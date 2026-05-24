'use strict';

const { levenshteinSimilarity } = require('../utils');

function cosineSimilarity(vec1, vec2) {
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  const allKeys = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
  for (const key of allKeys) {
    const v1 = vec1[key] || 0;
    const v2 = vec2[key] || 0;
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

function vectorizeText(text) {
  const words = String(text || '')
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 2);
  const vec = {};
  for (const word of words) {
    vec[word] = (vec[word] || 0) + 1;
  }
  return vec;
}

function clusterArticles(articles, threshold = 0.6) {
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < articles.length; i++) {
    if (assigned.has(i)) continue;

    const cluster = [articles[i]];
    assigned.add(i);

    const vec1 = vectorizeText(`${articles[i].title} ${articles[i].summary || ''}`);

    for (let j = i + 1; j < articles.length; j++) {
      if (assigned.has(j)) continue;

      const vec2 = vectorizeText(`${articles[j].title} ${articles[j].summary || ''}`);
      const similarity = cosineSimilarity(vec1, vec2);

      // Also check title similarity for very similar titles
      const titleSim = levenshteinSimilarity(articles[i].title || '', articles[j].title || '');

      if (similarity >= threshold || titleSim > 0.85) {
        cluster.push(articles[j]);
        assigned.add(j);
      }
    }

    if (cluster.length > 1) {
      clusters.push({
        size: cluster.length,
        articles: cluster.map((a) => ({
          id: a.id,
          title: a.title,
          source: a.source,
          publishedDate: a.published_date,
          relevance: a.relevance_score,
        })),
        mainTheme: cluster[0].title,
        coherence: calculateClusterCoherence(cluster),
      });
    }
  }

  return clusters.sort((a, b) => b.size - a.size);
}

function calculateClusterCoherence(articles) {
  if (articles.length < 2) return 1;
  let totalSim = 0;
  let count = 0;

  for (let i = 0; i < articles.length; i++) {
    const vec1 = vectorizeText(`${articles[i].title} ${articles[i].summary || ''}`);
    for (let j = i + 1; j < articles.length; j++) {
      const vec2 = vectorizeText(`${articles[j].title} ${articles[j].summary || ''}`);
      totalSim += cosineSimilarity(vec1, vec2);
      count++;
    }
  }

  return count > 0 ? Math.round((totalSim / count) * 100) / 100 : 0;
}

function findDuplicates(articles, similarity = 0.9) {
  const duplicates = [];
  const checked = new Set();

  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const key = `${i}-${j}`;
      if (checked.has(key)) continue;
      checked.add(key);

      const titleSim = levenshteinSimilarity(articles[i].title || '', articles[j].title || '');
      const vec1 = vectorizeText(articles[i].full_text || articles[i].summary || '');
      const vec2 = vectorizeText(articles[j].full_text || articles[j].summary || '');
      const textSim = cosineSimilarity(vec1, vec2);

      if (titleSim >= similarity || textSim >= similarity) {
        duplicates.push({
          article1: { id: articles[i].id, title: articles[i].title },
          article2: { id: articles[j].id, title: articles[j].title },
          titleSimilarity: Math.round(titleSim * 100) / 100,
          textSimilarity: Math.round(textSim * 100) / 100,
          combinedScore: Math.round(((titleSim + textSim) / 2) * 100) / 100,
        });
      }
    }
  }

  return duplicates.sort((a, b) => b.combinedScore - a.combinedScore);
}

module.exports = {
  clusterArticles,
  findDuplicates,
  calculateClusterCoherence,
  cosineSimilarity,
  vectorizeText,
};
