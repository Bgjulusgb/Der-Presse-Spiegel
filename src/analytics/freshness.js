'use strict';

const { differenceInHours, differenceInDays } = require('date-fns');

function calculateFreshness(articles) {
  const now = new Date();
  const freshness = [];

  for (const article of articles) {
    if (!article.published_date) {
      freshness.push({
        id: article.id,
        freshness: 'unknown',
        hoursOld: null,
        daysOld: null,
      });
      continue;
    }

    const pubDate = new Date(article.published_date);
    const hoursOld = differenceInHours(now, pubDate);
    const daysOld = differenceInDays(now, pubDate);

    let freshnessLabel = 'stale';
    if (hoursOld < 1) freshnessLabel = 'breaking';
    else if (hoursOld < 6) freshnessLabel = 'fresh';
    else if (hoursOld < 24) freshnessLabel = 'recent';
    else if (daysOld < 7) freshnessLabel = 'week-old';

    freshness.push({
      id: article.id,
      freshness: freshnessLabel,
      hoursOld,
      daysOld,
    });
  }

  return freshness;
}

function detectUpdates(articles) {
  // Group by normalized title to find articles updated over time
  const byTitle = new Map();

  for (const article of articles) {
    const titleKey = normalizeTitle(article.title || '');
    if (!byTitle.has(titleKey)) {
      byTitle.set(titleKey, []);
    }
    byTitle.get(titleKey).push(article);
  }

  const updates = [];
  for (const [title, variants] of byTitle) {
    if (variants.length > 1) {
      // Sort by publish date
      variants.sort((a, b) => new Date(a.published_date) - new Date(b.published_date));
      for (let i = 0; i < variants.length - 1; i++) {
        const prev = variants[i];
        const next = variants[i + 1];
        const hoursElapsed = (new Date(next.published_date) - new Date(prev.published_date)) / (1000 * 60 * 60);

        updates.push({
          storyTitle: title,
          originalArticle: { id: prev.id, source: prev.source, date: prev.published_date },
          updatedArticle: { id: next.id, source: next.source, date: next.published_date },
          hoursElapsed: Math.round(hoursElapsed),
          sourceChange: prev.source !== next.source,
        });
      }
    }
  }

  return updates;
}

function calculatePublicationVelocity(articles) {
  if (articles.length === 0) return 0;

  const dates = articles
    .filter((a) => a.published_date)
    .map((a) => new Date(a.published_date))
    .sort((a, b) => a - b);

  if (dates.length < 2) return 0;

  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];
  const spanHours = (lastDate - firstDate) / (1000 * 60 * 60);

  if (spanHours === 0) return articles.length; // All published at same time

  return Math.round((articles.length / spanHours) * 100) / 100; // Articles per hour
}

function getBreakingNews(articles, threshold = 5) {
  const freshness = calculateFreshness(articles);
  const breaking = [];

  for (const item of freshness) {
    if (item.freshness === 'breaking') {
      const article = articles.find((a) => a.id === item.id);
      if (article && (article.relevance_score || 0) >= threshold) {
        breaking.push({
          id: article.id,
          title: article.title,
          source: article.source,
          publishedDate: article.published_date,
          relevance: article.relevance_score,
          minutesOld: Math.round(item.hoursOld * 60),
        });
      }
    }
  }

  return breaking.sort((a, b) => new Date(b.publishedDate) - new Date(a.publishedDate));
}

function normalizeTitle(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[\W_]+/g, ' ')
    .trim();
}

module.exports = {
  calculateFreshness,
  detectUpdates,
  calculatePublicationVelocity,
  getBreakingNews,
};
