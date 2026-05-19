'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { format, subDays, endOfDay, startOfDay } = require('date-fns');

const logger = require('./logger');
const database = require('./database');
const { settings, loadJson, saveJson } = require('./config');
const { runScan } = require('./pipeline');
const { generateReport, findLatestReport, REPORTS_DIR } = require('./reporter');
const { parseDateRange } = require('./utils');
const { hybridSearch, suggestQueries, didYouMean, topMentions, trends } = require('./search');

const WEB_DIR = path.resolve(__dirname, '..', 'web');

const wsClients = new Set();
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const ws of wsClients) {
    if (ws.readyState === 1) {
      try { ws.send(msg); } catch (_) { /* ignore */ }
    }
  }
}

const wsLoggerTransport = {
  log({ level, message, ...meta }, cb) {
    broadcast('log', { level, message, meta });
    cb && cb();
  }
};

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
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(express.static(WEB_DIR));

  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      version: require('../package.json').version,
      reportsDir: REPORTS_DIR,
      dbPath: path.resolve(settings.database.path),
      timestamp: new Date().toISOString()
    });
  });

  app.get('/api/articles', (req, res) => {
    try {
      const opts = {
        from: req.query.from,
        to: req.query.to,
        last: req.query.last
      };
      if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
      const { from, to } = parseDateRange(opts);
      let articles = database.getArticlesByRange(from, to);
      const { category, sentiment, source, q, limit } = req.query;
      if (category) articles = articles.filter(a => a.category === category);
      if (sentiment) articles = articles.filter(a => a.sentiment === sentiment);
      if (source) articles = articles.filter(a => a.source === source);
      let scored = articles.map(a => ({ article: a, score: 0 }));
      if (q && q.trim()) {
        scored = hybridSearch(articles, q, { limit: 1000 });
      }
      const max = parseInt(limit, 10) || 500;
      const results = scored.slice(0, max).map(s => ({ ...s.article, _searchScore: s.score }));
      res.json({
        from: from.toISOString(),
        to: to.toISOString(),
        total: articles.length,
        returned: results.length,
        articles: results
      });
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
        last: req.query.last || '30d'
      });
      const stats = database.getStats(from, to);
      res.json({
        from: from.toISOString(),
        to: to.toISOString(),
        overview: stats.overview,
        bySource: stats.bySource,
        health: database.getSourceHealth()
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
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/mentions', (req, res) => {
    try {
      const { from, to } = parseDateRange({ from: req.query.from, to: req.query.to, last: req.query.last || '30d' });
      const articles = database.getArticlesByRange(from, to);
      res.json({ from: from.toISOString(), to: to.toISOString(), mentions: topMentions(articles, { limit: parseInt(req.query.limit || '30', 10) }) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/trends', (req, res) => {
    try {
      const period = req.query.period || '30d';
      const days = parseInt(period.replace(/[^\d]/g, ''), 10) || 30;
      const now = new Date();
      const recent = database.getArticlesByRange(subDays(now, days), now);
      const previous = database.getArticlesByRange(subDays(now, days * 2), subDays(now, days));
      res.json({ trends: trends(recent, previous), period: { days } });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/tags', (req, res) => {
    res.json({ tags: database.getAllTags() });
  });
  app.get('/api/article/:id/tags', (req, res) => {
    res.json({ tags: database.getTagsForArticle(parseInt(req.params.id, 10)) });
  });
  app.post('/api/article/:id/tags', (req, res) => {
    const { tag } = req.body || {};
    if (!tag) return res.status(400).json({ error: 'tag erforderlich' });
    database.addTag(parseInt(req.params.id, 10), tag);
    res.json({ ok: true });
  });
  app.delete('/api/article/:id/tags/:tag', (req, res) => {
    database.removeTag(parseInt(req.params.id, 10), req.params.tag);
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
      const { from, to } = parseDateRange({ from: req.query.from, to: req.query.to, last: req.query.last || '30d' });
      const articles = database.getArticlesByRange(from, to);
      const format = (req.query.format || 'json').toLowerCase();
      if (format === 'csv') {
        const cols = ['id', 'title', 'source', 'author', 'published_date', 'url', 'category', 'sentiment', 'relevance_score', 'word_count', 'paywall'];
        const escape = (v) => {
          if (v === null || v === undefined) return '';
          const s = String(v).replace(/"/g, '""').replace(/\n/g, ' ');
          return /[",;\n]/.test(s) ? `"${s}"` : s;
        };
        let csv = cols.join(';') + '\n';
        for (const a of articles) csv += cols.map(c => escape(a[c])).join(';') + '\n';
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="pressespiegel-${format}-${Date.now()}.csv"`);
        return res.send('﻿' + csv);
      }
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="pressespiegel-${Date.now()}.json"`);
        return res.send(JSON.stringify(articles, null, 2));
      }
      res.status(400).json({ error: 'Unbekanntes Format' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.get('/api/sources', (req, res) => {
    try {
      const sources = loadJson('sources.json');
      const health = database.getSourceHealth();
      const healthMap = new Map(health.map(h => [h.source, h]));
      const feeds = (sources.feeds || []).map(f => ({
        ...f,
        health: healthMap.get(f.name) || null
      }));
      res.json({ ...sources, feeds });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post('/api/sources/test', async (req, res) => {
    try {
      const { url, name } = req.body || {};
      if (!url) return res.status(400).json({ error: 'url erforderlich' });
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
    try { res.json(loadJson('keywords.json')); }
    catch (err) { res.status(500).json({ error: err.message }); }
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
    try { res.json(loadJson('settings.json')); }
    catch (err) { res.status(500).json({ error: err.message }); }
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
          from: req.body.from, to: req.body.to, last: req.body.last
        });
        broadcast('scan-start', { scanId, from: from.toISOString(), to: to.toISOString() });
        const summary = await runScan({ from, to });
        broadcast('scan-complete', { scanId, summary });
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
        from, to, articles,
        format: opts.format || 'html',
        title: opts.title
      });
      res.json({
        ok: true,
        articleCount: articles.length,
        html: result.html ? path.basename(result.html) : null,
        pdf: result.pdf ? path.basename(result.pdf) : null
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/reports', (req, res) => {
    if (!fs.existsSync(REPORTS_DIR)) return res.json({ reports: [] });
    const files = fs.readdirSync(REPORTS_DIR)
      .filter(f => f.endsWith('.html') || f.endsWith('.pdf'))
      .map(f => {
        const fp = path.join(REPORTS_DIR, f);
        const stat = fs.statSync(fp);
        return {
          name: f,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          type: f.endsWith('.pdf') ? 'pdf' : 'html'
        };
      })
      .sort((a, b) => b.mtime.localeCompare(a.mtime));
    res.json({ reports: files });
  });

  app.get('/api/reports/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(REPORTS_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).send('Report nicht gefunden');
    res.sendFile(filepath);
  });

  app.delete('/api/reports/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filepath = path.join(REPORTS_DIR, filename);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'nicht gefunden' });
    fs.unlinkSync(filepath);
    res.json({ ok: true });
  });

  app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit, 10) || 200;
    const logFile = path.join(__dirname, '..', 'logs', 'pressespiegel.log');
    if (!fs.existsSync(logFile)) return res.json({ logs: [] });
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean).slice(-limit);
    const logs = lines.map(line => {
      try { return JSON.parse(line); }
      catch { return { level: 'info', message: line }; }
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
        if (hit) found.push({
          id: c.id, title: c.title, source: c.source,
          duplicateOf: { id: hit.duplicate.id, title: hit.duplicate.title, source: hit.duplicate.source },
          reason: hit.reason
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
  const usePort = port || await findFreePort(parseInt(process.env.PRESSESPIEGEL_PORT || '4711', 10));
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
