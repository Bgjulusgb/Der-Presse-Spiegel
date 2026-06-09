'use strict';

const { createScoringEngine } = require('./scoring');
const { ExtendedSentimentAnalyzer } = require('./sentiment-extended');

// Comprehensive Weighting and Rating System
class ArticleWeightingSystem {
  constructor(profile = 'BROAD_COVERAGE', customWeights = {}) {
    this.scoringEngine = createScoringEngine(profile);
    this.sentimentAnalyzer = new ExtendedSentimentAnalyzer();
    this.profile = profile;
    this.customWeights = customWeights;
  }

  // Calculate comprehensive article weight/score with multiple dimensions
  calculateWeight(article, metadata = {}) {
    if (!article) return null;

    const baseScore = this.calculateBaseScore(article);
    const sentimentBonus = this.calculateSentimentBonus(article);
    const qualityBonus = this.calculateQualityBonus(article);
    const recencyBonus = this.scoringEngine.calculateRecencyBonus(article.pubDate);
    const sourceBonus = this.scoringEngine.evaluateSourceAuthority(
      article.source,
      metadata.sourceName
    );
    const authorBonus = this.scoringEngine.assessAuthorCredibility(article.author, article);
    const structuralBonus = this.scoringEngine.calculateStructuralBonus(article);
    const diversityBonus = this.scoringEngine.calculateSemanticDiversity(article);
    const cooccurrenceBonus = this.scoringEngine.calculateEntityCooccurrenceBonus(
      metadata.matches || {}
    );

    const totalScore =
      baseScore + sentimentBonus + qualityBonus + recencyBonus + sourceBonus + authorBonus;

    const bonuses = {
      sentiment: sentimentBonus,
      quality: qualityBonus,
      recency: recencyBonus,
      source: sourceBonus,
      author: authorBonus,
      structural: structuralBonus,
      diversity: diversityBonus,
      cooccurrence: cooccurrenceBonus,
    };

    const adjustedScore = totalScore + structuralBonus + diversityBonus + cooccurrenceBonus;
    const category = this.categorizeScore(adjustedScore);
    const priority = this.calculatePriority(adjustedScore, article);

    return {
      totalScore: Math.max(0, totalScore),
      adjustedScore: Math.max(0, adjustedScore),
      baseScore,
      bonuses,
      category,
      priority,
      confidence: this.calculateConfidence(article, bonuses),
      breakdown: this.getDetailedBreakdown(article, bonuses),
    };
  }

  // Core scoring based on content relevance
  calculateBaseScore(article) {
    let score = 0;
    const text = (article.fullText || article.summary || '').toLowerCase();
    const title = (article.title || '').toLowerCase();

    // Title scoring
    if (title.includes('kammerspiele')) score += 40;
    if (title.includes('premiere')) score += 20;

    // Content scoring (Erwaehnung im Text, falls nicht schon im Titel)
    if (!title.includes('kammerspiele') && text.includes('kammerspiele')) score += 20;

    // Content depth scoring
    const wordCount = (article.fullText || '').split(/\s+/).length;
    if (wordCount > 500) score += 20;
    else if (wordCount > 200) score += 10;

    // Type-based scoring
    if (article.articleType === 'review') score += 25;
    else if (article.articleType === 'interview') score += 20;
    else if (article.articleType === 'announcement') score += 15;

    return score;
  }

  // Sentiment impact on article weight
  calculateSentimentBonus(article) {
    const sentimentAnalysis = this.sentimentAnalyzer.analyze(
      `${article.title || ''} ${article.fullText || ''}`
    );

    // For reviews, strong sentiment (positive or negative) is valuable
    if (article.articleType === 'review' && sentimentAnalysis.intensity >= 4) {
      return 15;
    }

    // Mixed/neutral sentiment for news is acceptable
    if (article.articleType !== 'review' && sentimentAnalysis.label === 'neutral') {
      return 0;
    }

    // Strong sentiment in any content type adds credibility
    if (sentimentAnalysis.confidence > 0.7) {
      return 10;
    }

    return 5;
  }

  // Quality indicators (depth, structure, detail)
  calculateQualityBonus(article) {
    let bonus = 0;

    // Has full text (vs. summary only)
    if (article.fullText && article.fullText.length > 200) bonus += 10;

    // Multiple sources/references indicated
    if ((article.fullText || '').match(/http|www\.|link/i)) bonus += 5;

    // Direct quotes indicate reporting
    if ((article.fullText || '').match(/["„"«»]/)) bonus += 8;

    // Dated/time references indicate timeliness
    if ((article.fullText || '').match(/\d{1,2}\.\s*\w+\s*\d{4}|\d{4}|heute|gestern/i)) bonus += 5;

    // Professional structure
    const paragraphs = (article.fullText || '').split(/\n\n+/).length;
    if (paragraphs >= 3) bonus += 5;

    return Math.min(bonus, 25);
  }

  // Categorize score into tiers
  categorizeScore(score) {
    if (score >= 100) return 'excellent';
    if (score >= 80) return 'very_good';
    if (score >= 60) return 'good';
    if (score >= 40) return 'acceptable';
    if (score >= 20) return 'marginal';
    return 'poor';
  }

  // Calculate priority for article ordering
  calculatePriority(score, article) {
    let priorityScore = score;

    // Boost for recent articles
    if (article.pubDate) {
      const daysOld = (Date.now() - new Date(article.pubDate).getTime()) / (1000 * 60 * 60 * 24);
      if (daysOld < 1) priorityScore += 30;
      else if (daysOld < 7) priorityScore += 15;
    }

    // Boost for premieres
    if ((article.fullText || '').toLowerCase().includes('premiere')) priorityScore += 20;

    // Boost for reviews
    if (article.articleType === 'review') priorityScore += 15;

    if (priorityScore >= 130) return 1; // Critical
    if (priorityScore >= 100) return 2; // High
    if (priorityScore >= 70) return 3; // Medium
    if (priorityScore >= 40) return 4; // Low
    return 5; // Minimal
  }

  // Calculate confidence in the rating
  calculateConfidence(article, bonuses) {
    let confidence = 0.5; // Base confidence

    // Data completeness
    if (article.title) confidence += 0.1;
    if (article.fullText && article.fullText.length > 300) confidence += 0.15;
    if (article.source) confidence += 0.05;
    if (article.pubDate) confidence += 0.05;
    if (article.author) confidence += 0.05;

    // Bonus consistency
    const bonusValues = Object.values(bonuses).filter((b) => typeof b === 'number');
    if (bonusValues.some((b) => b > 0)) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  // Get detailed breakdown for transparency
  getDetailedBreakdown(article, bonuses) {
    const breakdown = {
      dataCompleteness: {
        hasTitle: !!article.title,
        hasFullText: !!article.fullText && article.fullText.length > 100,
        hasSource: !!article.source,
        hasPublishDate: !!article.pubDate,
        hasAuthor: !!article.author,
        hasSummary: !!article.summary,
      },
      contentQuality: {
        wordCount: (article.fullText || '').split(/\s+/).length,
        paragraphs: (article.fullText || '').split(/\n\n+/).length,
        hasQuotes: !!(article.fullText || '').match(/["„"«»]/),
        hasLinks: !!(article.fullText || '').match(/http|www\./i),
        type: article.articleType || 'unknown',
      },
      sentiment: this.sentimentAnalyzer.analyze(
        `${article.title || ''} ${article.fullText || ''}`
      ),
      bonusBreakdown: bonuses,
    };

    return breakdown;
  }

  // Compare weights of multiple articles
  compareArticles(articles) {
    const weights = articles.map((article, idx) => ({
      index: idx,
      title: article.title,
      weight: this.calculateWeight(article),
    }));

    return weights.sort((a, b) => b.weight.adjustedScore - a.weight.adjustedScore);
  }

  // Batch process articles with weights
  processArticleBatch(articles, metadata = {}) {
    return {
      articles: articles.map((article) => ({
        article,
        weight: this.calculateWeight(article, metadata),
      })),
      summary: {
        totalArticles: articles.length,
        averageScore: articles.reduce((sum, a) => sum + (this.calculateWeight(a).adjustedScore || 0), 0) / articles.length,
        topCategory: this.getTopCategory(articles),
        distribution: this.getScoreDistribution(articles),
      },
    };
  }

  // Get most common category
  getTopCategory(articles) {
    const categories = articles.map((a) => this.categorizeScore(this.calculateWeight(a).adjustedScore));
    const counts = {};
    categories.forEach((cat) => (counts[cat] = (counts[cat] || 0) + 1));
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
  }

  // Get score distribution
  getScoreDistribution(articles) {
    const scores = articles.map((a) => this.calculateWeight(a).adjustedScore);
    return {
      min: Math.min(...scores),
      max: Math.max(...scores),
      average: (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2),
      median: this.median(scores.sort((a, b) => a - b)),
      standardDeviation: this.stdDev(scores).toFixed(2),
    };
  }

  // Helper: calculate median
  median(sortedArray) {
    const mid = Math.floor(sortedArray.length / 2);
    return sortedArray.length % 2 !== 0
      ? sortedArray[mid]
      : ((sortedArray[mid - 1] + sortedArray[mid]) / 2).toFixed(2);
  }

  // Helper: calculate standard deviation
  stdDev(values) {
    const avg = values.reduce((a, b) => a + b) / values.length;
    const squareDiffs = values.map((value) => Math.pow(value - avg, 2));
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b) / squareDiffs.length;
    return Math.sqrt(avgSquareDiff);
  }

  // Change scoring profile dynamically
  setProfile(profileName) {
    this.profile = profileName;
    this.scoringEngine = createScoringEngine(profileName);
  }

  // Get available profiles
  getAvailableProfiles() {
    return Object.keys(require('./scoring').WEIGHT_PROFILES);
  }
}

module.exports = {
  ArticleWeightingSystem,
};
