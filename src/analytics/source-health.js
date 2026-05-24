'use strict';

function calculateSourceMetrics(articles) {
  const sources = new Map();

  for (const article of articles) {
    const source = article.source || 'Unbekannt';
    if (!sources.has(source)) {
      sources.set(source, {
        totalArticles: 0,
        relevanceScores: [],
        sentiments: { positiv: 0, negativ: 0, neutral: 0 },
        paywallCount: 0,
        avgWordCount: 0,
        wordCounts: [],
      });
    }

    const stats = sources.get(source);
    stats.totalArticles++;
    if (article.relevance_score) stats.relevanceScores.push(article.relevance_score);
    if (article.sentiment) stats.sentiments[article.sentiment]++;
    if (article.paywall) stats.paywallCount++;
    const wordCount = article.word_count || 0;
    stats.wordCounts.push(wordCount);
  }

  const result = [];
  for (const [source, stats] of sources) {
    const avgRelevance = stats.relevanceScores.length > 0 ? stats.relevanceScores.reduce((a, b) => a + b, 0) / stats.relevanceScores.length : 0;
    const avgWordCount = stats.wordCounts.reduce((a, b) => a + b, 0) / stats.wordCounts.length || 0;
    const totalSentiment = stats.sentiments.positiv + stats.sentiments.negativ + stats.sentiments.neutral || 1;
    const paywallRatio = stats.paywallCount / stats.totalArticles;

    result.push({
      source,
      totalArticles: stats.totalArticles,
      avgRelevanceScore: Math.round(avgRelevance * 100) / 100,
      avgWordCount: Math.round(avgWordCount),
      sentimentDistribution: {
        positiv: Math.round((stats.sentiments.positiv / totalSentiment) * 100),
        negativ: Math.round((stats.sentiments.negativ / totalSentiment) * 100),
        neutral: Math.round((stats.sentiments.neutral / totalSentiment) * 100),
      },
      paywallRatio: Math.round(paywallRatio * 100) / 100,
      qualityScore: calculateQualityScore(avgRelevance, paywallRatio, avgWordCount),
      bias: calculateBias(stats.sentiments, totalSentiment),
    });
  }

  return result.sort((a, b) => b.qualityScore - a.qualityScore);
}

function calculateQualityScore(avgRelevance, paywallRatio, avgWordCount) {
  let score = 50;
  score += Math.min(avgRelevance, 50);
  score -= paywallRatio * 30;
  if (avgWordCount > 200) score += 10;
  else if (avgWordCount < 100) score -= 10;
  return Math.max(0, Math.min(100, Math.round(score * 100) / 100));
}

function calculateBias(sentiments, total) {
  const pos = sentiments.positiv / total;
  const neg = sentiments.negativ / total;
  const neu = sentiments.neutral / total;

  if (pos > 0.6) return 'positive_bias';
  if (neg > 0.6) return 'negative_bias';
  if (neu > 0.8) return 'neutral_bias';
  return 'balanced';
}

function getSourceRanking(articles) {
  const metrics = calculateSourceMetrics(articles);
  return metrics.map((m, idx) => ({
    ...m,
    rank: idx + 1,
    trustScore: m.qualityScore - (m.bias === 'positive_bias' || m.bias === 'negative_bias' ? 15 : 0),
  }));
}

module.exports = {
  calculateSourceMetrics,
  getSourceRanking,
};
