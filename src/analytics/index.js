'use strict';

const logger = require('../logger');
const ner = require('./ner');
const mentions = require('./mentions');
const sourceHealth = require('./source-health');
const clustering = require('./clustering');
const freshness = require('./freshness');
const tonality = require('./tonality');
const events = require('./events');
const mediaResonance = require('./media-resonance');
const quotes = require('./quotes');

// Central analytics orchestrator
// Runs after article is saved to database

async function analyzeArticle(articleId, articleData) {
  try {
    const analysis = {};

    // Named entity recognition
    analysis.entities = ner.extractEntities(articleData);

    // Store extracted entities (caller should handle DB insert)
    // Event detection
    analysis.events = events.detectEvents(articleData, analysis.entities);

    // Advanced tonality analysis
    analysis.tonality = tonality.analyzeTonality(articleData);

    return analysis;
  } catch (err) {
    logger.error(`Analytics error for article ${articleId}: ${err.message}`);
    return {};
  }
}

// Batch analytics: run after articles are collected
async function analyzeCollection(articles, database) {
  try {
    const analysis = {};

    // Calculate freshness metrics
    analysis.freshness = freshness.calculateFreshness(articles);

    // Cluster similar articles
    analysis.clusters = clustering.clusterArticles(articles);

    // Source health metrics
    analysis.sourceHealth = sourceHealth.calculateSourceMetrics(articles);

    // Mention trends
    analysis.mentions = mentions.analyzeMentionTrends(articles);

    return analysis;
  } catch (err) {
    logger.error(`Collection analytics error: ${err.message}`);
    return {};
  }
}

module.exports = {
  analyzeArticle,
  analyzeCollection,
  ner,
  mentions,
  sourceHealth,
  clustering,
  freshness,
  tonality,
  events,
  mediaResonance,
  quotes,
};
