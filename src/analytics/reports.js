'use strict';

const { ArticleWeightingSystem } = require('./weighting');
const { ExtendedSentimentAnalyzer } = require('./sentiment-extended');
const { TemporalAnalyzer } = require('./temporal');

// Comprehensive Reporting and Analysis System
class AnalyticsReporter {
  constructor(profile = 'BROAD_COVERAGE') {
    this.weighting = new ArticleWeightingSystem(profile);
    this.sentiment = new ExtendedSentimentAnalyzer();
    this.temporal = new TemporalAnalyzer();
    this.profile = profile;
  }

  // Generate comprehensive article analysis report
  generateArticleReport(article, metadata = {}) {
    const weight = this.weighting.calculateWeight(article, metadata);
    const sentiment = this.sentiment.analyze(article.fullText || '');
    const phrases = this.sentiment.extractSentimentPhrases(article.fullText || '', 3);

    return {
      article: {
        title: article.title,
        source: article.source,
        author: article.author,
        pubDate: article.pubDate,
        wordCount: (article.fullText || '').split(/\s+/).length,
      },
      scoring: {
        totalScore: weight.totalScore,
        adjustedScore: weight.adjustedScore,
        category: weight.category,
        priority: weight.priority,
        confidence: weight.confidence,
      },
      sentiment: {
        label: sentiment.label,
        intensity: sentiment.intensity,
        confidence: sentiment.confidence,
        subjectivity: sentiment.subjectivity,
        emotionType: sentiment.emotionType,
        summary: sentiment.summary,
      },
      keyPhrases: phrases,
      breakdown: weight.breakdown,
      timestamp: new Date().toISOString(),
    };
  }

  // Generate portfolio analysis (multiple articles)
  generatePortfolioReport(articles, metadata = {}) {
    const reports = articles.map((article) => this.generateArticleReport(article, metadata));

    const scores = articles.map((a) => this.weighting.calculateWeight(a).adjustedScore);
    const categories = reports.map((r) => r.scoring.category);
    const sentiments = reports.map((r) => r.sentiment.label);

    const categoryDistribution = {};
    categories.forEach((cat) => (categoryDistribution[cat] = (categoryDistribution[cat] || 0) + 1));

    const sentimentDistribution = {};
    sentiments.forEach((sent) => (sentimentDistribution[sent] = (sentimentDistribution[sent] || 0) + 1));

    return {
      summary: {
        totalArticles: articles.length,
        scoreRange: {
          min: Math.min(...scores),
          max: Math.max(...scores),
          average: (scores.reduce((a, b) => a + b) / scores.length).toFixed(2),
        },
        topArticles: reports
          .sort((a, b) => b.scoring.adjustedScore - a.scoring.adjustedScore)
          .slice(0, 5),
        categoryDistribution,
        sentimentDistribution,
      },
      reports,
      timestamp: new Date().toISOString(),
    };
  }

  // Generate source performance report
  generateSourceReport(articles) {
    const bySource = {};

    articles.forEach((article) => {
      const source = article.source || 'Unknown';
      if (!bySource[source]) {
        bySource[source] = {
          source,
          articles: [],
          totalScore: 0,
          avgScore: 0,
          count: 0,
        };
      }
      const weight = this.weighting.calculateWeight(article);
      bySource[source].articles.push(article);
      bySource[source].totalScore += weight.adjustedScore;
      bySource[source].count++;
    });

    // Calculate averages and rankings
    const sourceStats = Object.values(bySource).map((s) => ({
      ...s,
      avgScore: (s.totalScore / s.count).toFixed(2),
      reliability: s.count >= 5 ? 'high' : s.count >= 2 ? 'medium' : 'low',
    }));

    sourceStats.sort((a, b) => parseFloat(b.avgScore) - parseFloat(a.avgScore));

    return {
      sources: sourceStats,
      topPerformers: sourceStats.slice(0, 5),
      bottomPerformers: sourceStats.slice(-5).reverse(),
      totalSources: sourceStats.length,
      timestamp: new Date().toISOString(),
    };
  }

  // Generate time-based analysis report
  generateTimelineReport(articles, eventMarkers = []) {
    const temporal = new TemporalAnalyzer();

    articles.forEach((article) => {
      const weight = this.weighting.calculateWeight(article);
      temporal.addArticle(article, weight.adjustedScore);
    });

    eventMarkers.forEach(({ date, title, type }) => {
      temporal.registerEvent(date, title, type);
    });

    return {
      timeline: temporal.getTimelineSummary(),
      trends: {
        pastWeek: temporal.analyzeTrend(
          new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          new Date()
        ),
        pastMonth: temporal.analyzeTrend(
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          new Date()
        ),
      },
      velocity: temporal.calculateVelocity(7),
      sentimentEvolution: temporal.analyzeSentimentEvolution(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date()
      ),
      anomalies: temporal.detectAnomalies(30),
      sourceDistribution: temporal.getSourceDistribution(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        new Date()
      ),
      timestamp: new Date().toISOString(),
    };
  }

  // Generate comparative report (e.g., before/after analysis)
  generateComparativeReport(beforeArticles, afterArticles) {
    const beforeReport = this.generatePortfolioReport(beforeArticles);
    const afterReport = this.generatePortfolioReport(afterArticles);

    const beforeAvg = parseFloat(beforeReport.summary.scoreRange.average);
    const afterAvg = parseFloat(afterReport.summary.scoreRange.average);
    const improvement = ((afterAvg - beforeAvg) / beforeAvg * 100).toFixed(2);

    return {
      period: {
        before: {
          count: beforeArticles.length,
          avgScore: beforeAvg,
          topScore: beforeReport.summary.scoreRange.max,
        },
        after: {
          count: afterArticles.length,
          avgScore: afterAvg,
          topScore: afterReport.summary.scoreRange.max,
        },
      },
      improvement: {
        scoreImprovement: improvement + '%',
        direction: improvement > 0 ? 'positive' : 'negative',
      },
      sentimentShift: {
        before: beforeReport.summary.sentimentDistribution,
        after: afterReport.summary.sentimentDistribution,
      },
      categoryShift: {
        before: beforeReport.summary.categoryDistribution,
        after: afterReport.summary.categoryDistribution,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // Generate quality assurance report
  generateQAReport(articles) {
    const reports = articles.map((a) => this.generateArticleReport(a));
    const weights = articles.map((a) => this.weighting.calculateWeight(a));

    const issues = [];

    articles.forEach((article, idx) => {
      const weight = weights[idx];
      const report = reports[idx];

      // Check for missing data
      if (!article.title) issues.push({ article: idx, severity: 'high', issue: 'Missing title' });
      if (!article.fullText || article.fullText.length < 50) {
        issues.push({
          article: idx,
          severity: 'medium',
          issue: 'Very short or missing content',
        });
      }
      if (!article.pubDate) issues.push({ article: idx, severity: 'medium', issue: 'Missing publication date' });
      if (!article.source) issues.push({ article: idx, severity: 'low', issue: 'Missing source' });

      // Check for low confidence
      if (weight.confidence < 0.3) {
        issues.push({
          article: idx,
          severity: 'medium',
          issue: `Low scoring confidence: ${weight.confidence}`,
        });
      }

      // Check for inconsistent sentiment
      if (report.sentiment.confidence < 0.3 && report.sentiment.label !== 'neutral') {
        issues.push({
          article: idx,
          severity: 'low',
          issue: `Weak sentiment signal: ${report.sentiment.label}`,
        });
      }
    });

    const severityCounts = { high: 0, medium: 0, low: 0 };
    issues.forEach((issue) => severityCounts[issue.severity]++);

    return {
      totalArticles: articles.length,
      issuesFound: issues.length,
      issuesBySeverity: severityCounts,
      issues: issues.sort((a, b) => {
        const severityMap = { high: 0, medium: 1, low: 2 };
        return severityMap[a.severity] - severityMap[b.severity];
      }),
      qualityScore: ((1 - issues.length / articles.length / 2) * 100).toFixed(2) + '%',
      timestamp: new Date().toISOString(),
    };
  }

  // Generate insights and recommendations
  generateInsights(articles) {
    const reports = this.generatePortfolioReport(articles);
    const sourceReport = this.generateSourceReport(articles);
    const qaReport = this.generateQAReport(articles);

    const insights = [];

    // Score insights
    const avgScore = parseFloat(reports.summary.scoreRange.average);
    if (avgScore > 80) {
      insights.push({
        type: 'strength',
        message: `High-quality portfolio: average score of ${avgScore} indicates strong article selection`,
      });
    } else if (avgScore < 40) {
      insights.push({
        type: 'warning',
        message: `Portfolio needs improvement: average score of ${avgScore} is below optimal threshold`,
      });
    }

    // Category insights
    const categories = reports.summary.categoryDistribution;
    const hasExcellent = categories.excellent > 0;
    if (hasExcellent) {
      insights.push({
        type: 'positive',
        message: `Portfolio includes ${categories.excellent} excellent articles`,
      });
    }

    // Sentiment insights
    const sentiments = reports.summary.sentimentDistribution;
    if (sentiments.positiv > sentiments.negativ) {
      insights.push({
        type: 'positive',
        message: `Predominantly positive sentiment (${sentiments.positiv} positive vs ${sentiments.negativ} negative articles)`,
      });
    }

    // Source insights
    if (sourceReport.topPerformers.length > 0) {
      const topSource = sourceReport.topPerformers[0];
      insights.push({
        type: 'info',
        message: `Best-performing source: ${topSource.source} (avg score: ${topSource.avgScore})`,
      });
    }

    // Quality insights
    const qualityScore = parseInt(qaReport.qualityScore);
    if (qualityScore < 70) {
      insights.push({
        type: 'warning',
        message: `Data quality issues detected: ${qaReport.issuesFound} issues found (severity: ${qaReport.issuesBySeverity.high} high, ${qaReport.issuesBySeverity.medium} medium)`,
      });
    }

    return {
      insights,
      recommendations: this.generateRecommendations(insights, articles, reports),
      timestamp: new Date().toISOString(),
    };
  }

  // Generate actionable recommendations
  generateRecommendations(insights, articles, reports) {
    const recommendations = [];

    const avgScore = parseFloat(reports.summary.scoreRange.average);
    if (avgScore < 50) {
      recommendations.push({
        priority: 'high',
        action: 'Improve article selection criteria',
        rationale: 'Average score below threshold suggests selection filter needs adjustment',
      });
    }

    if (reports.summary.sentimentDistribution.negativ > reports.summary.sentimentDistribution.positiv) {
      recommendations.push({
        priority: 'medium',
        action: 'Review negative sentiment articles',
        rationale: 'Consider whether critical coverage aligns with portfolio goals',
      });
    }

    const categories = reports.summary.categoryDistribution;
    if (categories.poor > articles.length * 0.1) {
      recommendations.push({
        priority: 'high',
        action: 'Filter out low-quality articles',
        rationale: `${categories.poor} articles have poor quality scores`,
      });
    }

    if (!categories.excellent) {
      recommendations.push({
        priority: 'medium',
        action: 'Seek high-quality sources',
        rationale: 'Portfolio lacks excellent-tier articles - consider expanding premium sources',
      });
    }

    return recommendations.slice(0, 5);
  }

  // Export report as structured data
  exportReport(type = 'portfolio', data = {}) {
    return {
      format: 'json',
      type,
      version: '1.0',
      profile: this.profile,
      data,
      exportedAt: new Date().toISOString(),
    };
  }

  // Generate HTML report summary
  generateHTMLSummary(reportData) {
    const summary = reportData.summary || {};
    const timestamp = reportData.timestamp || new Date().toISOString();

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pressespiegel Analyse Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display'; margin: 20px; }
    h1, h2 { color: #1d1d1f; }
    .stat { padding: 12px; background: #f5f5f7; border-radius: 8px; margin: 8px 0; }
    .stat-value { font-size: 24px; font-weight: 600; }
    .stat-label { color: #6e6e73; font-size: 12px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #e5e5ea; }
    th { background: #f5f5f7; font-weight: 600; }
  </style>
</head>
<body>
  <h1>Pressespiegel Analyse Report</h1>
  <p>Erstellt: ${timestamp}</p>

  <h2>Zusammenfassung</h2>
  <div class="stat">
    <div class="stat-value">${summary.totalArticles || 0}</div>
    <div class="stat-label">Artikel analysiert</div>
  </div>

  <div class="stat">
    <div class="stat-value">${summary.scoreRange?.average || 'N/A'}</div>
    <div class="stat-label">Durchschnittlicher Score</div>
  </div>

  <h2>Kategorieverteilung</h2>
  <table>
    <tr>
      <th>Kategorie</th>
      <th>Anzahl</th>
    </tr>
    ${
      Object.entries(summary.categoryDistribution || {})
        .map(([cat, count]) => `<tr><td>${cat}</td><td>${count}</td></tr>`)
        .join('')
    }
  </table>

  <h2>Sentimentverteilung</h2>
  <table>
    <tr>
      <th>Sentiment</th>
      <th>Anzahl</th>
    </tr>
    ${
      Object.entries(summary.sentimentDistribution || {})
        .map(([sent, count]) => `<tr><td>${sent}</td><td>${count}</td></tr>`)
        .join('')
    }
  </table>
</body>
</html>
    `.trim();
  }
}

module.exports = {
  AnalyticsReporter,
};
