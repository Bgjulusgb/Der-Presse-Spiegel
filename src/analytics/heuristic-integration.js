'use strict';

// Integration layer: connects advanced-heuristics to the analyzer
// Enhances article scoring with mathematical methods

const logger = require('../logger');
const advHeuristics = require('./advanced-heuristics');

// Shared context for learning across imports (source history, trending topics)
const CONTEXT = {
  sourceHistory: {}, // { sourceName: { total, relevant, avgScore, variance } }
  recentTopics: {}, // { token: { frequency, lastSeen } }
  articleCache: [], // Recent articles for co-occurrence analysis
  MAX_CACHE_SIZE: 1000,
};

// Update source history based on article analysis
function updateSourceHistory(sourceName, relevanceScore, isRelevant) {
  if (!CONTEXT.sourceHistory[sourceName]) {
    CONTEXT.sourceHistory[sourceName] = {
      total: 0,
      relevant: 0,
      scores: [],
      avgScore: 0,
      variance: 0,
      lastUpdate: new Date(),
    };
  }

  const hist = CONTEXT.sourceHistory[sourceName];
  hist.total++;
  if (isRelevant) hist.relevant++;
  hist.scores.push(relevanceScore);

  // Keep only recent scores for variance calculation
  if (hist.scores.length > 100) hist.scores.shift();

  // Calculate rolling average and variance
  const sum = hist.scores.reduce((a, b) => a + b, 0);
  hist.avgScore = sum / hist.scores.length;

  const squaredDiffs = hist.scores.map((s) => Math.pow(s - hist.avgScore, 2));
  hist.variance = Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / hist.scores.length);

  hist.lastUpdate = new Date();
  return hist;
}

// Detect trending topics from recent articles
function updateTrendingTopics(article) {
  if (!article.fullText) return;

  const tokens = article.fullText
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 4); // Only longer words

  const now = new Date();
  for (const token of tokens) {
    if (!CONTEXT.recentTopics[token]) {
      CONTEXT.recentTopics[token] = { frequency: 0, firstSeen: now, lastSeen: now };
    }
    CONTEXT.recentTopics[token].frequency++;
    CONTEXT.recentTopics[token].lastSeen = now;
  }

  // Cleanup old topics (>24h old with low frequency)
  for (const [token, info] of Object.entries(CONTEXT.recentTopics)) {
    const ageMs = now - new Date(info.lastSeen);
    if (ageMs > 24 * 60 * 60 * 1000 && info.frequency < 5) {
      delete CONTEXT.recentTopics[token];
    }
  }
}

// Cache article for co-occurrence analysis
function cacheArticle(article) {
  CONTEXT.articleCache.push({
    id: article.url,
    entities: article.entities || [],
    timestamp: new Date(),
  });

  if (CONTEXT.articleCache.length > CONTEXT.MAX_CACHE_SIZE) {
    CONTEXT.articleCache.shift();
  }
}

// Calculate enhanced relevance score using multiple heuristics
function calculateEnhancedRelevance(article, baselineScore, sourcePriority) {
  // Component 1: Ensemble scoring (Bayesian + TFIDF + Temporal + Source + Relevance)
  const ensemble = advHeuristics.ensembleScore(article, {
    bayesian: true,
    tfidf: true,
    temporal: true,
    sourceTrust: true,
    sourceHistory: CONTEXT.sourceHistory,
    weights: {
      bayesian: 0.1,
      tfidf: 0.15,
      temporal: 0.2,
      sourceTrust: 0.25,
      // baseline relevance gets 0.3
    },
  });

  // Component 2: Comprehensive quality score
  const quality = advHeuristics.calculateComprehensiveQuality(article, {
    relevanceScore: baselineScore,
    sourceHistory: CONTEXT.sourceHistory,
    recentTopics: CONTEXT.recentTopics,
  });

  // Component 3: Burstiness (trending topics)
  const burstiness = advHeuristics.calculateBurstiness(article, CONTEXT.recentTopics);

  // Combine components
  const enhancedScore =
    baselineScore * 0.4 + // Keep baseline relevance prominent
    ensemble.ensembleScore * 0.3 + // Add ensemble boost
    quality.overallQuality * 0.2 + // Quality matters
    burstiness * 5; // Trending gets modest boost

  return {
    enhancedScore: Math.max(0, Math.min(100, enhancedScore)),
    components: {
      baseline: baselineScore,
      ensemble: ensemble.ensembleScore,
      quality: quality.overallQuality,
      burstiness: burstiness,
    },
    breakdown: {
      ...ensemble.components,
      quality: quality.components,
    },
  };
}

// Enhance article with heuristic-based metadata
function enrichArticleWithHeuristics(article, baselineAnalysis) {
  try {
    // Update learning context
    const isRelevant =
      baselineAnalysis.relevanceScore >= (require('../config').keywords?.thresholds?.relevant || 50);
    updateSourceHistory(article.source, baselineAnalysis.relevanceScore, isRelevant);
    updateTrendingTopics(article);
    cacheArticle(article);

    // Calculate enhanced scores
    const enhanced = calculateEnhancedRelevance(
      article,
      baselineAnalysis.relevanceScore,
      article.sourcePriority || 50
    );

    return {
      ...baselineAnalysis,
      heuristics: {
        enhancedScore: enhanced.enhancedScore,
        components: enhanced.components,
        breakdown: enhanced.breakdown,
      },
      sourceHistory: CONTEXT.sourceHistory[article.source] || null,
      trendingFactors: Object.keys(CONTEXT.recentTopics).length,
    };
  } catch (err) {
    logger.warn(`Heuristic enrichment failed for ${article.url}: ${err.message}`);
    return baselineAnalysis; // Fallback to baseline
  }
}

// Get trending topics snapshot (for API/reporting)
function getTrendingTopics(topN = 20) {
  return Object.entries(CONTEXT.recentTopics)
    .map(([token, info]) => ({
      token,
      frequency: info.frequency,
      trend: info.frequency > 10 ? 'RISING' : info.frequency > 5 ? 'GROWING' : 'STABLE',
    }))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, topN);
}

// Get source reputation scores (for API/dashboard)
function getSourceReputation(sortBy = 'avgScore') {
  return Object.entries(CONTEXT.sourceHistory)
    .map(([name, hist]) => ({
      name,
      total: hist.total,
      relevant: hist.relevant,
      relevanceRatio: (hist.relevant / hist.total).toFixed(3),
      avgScore: hist.avgScore.toFixed(1),
      variance: hist.variance.toFixed(1),
      trust: advHeuristics.calculateSourceTrust(name, CONTEXT.sourceHistory).toFixed(3),
    }))
    .sort((a, b) => {
      if (sortBy === 'trust') return parseFloat(b.trust) - parseFloat(a.trust);
      if (sortBy === 'relevanceRatio') return parseFloat(b.relevanceRatio) - parseFloat(a.relevanceRatio);
      return parseFloat(b.avgScore) - parseFloat(a.avgScore);
    });
}

// Reset context (useful for testing or fresh start)
function resetContext() {
  CONTEXT.sourceHistory = {};
  CONTEXT.recentTopics = {};
  CONTEXT.articleCache = [];
}

// Get context snapshot (for debugging/monitoring)
function getContextSnapshot() {
  return {
    sources: Object.keys(CONTEXT.sourceHistory).length,
    topics: Object.keys(CONTEXT.recentTopics).length,
    cachedArticles: CONTEXT.articleCache.length,
    topTrendings: getTrendingTopics(5),
    sourceStats: Object.entries(CONTEXT.sourceHistory)
      .map(([name, hist]) => ({ name, total: hist.total, avg: hist.avgScore.toFixed(1) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5),
  };
}

module.exports = {
  enrichArticleWithHeuristics,
  getTrendingTopics,
  getSourceReputation,
  updateSourceHistory,
  updateTrendingTopics,
  cacheArticle,
  resetContext,
  getContextSnapshot,
  // Export context for testing
  CONTEXT,
};
