'use strict';

// Temporal Analysis - Track and Analyze Article Patterns Over Time
class TemporalAnalyzer {
  constructor() {
    this.articleTimeline = [];
    this.eventMarkers = [];
  }

  // Register an event (premiere, announcement, etc.)
  registerEvent(date, title, type = 'event') {
    this.eventMarkers.push({
      date: new Date(date),
      title,
      type,
      articlesAround: [],
    });
  }

  // Add article to timeline
  addArticle(article, weight = 0) {
    const pubDate = article.pubDate ? new Date(article.pubDate) : new Date();
    this.articleTimeline.push({
      date: pubDate,
      title: article.title,
      source: article.source,
      weight,
      type: article.articleType || 'news',
      sentiment: article.sentiment || 'neutral',
    });
  }

  // Calculate coverage density around an event
  getCoverageDensity(eventDate, windowDays = 30) {
    const event = new Date(eventDate);
    const start = new Date(event.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const end = new Date(event.getTime() + windowDays * 24 * 60 * 60 * 1000);

    const articles = this.articleTimeline.filter((a) => a.date >= start && a.date <= end);

    return {
      totalArticles: articles.length,
      beforeEvent: articles.filter((a) => a.date < event).length,
      afterEvent: articles.filter((a) => a.date > event).length,
      peakDay: this.findPeakDay(articles),
      density: (articles.length / (2 * windowDays)).toFixed(2),
      articles,
    };
  }

  // Find day with most articles
  findPeakDay(articles) {
    const dayMap = {};
    articles.forEach((a) => {
      const day = a.date.toISOString().split('T')[0];
      dayMap[day] = (dayMap[day] || 0) + 1;
    });

    const peak = Object.entries(dayMap).sort((a, b) => b[1] - a[1])[0];
    return peak ? { date: peak[0], count: peak[1] } : null;
  }

  // Analyze coverage trends over time periods
  analyzeTrend(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const articles = this.articleTimeline.filter((a) => a.date >= start && a.date <= end);

    if (articles.length === 0) {
      return { articles: 0, averageWeight: 0, trend: 'no_data' };
    }

    // Calculate trend direction
    const firstHalf = articles.filter((a) => a.date < new Date(start.getTime() + (end - start) / 2));
    const secondHalf = articles.filter((a) => a.date >= new Date(start.getTime() + (end - start) / 2));

    const firstAvgWeight = firstHalf.reduce((a, b) => a + b.weight, 0) / Math.max(firstHalf.length, 1);
    const secondAvgWeight = secondHalf.reduce((a, b) => a + b.weight, 0) / Math.max(secondHalf.length, 1);

    let trend = 'stable';
    if (secondAvgWeight > firstAvgWeight * 1.1) trend = 'increasing';
    else if (secondAvgWeight < firstAvgWeight * 0.9) trend = 'decreasing';

    return {
      articles: articles.length,
      averageWeight: (articles.reduce((a, b) => a + b.weight, 0) / articles.length).toFixed(2),
      firstHalfAvg: firstAvgWeight.toFixed(2),
      secondHalfAvg: secondAvgWeight.toFixed(2),
      trend,
      periodDays: Math.floor((end - start) / (1000 * 60 * 60 * 24)),
      articlesPerDay: (articles.length / Math.max((end - start) / (1000 * 60 * 60 * 24), 1)).toFixed(2),
    };
  }

  // Find related articles within a time window
  findRelatedArticles(sourceArticle, windowDays = 14) {
    const sourceDate = new Date(sourceArticle.pubDate);
    const start = new Date(sourceDate.getTime() - windowDays * 24 * 60 * 60 * 1000);
    const end = new Date(sourceDate.getTime() + windowDays * 24 * 60 * 60 * 1000);

    return this.articleTimeline.filter((a) => {
      if (a.date < start || a.date > end) return false;
      if (a.title === sourceArticle.title) return false;

      // Check for title overlap (words in common)
      const sourceWords = new Set(sourceArticle.title.toLowerCase().split(/\s+/));
      const targetWords = a.title.toLowerCase().split(/\s+/);
      const overlap = targetWords.filter((w) => sourceWords.has(w)).length;

      return overlap >= 2; // At least 2 words in common
    });
  }

  // Calculate article velocity (rate of publication)
  calculateVelocity(windowDays = 7) {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const recentArticles = this.articleTimeline.filter((a) => a.date >= cutoff);

    return {
      articlesInWindow: recentArticles.length,
      averagePerDay: (recentArticles.length / windowDays).toFixed(2),
      velocityTrend: this.getVelocityTrend(recentArticles),
    };
  }

  // Determine if velocity is accelerating or decelerating
  getVelocityTrend(articles) {
    if (articles.length < 4) return 'insufficient_data';

    const chunkSize = Math.ceil(articles.length / 2);
    const firstHalf = articles.slice(0, chunkSize);
    const secondHalf = articles.slice(chunkSize);

    const firstRate = firstHalf.length / Math.max(chunkSize, 1);
    const secondRate = secondHalf.length / Math.max(chunkSize, 1);

    if (secondRate > firstRate * 1.2) return 'accelerating';
    if (secondRate < firstRate * 0.8) return 'decelerating';
    return 'stable';
  }

  // Analyze sentiment evolution
  analyzeSentimentEvolution(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const articles = this.articleTimeline.filter((a) => a.date >= start && a.date <= end);

    if (articles.length === 0) return null;

    const sentimentCounts = {
      positiv: 0,
      neutral: 0,
      negativ: 0,
    };

    const sentimentByWeek = {};

    articles.forEach((a) => {
      sentimentCounts[a.sentiment] = (sentimentCounts[a.sentiment] || 0) + 1;

      const week = this.getWeekKey(a.date);
      if (!sentimentByWeek[week]) {
        sentimentByWeek[week] = { positiv: 0, neutral: 0, negativ: 0 };
      }
      sentimentByWeek[week][a.sentiment] = (sentimentByWeek[week][a.sentiment] || 0) + 1;
    });

    return {
      totalArticles: articles.length,
      overallSentiment: sentimentCounts,
      weeklyBreakdown: sentimentByWeek,
      dominantSentiment: Object.entries(sentimentCounts).sort((a, b) => b[1] - a[1])[0][0],
      sentimentBalance: this.calculateSentimentBalance(sentimentCounts),
    };
  }

  // Calculate sentiment balance score
  calculateSentimentBalance(sentiments) {
    const total = sentiments.positiv + sentiments.neutral + sentiments.negativ;
    if (total === 0) return 0;

    const positiveRatio = sentiments.positiv / total;
    const negativeRatio = sentiments.negativ / total;

    return (positiveRatio - negativeRatio).toFixed(2);
  }

  // Get week key for grouping
  getWeekKey(date) {
    const d = new Date(date);
    const week = Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 86400000 + 1) / 7);
    return `${d.getFullYear()}-W${week}`;
  }

  // Get source distribution over time
  getSourceDistribution(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const articles = this.articleTimeline.filter((a) => a.date >= start && a.date <= end);

    const sourceCounts = {};
    const sourceWeights = {};

    articles.forEach((a) => {
      sourceCounts[a.source] = (sourceCounts[a.source] || 0) + 1;
      sourceWeights[a.source] = (sourceWeights[a.source] || 0) + a.weight;
    });

    return {
      byCount: Object.entries(sourceCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([source, count]) => ({ source, count })),
      byWeight: Object.entries(sourceWeights)
        .sort((a, b) => b[1] - a[1])
        .map(([source, weight]) => ({ source, weight: weight.toFixed(2) })),
      totalSources: Object.keys(sourceCounts).length,
    };
  }

  // Detect anomalies (unusual spikes in coverage)
  detectAnomalies(windowDays = 30) {
    const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const articles = this.articleTimeline.filter((a) => a.date >= cutoff);

    const dailyCounts = {};
    articles.forEach((a) => {
      const day = a.date.toISOString().split('T')[0];
      dailyCounts[day] = (dailyCounts[day] || 0) + 1;
    });

    const counts = Object.values(dailyCounts);
    if (counts.length < 3) return [];

    const avg = counts.reduce((a, b) => a + b) / counts.length;
    const stdDev = Math.sqrt(counts.reduce((a, b) => a + Math.pow(b - avg, 2)) / counts.length);

    return Object.entries(dailyCounts)
      .filter(([_, count]) => Math.abs(count - avg) > 2 * stdDev)
      .map(([date, count]) => ({
        date,
        count,
        deviation: ((count - avg) / stdDev).toFixed(2),
        type: count > avg ? 'spike' : 'dip',
      }));
  }

  // Get timeline summary
  getTimelineSummary() {
    if (this.articleTimeline.length === 0) {
      return { articles: 0, dateRange: 'no_data' };
    }

    const dates = this.articleTimeline.map((a) => a.date.getTime()).sort((a, b) => a - b);
    const firstDate = new Date(dates[0]);
    const lastDate = new Date(dates[dates.length - 1]);

    return {
      totalArticles: this.articleTimeline.length,
      dateRange: {
        start: firstDate.toISOString().split('T')[0],
        end: lastDate.toISOString().split('T')[0],
        daysSpanned: Math.floor((lastDate - firstDate) / (1000 * 60 * 60 * 24)),
      },
      averageWeight: (this.articleTimeline.reduce((a, b) => a + b.weight, 0) / this.articleTimeline.length).toFixed(2),
      events: this.eventMarkers.length,
    };
  }
}

module.exports = {
  TemporalAnalyzer,
};
