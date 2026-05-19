'use strict';

const { request, Agent, setGlobalDispatcher, ProxyAgent } = require('undici');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');
const he = require('he');
const zlib = require('zlib');

const logger = require('./logger');
const { settings } = require('./config');
const { sleep } = require('./utils');

const dispatcher = new Agent({
  connect: { timeout: 15000 },
  keepAliveTimeout: 30000,
  keepAliveMaxTimeout: 60000,
  pipelining: 1,
  allowH2: true
});
setGlobalDispatcher(dispatcher);

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  try { setGlobalDispatcher(new ProxyAgent(proxyUrl)); }
  catch (e) { logger.warn(`Proxy konnte nicht gesetzt werden: ${e.message}`); }
}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
];

function pickUa(attempt = 0) {
  return USER_AGENTS[attempt % USER_AGENTS.length];
}

function buildHeaders({ ua, etag, lastModified, extra = {} } = {}) {
  return {
    'user-agent': ua || pickUa(),
    'accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, application/json;q=0.7, text/html;q=0.6, */*;q=0.5',
    'accept-language': 'de-DE,de;q=0.9,en-US;q=0.7,en;q=0.6',
    'accept-encoding': 'gzip, deflate, br',
    'cache-control': 'no-cache',
    'pragma': 'no-cache',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'dnt': '1',
    ...(etag && { 'if-none-match': etag }),
    ...(lastModified && { 'if-modified-since': lastModified }),
    ...extra
  };
}

const lastRequestByDomain = new Map();
async function throttle(url) {
  try {
    const domain = new URL(url).hostname;
    const limit = settings.scraping.rate_limit_per_domain_ms || 1000;
    const last = lastRequestByDomain.get(domain) || 0;
    const wait = limit - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    lastRequestByDomain.set(domain, Date.now());
  } catch { /* invalid url */ }
}

function detectEncoding(buffer, contentType) {
  const headerMatch = (contentType || '').match(/charset=["']?([^;"'\s]+)/i);
  if (headerMatch) return headerMatch[1].toLowerCase();
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) return 'utf-8';
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) return 'utf-16le';
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) return 'utf-16be';
  const head = buffer.slice(0, 4096).toString('ascii');
  const xmlMatch = head.match(/<\?xml[^>]+encoding=["']([^"']+)["']/i);
  if (xmlMatch) return xmlMatch[1].toLowerCase();
  const metaMatch = head.match(/<meta[^>]+charset=["']?([^>"'\s/]+)/i);
  if (metaMatch) return metaMatch[1].toLowerCase();
  return 'utf-8';
}

function decode(buffer, encoding) {
  const enc = (encoding || 'utf-8').toLowerCase().replace(/_/g, '-');
  try {
    if (enc === 'utf-8' || enc === 'utf8') return buffer.toString('utf8');
    if (iconv.encodingExists(enc)) return iconv.decode(buffer, enc);
  } catch (err) {
    logger.warn(`Encoding ${enc} fehlgeschlagen: ${err.message}`);
  }
  return buffer.toString('utf8');
}

async function decompressBody(body, contentEncoding) {
  if (!contentEncoding) return body;
  const enc = contentEncoding.toLowerCase();
  return new Promise((resolve, reject) => {
    const cb = (err, result) => err ? reject(err) : resolve(result);
    if (enc === 'gzip') zlib.gunzip(body, cb);
    else if (enc === 'deflate') zlib.inflate(body, cb);
    else if (enc === 'br') zlib.brotliDecompress(body, cb);
    else resolve(body);
  });
}

async function fetchRaw(url, { headers = {}, timeout, etag, lastModified, attempt = 0, maxRedirects = 6 } = {}) {
  const reqHeaders = buildHeaders({ ua: pickUa(attempt), etag, lastModified, extra: headers });
  await throttle(url);

  const t = timeout || settings.scraping.request_timeout_ms || 20000;
  let currentUrl = url;
  let redirects = 0;

  while (redirects <= maxRedirects) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), t);
    let res;
    try {
      res = await request(currentUrl, {
        method: 'GET',
        headers: reqHeaders,
        signal: controller.signal,
        maxRedirections: 0
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.statusCode >= 300 && res.statusCode < 400) {
      const location = res.headers.location;
      if (!location) break;
      const next = new URL(location, currentUrl).toString();
      try { await res.body.dump(); } catch {}
      currentUrl = next;
      redirects++;
      continue;
    }

    const chunks = [];
    for await (const chunk of res.body) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    body = await decompressBody(body, res.headers['content-encoding']);

    return {
      status: res.statusCode,
      headers: res.headers,
      buffer: body,
      finalUrl: currentUrl,
      etag: res.headers.etag,
      lastModified: res.headers['last-modified'],
      contentType: res.headers['content-type']
    };
  }

  throw new Error(`Zu viele Redirects (${maxRedirects})`);
}

async function fetchText(url, opts = {}) {
  const maxRetries = settings.scraping.max_retries || 3;
  const backoffBase = settings.scraping.retry_backoff_ms || 2000;
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchRaw(url, { ...opts, attempt });
      if (res.status === 304) return { status: 304, text: null, ...res };
      if (res.status >= 400) throw new Error(`HTTP ${res.status} fuer ${url}`);
      const encoding = detectEncoding(res.buffer, res.contentType);
      const text = decode(res.buffer, encoding);
      return { ...res, text, encoding };
    } catch (err) {
      lastErr = err;
      const isLast = attempt === maxRetries;
      const retryable = err.code === 'UND_ERR_SOCKET' || err.code === 'UND_ERR_CONNECT_TIMEOUT' ||
                        err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
                        err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' ||
                        err.name === 'AbortError' ||
                        (err.message && (err.message.includes('HTTP 5') || err.message.includes('HTTP 429')));
      logger.warn(`Fetch fehlgeschlagen (${attempt + 1}/${maxRetries + 1}): ${err.message}`, { url });
      if (isLast || !retryable) break;
      await sleep(backoffBase * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

function looksLikeAtom(text) {
  return /<feed[\s>][^]*?xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(text);
}
function looksLikeRdf(text) { return /<rdf:RDF/i.test(text); }
function looksLikeRss(text) { return /<rss[\s>]/i.test(text) || /<channel>/i.test(text); }
function looksLikeJsonFeed(text) {
  return text.trim().startsWith('{') && /jsonfeed\.org/i.test(text.slice(0, 1024));
}

async function parseFeedXml(text) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    mergeAttrs: true,
    explicitCharkey: false,
    trim: true,
    normalize: true,
    emptyTag: () => null,
    valueProcessors: [(val) => he.decode(val || '')]
  });
  const parsed = await parser.parseStringPromise(text);
  if (!parsed) throw new Error('Leeres XML');

  if (parsed.rss && parsed.rss.channel) {
    const ch = parsed.rss.channel;
    return { title: textOf(ch.title), items: arr(ch.item).map(rssItemToArticle) };
  }
  if (parsed.feed && (parsed.feed.entry || parsed.feed.title)) {
    return { title: textOf(parsed.feed.title), items: arr(parsed.feed.entry).map(atomEntryToArticle) };
  }
  if (parsed['rdf:RDF']) {
    const rdf = parsed['rdf:RDF'];
    return { title: rdf.channel ? textOf(rdf.channel.title) : null, items: arr(rdf.item).map(rdfItemToArticle) };
  }
  throw new Error('Unbekanntes Feed-Format');
}

function arr(x) { if (x == null) return []; return Array.isArray(x) ? x : [x]; }
function textOf(x) {
  if (x == null) return '';
  if (typeof x === 'string') return he.decode(x);
  if (typeof x === 'object') {
    if (typeof x._ === 'string') return he.decode(x._);
    if (typeof x['$t'] === 'string') return he.decode(x['$t']);
  }
  return String(x);
}
function parseDateSafe(s) {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rssItemToArticle(item) {
  return {
    title: stripHtml(textOf(item.title)),
    url: textOf(item.link || item.guid),
    guid: textOf(item.guid),
    publishedDate: parseDateSafe(item.pubDate || item['dc:date'] || item.date),
    summary: stripHtml(textOf(item.description || item.summary || '')),
    content: stripHtml(textOf(item['content:encoded'] || item.content || '')),
    author: stripHtml(textOf(item['dc:creator'] || item.author || '')),
    categories: arr(item.category).map(textOf).filter(Boolean)
  };
}

function atomEntryToArticle(entry) {
  let link = '';
  if (entry.link) {
    const links = arr(entry.link);
    const altLink = links.find(l => !l.rel || l.rel === 'alternate') || links[0];
    link = altLink ? (altLink.href || textOf(altLink)) : '';
  }
  return {
    title: stripHtml(textOf(entry.title)),
    url: link,
    guid: textOf(entry.id),
    publishedDate: parseDateSafe(entry.published || entry.updated),
    summary: stripHtml(textOf(entry.summary || '')),
    content: stripHtml(textOf(entry.content || '')),
    author: entry.author ? stripHtml(textOf(entry.author.name || entry.author)) : '',
    categories: arr(entry.category).map(c => c.term || textOf(c)).filter(Boolean)
  };
}

function rdfItemToArticle(item) {
  return {
    title: stripHtml(textOf(item.title)),
    url: textOf(item.link || item['rdf:about']),
    guid: textOf(item.link || item['rdf:about']),
    publishedDate: parseDateSafe(item['dc:date'] || item.date),
    summary: stripHtml(textOf(item.description || '')),
    content: stripHtml(textOf(item['content:encoded'] || item.content || '')),
    author: stripHtml(textOf(item['dc:creator'] || '')),
    categories: arr(item['dc:subject']).map(textOf).filter(Boolean)
  };
}

function parseJsonFeed(text) {
  const data = JSON.parse(text);
  const items = (data.items || []).map(item => ({
    title: item.title || '',
    url: item.url || item.id,
    guid: item.id,
    publishedDate: parseDateSafe(item.date_published),
    summary: item.summary || '',
    content: item.content_text || item.content_html || '',
    author: item.author?.name || item.authors?.[0]?.name || '',
    categories: item.tags || []
  }));
  return { title: data.title, items };
}

function cleanUrl(url) {
  if (!url) return '';
  return url.trim().replace(/&amp;/g, '&');
}

async function fetchFeed(feed, { etag, lastModified } = {}) {
  const start = Date.now();
  try {
    if (feed.kind === 'google-news') {
      const { fetchGoogleNewsFeed } = require('./news-search');
      return await fetchGoogleNewsFeed(feed);
    }
    if (feed.kind === 'bing-news') {
      const { fetchBingNewsFeed } = require('./news-search');
      return await fetchBingNewsFeed(feed);
    }

    const res = await fetchText(feed.url, { etag, lastModified });
    if (res.status === 304) {
      return { status: 'not-modified', items: [], responseTimeMs: Date.now() - start, etag, lastModified };
    }

    let parsed;
    if (looksLikeJsonFeed(res.text)) parsed = parseJsonFeed(res.text);
    else if (looksLikeRss(res.text) || looksLikeAtom(res.text) || looksLikeRdf(res.text)) parsed = await parseFeedXml(res.text);
    else throw new Error('Inhalt ist kein erkennbarer Feed');

    const items = parsed.items.map(it => ({
      ...it,
      url: cleanUrl(it.url),
      source: feed.name,
      sourcePriority: feed.priority || 50
    })).filter(it => it.url);

    return {
      status: 'ok',
      title: parsed.title,
      items,
      responseTimeMs: Date.now() - start,
      etag: res.etag,
      lastModified: res.lastModified,
      contentType: res.contentType
    };
  } catch (err) {
    return { status: 'error', error: err.message, items: [], responseTimeMs: Date.now() - start };
  }
}

async function testFeed(feedUrl, name) {
  const start = Date.now();
  try {
    if (feedUrl && feedUrl.startsWith('google-news:')) {
      const { fetchGoogleNewsFeed } = require('./news-search');
      const result = await fetchGoogleNewsFeed({ name, queries: [feedUrl.slice('google-news:'.length)], priority: 80 });
      return {
        ok: result.status === 'ok',
        type: 'google-news',
        itemCount: result.items.length,
        sample: result.items.slice(0, 3).map(i => ({ title: i.title, url: i.url, published: i.publishedDate })),
        responseTimeMs: Date.now() - start,
        title: 'Google News',
        error: result.error
      };
    }
    const res = await fetchText(feedUrl, { timeout: 10000 });
    let parsed = null, feedType = 'unknown';
    if (looksLikeJsonFeed(res.text)) { parsed = parseJsonFeed(res.text); feedType = 'json'; }
    else if (looksLikeAtom(res.text)) { parsed = await parseFeedXml(res.text); feedType = 'atom'; }
    else if (looksLikeRdf(res.text)) { parsed = await parseFeedXml(res.text); feedType = 'rdf'; }
    else if (looksLikeRss(res.text)) { parsed = await parseFeedXml(res.text); feedType = 'rss'; }
    else throw new Error('Inhalt ist kein erkennbarer Feed');

    return {
      ok: true,
      status: res.status,
      type: feedType,
      title: parsed.title,
      itemCount: parsed.items.length,
      sample: parsed.items.slice(0, 3).map(i => ({ title: i.title, url: i.url, published: i.publishedDate })),
      responseTimeMs: Date.now() - start,
      contentType: res.contentType,
      encoding: res.encoding
    };
  } catch (err) {
    return { ok: false, error: err.message, responseTimeMs: Date.now() - start };
  }
}

module.exports = {
  fetchRaw,
  fetchText,
  fetchFeed,
  testFeed,
  parseFeedXml,
  parseJsonFeed,
  detectEncoding,
  decode,
  USER_AGENTS,
  buildHeaders
};
