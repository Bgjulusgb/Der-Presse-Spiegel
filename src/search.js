'use strict';

const Fuse = require('fuse.js');
const natural = require('natural');
const { keywords } = require('./config');
const { normalize } = require('./analyzer');

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

function tokenizeAndStem(text) {
  if (!text) return [];
  const normalized = normalize(text);
  const tokens = tokenizer.tokenize(normalized) || [];
  return tokens
    .filter(t => t.length >= 3 && !GERMAN_STOPWORDS.has(t))
    .map(t => stemmer.stem(t));
}

class BM25Index {
  constructor(articles, { k1 = 1.5, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = [];
    this.df = new Map();
    this.avgdl = 0;

    let totalLen = 0;
    for (const article of articles) {
      const titleTokens = tokenizeAndStem(article.title);
      const bodyTokens = tokenizeAndStem(article.summary || article.full_text || article.fullText || '');
      const tokens = [...titleTokens, ...titleTokens, ...bodyTokens];
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      const seen = new Set(tokens);
      for (const t of seen) this.df.set(t, (this.df.get(t) || 0) + 1);
      this.docs.push({ article, tf, len: tokens.length });
      totalLen += tokens.length;
    }
    this.avgdl = this.docs.length ? totalLen / this.docs.length : 0;
    this.N = this.docs.length;
  }

  idf(term) {
    const n = this.df.get(term) || 0;
    return Math.log(1 + (this.N - n + 0.5) / (n + 0.5));
  }

  score(query, doc) {
    const terms = tokenizeAndStem(query);
    let score = 0;
    for (const term of terms) {
      const tf = doc.tf.get(term) || 0;
      if (tf === 0) continue;
      const idf = this.idf(term);
      const norm = 1 - this.b + this.b * (doc.len / (this.avgdl || 1));
      score += idf * ((tf * (this.k1 + 1)) / (tf + this.k1 * norm));
    }
    return score;
  }

  search(query, limit = 50) {
    if (!query || !query.trim()) return [];
    const scored = this.docs.map(doc => ({
      article: doc.article,
      score: this.score(query, doc)
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

function hybridSearch(articles, query, { limit = 50 } = {}) {
  if (!query || !query.trim()) {
    return articles.slice(0, limit).map(a => ({ article: a, score: 0 }));
  }
  const bm25 = new BM25Index(articles);
  const bm25Results = bm25.search(query, limit * 2);
  const bm25Map = new Map(bm25Results.map(r => [r.article.id, r.score]));

  const fuse = buildFuse(articles);
  const fuseResults = fuse.search(query, { limit: limit * 2 });
  const fuseMap = new Map(fuseResults.map(r => [r.item.id, 1 - (r.score || 0)]));

  const allIds = new Set([...bm25Map.keys(), ...fuseMap.keys()]);
  const maxBm25 = Math.max(...bm25Results.map(r => r.score), 1);

  const combined = [];
  for (const id of allIds) {
    const article = articles.find(a => a.id === id);
    if (!article) continue;
    const bm25Norm = (bm25Map.get(id) || 0) / maxBm25;
    const fuseNorm = fuseMap.get(id) || 0;
    const score = bm25Norm * 0.65 + fuseNorm * 0.35;
    combined.push({ article, score, bm25: bm25Norm, fuzzy: fuseNorm });
  }
  combined.sort((a, b) => b.score - a.score);
  return combined.slice(0, limit);
}

function highlightTerms(text, query) {
  if (!query || !text) return text;
  const terms = tokenizeAndStem(query);
  if (!terms.length) return text;
  const escaped = terms
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .filter(Boolean);
  if (!escaped.length) return text;
  const re = new RegExp(`(${escaped.join('|')})`, 'gi');
  return text.replace(re, '<mark>$1</mark>');
}

function suggestQueries(prefix, articles) {
  if (!prefix || prefix.length < 2) return [];
  const lower = normalize(prefix);
  const candidates = new Set();
  for (const a of articles) {
    if (a.source && normalize(a.source).startsWith(lower)) candidates.add(a.source);
    const words = normalize(a.title || '').split(/\s+/);
    for (const w of words) {
      if (w.length >= 3 && w.startsWith(lower)) candidates.add(w);
    }
  }
  for (const kw of [...keywords.productions, ...keywords.people, ...(keywords.venues || [])]) {
    if (kw && normalize(kw).startsWith(lower)) candidates.add(kw);
  }
  return [...candidates].slice(0, 10);
}

module.exports = {
  BM25Index,
  buildFuse,
  hybridSearch,
  highlightTerms,
  suggestQueries,
  tokenizeAndStem
};
