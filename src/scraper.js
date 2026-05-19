'use strict';

const cheerio = require('cheerio');
const pLimit = require('p-limit');
const { parse: parseDate, isValid } = require('date-fns');

const logger = require('./logger');
const { settings, sources } = require('./config');
const { normalizeUrl } = require('./utils');
const { extractFirstParagraph } = require('./deduplicator');
const database = require('./database');
const { fetchFeed, fetchText, testFeed } = require('./feed-fetcher');

function extractArticleDate(html, url) {
  if (!html) return tryUrlDate(url) || null;
  const $ = cheerio.load(html);

  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[property="article:published"]',
    'meta[name="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[property="og:article:published_time"]',
    'meta[name="published"]',
    'meta[name="pubdate"]',
    'meta[name="publish-date"]',
    'meta[name="date"]',
    'meta[itemprop="datePublished"]',
    'meta[name="DC.date.issued"]',
    'meta[name="parsely-pub-date"]',
    'meta[name="sailthru.date"]'
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
      const items = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
      for (const item of items) {
        if (!item) continue;
        const candidates = [item.datePublished, item.dateCreated, item.uploadDate, item.dateModified];
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

  const timeAttr = $('time[datetime]').first().attr('datetime') ||
                   $('[itemprop="datePublished"]').first().attr('datetime') ||
                   $('[itemprop="datePublished"]').first().attr('content');
  if (timeAttr) {
    const parsed = new Date(timeAttr);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const urlDate = tryUrlDate(url);
  if (urlDate) return urlDate;

  const bodyText = $('body').text().slice(0, 4000);
  const textDate = tryTextDate(bodyText);
  if (textDate) return textDate;

  return null;
}

function tryUrlDate(url) {
  if (!url) return null;
  const m = url.match(/(\d{4})[\/\-_](\d{1,2})[\/\-_](\d{1,2})/);
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
  januar: 0, jan: 0,
  februar: 1, feb: 1,
  maerz: 2, märz: 2, mar: 2,
  april: 3, apr: 3,
  mai: 4,
  juni: 5, jun: 5,
  juli: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  oktober: 9, okt: 9, oct: 9,
  november: 10, nov: 10,
  dezember: 11, dez: 11, dec: 11
};

function tryTextDate(text) {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\.\s*(Januar|Februar|M[aä]rz|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|Jan|Feb|M[aä]r|Apr|Mai|Jun|Jul|Aug|Sep|Sept|Okt|Nov|Dez)\.?\s*(\d{4})/i);
  if (m) {
    const day = parseInt(m[1], 10);
    const monthKey = m[2].toLowerCase().replace('.', '');
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

const ARTICLE_SELECTORS = [
  'article[itemtype*="NewsArticle"]',
  '[itemprop="articleBody"]',
  'article.article',
  'div.article-body',
  'div.article__body',
  'div.entry-content',
  'div.post-content',
  'div.content__article-body',
  'div.story-body',
  'div.text-block',
  'main article',
  'article',
  'main'
];

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'embed', 'object',
  'nav', 'header', 'footer', 'aside', 'form',
  '.ad', '.ads', '.advertisement', '.advertising', '.banner',
  '.newsletter', '.newsletter-signup', '.subscribe',
  '.related', '.related-articles', '.recommendations', '.read-more',
  '.share', '.social', '.social-share', '.sharing',
  '.comments', '.comment-section', '.disqus',
  '.cookie', '.cookie-banner', '.gdpr',
  '.popup', '.modal', '.overlay',
  '.breadcrumb', '.breadcrumbs', '.tags', '.taglist',
  '.author-box', '.author-info',
  '[role="banner"]', '[role="navigation"]', '[role="contentinfo"]',
  '[aria-label*="cookie" i]', '[aria-label*="werbung" i]',
  'figure figcaption', '.image-credit', '.photo-credit',
  '.amp-ad', 'amp-ad'
];

function tryReadability(html, url) {
  try {
    const { Readability } = require('@mozilla/readability');
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document, { charThreshold: 200 });
    const article = reader.parse();
    if (!article || !article.textContent) return null;
    return {
      title: article.title || '',
      author: article.byline || null,
      text: article.textContent.replace(/\s+/g, ' ').trim(),
      excerpt: article.excerpt || '',
      siteName: article.siteName || ''
    };
  } catch (err) {
    return null;
  }
}

function extractArticleContent(html, url) {
  if (!html) return { title: '', text: '', firstParagraph: '', paywall: false };

  const $ = cheerio.load(html);

  REMOVE_SELECTORS.forEach(sel => { try { $(sel).remove(); } catch {} });

  let title = $('meta[property="og:title"]').attr('content') ||
              $('meta[name="twitter:title"]').attr('content') ||
              $('meta[itemprop="headline"]').attr('content') ||
              $('h1[itemprop="headline"]').first().text().trim() ||
              $('h1').first().text().trim() ||
              $('title').first().text().trim();
  title = (title || '').replace(/\s+/g, ' ').trim();
  title = title.split(/\s[\-–|·]\s/)[0].trim() || title;

  let author = $('meta[name="author"]').attr('content') ||
               $('meta[property="article:author"]').attr('content') ||
               $('[itemprop="author"] [itemprop="name"]').first().text() ||
               $('[itemprop="author"]').first().text() ||
               $('[rel="author"]').first().text().trim() ||
               $('.author').first().text().trim() ||
               $('.byline').first().text().trim() ||
               null;
  if (author) author = author.replace(/\s+/g, ' ').replace(/^(von|by)\s+/i, '').trim();
  if (author && author.length > 80) author = null;

  let description = $('meta[property="og:description"]').attr('content') ||
                    $('meta[name="description"]').attr('content') ||
                    $('meta[name="twitter:description"]').attr('content') ||
                    '';
  description = description.replace(/\s+/g, ' ').trim();

  let bestContainer = null;
  let bestScore = 0;
  for (const sel of ARTICLE_SELECTORS) {
    const els = $(sel);
    els.each((_, el) => {
      const $el = $(el);
      const text = $el.text().trim();
      if (text.length < 200) return;
      const pCount = $el.find('p').length;
      const score = text.length + pCount * 100;
      if (score > bestScore) {
        bestScore = score;
        bestContainer = $el;
      }
    });
    if (bestContainer && bestScore > 1000) break;
  }
  if (!bestContainer) bestContainer = $('body');

  const paragraphs = [];
  bestContainer.find('p, h2, h3, blockquote, li').each((_, el) => {
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (text.length >= 25) {
      paragraphs.push(text);
    }
  });

  if (paragraphs.length === 0) {
    const fallback = bestContainer.text().replace(/\s+/g, ' ').trim();
    if (fallback) paragraphs.push(fallback);
  }
  const text = paragraphs.join('\n\n');
  const firstParagraph = extractFirstParagraph(text);

  const paywallSignals = [
    'paywall', 'sz-plus', 'sueddeutsche-plus', 'spplus', 'subscriber-only',
    'plus-artikel', 'nur-fuer-abonnenten', 'abo-artikel', 'premium-content',
    '"isAccessibleForFree":false', 'data-paywall', 'class="paywall',
    'm-paywall', 'paid-content', 'metered-content'
  ];
  const htmlLower = html.toLowerCase();
  const paywall = paywallSignals.some(s => htmlLower.includes(s.toLowerCase()));

  let finalText = text;
  let finalTitle = title;
  let finalAuthor = author;
  const readabilityResult = tryReadability(html, url);
  if (readabilityResult && readabilityResult.text.length > finalText.length * 0.8) {
    finalText = readabilityResult.text;
    if (readabilityResult.title && readabilityResult.title.length > 5) finalTitle = readabilityResult.title;
    if (readabilityResult.author && !finalAuthor) finalAuthor = readabilityResult.author;
  }
  const finalFirstParagraph = extractFirstParagraph(finalText);

  return {
    title: finalTitle,
    author: finalAuthor,
    description,
    text: finalText,
    firstParagraph: finalFirstParagraph,
    paywall
  };
}

async function fetchRssFeed(feed) {
  const health = database.getSourceHealth(feed.name);
  const conditional = health
    ? { etag: health.etag, lastModified: health.last_modified }
    : {};

  let result;
  if (feed.use_browser === true) {
    const { fetchFeedViaBrowser } = require('./puppeteer-fetcher');
    result = await fetchFeedViaBrowser(feed);
  } else {
    result = await fetchFeed(feed, conditional);

    const shouldRetryWithBrowser =
      result.status === 'error' &&
      typeof result.error === 'string' &&
      (result.error.includes('HTTP 403') || result.error.includes('HTTP 429') || result.error.includes('challenge')) &&
      feed.use_browser !== false &&
      settings.scraping.puppeteer_fallback !== false;

    if (shouldRetryWithBrowser) {
      logger.info(`Versuche Puppeteer-Fallback fuer ${feed.name} nach: ${result.error}`);
      const { fetchFeedViaBrowser } = require('./puppeteer-fetcher');
      const browserResult = await fetchFeedViaBrowser(feed);
      if (browserResult.status === 'ok') {
        result = browserResult;
      }
    }
  }

  if (result.status === 'not-modified') {
    database.recordSourceSuccess(feed.name, {
      etag: health.etag,
      lastModified: health.last_modified,
      responseTimeMs: result.responseTimeMs,
      itemCount: 0,
      feedType: 'unchanged'
    });
    logger.info(`RSS: ${feed.name} - 304 Not Modified (${result.responseTimeMs}ms)`);
    return [];
  }

  if (result.status === 'error') {
    database.recordSourceFailure(feed.name, result.error, {
      responseTimeMs: result.responseTimeMs
    });
    logger.error(`RSS fehlgeschlagen: ${feed.name}: ${result.error}`);
    return [];
  }

  database.recordSourceSuccess(feed.name, {
    etag: result.etag,
    lastModified: result.lastModified,
    responseTimeMs: result.responseTimeMs,
    itemCount: result.items.length,
    contentType: result.contentType,
    feedType: 'rss/atom'
  });
  logger.info(`RSS: ${feed.name} -> ${result.items.length} Eintraege (${result.responseTimeMs}ms)`);

  return result.items.map(item => ({
    title: item.title,
    url: item.url,
    publishedDate: item.publishedDate,
    summary: item.summary,
    content: item.content,
    author: item.author,
    source: feed.name,
    sourcePriority: feed.priority || 50
  })).filter(it => it.url);
}

function buildFromRss(item, originalUrl) {
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
    meta: {
      fallback: 'rss-only',
      original_url: originalUrl || item.url,
      fetched_at: new Date().toISOString()
    }
  };
}

async function fetchArticleDetails(item) {
  const isGoogleNews = item.googleNewsRedirect || (item.url && item.url.includes('news.google.com'));
  const fetchTimeout = isGoogleNews ? 10000 : (settings.scraping.request_timeout_ms || 20000);

  try {
    let targetUrl = item.url;
    if (isGoogleNews) {
      try {
        const { resolveGoogleNewsUrl } = require('./news-search');
        const resolved = await Promise.race([
          require('./news-search').resolveGoogleNewsUrl(targetUrl),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Redirect-Timeout')), 8000))
        ]);
        if (resolved && resolved !== targetUrl && !resolved.includes('news.google.com')) {
          targetUrl = resolved;
          item.url = targetUrl;
        }
      } catch (e) {
        logger.debug(`Google-News-Redirect ueberprungen: ${e.message}`);
        return buildFromRss(item);
      }
    }

    const res = await Promise.race([
      fetchText(targetUrl, { timeout: fetchTimeout }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Fetch-Timeout')), fetchTimeout + 2000))
    ]);
    if (res.status === 304) return null;
    const html = res.text;
    const content = extractArticleContent(html, targetUrl);
    let publishedDate = item.publishedDate;
    if (!publishedDate) {
      publishedDate = extractArticleDate(html, item.url);
    }
    const title = (item.title || content.title || '').replace(/\s+/g, ' ').trim();
    const fullText = content.text || item.content || item.summary || '';
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;

    return {
      url: item.url,
      urlNormalized: normalizeUrl(item.url),
      title,
      source: item.source,
      sourcePriority: item.sourcePriority || 50,
      author: item.author || content.author,
      publishedDate,
      fullText,
      firstParagraph: content.firstParagraph || extractFirstParagraph(fullText),
      paywall: content.paywall,
      wordCount,
      meta: { fetched_at: new Date().toISOString(), description: content.description }
    };
  } catch (err) {
    logger.debug(`Artikel-Details fehlgeschlagen: ${item.url} (${err.message})`);
    const fallback = buildFromRss(item);
    fallback.meta = { ...fallback.meta, fetch_error: err.message };
    return fallback;
  }
}

async function gatherFromFeeds(feedsConfig) {
  const list = feedsConfig || sources.feeds || [];
  const enabledFeeds = list.filter(f => {
    if (f.disabled === true) return false;
    const h = database.getSourceHealth(f.name);
    return !h || h.enabled !== 0;
  });
  if (enabledFeeds.length < list.length) {
    logger.info(`${list.length - enabledFeeds.length} Feeds deaktiviert, ${enabledFeeds.length} aktiv`);
  }
  const limit = pLimit(settings.scraping.max_concurrent_requests || 4);
  const results = await Promise.all(
    enabledFeeds.map(feed => limit(() => fetchRssFeed(feed)))
  );
  return results.flat();
}

async function enrichItems(items, { from, to }) {
  const limit = pLimit(settings.scraping.max_concurrent_requests || 4);

  const seen = new Set();
  const deduped = [];
  for (const item of items) {
    const key = normalizeUrl(item.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  const inRange = deduped.filter(item => {
    if (!item.publishedDate) return true;
    if (from && item.publishedDate < from) return false;
    if (to && item.publishedDate > to) return false;
    return true;
  });

  const existing = new Set();
  for (const item of inRange) {
    const norm = normalizeUrl(item.url);
    const hit = database.findByNormalizedUrl(norm);
    if (hit) existing.add(norm);
  }
  const fresh = inRange.filter(i => !existing.has(normalizeUrl(i.url)));
  if (existing.size > 0) {
    logger.info(`Anreicherung: ${fresh.length} neu, ${existing.size} schon in DB`);
  } else {
    logger.info(`Anreicherung: ${fresh.length} von ${items.length} Items im Zeitraum`);
  }

  const enriched = await Promise.all(
    fresh.map(item => limit(() => fetchArticleDetails(item)))
  );

  return enriched.filter(a => {
    if (!a) return false;
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
  fetchText,
  testFeed,
  extractArticleDate,
  extractArticleContent,
  gatherFromFeeds,
  enrichItems
};
