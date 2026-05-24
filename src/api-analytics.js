'use strict';

const express = require('express');
const { subDays } = require('date-fns');
const database = require('./database');
const { parseDateRange } = require('./utils');
const analytics = require('./analytics');

const router = express.Router();

// GET /api/analytics/entities - All extracted entities
router.get('/entities', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);

    const articles = database.getArticlesByRange(from, to);
    const entityStats = analytics.ner.getEntityStats(articles);

    const result = {
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      entities: {},
    };

    for (const [type, map] of Object.entries(entityStats)) {
      result.entities[type.replace('s', '')] = Array.from(map.entries()).map(([value, stats]) => ({
        value,
        ...stats,
      }));
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/people-mentions - Focused on people mentions
router.get('/people-mentions', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);
    const limit = parseInt(req.query.limit || 20, 10);

    const articles = database.getArticlesByRange(from, to);
    const topMentions = analytics.mentions.getTopMentions(articles, 'person', limit);

    res.json({
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      topPeople: topMentions,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/mention-trends - Entity mention trends over time
router.get('/mention-trends', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);

    const articles = database.getArticlesByRange(from, to);
    const trends = analytics.mentions.analyzeMentionTrends(articles);
    const spikes = analytics.mentions.getMentionSpikes(articles, 7);

    res.json({
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      trends,
      spikes: spikes.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/entity-timeline/:entity - Timeline for specific entity
router.get('/entity-timeline/:entity', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);

    const articles = database.getArticlesByRange(from, to);
    const timeline = analytics.mentions.getEntityTimeline(articles, req.params.entity);

    res.json({
      entity: req.params.entity,
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      timeline,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/source-quality - Source health metrics
router.get('/source-quality', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);

    const articles = database.getArticlesByRange(from, to);
    const metrics = analytics.sourceHealth.calculateSourceMetrics(articles);

    res.json({
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      sources: metrics,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/source-bias - Source sentiment bias analysis
router.get('/source-bias', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);

    const articles = database.getArticlesByRange(from, to);
    const ranking = analytics.sourceHealth.getSourceRanking(articles);

    res.json({
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      sourceRanking: ranking,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/clusters - Article story clusters
router.get('/clusters', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);
    const threshold = parseFloat(req.query.threshold || 0.6);

    const articles = database.getArticlesByRange(from, to);
    const clusters = analytics.clustering.clusterArticles(articles, threshold);

    res.json({
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      clusterCount: clusters.length,
      clusters: clusters.slice(0, 50),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/freshness-score - Article freshness metrics
router.get('/freshness-score', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);

    const articles = database.getArticlesByRange(from, to);
    const freshness = analytics.freshness.calculateFreshness(articles);
    const updates = analytics.freshness.detectUpdates(articles);
    const velocity = analytics.freshness.calculatePublicationVelocity(articles);

    const freshnessDistribution = {};
    for (const item of freshness) {
      if (!freshnessDistribution[item.freshness]) freshnessDistribution[item.freshness] = 0;
      freshnessDistribution[item.freshness]++;
    }

    res.json({
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      freshnessDistribution,
      publicationVelocity: velocity,
      recentUpdates: updates.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/breaking-news - Breaking news detection
router.get('/breaking-news', (req, res) => {
  try {
    const articles = database.getArticlesByRange(subDays(new Date(), 1), new Date());
    const breaking = analytics.freshness.getBreakingNews(articles, parseInt(req.query.threshold || 5, 10));

    res.json({
      lastDay: true,
      breakingNewsCount: breaking.length,
      articles: breaking.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/events - Detected events
router.get('/events', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);

    const articles = database.getArticlesByRange(from, to);
    const eventTimeline = analytics.events.getEventTimeline(articles);
    const eventGroups = analytics.events.groupEventsByType(articles);

    res.json({
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      eventTypes: Object.keys(eventGroups),
      timeline: eventTimeline.slice(0, 100),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/tonality - Tonality analysis
router.get('/tonality', (req, res) => {
  try {
    const opts = {
      from: req.query.from,
      to: req.query.to,
      last: req.query.last,
    };
    if (!opts.from && !opts.to && !opts.last) opts.last = '30d';
    const { from, to } = parseDateRange(opts);

    const articles = database.getArticlesByRange(from, to);
    const tonalityStats = {};

    for (const article of articles) {
      const ton = analytics.tonality.analyzeTonality(article);
      if (!tonalityStats[ton.tonality]) tonalityStats[ton.tonality] = 0;
      tonalityStats[ton.tonality]++;
    }

    const contrasts = analytics.tonality.analyzeTonalityContrast(articles);

    res.json({
      dateRange: { from: from.toISOString(), to: to.toISOString() },
      tonalityDistribution: tonalityStats,
      contrasts: contrasts.slice(0, 20),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
