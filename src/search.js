'use strict';

const Fuse = require('fuse.js');
const natural = require('natural');
const leven = require('js-levenshtein');
const { keywords, loadJson } = require('./config');
const { normalize } = require('./analyzer');
const { parseQuery, queryToBM25String, articleMatchesStructured } = require('./query-parser');

const GERMAN_STOPWORDS = new Set([
  'der', 'die', 'das', 'ein', 'eine', 'einen', 'einer', 'eines', 'einem',
  'und', 'oder', 'aber', 'denn', 'doch', 'sondern', 'weil', 'wenn', 'dass',
  'ist', 'sind', 'war', 'waren', 'wird', 'werden', 'wurde', 'wurden',
  'sein', 'seine', 'seiner', 'seinem', 'seinen', 'ihrer', 'ihrem', 'ihren',
  'auf', 'an', 'in', 'im', 'aus', 'bei', 'mit', 'nach', 'von', 'vom',
  'zu', 'zur', 'zum', 'fuer', 'fur', 'durch', 'ueber', 'unter', 'vor',
  'gegen', 'ohne', 'als', 'wie', 'auch', 'noch', 'nur', 'schon', 'sehr',
  'mehr', 'kann', 'koennte', 'soll', 'sollte', 'will', 'wollte', 'muss',
  'man', 'er', 'sie', 'es', 'wir', 'ihr', 'ich', 'du', 'mich', 'mir', 'dir',
  'sich', 'dem', 'den', 'des', 'so', 'nicht', 'nichts', 'kein', 'keine',
  'da', 'dort', 'hier', 'jetzt', 'dann', 'noch', 'mal', 'am'
]);

const tokenizer = new natural.AggressiveTokenizerDe();
const stemmer = natural.PorterStemmerDe;

let SYNONYMS_MAP = new Map();
try {
  const syn = loadJson('synonyms.json');
  for (const group of syn.groups || []) {
    const normalized = group.map(g => stemmer.stem(normalize(g)));
    for (const t of normalized) SYNONYMS_MAP.set(t, normalized);
  }
} catch { /* synonyms optional */ }

function expandWithSynonyms(stems) {
  const expanded = new Set();
  for (const s of stems) {
    expanded.add(s);
    if (SYNONYMS_MAP.has(s)) {
      for (const syn of SYNONYMS_MAP.get(s)) expanded.add(syn);
    }
  }
  return [...expanded];
}

function tokenizeAndStem(text, { withSynonyms = false } = {}) {
  if (!text) return [];
  const normalized = normalize(text);
  const tokens = tokenizer.tokenize(normalized) || [];
  const stems = tokens
    .filter(t => t.length >= 3 && !GERMAN_STOPWORDS.has(t))
    .map(t => stemmer.stem(t));
  return withSynonyms ? expandWithSynonyms(stems) : stems;
}

class BM25Index {
  constructor(articles, { k1 = 1.5, b = 0.75, titleBoost = 3, recencyHalfLife = 30 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.titleBoost = titleBoost;
    this.recencyHalfLife = recencyHalfLife;
    this.docs = [];
    this.df = new Map();
    this.avgdl = 0;

    const now = Date.now();
    let totalLen = 0;
    for (const article of articles) {
      const titleTokens = tokenizeAndStem(article.title);
      const summaryTokens = tokenizeAndStem(article.summary || '');
      const bodyTokens = tokenizeAndStem(article.full_text || article.fullText || '');
      const allTokens = [
        ...Array(this.titleBoost).fill(titleTokens).flat(),
        ...summaryTokens,
        ...bodyTokens
      ];
      const tf = new Map();
      for (const t of allTokens) tf.set(t, (tf.get(t) || 0) + 1);
      const seen = new Set(allTokens);
      for (const t of seen) this.df.set(t, (this.df.get(t) || 0) + 1);

      let recency = 1;
      if (article.published_date) {
        const ageDays = (now - new Date(article.published_date).getTime()) / 86400000;
        recency = Math.pow(0.5, Math.max(0, ageDays) / this.recencyHalfLife);
      }

      this.docs.push({
        article,
        tf,
        len: allTokens.length,
        recency,
        sourcePriority: article.source_priority || 50
      });
      totalLen += allTokens.length;
    }
    this.avgdl = this.docs.length ? totalLen / this.docs.length : 0;
    this.N = this.docs.length;
  }

  idf(term) {
    const n = this.df.get(term) || 0;
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }

  score(queryStems, doc, { applyRecency = true } = {}) {
    let score = 0;
    for (const term of queryStems) {
      const tf = doc.tf.get(term) || 0;
      if (tf === 0) continue;
      const idf = this.idf(term);
      const norm = 1 - this.b + this.b * (doc.len / (this.avgdl || 1));
      score += idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm));
    }
    if (applyRecency) score *= (0.5 + doc.recency);
    return score;
  }

  search(query, { limit = 50, withSynonyms = true, applyRecency = true } = {}) {
    if (!query || !query.trim()) return [];
    const stems = tokenizeAndStem(query, { withSynonyms });
    if (stems.length === 0) return [];
    const scored = this.docs.map(doc => ({
      article: doc.article,
      score: this.score(stems, doc, { applyRecency })
    })).filter(r => r.score > 0);
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }
}

function buildFuse(articles) {
  return new Fuse(articles, {
    keys: [
      { name: 'title', weight: 0.5 },
      { name: 'summary', weight: 0.3 },
      { name: 'source', weight: 0.1 },
      { name: 'author', weight: 0.05 },
      { name: 'full_text', weight: 0.05 }
    ],
    threshold: 0.45,
    distance: 200,
    ignoreLocation: true,
    minMatchCharLength: 3,
    includeScore: true,
    useExtendedSearch: true,
    findAllMatches: false
  });
}

function hybridSearch(articles, query, { limit = 50, withSynonyms = true, applyRecency = true } = {}) {
  if (!query || !query.trim()) {
    return articles.slice(0, limit).map(a => ({ article: a, score: 0 }));
  }

  const parsed = parseQuery(query);
  let filteredArticles = articles;
  if (parsed && parsed.isStructured) {
    filteredArticles = articles.filter(a => articleMatchesStructured(a, parsed));
    if (filteredArticles.length === 0) {
      return [];
    }
  }

  const bm25Query = parsed ? queryToBM25String(parsed) || query : query;
  const bm25 = new BM25Index(filteredArticles);
  const bm25Results = bm25.search(bm25Query, { limit: limit * 2, withSynonyms, applyRecency });
  const bm25Map = new Map(bm25Results.map(r => [r.article.id, r.score]));

  const fuse = buildFuse(filteredArticles);
  const fuseResults = fuse.search(bm25Query, { limit: limit * 2 });
  const fuseMap = new Map(fuseResults.map(r => [r.item.id, 1 - (r.score || 0)]));

  const allIds = new Set([...bm25Map.keys(), ...fuseMap.keys()]);
  const maxBm25 = Math.max(...bm25Results.map(r => r.score), 1);

  const combined = [];
  for (const id of allIds) {
    const article = filteredArticles.find(a => a.id === id);
    if (!article) continue;
    const bm25Norm = (bm25Map.get(id) || 0) / maxBm25;
    const fuseNorm = fuseMap.get(id) || 0;
    let score = bm25Norm * 0.65 + fuseNorm * 0.35;

    if (parsed && parsed.must.some(t => t.type === 'phrase')) {
      const titleLower = (article.title || '').toLowerCase();
      for (const phrase of parsed.must.filter(t => t.type === 'phrase')) {
        if (titleLower.includes(phrase.value.toLowerCase())) score += 0.3;
      }
    }

    if (article.source_priority >= 95) score *= 1.1;
    else if (article.source_priority >= 80) score *= 1.05;

    combined.push({ article, score, bm25: bm25Norm, fuzzy: fuseNorm });
  }
  combined.sort((a, b) => b.score - a.score);
  return combined.slice(0, limit);
}

function highlightTerms(text, query) {
  if (!query || !text) return text;
  const parsed = parseQuery(query);
  const literals = [];
  if (parsed) {
    for (const m of [...parsed.must, ...parsed.should]) {
      if (m.value && m.value.length >= 3) literals.push(m.value);
    }
  } else {
    literals.push(...query.split(/\s+/).filter(t => t.length >= 3));
  }
  const stems = [...new Set(tokenizeAndStem(query))];
  const all = [...new Set([...literals, ...stems])];
  if (!all.length) return text;
  const escaped = all.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

function suggestQueries(prefix, articles) {
  if (!prefix || prefix.length < 2) return [];
  const lower = normalize(prefix);
  const candidates = new Map();

  function add(term, weight = 1) {
    if (!term) return;
    candidates.set(term, (candidates.get(term) || 0) + weight);
  }

  for (const a of articles) {
    if (a.source && normalize(a.source).startsWith(lower)) add(a.source, 5);
    const words = normalize(a.title || '').split(/\s+/);
    for (const w of words) {
      if (w.length >= 3 && w.startsWith(lower)) add(w, 2);
    }
  }
  for (const kw of [...(keywords.productions || []), ...(keywords.people || []), ...(keywords.venues || [])]) {
    if (kw && normalize(kw).startsWith(lower)) add(kw, 10);
  }

  return [...candidates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([term]) => term);
}

function didYouMean(query, articles, { threshold = 3 } = {}) {
  if (!query || query.length < 4) return null;
  const allTerms = new Set();
  for (const a of articles) {
    for (const w of (normalize(a.title || '').split(/\s+/))) {
      if (w.length >= 4) allTerms.add(w);
    }
  }
  for (const kw of [...(keywords.productions || []), ...(keywords.people || [])]) {
    for (const w of normalize(kw).split(/\s+/)) if (w.length >= 4) allTerms.add(w);
  }
  const queryTerms = normalize(query).split(/\s+/);
  const suggestions = [];
  for (const qt of queryTerms) {
    if (qt.length < 4) { suggestions.push(qt); continue; }
    if (allTerms.has(qt)) { suggestions.push(qt); continue; }
    let best = null, bestDist = Infinity;
    for (const term of allTerms) {
      if (Math.abs(term.length - qt.length) > threshold) continue;
      const d = leven(qt, term);
      if (d > 0 && d <= threshold && d < bestDist) { bestDist = d; best = term; }
    }
    suggestions.push(best || qt);
  }
  const result = suggestions.join(' ');
  return result.toLowerCase() === normalize(query).toLowerCase() ? null : result;
}

function topMentions(articles, { minLen = 4, limit = 30 } = {}) {
  const counts = new Map();
  for (const a of articles) {
    const text = (a.title || '') + ' ' + (a.summary || '');
    const tokens = tokenizeAndStem(text);
    const seen = new Set();
    for (const t of tokens) {
      if (t.length < minLen || seen.has(t)) continue;
      seen.add(t);
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function trends(articlesA, articlesB) {
  const a = topMentions(articlesA, { limit: 100 });
  const b = topMentions(articlesB, { limit: 100 });
  const bMap = new Map(b.map(x => [x.term, x.count]));
  return a.map(({ term, count }) => {
    const prev = bMap.get(term) || 0;
    const diff = count - prev;
    return { term, count, previous: prev, change: diff };
  }).sort((x, y) => y.change - x.change);
}

module.exports = {
  BM25Index,
  buildFuse,
  hybridSearch,
  highlightTerms,
  suggestQueries,
  didYouMean,
  topMentions,
  trends,
  tokenizeAndStem
};
