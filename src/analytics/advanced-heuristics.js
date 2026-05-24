'use strict';

// Advanced Mathematical Heuristics for Article Ranking and Analysis
// Implements Bayesian inference, TF-IDF scoring, temporal decay, ensemble methods

const { normalize } = require('../analyzer');

// ============================================================================
// 1. BAYESIAN RANKING WITH PRIOR BELIEF
// ============================================================================
// Prior: what % of articles about theater are positive? negative? neutral?
const THEATER_SENTIMENT_PRIORS = {
  positiv: 0.5, // 50% of theater reviews are positive
  neutral: 0.35, // 35% neutral
  negativ: 0.15, // 15% negative (critics are harsh)
};

// Likelihood: given observed keywords, how likely is each sentiment?
const SENTIMENT_LIKELIHOOD = {
  positiv: {
    keywords: ['brilliant', 'beeindruckend', 'meisterschaft', 'großartig', 'faszinierend'],
    baseWeight: 0.85,
  },
  negativ: {
    keywords: ['schwach', 'langweilig', 'schlecht', 'unglücklich', 'katastrophal'],
    baseWeight: 0.9,
  },
  neutral: {
    keywords: ['zeigt', 'präsentiert', 'ankündigt', 'berichtet'],
    baseWeight: 0.7,
  },
};

// Bayes' theorem for sentiment: P(sentiment|evidence) = P(evidence|sentiment) * P(sentiment) / P(evidence)
function bayesianSentimentScore(article) {
  const text = normalize(article.fullText || article.title || '');
  const scores = {};

  for (const [sentiment, config] of Object.entries(SENTIMENT_LIKELIHOOD)) {
    const prior = THEATER_SENTIMENT_PRIORS[sentiment] || 0.33;
    const matchCount = config.keywords.filter((k) => text.includes(normalize(k))).length;
    const likelihood = Math.min(matchCount * config.baseWeight, 1.0);
    const posterior = likelihood * prior;
    scores[sentiment] = posterior;
  }

  // Normalize to probabilities
  const total = Object.values(scores).reduce((a, b) => a + b, 0.001);
  const normalized = {};
  for (const [k, v] of Object.entries(scores)) normalized[k] = v / total;

  return normalized;
}

// ============================================================================
// 2. TF-IDF STYLE KEYWORD IMPORTANCE
// ============================================================================
// TF (term frequency) × IDF (inverse document frequency) for keyword relevance
// In our context: how important is this keyword across the whole corpus?

function calculateTFIDF(article, documentFrequencies = {}) {
  const text = normalize(article.fullText || '');
  const tokens = text.split(/\s+/).filter(Boolean);

  const termFreq = {};
  for (const token of tokens) {
    termFreq[token] = (termFreq[token] || 0) + 1;
  }

  const docLength = tokens.length;
  const tfidf = {};

  for (const [term, tf] of Object.entries(termFreq)) {
    const docFreq = documentFrequencies[term] || 1;
    const idf = Math.log((100 + 1) / (docFreq + 1)); // log scale, +1 smoothing
    tfidf[term] = (tf / Math.max(docLength, 1)) * idf;
  }

  return { tfidf, termFreq };
}

// ============================================================================
// 3. TEMPORAL DECAY FUNCTION
// ============================================================================
// Older articles are less relevant (exponential decay)
// Half-life: articles from 7 days ago have 50% relevance weight

function calculateTemporalRelevance(publishedDate, halfLife = 7 * 24 * 60 * 60 * 1000) {
  if (!publishedDate) return 1.0;

  const now = new Date();
  const ageMs = now.getTime() - new Date(publishedDate).getTime();
  if (ageMs < 0) return 1.0; // Future-dated articles get full weight

  // Exponential decay: decay = 2^(-age / halfLife)
  const decay = Math.pow(2, -(ageMs / halfLife));
  return decay;
}

// ============================================================================
// 4. SOURCE TRUST SCORE (Reputation based on history)
// ============================================================================
// Build source reputation from historical accuracy/relevance

function calculateSourceTrust(sourceName, sourceHistory = {}) {
  if (!sourceHistory[sourceName]) return 0.5; // Default neutral

  const hist = sourceHistory[sourceName];
  const relevantRatio = hist.relevant / Math.max(hist.total, 1);
  const avgQuality = (hist.avgScore || 50) / 100; // normalize 0-1

  // Trust = weighted combination of accuracy and quality
  const trust = relevantRatio * 0.6 + avgQuality * 0.4;
  return Math.max(0, Math.min(1, trust));
}

// ============================================================================
// 5. SEMANTIC SIMILARITY (Cosine Similarity for relatedness)
// ============================================================================
// How similar is this article to the "core mission" (Kammerspiele coverage)?

function vectorizeText(text, knownKeywords) {
  const normalized = normalize(text);
  const vector = {};

  for (const keyword of knownKeywords) {
    const count = (normalized.match(new RegExp(normalize(keyword), 'g')) || []).length;
    vector[keyword] = count;
  }

  return vector;
}

function cosineSimilarity(vec1, vec2) {
  const allKeys = new Set([...Object.keys(vec1), ...Object.keys(vec2)]);
  let dotProduct = 0;
  let mag1 = 0;
  let mag2 = 0;

  for (const key of allKeys) {
    const v1 = vec1[key] || 0;
    const v2 = vec2[key] || 0;
    dotProduct += v1 * v2;
    mag1 += v1 * v1;
    mag2 += v2 * v2;
  }

  const denominator = Math.sqrt(mag1) * Math.sqrt(mag2);
  return denominator > 0 ? dotProduct / denominator : 0;
}

// ============================================================================
// 6. ENSEMBLE SCORING (Combine multiple models)
// ============================================================================
// Use multiple scoring methods and average them with weights

function ensembleScore(article, models = {}) {
  const scores = {};

  // Model 1: Bayesian sentiment
  if (models.bayesian !== false) {
    const bayesian = bayesianSentimentScore(article);
    scores.bayesian = (bayesian.positiv || 0) * 100; // 0-100
  }

  // Model 2: TFIDF importance
  if (models.tfidf !== false) {
    const { tfidf } = calculateTFIDF(article);
    const avgTFIDF = Object.values(tfidf).reduce((a, b) => a + b, 0) / Object.keys(tfidf).length;
    scores.tfidf = avgTFIDF * 100;
  }

  // Model 3: Temporal relevance
  if (models.temporal !== false) {
    scores.temporal = calculateTemporalRelevance(article.publishedDate) * 100;
  }

  // Model 4: Source trust (requires history)
  if (models.sourceTrust && article.source) {
    scores.sourceTrust = calculateSourceTrust(article.source, models.sourceHistory || {}) * 100;
  }

  // Average ensemble
  const weights = models.weights || {};
  let total = 0;
  let totalWeight = 0;

  for (const [model, score] of Object.entries(scores)) {
    const weight = weights[model] || 1;
    total += score * weight;
    totalWeight += weight;
  }

  return {
    ensembleScore: totalWeight > 0 ? total / totalWeight : 0,
    components: scores,
    breakdown: scores,
  };
}

// ============================================================================
// 7. INFORMATION ENTROPY (Richness/Diversity of content)
// ============================================================================
// How diverse is the vocabulary? (High entropy = more unique info)

function calculateEntropy(text) {
  if (!text) return 0;

  const tokens = normalize(text).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;

  const freq = {};
  for (const token of tokens) {
    freq[token] = (freq[token] || 0) + 1;
  }

  let entropy = 0;
  for (const count of Object.values(freq)) {
    const p = count / tokens.length;
    entropy -= p * Math.log2(p);
  }

  return entropy;
}

// ============================================================================
// 8. BURSTINESS DETECTION (Trending/Important topics)
// ============================================================================
// Articles about trending topics get a boost

function calculateBurstiness(article, recentTopics = {}) {
  const text = normalize(article.fullText || article.title || '');
  const tokens = text.split(/\s+/).filter((t) => t.length > 4);

  let burstScore = 0;
  for (const token of tokens) {
    if (recentTopics[token]) {
      burstScore += recentTopics[token].frequency;
    }
  }

  return Math.min(burstScore / Math.max(tokens.length, 1), 2.0); // Capped at 2x
}

// ============================================================================
// 9. COMPREHENSIVE ARTICLE QUALITY SCORE
// ============================================================================
// Combines all heuristics into a final quality metric (0-100)

function calculateComprehensiveQuality(article, context = {}) {
  const components = {
    depth: 0,
    breadth: 0,
    credibility: 0,
    timeliness: 0,
    relevance: 0,
  };

  // Depth: structural quality + word count
  const wordCount = (article.fullText || '').split(/\s+/).length;
  const paragraphs = (article.fullText || '').split(/\n\n+/).length;
  components.depth = Math.min((wordCount / 1000 + paragraphs / 5) * 50, 100);

  // Breadth: semantic entropy (vocabulary diversity)
  components.breadth = calculateEntropy(article.fullText || article.title || '');

  // Credibility: source trust + author credibility
  const sourceTrust = calculateSourceTrust(article.source, context.sourceHistory || {});
  const hasAuthor = (article.author && article.author.length > 0) ? 0.2 : 0;
  components.credibility = (sourceTrust * 0.8 + hasAuthor) * 100;

  // Timeliness: temporal relevance (0-100)
  components.timeliness = calculateTemporalRelevance(article.publishedDate) * 100;

  // Relevance: keyword matches + semantic similarity
  const relevance = context.relevanceScore || 50;
  const burstiness = calculateBurstiness(article, context.recentTopics || {});
  components.relevance = (relevance * 0.7 + burstiness * 30) / 1.0;

  // Weighted average
  const weights = { depth: 0.25, breadth: 0.15, credibility: 0.25, timeliness: 0.2, relevance: 0.15 };
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    total += components[key] * weight;
  }

  return {
    overallQuality: Math.max(0, Math.min(100, total)),
    components,
  };
}

module.exports = {
  bayesianSentimentScore,
  calculateTFIDF,
  calculateTemporalRelevance,
  calculateSourceTrust,
  vectorizeText,
  cosineSimilarity,
  ensembleScore,
  calculateEntropy,
  calculateBurstiness,
  calculateComprehensiveQuality,
};
