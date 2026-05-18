'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const Parser = require('rss-parser');
const pLimit = require('p-limit');
const { parse: parseDate, isValid } = require('date-fns');

const logger = require('./logger');
const { settings, sources } = require('./config');
const { normalizeUrl, sleep } = require('./utils');
const { extractFirstParagraph } = require('./deduplicator');
const database = require('./database');

const rssParser = new Parser({
  timeout: settings.scraping.request_timeout_ms,
  headers: { 'User-Agent': settings.scraping.user_agent },
  customFields: {
    item: [
      ['media:content', 'media'],
      ['content:encoded', 'contentEncoded'],
      ['dc:creator', 'creator']
    ]
  }
});

const http = axios.create({
  timeout: settings.scraping.request_timeout_ms,
  headers: {
    'User-Agent': settings.scraping.user_agent,
    'Accept': 'text/html,application/xhtml+xml,application/xml,application/rss+xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
  },
  maxRedirects: 5,
  validateStatus: status => status < 500
});

const lastRequestByDomain = new Map();
async function throttleDomain(url) {
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

async function fetchWithRetry(url, options = {}) {
  const maxRetries = settings.scraping.max_retries || 3;
  let lastErr = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await throttleDomain(url);
      const res = await http.get(url, options);
      if (res.status >= 400) {
        throw new Error(`HTTP ${res.status} fuer ${url}`);
      }
      return res;
    } catch (err) {
      lastErr = err;
      const backoff = (settings.scraping.retry_backoff_ms || 2000) * Math.pow(2, attempt);
      logger.warn(`Fetch fehlgeschlagen (Versuch ${attempt + 1}/${maxRetries + 1}): ${err.message}`, { url });
      if (attempt < maxRetries) await sleep(backoff);
    }
  }
  throw lastErr;
}

function extractArticleDate(html, url) {
  if (!html) return tryUrlDate(url) || null;
  const $ = cheerio.load(html);

  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="published"]',
    'meta[name="pubdate"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
    'meta[name="DC.date.issued"]'
  ];
  for (const sel of metaSelectors) {
    const content = $(sel).attr('content');
    if (content) {
      const parsed = new Date(content);
      if (!isNaN(parsed.getTime())) return parsed;
    }
  }

  const jsonLdNodes = $('script[type="application/ld+json"]');
  for (let i = 0; i < jsonLdNodes.length; i++) {
    try {
      const raw = $(jsonLdNodes[i]).html();
      if (!raw) continue;
      const data = JSON.parse(raw);
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const candidates = [item.datePublished, item.dateCreated, item.uploadDate];
        for (const c of candidates) {
          if (c) {
            const parsed = new Date(c);
            if (!isNaN(parsed.getTime())) return parsed;
          }
        }
      }
    } catch {
      /* skip invalid json-ld */
    }
  }

  const timeAttr = $('time[datetime]').first().attr('datetime');
  if (timeAttr) {
    const parsed = new Date(timeAttr);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const urlDate = tryUrlDate(url);
  if (urlDate) return urlDate;

  const text = $('body').text().slice(0, 3000);
  const textDate = tryTextDate(text);
  if (textDate) return textDate;

  return null;
}

function tryUrlDate(url) {
  if (!url) return null;
  const m = url.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  return isNaN(d.getTime()) ? null : d;
}

const MONTHS = {
  januar: 0, februar: 1, maerz: 2, märz: 2, april: 3, mai: 4, juni: 5,
  juli: 6, august: 7, september: 8, oktober: 9, november: 10, dezember: 11
};

function tryTextDate(text) {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\.\s*(Januar|Februar|M[aä]rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s*(\d{4})/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthKey = m[2].toLowerCase();
    const month = MONTHS[monthKey];
    const year = parseInt(m[3], 10);
    if (month !== undefined) {
      const d = new Date(Date.UTC(year, month, day));
      if (!isNaN(d.getTime())) return d;
    }
  }
  const m2 = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m2) {
    const parsed = parseDate(`${m2[1]}.${m2[2]}.${m2[3]}`, 'd.M.yyyy', new Date());
    if (isValid(parsed)) return parsed;
  }
  return null;
}

function extractArticleContent(html, url) {
  if (!html) return { title: '', text: '', firstParagraph: '', paywall: false };
  const $ = cheerio.load(html);

  $('script, style, noscript, iframe, nav, header, footer, aside, form, .ad, .ads, .advertisement, .newsletter, .related, .recommendations').remove();

  let title = $('meta[property="og:title"]').attr('content') ||
              $('meta[name="twitter:title"]').attr('content') ||
              $('h1').first().text().trim() ||
              $('title').first().text().trim();
  title = (title || '').replace(/\s+/g, ' ').trim();

  let author = $('meta[name="author"]').attr('content') ||
               $('meta[property="article:author"]').attr('content') ||
               $('[rel="author"]').first().text().trim() ||
               null;
  if (author) author = author.replace(/\s+/g, ' ').trim();

  const articleSelectors = ['article', '[itemprop="articleBody"]', '.article-body', '.entry-content', 'main'];
  let textContainer = null;
  for (const sel of articleSelectors) {
    const el = $(sel).first();
    if (el.length && el.text().trim().length > 200) {
      textContainer = el;
      break;
    }
  }
  if (!textContainer) textContainer = $('body');

  const paragraphs = [];
  textContainer.find('p').each((_, p) => {
    const t = $(p).text().replace(/\s+/g, ' ').trim();
    if (t.length >= 30) paragraphs.push(t);
  });
  if (paragraphs.length === 0) {
    const fallback = textContainer.text().replace(/\s+/g, ' ').trim();
    if (fallback) paragraphs.push(fallback);
  }
  const text = paragraphs.join('\n\n');
  const firstParagraph = extractFirstParagraph(text);

  const paywallSignals = [
    'paywall', 'sz-plus', 'sueddeutsche-plus', 'spplus', 'subscriber-only',
    'plus-artikel', 'nur-fuer-abonnenten', 'abo-artikel'
  ];
  const htmlLower = html.toLowerCase();
  const paywall = paywallSignals.some(s => htmlLower.includes(s));

  return { title, author, text, firstParagraph, paywall };
}

async function fetchRssFeed(feed) {
  try {
    const parsed = await rssParser.parseURL(feed.url);
    database.recordSourceSuccess(feed.name);
    const items = (parsed.items || []).map(item => ({
      title: item.title || '',
      url: item.link || item.guid,
      publishedDate: item.isoDate ? new Date(item.isoDate) : (item.pubDate ? new Date(item.pubDate) : null),
      summary: item.contentSnippet || item.summary || '',
      content: item.contentEncoded || item.content || '',
      author: item.creator || item.author || null,
      source: feed.name,
      sourcePriority: feed.priority || 50
    })).filter(it => it.url);
    logger.info(`RSS: ${feed.name} → ${items.length} Eintraege`);
    return items;
  } catch (err) {
    database.recordSourceFailure(feed.name, err.message);
    logger.error(`RSS fehlgeschlagen: ${feed.name}`, { url: feed.url, error: err.message });
    return [];
  }
}

async function fetchArticleDetails(item) {
  try {
    const res = await fetchWithRetry(item.url);
    const html = res.data;
    const content = extractArticleContent(html, item.url);
    let publishedDate = item.publishedDate;
    if (!publishedDate) {
      publishedDate = extractArticleDate(html, item.url);
    }
    const title = item.title || content.title;
    const fullText = content.text || item.content || item.summary || '';
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    return {
      url: item.url,
      urlNormalized: normalizeUrl(item.url),
      title: (title || '').replace(/\s+/g, ' ').trim(),
      source: item.source,
      sourcePriority: item.sourcePriority || 50,
      author: item.author || content.author,
      publishedDate,
      fullText,
      firstParagraph: content.firstParagraph || extractFirstParagraph(fullText),
      paywall: content.paywall,
      wordCount,
      meta: { fetched_at: new Date().toISOString() }
    };
  } catch (err) {
    logger.warn(`Artikel-Details fehlgeschlagen: ${item.url} (${err.message})`);
    const fallbackText = item.content || item.summary || '';
    return {
      url: item.url,
      urlNormalized: normalizeUrl(item.url),
      title: (item.title || '').replace(/\s+/g, ' ').trim(),
      source: item.source,
      sourcePriority: item.sourcePriority || 50,
      author: item.author,
      publishedDate: item.publishedDate,
      fullText: fallbackText,
      firstParagraph: extractFirstParagraph(fallbackText),
      paywall: false,
      wordCount: fallbackText.split(/\s+/).filter(Boolean).length,
      meta: { fetch_error: err.message, fetched_at: new Date().toISOString() }
    };
  }
}

async function gatherFromFeeds(feedsConfig = sources.feeds) {
  const limit = pLimit(settings.scraping.max_concurrent_requests || 4);
  const results = await Promise.all(
    feedsConfig.map(feed => limit(() => fetchRssFeed(feed)))
  );
  return results.flat();
}

async function enrichItems(items, { from, to }) {
  const limit = pLimit(settings.scraping.max_concurrent_requests || 4);
  const filtered = items.filter(item => {
    if (!item.publishedDate) return true;
    if (from && item.publishedDate < from) return false;
    if (to && item.publishedDate > to) return false;
    return true;
  });
  logger.info(`Anreicherung: ${filtered.length} von ${items.length} Items im Zeitraum`);
  const enriched = await Promise.all(filtered.map(item => limit(() => fetchArticleDetails(item))));
  return enriched.filter(a => {
    if (!a.publishedDate) {
      logger.warn(`Artikel ohne Datum, verwende aktuelles Datum: ${a.url}`);
      a.publishedDate = new Date();
      a.meta = { ...a.meta, date_warning: true };
    }
    if (from && a.publishedDate < from) return false;
    if (to && a.publishedDate > to) return false;
    return true;
  });
}

module.exports = {
  fetchRssFeed,
  fetchArticleDetails,
  fetchWithRetry,
  extractArticleDate,
  extractArticleContent,
  gatherFromFeeds,
  enrichItems
};
