'use strict';

const { sources } = require('../config');
const ner = require('./ner');

// --- Feldzugriff robust gegenueber camelCase (Pipeline) und snake_case (DB) ---
function field(article, camel, snake) {
  if (article == null) return undefined;
  return article[camel] !== undefined ? article[camel] : article[snake];
}
function getRelevance(a) {
  return Number(field(a, 'relevanceScore', 'relevance_score') || 0);
}
function getSentimentScore(a) {
  return Number(field(a, 'sentimentScore', 'sentiment_score') || 0);
}
function getSentiment(a) {
  return field(a, 'sentiment', 'sentiment') || 'neutral';
}
function getType(a) {
  return field(a, 'articleType', 'article_type') || 'news';
}
function getWordCount(a) {
  return Number(field(a, 'wordCount', 'word_count') || 0);
}
function getDate(a) {
  return field(a, 'publishedDate', 'published_date') || null;
}

// --- Reichweiten-Lookup aus der Quellen-Konfiguration ---
let _reachMap = null;
function reachMap() {
  if (_reachMap) return _reachMap;
  _reachMap = new Map();
  for (const f of sources.feeds || []) {
    if (f.name) _reachMap.set(f.name.toLowerCase(), f.priority || 50);
  }
  return _reachMap;
}

// Ordnet einem Quellennamen eine Prioritaet (0-100) zu. Google-News-Quellen
// tragen den Originalnamen als Prefix ("SZ (via Google News)") — daher auch
// Teilstring-Abgleich. Default 50 (mittlere Reichweite).
function sourcePriority(sourceName) {
  if (!sourceName) return 50;
  const key = String(sourceName).toLowerCase();
  const map = reachMap();
  if (map.has(key)) return map.get(key);
  for (const [name, prio] of map) {
    if (key.includes(name) || name.includes(key)) return prio;
  }
  return 50;
}

// Reichweiten-Gewicht: Prioritaet 50 -> 1.0, 100 -> 1.5, 0 -> 0.5.
function reachWeight(priority) {
  return 0.5 + Math.max(0, Math.min(100, priority)) / 100;
}

// Medienresonanz-Score eines Artikels: kombiniert Relevanz (Themenbezug),
// Reichweite (Quellen-Prioritaet) und Prominenz (Artikeltyp/Laenge).
function articleResonance(article) {
  const relevance = getRelevance(article);
  const priority = sourcePriority(field(article, 'source', 'source'));
  const weight = reachWeight(priority);

  let prominence = 1;
  const type = getType(article);
  if (type === 'review') prominence += 0.4; // Kritiken wiegen schwerer
  else if (type === 'interview') prominence += 0.25;
  else if (type === 'announcement') prominence += 0.1;
  const words = getWordCount(article);
  if (words >= 500) prominence += 0.2;
  else if (words > 0 && words < 100) prominence -= 0.2;

  const base = Math.max(relevance, 1);
  return Math.round(base * weight * Math.max(0.3, prominence));
}

// Aggregierte Resonanz fuer einen Zeitraum.
function aggregateResonance(articles) {
  let total = 0;
  let reviewResonance = 0;
  const bySource = new Map();
  for (const a of articles) {
    const r = articleResonance(a);
    total += r;
    if (getType(a) === 'review') reviewResonance += r;
    const src = field(a, 'source', 'source') || 'Unbekannt';
    bySource.set(src, (bySource.get(src) || 0) + r);
  }
  const topSources = Array.from(bySource.entries())
    .map(([source, resonance]) => ({ source, resonance, priority: sourcePriority(source) }))
    .sort((a, b) => b.resonance - a.resonance)
    .slice(0, 15);

  return {
    totalArticles: articles.length,
    totalResonance: total,
    reviewResonance,
    avgResonance: articles.length ? Math.round(total / articles.length) : 0,
    topSources,
  };
}

// Resonanz und Volumen je Produktion.
function resonanceByProduction(articles) {
  const map = new Map();
  for (const a of articles) {
    const entities = ner.extractEntities(a);
    const r = articleResonance(a);
    const sScore = getSentimentScore(a);
    for (const e of entities) {
      if (e.type !== 'production') continue;
      const cur = map.get(e.value) || {
        production: e.value,
        articles: 0,
        resonance: 0,
        mentions: 0,
        sentimentSum: 0,
        reviews: 0,
      };
      cur.articles += 1;
      cur.resonance += r;
      cur.mentions += e.mentions;
      cur.sentimentSum += sScore;
      if (getType(a) === 'review') cur.reviews += 1;
      map.set(e.value, cur);
    }
  }
  return Array.from(map.values())
    .map((p) => ({
      ...p,
      avgSentiment: p.articles ? Math.round((p.sentimentSum / p.articles) * 100) / 100 : 0,
    }))
    .sort((a, b) => b.resonance - a.resonance);
}

// Share of Voice: prozentualer Anteil je Entitaet an der Gesamt-Resonanz.
// dimension: 'production' | 'person' | 'source'
function shareOfVoice(articles, dimension = 'production') {
  const map = new Map();
  let total = 0;
  for (const a of articles) {
    const r = articleResonance(a);
    if (dimension === 'source') {
      const src = field(a, 'source', 'source') || 'Unbekannt';
      map.set(src, (map.get(src) || 0) + r);
      total += r;
      continue;
    }
    const entities = ner.extractEntities(a).filter((e) => e.type === dimension);
    for (const e of entities) {
      map.set(e.value, (map.get(e.value) || 0) + r);
      total += r;
    }
  }
  if (total === 0) return [];
  return Array.from(map.entries())
    .map(([name, resonance]) => ({
      name,
      resonance,
      share: Math.round((resonance / total) * 1000) / 10, // eine Nachkommastelle
    }))
    .sort((a, b) => b.resonance - a.resonance);
}

// Sentiment-Zeitverlauf: pro Tag Durchschnitt und Verteilung.
function sentimentTimeline(articles) {
  const days = new Map();
  for (const a of articles) {
    const d = getDate(a);
    if (!d) continue;
    const key = new Date(d).toISOString().slice(0, 10);
    const cur = days.get(key) || { date: key, count: 0, scoreSum: 0, positiv: 0, negativ: 0, neutral: 0 };
    cur.count += 1;
    cur.scoreSum += getSentimentScore(a);
    const label = getSentiment(a);
    if (label === 'positiv') cur.positiv += 1;
    else if (label === 'negativ') cur.negativ += 1;
    else cur.neutral += 1;
    days.set(key, cur);
  }
  return Array.from(days.values())
    .map((d) => ({
      date: d.date,
      count: d.count,
      avgScore: d.count ? Math.round((d.scoreSum / d.count) * 100) / 100 : 0,
      positiv: d.positiv,
      negativ: d.negativ,
      neutral: d.neutral,
    }))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
}

// Kritiker-Konsens je Produktion: nur Rezensionen aggregieren.
function criticConsensus(articles) {
  const map = new Map();
  for (const a of articles) {
    if (getType(a) !== 'review') continue;
    const entities = ner.extractEntities(a).filter((e) => e.type === 'production');
    const sScore = getSentimentScore(a);
    const label = getSentiment(a);
    for (const e of entities) {
      const cur = map.get(e.value) || {
        production: e.value,
        reviews: 0,
        scoreSum: 0,
        positiv: 0,
        negativ: 0,
        neutral: 0,
      };
      cur.reviews += 1;
      cur.scoreSum += sScore;
      if (label === 'positiv') cur.positiv += 1;
      else if (label === 'negativ') cur.negativ += 1;
      else cur.neutral += 1;
      map.set(e.value, cur);
    }
  }
  return Array.from(map.values())
    .map((p) => {
      const avg = p.reviews ? p.scoreSum / p.reviews : 0;
      let consensus = 'gemischt';
      if (p.positiv > p.negativ * 2 && p.positiv >= p.reviews / 2) consensus = 'ueberwiegend_positiv';
      else if (p.negativ > p.positiv * 2 && p.negativ >= p.reviews / 2) consensus = 'ueberwiegend_negativ';
      else if (p.neutral >= p.reviews) consensus = 'neutral';
      return {
        production: p.production,
        reviews: p.reviews,
        avgScore: Math.round(avg * 100) / 100,
        distribution: { positiv: p.positiv, negativ: p.negativ, neutral: p.neutral },
        consensus,
      };
    })
    .sort((a, b) => b.reviews - a.reviews);
}

module.exports = {
  articleResonance,
  aggregateResonance,
  resonanceByProduction,
  shareOfVoice,
  sentimentTimeline,
  criticConsensus,
  sourcePriority,
  reachWeight,
};
