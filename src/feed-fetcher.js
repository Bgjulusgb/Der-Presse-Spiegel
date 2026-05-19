'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');
const xml2js = require('xml2js');
const he = require('he');

const logger = require('./logger');
const { settings } = require('./config');
const { sleep } = require('./utils');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Accept': 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, application/json;q=0.7, text/html;q=0.6, */*;q=0.5',
  'Accept-Language': 'de-DE,de;q=0.9,en-US;q=0.7,en;q=0.6',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'DNT': '1',
  'Connection': 'keep-alive'
};

const lastRequestByDomain = new Map();

async function throttle(url) {
  try {
    const domain = new URL(url).hostname;
    const limit = settings.scraping.rate_limit_per_domain_ms || 1000;
    const last = lastRequestByDomain.get(domain) || 0;
    const wait = limit - (Date.now() - last);
    if (wait > 0) await sleep(wait);
    lastRequestByDomain.set(domain, Date.now());
  } catch {
    /* invalid url */
  }
}

function detectEncoding(buffer, contentType) {
  const headerMatch = (contentType || '').match(/charset=["']?([^;"'\s]+)/i);
  if (headerMatch) return headerMatch[1].toLowerCase();

  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return 'utf-8';
  }
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
    logger.warn(`Encoding ${enc} fehlgeschlagen, nutze utf-8: ${err.message}`);
  }
  return buffer.toString('utf8');
}

async function fetchRaw(url, { headers = {}, timeout, etag, lastModified } = {}) {
  const reqHeaders = { ...BROWSER_HEADERS, ...headers };
  if (etag) reqHeaders['If-None-Match'] = etag;
  if (lastModified) reqHeaders['If-Modified-Since'] = lastModified;

  await throttle(url);

  const res = await axios.get(url, {
    timeout: timeout || settings.scraping.request_timeout_ms || 20000,
    headers: reqHeaders,
    responseType: 'arraybuffer',
    decompress: true,
    maxRedirects: 5,
    validateStatus: status => status < 500 && status !== 429
  });

  return {
    status: res.status,
    headers: res.headers,
    buffer: Buffer.isBuffer(res.data) ? res.data : Buffer.from(res.data),
    finalUrl: res.request?.res?.responseUrl || url,
    etag: res.headers.etag,
    lastModified: res.headers['last-modified'],
    contentType: res.headers['content-type']
  };
}

async function fetchText(url, opts = {}) {
  const maxRetries = settings.scraping.max_retries || 3;
  const backoffBase = settings.scraping.retry_backoff_ms || 2000;
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchRaw(url, opts);
      if (res.status === 304) {
        return { status: 304, text: null, ...res };
      }
      if (res.status >= 400) {
        throw new Error(`HTTP ${res.status} fuer ${url}`);
      }
      const encoding = detectEncoding(res.buffer, res.contentType);
      const text = decode(res.buffer, encoding);
      return { ...res, text, encoding };
    } catch (err) {
      lastErr = err;
      const isLastAttempt = attempt === maxRetries;
      const isRetryable = err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' ||
                          err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN' ||
                          (err.message && err.message.includes('HTTP 5'));
      logger.warn(`Fetch fehlgeschlagen (${attempt + 1}/${maxRetries + 1}): ${err.message}`, { url });
      if (isLastAttempt || !isRetryable) break;
      await sleep(backoffBase * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

function looksLikeAtom(text) {
  return /<feed[\s>][^]*?xmlns=["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(text);
}

function looksLikeRdf(text) {
  return /<rdf:RDF/i.test(text);
}

function looksLikeRss(text) {
  return /<rss[\s>]/i.test(text) || /<channel>/i.test(text);
}

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
    const items = arr(ch.item).map(rssItemToArticle);
    return { title: textOf(ch.title), items };
  }

  if (parsed.feed && (parsed.feed.entry || parsed.feed.title)) {
    const f = parsed.feed;
    const items = arr(f.entry).map(atomEntryToArticle);
    return { title: textOf(f.title), items };
  }

  if (parsed['rdf:RDF']) {
    const rdf = parsed['rdf:RDF'];
    const items = arr(rdf.item).map(rdfItemToArticle);
    return { title: rdf.channel ? textOf(rdf.channel.title) : null, items };
  }

  throw new Error('Unbekanntes Feed-Format');
}

function arr(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

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

function rssItemToArticle(item) {
  return {
    title: textOf(item.title),
    url: textOf(item.link || item.guid),
    guid: textOf(item.guid),
    publishedDate: parseDateSafe(item.pubDate || item['dc:date'] || item.date),
    summary: textOf(item.description || item.summary || ''),
    content: textOf(item['content:encoded'] || item.content || ''),
    author: textOf(item['dc:creator'] || item.author || ''),
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
    title: textOf(entry.title),
    url: link,
    guid: textOf(entry.id),
    publishedDate: parseDateSafe(entry.published || entry.updated),
    summary: textOf(entry.summary || ''),
    content: textOf(entry.content || ''),
    author: entry.author ? textOf(entry.author.name || entry.author) : '',
    categories: arr(entry.category).map(c => c.term || textOf(c)).filter(Boolean)
  };
}

function rdfItemToArticle(item) {
  return {
    title: textOf(item.title),
    url: textOf(item.link || item['rdf:about']),
    guid: textOf(item.link || item['rdf:about']),
    publishedDate: parseDateSafe(item['dc:date'] || item.date),
    summary: textOf(item.description || ''),
    content: textOf(item['content:encoded'] || item.content || ''),
    author: textOf(item['dc:creator'] || ''),
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

async function fetchFeed(feed, { etag, lastModified } = {}) {
  const start = Date.now();
  try {
    const res = await fetchText(feed.url, { etag, lastModified });
    if (res.status === 304) {
      return {
        status: 'not-modified',
        items: [],
        responseTimeMs: Date.now() - start,
        etag,
        lastModified
      };
    }

    let parsed;
    if (looksLikeJsonFeed(res.text)) {
      parsed = parseJsonFeed(res.text);
    } else if (looksLikeRss(res.text) || looksLikeAtom(res.text) || looksLikeRdf(res.text)) {
      parsed = await parseFeedXml(res.text);
    } else {
      throw new Error('Inhalt ist kein erkennbarer Feed');
    }

    const items = parsed.items
      .map(it => ({
        ...it,
        url: cleanUrl(it.url),
        source: feed.name,
        sourcePriority: feed.priority || 50
      }))
      .filter(it => it.url);

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
    return {
      status: 'error',
      error: err.message,
      items: [],
      responseTimeMs: Date.now() - start
    };
  }
}

function cleanUrl(url) {
  if (!url) return '';
  return url.trim().replace(/&amp;/g, '&');
}

async function testFeed(feedUrl, name) {
  const start = Date.now();
  try {
    const res = await fetchText(feedUrl, { timeout: 10000 });
    let parsed = null;
    let feedType = 'unknown';
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
    return {
      ok: false,
      error: err.message,
      responseTimeMs: Date.now() - start
    };
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
  BROWSER_HEADERS
};
