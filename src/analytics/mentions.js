'use strict';

const ner = require('./ner');
const { subDays, format } = require('date-fns');

function analyzeMentionTrends(articles) {
  const byDate = new Map();
  const entities = new Map();

  // Group by published date
  for (const article of articles) {
    if (!article.published_date) continue;
    const dateKey = format(new Date(article.published_date), 'yyyy-MM-dd');
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(article);
  }

  // Extract entities and build trends
  for (const [dateKey, dayArticles] of byDate) {
    for (const article of dayArticles) {
      const extracted = ner.extractEntities(article);
      for (const entity of extracted) {
        if (!entities.has(entity.type)) entities.set(entity.type, new Map());
        const typeMap = entities.get(entity.type);
        if (!typeMap.has(entity.value)) {
          typeMap.set(entity.value, []);
        }
        const timeline = typeMap.get(entity.value);
        const existing = timeline.find((t) => t.date === dateKey);
        if (existing) {
          existing.count++;
          existing.mentions += entity.mentions;
        } else {
          timeline.push({
            date: dateKey,
            count: 1,
            mentions: entity.mentions,
          });
        }
      }
    }
  }

  // Convert to output format
  const trends = {};
  for (const [type, typeMap] of entities) {
    trends[type] = {};
    for (const [entity, timeline] of typeMap) {
      timeline.sort((a, b) => new Date(a.date) - new Date(b.date));
      trends[type][entity] = timeline;
    }
  }

  return trends;
}

function getMentionSpikes(articles, windowDays = 7) {
  const trends = analyzeMentionTrends(articles);
  const spikes = [];

  for (const [entityType, typeMap] of Object.entries(trends)) {
    for (const [entityValue, timeline] of Object.entries(typeMap)) {
      if (timeline.length < 2) continue;

      // Calculate moving average
      const recent = timeline.slice(-windowDays);
      const avgRecent = recent.reduce((sum, t) => sum + t.mentions, 0) / recent.length;
      const older = timeline.slice(0, -windowDays);
      const avgOlder = older.length > 0 ? older.reduce((sum, t) => sum + t.mentions, 0) / older.length : avgRecent;

      if (avgOlder > 0 && avgRecent / avgOlder > 2) {
        spikes.push({
          type: entityType,
          entity: entityValue,
          spikeRatio: (avgRecent / avgOlder).toFixed(2),
          recentMentions: Math.round(avgRecent),
          previousAvg: Math.round(avgOlder),
        });
      }
    }
  }

  return spikes.sort((a, b) => parseFloat(b.spikeRatio) - parseFloat(a.spikeRatio));
}

function getTopMentions(articles, entityType = null, limit = 10) {
  const ent = ner.getEntityStats(articles);
  let candidates = [];

  if (entityType) {
    const map = ent[entityType + 's'];
    if (map) {
      for (const [value, stats] of map) {
        candidates.push({ type: entityType, value, ...stats });
      }
    }
  } else {
    for (const [type, map] of Object.entries(ent)) {
      for (const [value, stats] of map) {
        candidates.push({ type, value, ...stats });
      }
    }
  }

  return candidates
    .sort((a, b) => b.mentions - a.mentions || b.articles - a.articles)
    .slice(0, limit);
}

function getEntityTimeline(articles, entityValue) {
  const timeline = new Map();

  for (const article of articles) {
    if (!article.published_date) continue;
    const dateKey = format(new Date(article.published_date), 'yyyy-MM-dd');
    const entities = ner.extractEntities(article);
    const found = entities.find((e) => e.value === entityValue);
    if (found) {
      const current = timeline.get(dateKey) || { count: 0, mentions: 0, sentiment: [] };
      current.count++;
      current.mentions += found.mentions;
      if (article.sentiment) current.sentiment.push(article.sentiment);
      timeline.set(dateKey, current);
    }
  }

  return Array.from(timeline.entries())
    .map(([date, data]) => ({
      date,
      count: data.count,
      mentions: data.mentions,
      dominantSentiment:
        data.sentiment.length > 0
          ? data.sentiment.reduce((a, b, _, arr) => (arr.filter((x) => x === a).length > arr.filter((x) => x === b).length ? a : b))
          : null,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

module.exports = {
  analyzeMentionTrends,
  getMentionSpikes,
  getTopMentions,
  getEntityTimeline,
};
