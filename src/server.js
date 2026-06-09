'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { subDays } = require('date-fns');

const logger = require('./logger');
const database = require('./database');
const { settings, loadJson, saveJson } = require('./config');
const { runScan } = require('./pipeline');
const { generateReport, REPORTS_DIR } = require('./reporter');
const { parseDateRange } = require('./utils');
const { hybridSearch, suggestQueries, didYouMean, topMentions, trends } = require('./search');
const textUtils = require('./text-utils');
const analyticsRouter = require('./api-analytics');

// Simple rate limiter (in-memory, key: IP or user)
class RateLimiter {
  constructor(windowMs = 60000, maxRequests = 100) {
    this.windowMs = windowMs;
    this.maxRequests = maxRequests;
    this.requests = new Map();
  }

  middleware() {
    return (req, res, next) => {
      const ip = req.ip || req.socket.remoteAddress || 'unknown';
      const now = Date.now();
      if (!this.requests.has(ip)) {
        this.requests.set(ip, []);
      }
      const reqs = this.requests.get(ip).filter((t) => now - t < this.windowMs);
      if (reqs.length >= this.maxRequests) {
        return res.status(429).json({ error: 'Rate limit überschritten' });
      }
      reqs.push(now);
      this.requests.set(ip, reqs);
      // Cleanup old entries every 10 requests
      if (Math.random() < 0.1) {
        for (const [k, v] of this.requests) {
          if (v.length === 0) this.requests.delete(k);
        }
      }
      next();
    };
  }
}

// Simple response cache (for GET endpoints, max 200 entries, 60s TTL)
class ResponseCache {
  constructor(maxEntries = 200, ttlMs = 60000) {
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  key(req) {
    return `${req.path}?${new URLSearchParams(req.query).toString()}`;
  }

  get(req) {
    const k = this.key(req);
    const entry = this.cache.get(k);
    if (!entry) return null;
    if (Date.now() - entry.time > this.ttlMs) {
      this.cache.delete(k);
      return null;
    }
    return entry.data;
  }

  set(req, data) {
    if (this.cache.size >= this.maxEntries) {
      const first = this.cache.keys().next().value;
      this.cache.delete(first);
    }
    this.cache.set(this.key(req), { data, time: Date.now() });
  }

  middleware(method = 'GET') {
    const self = this;
    return (req, res, next) => {
      if (req.method !== method) return next();
      const cached = self.get(req);
      if (cached) {
        res.setHeader('X-Cache', 'HIT');
        return res.json(cached);
      }
      const originalJson = res.json;
      res.json = function (data) {
        try {
          self.set(req, data);
        } catch (err) {
          logger.debug('Cache-Write fehlgeschlagen', { error: err.message });
        }
        res.setHeader('X-Cache', 'MISS');
        res.setHeader('Cache-Control', 'private, max-age=60');
        return originalJson.call(this, data);
      };
      next();
    };
  }
}

const limiter = new RateLimiter(60000, 100);
const cache = new ResponseCache(200, 60000);

function computeFacets(articles) {
  // Single-pass computation instead of 7 passes
  const result = {
    category: new Map(),
    sentiment: new Map(),
    type: new Map(),
    source: new Map(),
    tag: new Map(),
    language: new Map(),
    paywall: new Map(),
    image: new Map(),
  };

  for (const a of articles) {
    // Category
    if (a.category) result.category.set(a.category, (result.category.get(a.category) || 0) + 1);
    // Sentiment
    if (a.sentiment) result.sentiment.set(a.sentiment, (result.sentiment.get(a.sentiment) || 0) + 1);
    // Type
    if (a.article_type) result.type.set(a.article_type, (result.type.get(a.article_type) || 0) + 1);
    // Source
    if (a.source) result.source.set(a.source, (result.source.get(a.source) || 0) + 1);
    // Tags
    for (const tag of (a.tags || [])) result.tag.set(tag, (result.tag.get(tag) || 0) + 1);
    // Language
    const lang = a.language || 'de';
    result.language.set(lang, (result.language.get(lang) || 0) + 1);
    // Paywall
    const pw = a.paywall ? 'yes' : 'no';
    result.paywall.set(pw, (result.paywall.get(pw) || 0) + 1);
    // Image
    const img = a.has_image ? 'yes' : 'no';
    result.image.set(img, (result.image.get(img) || 0) + 1);
  }

  // Convert to sorted arrays
  const convert = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
  return {
    category: convert(result.category),
    sentiment: convert(result.sentiment),
    type: convert(result.type),
    source: convert(result.source).slice(0, 25),
    tag: convert(result.tag).slice(0, 25),
    language: convert(result.language),
    paywall: convert(result.paywall),
    image: convert(result.image),
  };
}

const WEB_DIR = path.resolve(__dirname, '..', 'web');

const wsClients = new Set();
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  const deadClients = [];
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      try {
        ws.send(msg);
      } catch (e) {
        logger.debug('WS send failed', { error: e.message });
        deadClients.push(ws);
      }
    } else if (ws.readyState === 3) {
      // CLOSED
      deadClients.push(ws);
    }
  }
  // Cleanup dead connections
  for (const ws of deadClients) {
    wsClients.delete(ws);
  }
}

function attachLogger() {
  const winston = require('winston');
  class WsTransport extends winston.Transport {
    log(info, cb) {
      const { level, message, ...meta } = info;
      delete meta[Symbol.for('level')];
      delete meta[Symbol.for('message')];
      delete meta[Symbol.for('splat')];
      broadcast('log', { level, message, meta });
      cb && cb();
    }
  }
  logger.add(new WsTransport({ level: 'info' }));
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  // Security headers
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // Rate limiting for API endpoints
  app.use('/api/', limiter.middleware());

  // Cache middleware für GET /api endpoints (außer /health)
  app.get('/api/articles', cache.middleware('GET'));
  app.get('/api/article/:id', cache.middleware('GET'));
  app.get('/api/tags', cache.middleware('GET'));
  app.get('/api/trends', cache.middleware('GET'));
  app.get('/api/mentions', cache.middleware('GET'));
  app.get('/api/sources', cache.middleware('GET'));
  app.get('/api/keywords', cache.middleware('GET'));

  // Analytics endpoints with caching
  app.use('/api/analytics/', cache.middleware('GET'));
  app.use('/api/analytics/', analyticsRouter);

  app.use(express.static(WEB_DIR));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      version: require('../package.json').version,
      reportsDir: REPORTS_DIR,
      dbPath: path.resolve(settings.database.path),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/articles', (req, res) => {
    try {
      const opts = {
        from: req.query.from,
        to: req.query.to,
        last: req.query.last,
      };
      if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
      const { from, to } = parseDateRange(opts);
      let articles = database.getArticlesByRange(from, to);

      const tagMap = new Map();
      const allTagRows = database.db
        .prepare(
          `
        SELECT t.article_id, t.tag FROM article_tags t
        JOIN articles a ON a.id = t.article_id
        WHERE a.published_date >= @from AND a.published_date <= @to
      `
        )
        .all({ from: from.toISOString(), to: to.toISOString() });
      for (const row of allTagRows) {
        if (!tagMap.has(row.article_id)) tagMap.set(row.article_id, []);
        tagMap.get(row.article_id).push(row.tag);
      }
      const bookmarkIds = new Set(
        database.db
          .prepare('SELECT article_id FROM bookmarks')
          .all()
          .map((r) => r.article_id)
      );

      articles = articles.map((a) => {
        const enriched = {
          ...a,
          tags: tagMap.get(a.id) || [],
          bookmarked: bookmarkIds.has(a.id),
          has_image: textUtils.hasImage(a),
          reading_time_min: textUtils.estimateReadingMinutes(
            (a.full_text || a.summary || '').toString()
          ),
        };
        if (!enriched.language) {
          enriched.language = textUtils.detectLanguage((a.title || '') + ' ' + (a.summary || ''), {
            minLen: 60,
            fallback: 'de',
          });
        }
        return enriched;
      });

      const {
        category,
        sentiment,
        source,
        tag,
        tagNot,
        tagMode,
        bookmark,
        paywall,
        image,
        q,
        limit,
        minScore,
        maxScore,
        type,
        wordsMin,
        wordsMax,
        readingTimeMin,
        readingTimeMax,
        lang,
        dupes,
        facets,
      } = req.query;
      const splitMulti = (v) =>
        String(v)
          .split(/[,;|]/)
          .map((s) => s.trim())
          .filter(Boolean);
      const tagModeNorm = (tagMode || 'any').toLowerCase();

      if (category) {
        const cats = splitMulti(category);
        articles = articles.filter((a) => cats.includes(a.category));
      }
      if (sentiment) {
        const sents = splitMulti(sentiment);
        articles = articles.filter((a) => sents.includes(a.sentiment));
      }
      if (source) {
        const srcs = splitMulti(source);
        articles = articles.filter((a) => srcs.includes(a.source));
      }
      if (tag) {
        const tags = splitMulti(tag);
        if (tagModeNorm === 'all') {
          articles = articles.filter((a) => tags.every((t) => a.tags.includes(t)));
        } else if (tagModeNorm === 'none') {
          articles = articles.filter((a) => !tags.some((t) => a.tags.includes(t)));
        } else {
          articles = articles.filter((a) => tags.some((t) => a.tags.includes(t)));
        }
      }
      if (tagNot) {
        const tags = splitMulti(tagNot);
        articles = articles.filter((a) => !tags.some((t) => a.tags.includes(t)));
      }
      if (type) {
        const types = splitMulti(type);
        articles = articles.filter((a) => types.includes(a.article_type));
      }
      if (lang) {
        const langs = splitMulti(lang).map((l) => l.toLowerCase());
        articles = articles.filter((a) => langs.includes((a.language || 'de').toLowerCase()));
      }
      if (minScore !== undefined && minScore !== '') {
        const n = parseInt(minScore, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.relevance_score || 0) >= n);
      }
      if (maxScore !== undefined && maxScore !== '') {
        const n = parseInt(maxScore, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.relevance_score || 0) <= n);
      }
      if (wordsMin !== undefined && wordsMin !== '') {
        const n = parseInt(wordsMin, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.word_count || 0) >= n);
      }
      if (wordsMax !== undefined && wordsMax !== '') {
        const n = parseInt(wordsMax, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.word_count || 0) <= n);
      }
      if (readingTimeMin !== undefined && readingTimeMin !== '') {
        const n = parseInt(readingTimeMin, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.reading_time_min || 0) >= n);
      }
      if (readingTimeMax !== undefined && readingTimeMax !== '') {
        const n = parseInt(readingTimeMax, 10);
        if (Number.isFinite(n)) articles = articles.filter((a) => (a.reading_time_min || 0) <= n);
      }
      if (bookmark === 'yes') articles = articles.filter((a) => a.bookmarked);
      if (bookmark === 'no') articles = articles.filter((a) => !a.bookmarked);
      if (paywall === 'yes') articles = articles.filter((a) => !!a.paywall);
      if (paywall === 'no') articles = articles.filter((a) => !a.paywall);
      if (image === 'yes') articles = articles.filter((a) => !!a.has_image);
      if (image === 'no') articles = articles.filter((a) => !a.has_image);
      if (dupes === 'hide') articles = articles.filter((a) => !a.duplicate_of);

      let scored = articles.map((a) => ({ article: a, score: 0 }));
      if (q && q.trim()) {
        scored = hybridSearch(articles, q, { limit: 1000 });
      }
      const max = Math.min(parseInt(limit, 10) || 500, 2000);
      const results = scored.slice(0, max).map((s) => ({
        ...s.article,
        _searchScore: s.score,
        _viaDidYouMean: s._viaDidYouMean,
      }));

      const payload = {
        from: from.toISOString(),
        to: to.toISOString(),
        total: articles.length,
        returned: results.length,
        articles: results,
      };

      if (facets === 'true' || facets === '1') {
        payload.facets = computeFacets(articles);
      }
      if (q && q.trim() && scored.length > 0 && scored[0]._viaDidYouMean) {
        payload.didYouMean = scored[0]._viaDidYouMean;
      }

      res.json(payload);
    } catch (err) {
      logger.error('GET /api/articles fehlgeschlagen', { error: err.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/article/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    const row = database.db.prepare('SELECT * FROM articles WHERE id = ?').get(id);
    if (!row) return res.status(404).json({ error: 'Artikel nicht gefunden' });
    res.json(row);
  });

  app.get('/api/stats', (req, res) => {
    try {
      const { from, to } = parseDateRange({
        from: req.query.from,
        to: req.query.to,
        last: req.query.last || '30d',
      });
      const stats = database.getStats(from, to);
      res.json({
        from: from.toISOString(),
        to: to.toISOString(),
        overview: stats.overview,
        bySource: stats.bySource,
        health: database.getSourceHealth(),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/suggest', (req, res) => {
    try {
      const prefix = req.query.q || '';
      const articles = database.getArticlesByRange(subDays(new Date(), 60), new Date());
      res.json({ suggestions: suggestQueries(prefix, articles) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/did-you-mean', (req, res) => {
    try {
      const q = req.query.q || '';
      const articles = database.getArticlesByRange(subDays(new Date(), 365), new Date());
      const suggestion = didYouMean(q, articles);
      res.json({ query: q, suggestion });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/analytics', (req, res) => {
    try {
      const now = new Date();
      const last30 = database.getArticlesByRange(subDays(now, 30), now);
      const last7 = database.getArticlesByRange(subDays(now, 7), now);
      const today = database.getArticlesByRange(subDays(now, 1), now);

      const computeMetrics = (articles) => ({
        count: articles.length,
        avgRelevance: articles.length ? Math.round(articles.reduce((sum, a) => sum + (a.relevance_score || 0), 0) / articles.length) : 0,
        sentiments: {
          positiv: articles.filter((a) => a.sentiment === 'positiv').length,
          neutral: articles.filter((a) => a.sentiment === 'neutral').length,
          negativ: articles.filter((a) => a.sentiment === 'negativ').length,
        },
        topSources: [...new Map(articles.map((a) => [a.source, a])).values()]
          .map((a) => a.source)
          .filter(Boolean)
          .slice(0, 5),
        paywallCount: articles.filter((a) => a.paywall).length,
        avgReadingTime: articles.length ? Math.round(articles.reduce((sum, a) => sum + (a.word_count || 0), 0) / (articles.length * 200)) : 0,
      });

      res.json({
        timestamp: now.toISOString(),
        today: computeMetrics(today),
        last7: computeMetrics(last7),
        last30: computeMetrics(last30),
        growth: {
          daily: last7.length / 7,
          weekly: last30.length / 4,
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/mentions', (req, res) => {
    try {
      const { from, to } = parseDateRange({
        from: req.query.from,
        to: req.query.to,
        last: req.query.last || '30d',
      });
      const articles = database.getArticlesByRange(from, to);
      res.json({
        from: from.toISOString(),
        to: to.toISOString(),
        mentions: topMentions(articles, { limit: parseInt(req.query.limit || '30', 10) }),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/trends', (req, res) => {
    try {
      const period = req.query.period || '30d';
      const days = Math.min(parseInt(period.replace(/[^\d]/g, ''), 10) || 30, 730);
      const now = new Date();
      const recent = database.getArticlesByRange(subDays(now, days), now);
      const previous = database.getArticlesByRange(subDays(now, days * 2), subDays(now, days));
      res.json({ trends: trends(recent, previous), period: { days } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/tags', (req, res) => {
    res.json({ tags: database.getAllTags() });
  });

  app.post('/api/tags/retag-all', (req, res) => {
    try {
      const { autoTag } = require('./tagger');
      const rows = database.db
        .prepare(
          `
        SELECT id, title, full_text, summary, category, sentiment, paywall
        FROM articles WHERE deleted_at IS NULL
      `
        )
        .all();
      let added = 0;
      const errors = [];
      for (const row of rows) {
        const analysis = { category: row.category, sentiment: row.sentiment };
        const tags = autoTag({ ...row, fullText: row.full_text }, analysis);
        for (const tag of tags) {
          try {
            database.addTag(row.id, tag);
            added++;
          } catch (e) {
            logger.debug(`Tag failed for article ${row.id}: ${tag}`, { error: e.message });
            errors.push({ articleId: row.id, tag, error: e.message });
          }
        }
      }
      res.json({ ok: true, articles: rows.length, tags_added: added, errors: errors.length > 0 ? errors.slice(0, 10) : undefined });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
  app.get('/api/article/:id/tags', (req, res) => {
    res.json({ tags: database.getTagsForArticle(parseInt(req.params.id, 10)) });
  });
  app.post('/api/article/:id/tags', (req, res) => {
    const { tag } = req.body || {};
    if (!tag || typeof tag !== 'string') return res.status(400).json({ error: 'tag erforderlich' });
    if (tag.length > 100) return res.status(400).json({ error: 'tag zu lang (max 100 Zeichen)' });
    if (!/^[a-zA-Z0-9_:äöüß-]{1,100}$/.test(tag)) return res.status(400).json({ error: 'tag hat ungültige Zeichen' });
    const articleId = parseInt(req.params.id, 10);
    if (!Number.isInteger(articleId)) return res.status(400).json({ error: 'Ungültige Article ID' });
    database.addTag(articleId, tag);
    res.json({ ok: true });
  });
  app.delete('/api/article/:id/tags/:tag', (req, res) => {
    const articleId = parseInt(req.params.id, 10);
    if (!Number.isInteger(articleId)) return res.status(400).json({ error: 'Ungültige Article ID' });
    const tag = req.params.tag;
    if (!/^[a-zA-Z0-9_:äöüß-]{1,100}$/.test(tag)) return res.status(400).json({ error: 'tag hat ungültige Zeichen' });
    database.removeTag(articleId, tag);
    res.json({ ok: true });
  });

  app.get('/api/bookmarks', (req, res) => {
    res.json({ bookmarks: database.getBookmarks() });
  });
  app.post('/api/article/:id/bookmark', (req, res) => {
    database.setBookmark(parseInt(req.params.id, 10), req.body?.note);
    res.json({ ok: true });
  });
  app.delete('/api/article/:id/bookmark', (req, res) => {
    database.removeBookmark(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  app.get('/api/saved-searches', (req, res) => {
    res.json({ searches: database.getSavedSearches() });
  });
  app.post('/api/saved-searches', (req, res) => {
    const { name, query, filters } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name erforderlich' });
    database.saveSearch(name, query, filters);
    res.json({ ok: true });
  });
  app.delete('/api/saved-searches/:name', (req, res) => {
    database.deleteSavedSearch(req.params.name);
    res.json({ ok: true });
  });

  app.get('/api/export', (req, res) => {
    try {
      const { from, to } = parseDateRange({
        from: req.query.from,
        to: req.query.to,
        last: req.query.last || '30d',
      });
      const articles = database.getArticlesByRange(from, to);
      const format = (req.query.format || 'json').toLowerCase();
      if (format === 'csv') {
        const cols = [
          'id',
          'title',
          'source',
          'author',
          'published_date',
          'url',
          'category',
          'sentiment',
          'relevance_score',
          'word_count',
          'paywall',
        ];
        const escape = (v) => {
          if (v === null || v === undefined) return '';
          const s = String(v).replace(/"/g, '""').replace(/\n/g, ' ');
          return /[",;\n]/.test(s) ? `"${s}"` : s;
        };
        let csv = cols.join(';') + '\n';
        for (const a of articles) csv += cols.map((c) => escape(a[c])).join(';') + '\n';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="pressespiegel-${format}-${Date.now()}.csv"`
        );
        return res.send('﻿' + csv);
      }
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="pressespiegel-${Date.now()}.json"`
        );
        return res.send(JSON.stringify(articles, null, 2));
      }
      if (format === 'md' || format === 'markdown') {
        // Weitergebbare Linkliste (E-Mail/Chat): der Spiegel als Markdown,
        // nach Datum absteigend, mit "auch erschienen in"-Links
        const fmtDate = (d) => (d ? String(d).slice(0, 10) : 'ohne Datum');
        // eckige Klammern wuerden das [Titel](URL)-Linkformat brechen
        const mdLabel = (s) => String(s || '').replace(/[[\]]/g, ' ').trim();
        const lines = [
          `# Pressespiegel Muenchner Kammerspiele`,
          ``,
          `Zeitraum: ${fmtDate(from.toISOString())} bis ${fmtDate(to.toISOString())} — ${articles.length} Artikel`,
          ``,
        ];
        for (const a of articles) {
          const badges = [a.category, a.sentiment, a.article_type]
            .filter(Boolean)
            .join(' · ');
          lines.push(`- **[${mdLabel(a.title) || a.url}](${a.url})**`);
          lines.push(
            `  ${a.source || 'Unbekannt'} · ${fmtDate(a.published_date)}${a.author ? ` · ${a.author}` : ''}${badges ? ` · ${badges}` : ''}`
          );
          const alsoOn = Array.isArray(a.also_on) ? a.also_on : [];
          if (alsoOn.length > 0) {
            lines.push(`  auch erschienen in: ${alsoOn.join(', ')}`);
          }
        }
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="pressespiegel-${Date.now()}.md"`
        );
        return res.send(lines.join('\n') + '\n');
      }
      res.status(400).json({ error: 'Unbekanntes Format' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/export-with-metadata', (req, res) => {
    try {
      const opts = {
        from: req.query.from,
        to: req.query.to,
        last: req.query.last,
      };
      if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
      const { from, to } = parseDateRange(opts);
      const articles = database.getArticlesByRange(from, to);

      const tagMap = new Map();
      const allTagRows = database.db
        .prepare(
          `SELECT t.article_id, t.tag FROM article_tags t
           JOIN articles a ON a.id = t.article_id
           WHERE a.published_date >= @from AND a.published_date <= @to`
        )
        .all({ from: from.toISOString(), to: to.toISOString() });
      for (const row of allTagRows) {
        if (!tagMap.has(row.article_id)) tagMap.set(row.article_id, []);
        tagMap.get(row.article_id).push(row.tag);
      }

      const enriched = articles.map((a) => ({
        ...a,
        tags: tagMap.get(a.id) || [],
        has_image: textUtils.hasImage(a),
        reading_time_min: textUtils.estimateReadingMinutes((a.full_text || a.summary || '').toString()),
      }));

      const metadata = {
        exportDate: new Date().toISOString(),
        range: { from: from.toISOString(), to: to.toISOString() },
        totalArticles: enriched.length,
        avgRelevance: enriched.length ? Math.round(enriched.reduce((sum, a) => sum + (a.relevance_score || 0), 0) / enriched.length) : 0,
        facets: computeFacets(enriched),
      };

      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pressespiegel-export-${Date.now()}.json"`);
      res.send(JSON.stringify({ metadata, articles: enriched }, null, 2));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sources', (req, res) => {
    try {
      const sources = loadJson('sources.json');
      const health = database.getSourceHealth();
      const healthMap = new Map(health.map((h) => [h.source, h]));
      const stats = { ok: 0, degraded: 0, blocked: 0, dead: 0, unknown: 0, total: 0 };
      const feeds = (sources.feeds || []).map((f) => {
        const h = healthMap.get(f.name) || null;
        const status = database.classifyFeedHealth(h);
        stats[status] = (stats[status] || 0) + 1;
        stats.total++;
        return { ...f, health: h, healthStatus: status };
      });
      res.json({ ...sources, feeds, stats });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/test', async (req, res) => {
    try {
      const { url, name } = req.body || {};
      if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url erforderlich' });
      if (url.length > 2000) return res.status(400).json({ error: 'url zu lang' });
      try {
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'Ungültige URL' });
      }
      const { testFeed } = require('./scraper');
      const result = await testFeed(url, name);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/toggle', (req, res) => {
    try {
      const { name, enabled } = req.body || {};
      if (!name) return res.status(400).json({ error: 'name erforderlich' });
      database.setSourceEnabled(name, enabled);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/bulk-disable-dead', (req, res) => {
    try {
      const health = database.getSourceHealth();
      let count = 0;
      for (const h of health) {
        if (database.classifyFeedHealth(h) === 'dead' && h.enabled !== 0) {
          database.setSourceEnabled(h.source, false);
          count++;
        }
      }
      res.json({ ok: true, disabled: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/bulk-mark-blocked-browser', (req, res) => {
    try {
      const sources = loadJson('sources.json');
      const health = database.getSourceHealth();
      const blockedNames = new Set(
        health.filter((h) => database.classifyFeedHealth(h) === 'blocked').map((h) => h.source)
      );
      let count = 0;
      const feeds = (sources.feeds || []).map((f) => {
        if (blockedNames.has(f.name) && !f.use_browser) {
          count++;
          return { ...f, use_browser: true, retry_delay: f.retry_delay || 3000 };
        }
        return f;
      });
      saveJson('sources.json', { ...sources, feeds });
      res.json({ ok: true, updated: count });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/sources/opml', (req, res) => {
    try {
      const data = loadJson('sources.json');
      const escape = (s) =>
        String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;');
      const now = new Date().toISOString();
      let opml = `<?xml version="1.0" encoding="UTF-8"?>\n<opml version="2.0">\n  <head>\n    <title>Pressespiegel Kammerspiele Feeds</title>\n    <dateCreated>${now}</dateCreated>\n  </head>\n  <body>\n`;
      const byCategory = new Map();
      for (const f of data.feeds || []) {
        const cat = f.category || 'andere';
        if (!byCategory.has(cat)) byCategory.set(cat, []);
        byCategory.get(cat).push(f);
      }
      for (const [cat, feeds] of byCategory) {
        opml += `    <outline text="${escape(cat)}" title="${escape(cat)}">\n`;
        for (const f of feeds) {
          if (f.kind === 'google-news' || f.kind === 'bing-news') continue;
          opml += `      <outline type="rss" text="${escape(f.name)}" title="${escape(f.name)}" xmlUrl="${escape(f.url)}" htmlUrl="${escape(f.url)}"/>\n`;
        }
        opml += '    </outline>\n';
      }
      opml += '  </body>\n</opml>\n';
      res.setHeader('Content-Type', 'text/x-opml; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="pressespiegel-feeds.opml"`);
      res.send(opml);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/opml-preview', async (req, res) => {
    try {
      const xml = req.body && req.body.opml;
      if (!xml) return res.status(400).json({ error: 'opml erforderlich' });
      const xml2js = require('xml2js');
      const parsed = await new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
      }).parseStringPromise(xml);
      const outlines = [];
      const walk = (node) => {
        if (!node) return;
        const items = Array.isArray(node) ? node : [node];
        for (const it of items) {
          if (it.xmlUrl) outlines.push(it);
          if (it.outline) walk(it.outline);
        }
      };
      walk(parsed.opml && parsed.opml.body && parsed.opml.body.outline);
      const current = loadJson('sources.json');
      const existing = new Set((current.feeds || []).map((f) => f.url));
      const { fetchRaw, classifyError } = require('./feed-fetcher');
      const pLimit = require('p-limit');
      const limit = pLimit(4);
      const previews = await Promise.all(
        outlines.map((o) =>
          limit(async () => {
            const name =
              o.title ||
              o.text ||
              (() => {
                try {
                  return new URL(o.xmlUrl).hostname;
                } catch {
                  return o.xmlUrl;
                }
              })();
            const url = o.xmlUrl;
            const isDuplicate = existing.has(url);
            const start = Date.now();
            try {
              const r = await fetchRaw(url, { timeout: 5000, maxRedirects: 2 });
              const ms = Date.now() - start;
              let level = 'ok';
              if (r.status === 403) level = 'warn';
              else if (r.status >= 400) level = 'error';
              return {
                name,
                url,
                status: r.status,
                responseTimeMs: ms,
                level,
                duplicate: isDuplicate,
              };
            } catch (err) {
              const cls = classifyError(err);
              const level = cls === 'forbidden' ? 'warn' : 'error';
              return {
                name,
                url,
                status: null,
                level,
                error: err.message,
                errorClass: cls,
                duplicate: isDuplicate,
              };
            }
          })
        )
      );
      res.json({ ok: true, count: previews.length, previews });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources/opml-import', async (req, res) => {
    try {
      const xml = req.body && req.body.opml;
      if (!xml) return res.status(400).json({ error: 'opml erforderlich' });
      const xml2js = require('xml2js');
      const parsed = await new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
      }).parseStringPromise(xml);
      const outlines = [];
      const walk = (node) => {
        if (!node) return;
        const items = Array.isArray(node) ? node : [node];
        for (const it of items) {
          if (it.xmlUrl) outlines.push(it);
          if (it.outline) walk(it.outline);
        }
      };
      walk(parsed.opml && parsed.opml.body && parsed.opml.body.outline);
      const current = loadJson('sources.json');
      const existing = new Set((current.feeds || []).map((f) => f.url));
      let added = 0;
      for (const o of outlines) {
        if (existing.has(o.xmlUrl)) continue;
        current.feeds.push({
          name: o.title || o.text || new URL(o.xmlUrl).hostname,
          url: o.xmlUrl,
          priority: 70,
          type: 'rss',
          category: 'imported',
        });
        added++;
      }
      const { saveJson } = require('./config');
      saveJson('sources.json', current);
      res.json({ ok: true, added, total: current.feeds.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/sources', (req, res) => {
    try {
      const data = req.body;
      if (!data || !Array.isArray(data.feeds)) {
        return res.status(400).json({ error: 'feeds[] erforderlich' });
      }
      saveJson('sources.json', data);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/keywords', (req, res) => {
    try {
      res.json(loadJson('keywords.json'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/keywords', (req, res) => {
    try {
      const data = req.body;
      if (!data || !Array.isArray(data.required)) {
        return res.status(400).json({ error: 'required[] erforderlich' });
      }
      saveJson('keywords.json', data);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/settings', (req, res) => {
    try {
      res.json(loadJson('settings.json'));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/settings', (req, res) => {
    try {
      saveJson('settings.json', req.body);
      res.json({ ok: true, note: 'Neustart erforderlich, damit alle Aenderungen greifen' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  let activeScan = null;
  app.post('/api/scan', async (req, res) => {
    if (activeScan) {
      return res.status(409).json({ error: 'Scan laeuft bereits', scanId: activeScan });
    }
    const scanId = `scan-${Date.now()}`;
    activeScan = scanId;
    res.json({ scanId, status: 'started' });

    setImmediate(async () => {
      try {
        const { from, to } = parseDateRange({
          from: req.body.from,
          to: req.body.to,
          last: req.body.last,
        });
        broadcast('scan-start', { scanId, from: from.toISOString(), to: to.toISOString() });
        const summary = await runScan({ from, to });
        broadcast('scan-complete', { scanId, summary });
        broadcast('scan_summary', {
          scanId,
          type: 'scan_summary',
          total_feeds: summary.total_feeds,
          ok: summary.ok,
          degraded: summary.degraded,
          blocked_403: summary.blocked_403,
          dead: summary.dead,
          new_articles: summary.new_articles,
          duplicates_removed: summary.duplicates_removed,
          duration_ms: summary.duration_ms,
        });
      } catch (err) {
        broadcast('scan-error', { scanId, error: err.message });
      } finally {
        activeScan = null;
      }
    });
  });

  app.get('/api/scan/status', (req, res) => {
    res.json({ active: activeScan });
  });

  app.post('/api/report', async (req, res) => {
    try {
      const opts = req.body || {};
      const { from, to } = parseDateRange(opts);
      const articles = database.getArticlesByRange(from, to);
      const result = await generateReport({
        from,
        to,
        articles,
        format: opts.format || 'html',
        title: opts.title,
      });
      res.json({
        ok: true,
        articleCount: articles.length,
        html: result.html ? path.basename(result.html) : null,
        pdf: result.pdf ? path.basename(result.pdf) : null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/reports', (req, res) => {
    if (!fs.existsSync(REPORTS_DIR)) return res.json({ reports: [] });
    const files = fs
      .readdirSync(REPORTS_DIR)
      .filter((f) => f.endsWith('.html') || f.endsWith('.pdf'))
      .map((f) => {
        const fp = path.join(REPORTS_DIR, f);
        const stat = fs.statSync(fp);
        return {
          name: f,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          type: f.endsWith('.pdf') ? 'pdf' : 'html',
        };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ reports: files });
  });

  app.get('/api/reports/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    if (!/\.(html|pdf)$/i.test(filename)) {
      return res.status(400).send('Ungueltiger Report-Dateiname');
    }
    const filepath = path.join(REPORTS_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).send('Report nicht gefunden');
    res.sendFile(filepath);
  });

  app.delete('/api/reports/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    if (!/\.(html|pdf)$/i.test(filename)) {
      return res.status(400).json({ error: 'Ungueltiger Report-Dateiname' });
    }
    const filepath = path.join(REPORTS_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'nicht gefunden' });
    fs.unlinkSync(filepath);
    res.json({ ok: true });
  });

  app.get('/api/logs', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 2000);
    const logFile = path.join(__dirname, '..', 'logs', 'pressespiegel.log');
    if (!fs.existsSync(logFile)) return res.json({ logs: [] });
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).slice(-limit);
    const logs = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { level: 'info', message: line };
      }
    });
    res.json({ logs });
  });

  app.get('/api/duplicates/check', (req, res) => {
    try {
      const since = req.query.since ? new Date(req.query.since) : subDays(new Date(), 90);
      const candidates = database.getRecentForDedup(since);
      const { findDuplicate } = require('./deduplicator');
      const found = [];
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const hit = findDuplicate(
          { id: c.id, title: c.title, url: c.url_normalized, first_paragraph: c.first_paragraph },
          candidates.slice(0, i)
        );
        if (hit)
          found.push({
            id: c.id,
            title: c.title,
            source: c.source,
            duplicateOf: {
              id: hit.duplicate.id,
              title: hit.duplicate.title,
              source: hit.duplicate.source,
            },
            reason: hit.reason,
          });
      }
      res.json({ checked: candidates.length, duplicates: found });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(WEB_DIR, 'index.html'));
  });

  // Global error handler (muss nach allen routes sein; 4-arg-Signatur ist Pflicht)
  app.use((err, req, res, _next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    const status = err.status || 500;
    const message = process.env.NODE_ENV === 'production' ? 'Server error' : err.message;
    logger.error(`Error on ${req.method} ${req.path}`, {
      error: err.message,
      status,
      endpoint: `${req.method} ${req.path}`
    });
    res.status(status).json({ error: message });
  });

  return app;
}

function findFreePort(start = 4711) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      if (start < 65535) resolve(findFreePort(start + 1));
      else reject(new Error('Kein freier Port gefunden'));
    });
    server.listen(start, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function start({ port, host = '127.0.0.1' } = {}) {
  attachLogger();
  const usePort =
    port || (await findFreePort(parseInt(process.env.PRESSESPIEGEL_PORT || '4711', 10)));
  const app = buildApp();
  const server = app.listen(usePort, host, () => {
    logger.info(`UI-Server laeuft auf http://${host}:${usePort}`);
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    wsClients.add(ws);
    ws.send(JSON.stringify({ type: 'connected', payload: { ts: Date.now() } }));
    ws.on('close', () => wsClients.delete(ws));
  });

  return { server, port: usePort, host, broadcast };
}

module.exports = { start, buildApp, broadcast };
