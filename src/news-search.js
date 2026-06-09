'use strict';

const cheerio = require('cheerio');
const logger = require('./logger');
const { keywords } = require('./config');
const { fetchText, parseFeedXml } = require('./feed-fetcher');

// Generiert Aggregator-Queries aus keywords.json (Feld "queries_from" am
// Feed, z. B. ["productions", "people"]). Neue Stuecke/Ensemble-Mitglieder
// landen damit automatisch im Backbone, ohne sources.json zu pflegen.
function expandFeedQueries(feed, kw = keywords) {
  const queries = [...(feed.queries || [])];
  const sets = Array.isArray(feed.queries_from) ? feed.queries_from : [];
  for (const setName of sets) {
    const list = Array.isArray(kw && kw[setName]) ? kw[setName] : [];
    for (const raw of list) {
      const term = String(raw || '').trim();
      if (term.length < 3) continue;
      // Personen nur mit vollem Namen — blanke Nachnamen sind zu unscharf
      if (setName === 'people' && !term.includes(' ')) continue;
      queries.push(`"${term}" Kammerspiele`);
    }
  }
  // Dedupe (case-insensitiv, stabile Reihenfolge) + Limit gegen
  // Query-Explosion: jede Query ist ein eigener HTTP-Abruf pro Scan
  const seen = new Set();
  const result = [];
  for (const q of queries) {
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(q);
  }
  const max = Number.isInteger(feed.max_queries) ? feed.max_queries : 24;
  return result.slice(0, max);
}

// Detects whether a response body is actually a feed. News aggregators
// (especially Bing) sometimes return an HTML page instead of RSS — parsing
// that as XML throws a cryptic error, so we check up front and skip cleanly.
function looksLikeFeed(text) {
  if (!text) return false;
  const head = text.slice(0, 2048).toLowerCase();
  if (/^\s*\{/.test(text) && /jsonfeed\.org/.test(head)) return true;
  if (/<!doctype html|<html[\s>]/.test(head) && !/<rss|<feed|<rdf:rdf/.test(head)) return false;
  return /<rss[\s>]|<feed[\s>]|<rdf:rdf|<channel[\s>]/.test(head);
}

function buildGoogleNewsUrl(query, { hl = 'de', gl = 'DE', ceid = 'DE:de' } = {}) {
  const q = encodeURIComponent(query);
  return `https://news.google.com/rss/search?q=${q}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

function buildBingNewsUrl(query, { mkt = 'de-DE' } = {}) {
  const q = encodeURIComponent(query);
  return `https://www.bing.com/news/search?q=${q}&format=rss&mkt=${mkt}`;
}

const redirectCache = new Map();

async function resolveGoogleNewsUrl(googleUrl) {
  if (!googleUrl || !googleUrl.includes('news.google.com')) return googleUrl;
  if (redirectCache.has(googleUrl)) return redirectCache.get(googleUrl);
  try {
    const res = await fetchText(googleUrl, { timeout: 15000 });
    const html = res.text;
    const $ = cheerio.load(html);

    const metaRefresh = $('meta[http-equiv="refresh"]').attr('content');
    if (metaRefresh) {
      const m = metaRefresh.match(/url=(.+)$/i);
      if (m) {
        const resolved = m[1].trim().replace(/^['"]|['"]$/g, '');
        redirectCache.set(googleUrl, resolved);
        return resolved;
      }
    }

    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical && !canonical.includes('news.google.com')) {
      redirectCache.set(googleUrl, canonical);
      return canonical;
    }

    const ogUrl = $('meta[property="og:url"]').attr('content');
    if (ogUrl && !ogUrl.includes('news.google.com')) {
      redirectCache.set(googleUrl, ogUrl);
      return ogUrl;
    }

    const jsRedirect = html.match(/window\.location\.replace\(["']([^"']+)["']\)/);
    if (jsRedirect) {
      redirectCache.set(googleUrl, jsRedirect[1]);
      return jsRedirect[1];
    }

    const aTag = $('a[href]').first().attr('href');
    if (aTag && aTag.startsWith('http') && !aTag.includes('news.google.com')) {
      redirectCache.set(googleUrl, aTag);
      return aTag;
    }

    if (res.finalUrl && !res.finalUrl.includes('news.google.com')) {
      redirectCache.set(googleUrl, res.finalUrl);
      return res.finalUrl;
    }
  } catch (err) {
    logger.debug(`Konnte Google-News-Redirect nicht aufloesen: ${err.message}`);
  }
  redirectCache.set(googleUrl, googleUrl);
  return googleUrl;
}

function extractSourceFromGoogleTitle(title) {
  if (!title) return null;
  const m = title.match(/\s+-\s+([^-]+)$/);
  if (m) return m[1].trim();
  return null;
}

function cleanGoogleNewsTitle(title) {
  if (!title) return '';
  return title.replace(/\s+-\s+[^-]+$/, '').trim();
}

async function fetchGoogleNewsFeed(feed) {
  const start = Date.now();
  const queries = expandFeedQueries(feed);
  if (queries.length === 0) queries.push(feed.query || 'Münchner Kammerspiele');
  const allItems = new Map();

  for (const query of queries) {
    const url = buildGoogleNewsUrl(query);
    try {
      const res = await fetchText(url, { timeout: 20000 });
      if (!looksLikeFeed(res.text)) {
        logger.warn(`Google News Query "${query}": Antwort ist kein Feed (HTML?), uebersprungen`);
        continue;
      }
      const parsed = await parseFeedXml(res.text);
      for (const item of parsed.items) {
        if (!item.url) continue;
        const sourceName = extractSourceFromGoogleTitle(item.title) || 'Google News';
        const cleanTitle = cleanGoogleNewsTitle(item.title);
        const key = `${cleanTitle}::${sourceName}`;
        if (allItems.has(key)) continue;
        allItems.set(key, {
          title: cleanTitle,
          url: item.url,
          guid: item.guid,
          publishedDate: item.publishedDate,
          summary: item.summary,
          content: item.content,
          author: item.author,
          source: `${sourceName} (via Google News)`,
          sourcePriority: feed.priority || 80,
          googleNewsRedirect: true,
          searchQuery: query,
        });
      }
    } catch (err) {
      logger.warn(`Google News Query "${query}" fehlgeschlagen: ${err.message}`);
    }
  }

  const items = Array.from(allItems.values());
  return {
    status: items.length > 0 ? 'ok' : 'error',
    title: 'Google News',
    items,
    responseTimeMs: Date.now() - start,
    error: items.length === 0 ? `Alle ${queries.length} Queries fehlgeschlagen` : null,
    feedType: 'google-news',
  };
}

async function fetchBingNewsFeed(feed) {
  const start = Date.now();
  const queries = expandFeedQueries(feed);
  if (queries.length === 0) queries.push(feed.query || 'Münchner Kammerspiele');
  const allItems = new Map();

  for (const query of queries) {
    const url = buildBingNewsUrl(query);
    try {
      const res = await fetchText(url, { timeout: 20000 });
      if (!looksLikeFeed(res.text)) {
        logger.warn(`Bing News Query "${query}": Antwort ist kein Feed (HTML?), uebersprungen`);
        continue;
      }
      const parsed = await parseFeedXml(res.text);
      for (const item of parsed.items) {
        if (!item.url || allItems.has(item.url)) continue;
        allItems.set(item.url, {
          ...item,
          source: feed.name || 'Bing News',
          sourcePriority: feed.priority || 70,
        });
      }
    } catch (err) {
      logger.warn(`Bing News Query "${query}" fehlgeschlagen: ${err.message}`);
    }
  }

  const items = Array.from(allItems.values());
  return {
    status: items.length > 0 ? 'ok' : 'error',
    items,
    responseTimeMs: Date.now() - start,
    feedType: 'bing-news',
    error: items.length === 0 ? 'Keine Treffer' : null,
  };
}

module.exports = {
  buildGoogleNewsUrl,
  buildBingNewsUrl,
  expandFeedQueries,
  resolveGoogleNewsUrl,
  fetchGoogleNewsFeed,
  fetchBingNewsFeed,
  cleanGoogleNewsTitle,
  extractSourceFromGoogleTitle,
  looksLikeFeed,
};
