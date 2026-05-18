'use strict';

const { keywords, sentiment, settings } = require('./config');

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function preparedKeywords() {
  return {
    required: keywords.required.map(normalize),
    productions: keywords.productions.map(normalize),
    people: keywords.people.map(normalize),
    venues: (keywords.venues || []).map(normalize),
    exclude: keywords.exclude.map(normalize)
  };
}

const KW = preparedKeywords();

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function hasAnyKeyword(text, list) {
  const t = normalize(text);
  return list.some(k => t.includes(k));
}

function passesRequiredFilter(article) {
  const haystack = normalize(`${article.title || ''} ${article.fullText || ''}`);
  const hasRequired = KW.required.some(k => haystack.includes(k));
  if (!hasRequired) return { passes: false, reason: 'no-required-keyword' };
  const excludeHit = KW.exclude.find(k => haystack.includes(k));
  if (excludeHit) return { passes: false, reason: `exclude:${excludeHit}` };
  return { passes: true };
}

function detectArticleType(article) {
  const text = normalize(`${article.title || ''} ${article.fullText || ''}`);
  const indicators = (list) => list.filter(w => text.includes(normalize(w))).length;
  const review = indicators(sentiment.review_indicators || []);
  const interview = indicators(sentiment.interview_indicators || []);
  const announcement = indicators(sentiment.announcement_indicators || []);

  const max = Math.max(review, interview, announcement);
  if (max === 0) return 'news';
  if (max === review) return 'review';
  if (max === interview) return 'interview';
  return 'announcement';
}

function isReview(article) {
  return detectArticleType(article) === 'review';
}

function calculateRelevance(article, sourcePriority = 50) {
  const w = keywords.scoring_weights;
  const title = normalize(article.title || '');
  const text = normalize(article.fullText || '');
  let score = 0;
  const reasons = [];

  let titleMatched = false;
  for (const req of KW.required) {
    if (title.includes(req)) {
      score += w.title_exact_match || 80;
      reasons.push(`Titel: "${req}"`);
      titleMatched = true;
      break;
    }
  }
  if (!titleMatched) {
    for (const req of KW.required) {
      if (text.includes(req)) {
        const count = countOccurrences(text, req);
        score += (w.required_keyword || 10) * Math.min(count, 5);
        reasons.push(`${count}x "${req}"`);
      }
    }
  }

  for (const p of KW.productions) {
    if (text.includes(p) || title.includes(p)) {
      score += w.production_match || 15;
      reasons.push(`Produktion: ${p}`);
    }
  }

  for (const person of KW.people) {
    if (text.includes(person) || title.includes(person)) {
      score += w.people_match || 20;
      reasons.push(`Person: ${person}`);
    }
  }

  for (const venue of KW.venues) {
    if (text.includes(venue)) {
      score += w.venue_match || 10;
    }
  }

  const type = detectArticleType(article);
  if (type === 'review') {
    score += w.review || 30;
    reasons.push('Typ: Kritik');
  } else if (type === 'interview') {
    score += w.interview || 25;
    reasons.push('Typ: Interview');
  } else if (type === 'announcement') {
    score += w.announcement || 20;
    reasons.push('Typ: Ankuendigung');
  }

  const wordCount = article.wordCount || (article.fullText || '').split(/\s+/).length;
  const minWords = keywords.thresholds.min_word_count || 50;
  const shortThreshold = keywords.thresholds.short_article_word_count || 100;
  if (wordCount < minWords) {
    score += w.very_short_article_penalty || -50;
    reasons.push('sehr kurz');
  } else if (wordCount < shortThreshold) {
    score += w.short_article_penalty || -20;
    reasons.push('kurz');
  }

  if (sourcePriority >= 90) score += 15;
  else if (sourcePriority >= 70) score += 8;

  const category = categorize(score);
  return { score: Math.max(0, score), reasons, category, articleType: type };
}

function categorize(score) {
  const t = keywords.thresholds;
  if (score >= (t.very_relevant || 80)) return 'sehr_relevant';
  if (score >= (t.relevant || 50)) return 'relevant';
  if (score >= (t.maybe_relevant || 30)) return 'moeglich_relevant';
  return 'irrelevant';
}

function matchesAnyStem(token, stems) {
  if (stems.has(token)) return true;
  for (const stem of stems) {
    if (token.length >= stem.length && token.length <= stem.length + 4 &&
        token.startsWith(stem)) {
      return true;
    }
  }
  return false;
}

function analyzeSentiment(text) {
  if (!text) return { label: 'neutral', score: 0, positiveHits: [], negativeHits: [] };
  const normalized = normalize(text);
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const positiveSet = new Set(sentiment.positive.map(normalize));
  const negativeSet = new Set(sentiment.negative.map(normalize));
  const negations = new Set(sentiment.negations.map(normalize));
  const intensifiers = new Set(sentiment.intensifiers.map(normalize));

  let score = 0;
  const positiveHits = [];
  const negativeHits = [];

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    let weight = 1;
    let polarity = 0;
    if (matchesAnyStem(tok, positiveSet)) polarity = 1;
    else if (matchesAnyStem(tok, negativeSet)) polarity = -1;
    if (polarity === 0) continue;

    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (negations.has(tokens[j])) polarity = -polarity;
      if (intensifiers.has(tokens[j])) weight = 2;
    }

    score += polarity * weight;
    if (polarity > 0) positiveHits.push(tok);
    else negativeHits.push(tok);
  }

  const t = sentiment.thresholds || { positive: 2, negative: -2 };
  let label = 'neutral';
  if (score >= (t.positive || 2)) label = 'positiv';
  else if (score <= (t.negative || -2)) label = 'negativ';

  return { label, score, positiveHits, negativeHits };
}

function generateSummary(article, maxLength) {
  const limit = maxLength || (settings.reports && settings.reports.max_summary_length) || 280;
  const text = (article.fullText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit + 100);
  const sentences = truncated.split(/(?<=[.!?])\s+/);
  let summary = '';
  for (const s of sentences) {
    if ((summary + ' ' + s).trim().length > limit) break;
    summary = (summary + ' ' + s).trim();
  }
  if (!summary) summary = text.slice(0, limit) + '…';
  return summary;
}

function analyze(article, sourcePriority = 50) {
  const filter = passesRequiredFilter(article);
  const relevance = calculateRelevance(article, sourcePriority);
  const sentimentResult = analyzeSentiment(`${article.title} ${article.fullText || ''}`);
  const summary = generateSummary(article);
  return {
    passes: filter.passes,
    rejectReason: filter.reason,
    relevanceScore: relevance.score,
    relevanceReasons: relevance.reasons,
    category: relevance.category,
    articleType: relevance.articleType,
    sentiment: sentimentResult.label,
    sentimentScore: sentimentResult.score,
    sentimentHits: {
      positive: sentimentResult.positiveHits,
      negative: sentimentResult.negativeHits
    },
    summary
  };
}

module.exports = {
  analyze,
  analyzeSentiment,
  calculateRelevance,
  passesRequiredFilter,
  detectArticleType,
  isReview,
  generateSummary,
  categorize,
  normalize
};
