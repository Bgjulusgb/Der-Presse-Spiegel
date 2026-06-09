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
const { ScoringEngine, createScoringEngine, WEIGHT_PROFILES } = require('./scoring');
const { ArticleWeightingSystem } = require('./weighting');
const { ExtendedSentimentAnalyzer } = require('./sentiment-extended');
const { TemporalAnalyzer } = require('./temporal');
const { AnalyticsReporter } = require('./reports');

// High-level Analytics Orchestrator for comprehensive analysis
class AnalyticsOrchestrator {
  constructor(profile = 'BROAD_COVERAGE') {
    this.profile = profile;
    this.weighting = new ArticleWeightingSystem(profile);
    this.sentiment = new ExtendedSentimentAnalyzer();
    this.reporter = new AnalyticsReporter(profile);
  }

  analyzeArticle(article, metadata = {}) {
    return this.reporter.generateArticleReport(article, metadata);
  }

  analyzePortfolio(articles, metadata = {}) {
    return this.reporter.generatePortfolioReport(articles, metadata);
  }

  getInsights(articles) {
    return this.reporter.generateInsights(articles);
  }

  analyzeSourcePerformance(articles) {
    return this.reporter.generateSourceReport(articles);
  }

  analyzeTimeline(articles, events = []) {
    return this.reporter.generateTimelineReport(articles, events);
  }

  compare(beforeArticles, afterArticles) {
    return this.reporter.generateComparativeReport(beforeArticles, afterArticles);
  }

  checkQuality(articles) {
    return this.reporter.generateQAReport(articles);
  }

  switchProfile(profileName) {
    if (!WEIGHT_PROFILES[profileName]) {
      throw new Error(`Unknown profile: ${profileName}`);
    }
    this.profile = profileName;
    this.weighting.setProfile(profileName);
    this.reporter.profile = profileName;
  }

  getProfiles() {
    return Object.keys(WEIGHT_PROFILES);
  }

  analyzeBatch(articles, onProgress = null) {
    const results = { articles: [], summary: {}, errors: [] };
    articles.forEach((article, idx) => {
      try {
        const report = this.analyzeArticle(article);
        results.articles.push(report);
        if (onProgress) onProgress({ current: idx + 1, total: articles.length, article: article.title });
      } catch (error) {
        results.errors.push({ index: idx, error: error.message });
      }
    });
    results.summary = {
      totalAnalyzed: results.articles.length,
      totalErrors: results.errors.length,
      successRate: ((results.articles.length / articles.length) * 100).toFixed(2) + '%',
    };
    return results;
  }
}

// Central analytics orchestrator (legacy)
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
async function analyzeCollection(articles, _database) {
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

// Utility functions for common operations
const AnalyticsUtils = {
  sortByScore(articles, order = 'desc') {
    const orchestrator = new AnalyticsOrchestrator();
    return articles
      .map((article) => ({
        article,
        score: orchestrator.weighting.calculateWeight(article).adjustedScore,
      }))
      .sort((a, b) => (order === 'desc' ? b.score - a.score : a.score - b.score))
      .map((item) => item.article);
  },

  filterByScore(articles, minScore, maxScore = Infinity) {
    const orchestrator = new AnalyticsOrchestrator();
    return articles.filter((article) => {
      const score = orchestrator.weighting.calculateWeight(article).adjustedScore;
      return score >= minScore && score <= maxScore;
    });
  },

  filterBySentiment(articles, sentiments = ['positiv', 'neutral', 'negativ']) {
    const analyzer = new ExtendedSentimentAnalyzer();
    return articles.filter((article) => {
      const sentiment = analyzer.analyze(article.fullText || '');
      return sentiments.includes(sentiment.label);
    });
  },

  groupByCategory(articles) {
    const orchestrator = new AnalyticsOrchestrator();
    const grouped = {};
    articles.forEach((article) => {
      const weight = orchestrator.weighting.calculateWeight(article);
      const category = weight.category;
      if (!grouped[category]) grouped[category] = [];
      grouped[category].push(article);
    });
    return grouped;
  },

  groupBySource(articles) {
    const grouped = {};
    articles.forEach((article) => {
      const source = article.source || 'Unknown';
      if (!grouped[source]) grouped[source] = [];
      grouped[source].push(article);
    });
    return grouped;
  },

  getTopArticles(articles, count = 10) {
    return this.sortByScore(articles, 'desc').slice(0, count);
  },

  calculateDiversity(articles) {
    const categories = this.groupByCategory(articles);
    const sources = this.groupBySource(articles);
    return {
      categoryDiversity: Object.keys(categories).length,
      sourceDiversity: Object.keys(sources).length,
      categoryDistribution: Object.fromEntries(
        Object.entries(categories).map(([cat, arts]) => [cat, arts.length])
      ),
      sourceDistribution: Object.fromEntries(
        Object.entries(sources).map(([src, arts]) => [src, arts.length])
      ),
    };
  },
};

module.exports = {
  // Legacy API
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

  // New advanced analytics
  AnalyticsOrchestrator,
  ScoringEngine,
  ArticleWeightingSystem,
  ExtendedSentimentAnalyzer,
  TemporalAnalyzer,
  AnalyticsReporter,
  createScoringEngine,
  WEIGHT_PROFILES,
  AnalyticsUtils,

  // Convenience factory
  createOrchestrator(profile = 'BROAD_COVERAGE') {
    return new AnalyticsOrchestrator(profile);
  },
};
