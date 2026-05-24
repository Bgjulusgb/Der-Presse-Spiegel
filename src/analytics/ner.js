'use strict';

const { keywords } = require('../config');

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function extractEntities(article) {
  const entities = [];
  const title = normalize(article.title || '');
  const text = normalize([article.fullText, article.summary, article.firstParagraph].filter(Boolean).join(' '));

  // Extract people
  for (const person of keywords.people) {
    if (!person || person.length < 3) continue;
    const normalized = normalize(person);
    const titleCount = countOccurrences(title, normalized);
    const textCount = countOccurrences(text, normalized);
    if (titleCount > 0 || textCount > 0) {
      entities.push({
        type: 'person',
        value: person,
        inTitle: titleCount > 0,
        mentions: titleCount + textCount,
        confidence: Math.min(1, (titleCount * 2 + textCount) / 10),
      });
    }
  }

  // Extract productions
  for (const prod of keywords.productions) {
    if (!prod || prod.length < 3) continue;
    const normalized = normalize(prod);
    const titleCount = countOccurrences(title, normalized);
    const textCount = countOccurrences(text, normalized);
    if (titleCount > 0 || textCount > 0) {
      entities.push({
        type: 'production',
        value: prod,
        inTitle: titleCount > 0,
        mentions: titleCount + textCount,
        confidence: Math.min(1, (titleCount * 2 + textCount) / 10),
      });
    }
  }

  // Extract venues
  for (const venue of keywords.venues) {
    if (!venue || venue.length < 3) continue;
    const normalized = normalize(venue);
    const titleCount = countOccurrences(title, normalized);
    const textCount = countOccurrences(text, normalized);
    if (titleCount > 0 || textCount > 0) {
      entities.push({
        type: 'venue',
        value: venue,
        inTitle: titleCount > 0,
        mentions: titleCount + textCount,
        confidence: Math.min(1, (titleCount + textCount) / 5),
      });
    }
  }

  // Extract keywords (theater context)
  for (const kw of keywords.theater_context) {
    if (!kw || kw.length < 3) continue;
    const normalized = normalize(kw);
    const textCount = countOccurrences(text, normalized);
    if (textCount > 0) {
      entities.push({
        type: 'keyword',
        value: kw,
        inTitle: false,
        mentions: textCount,
        confidence: 0.6,
      });
    }
  }

  return entities;
}

function countOccurrences(haystack, needle) {
  if (!needle || needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function getEntityStats(articles) {
  const stats = {
    people: new Map(),
    productions: new Map(),
    venues: new Map(),
    keywords: new Map(),
  };

  const typeMapping = {
    person: 'people',
    production: 'productions',
    venue: 'venues',
    keyword: 'keywords',
  };

  for (const article of articles) {
    const entities = extractEntities(article);
    for (const entity of entities) {
      const typeKey = typeMapping[entity.type];
      if (!typeKey) continue;
      const key = entity.value;
      const current = stats[typeKey].get(key) || { mentions: 0, inTitle: 0, articles: 0 };
      current.mentions += entity.mentions;
      if (entity.inTitle) current.inTitle++;
      current.articles++;
      stats[typeKey].set(key, current);
    }
  }

  return stats;
}

module.exports = {
  extractEntities,
  getEntityStats,
  normalize,
};
