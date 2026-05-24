'use strict';

const { keywords, settings } = require('../config');
const { normalize } = require('../analyzer');

// Advanced Scoring Engine with Multiple Dimensions and Profiles
class ScoringEngine {
  constructor(weights = {}) {
    this.weights = {
      ...this.defaultWeights(),
      ...weights,
    };
  }

  defaultWeights() {
    return {
      titleExactMatch: 100,
      titlePartialMatch: 60,
      contentMention: 20,
      contextualMention: 35,
      productionTitle: 80,
      productionContent: 40,
      personTitle: 60,
      personContent: 25,
      venueMatch: 15,
      theaterContext: 12,
      multipleProductions: 50,
      multiplePeople: 30,
      reviewType: 40,
      interviewType: 35,
      announcementType: 25,
      premiereBonus: 30,
      contentLength: { veryShort: -40, short: -15, medium: 8, long: 15, veryLong: 25 },
      sourceAuthority: { premium: 25, established: 15, reliable: 8, unknown: 0 },
      articleDepth: { veryDeep: 20, deep: 10, moderate: 5, shallow: 0 },
      recencyBonus: { fresh: 15, recent: 10, moderate: 5, old: 0 },
      paywallPenalty: -10,
      duplicateContent: -20,
      authorCredibility: { highlyCredible: 20, credible: 10, moderate: 5, unknown: 0 },
      competitiveContent: 15,
    };
  }

  // Calculate recency bonus based on publication date
  calculateRecencyBonus(publishedDate) {
    if (!publishedDate) return 0;
    const now = Date.now();
    const then = new Date(publishedDate).getTime();
    const daysOld = (now - then) / (1000 * 60 * 60 * 24);

    if (daysOld < 1) return this.weights.recencyBonus.fresh;
    if (daysOld < 7) return this.weights.recencyBonus.recent;
    if (daysOld < 30) return this.weights.recencyBonus.moderate;
    return this.weights.recencyBonus.old;
  }

  // Evaluate source authority based on known reliable sources
  evaluateSourceAuthority(sourceUrl, sourceName) {
    if (!sourceUrl && !sourceName) return 0;

    const premiumSources = ['sueddeutsche', 'faz', 'taz', 'zeit', 'neues', 'deutschland', 'br', 'ard', 'zdf'];
    const established = ['merkur', 'muenchner', 'abendzeitung', 'bayerischer', 'rundfunk'];

    const urlLower = (sourceUrl || '').toLowerCase();
    const nameLower = (sourceName || '').toLowerCase();
    const combined = `${urlLower} ${nameLower}`;

    if (premiumSources.some((s) => combined.includes(s))) return this.weights.sourceAuthority.premium;
    if (established.some((s) => combined.includes(s))) return this.weights.sourceAuthority.established;
    if (combined.length > 0) return this.weights.sourceAuthority.reliable;
    return this.weights.sourceAuthority.unknown;
  }

  // Assess author credibility based on patterns
  assessAuthorCredibility(author, article) {
    if (!author || author.length < 2) return 0;

    let score = 0;
    const authorLower = normalize(author);

    // Author mentions byline consistently
    if (article.author && article.author === author) score += 3;

    // Known theater critics/journalists
    const knownCritics = ['rezensentin', 'kritiker', 'korrespondent', 'redakteur', 'redakteurin'];
    if (knownCritics.some((k) => authorLower.includes(k))) {
      return this.weights.authorCredibility.credible;
    }

    // Has published multiple articles
    if (article.authorArticleCount && article.authorArticleCount > 5) {
      return this.weights.authorCredibility.credible;
    }

    return this.weights.authorCredibility.unknown;
  }

  // Detect competitive content (mentions rival theaters/productions)
  detectCompetitiveContent(text, primarySubject = 'Kammerspiele') {
    if (!text) return 0;

    const competitors = ['residenztheater', 'staatstheater', 'marstall', 'blutenburg', 'schauburg'];
    const normalized = normalize(text);

    const hasCompetitor = competitors.some((c) => normalized.includes(c));
    const hasPrimary = normalized.includes(normalize(primarySubject));

    if (hasCompetitor && hasPrimary) {
      return this.weights.competitiveContent;
    }
    return 0;
  }

  // Detect if article is likely duplicate based on similarity metrics
  isDuplicateContent(text1, text2, threshold = 0.85) {
    if (!text1 || !text2) return false;

    const n1 = normalize(text1);
    const n2 = normalize(text2);

    if (n1 === n2) return true;

    // Simple character-level similarity
    const common = [...new Set(n1)].filter((c) => n2.includes(c)).length;
    const total = new Set([...n1, ...n2]).size;
    const similarity = common / total;

    return similarity >= threshold;
  }

  // Calculate structural richness bonus
  calculateStructuralBonus(article) {
    let bonus = 0;

    // Has direct quotes (indicates reporting depth)
    if ((article.fullText || '').match(/["„"«»]/g)) {
      bonus += 5;
    }

    // Has links (indicates research/reference depth)
    if ((article.fullText || '').match(/https?:\/\/|www\./g)) {
      bonus += 3;
    }

    // Multiple paragraphs (structured content)
    const paragraphs = (article.fullText || '').split(/\n\n+/).filter(Boolean).length;
    if (paragraphs >= 5) bonus += 5;
    else if (paragraphs >= 3) bonus += 2;

    // Has lists or structured data
    if ((article.fullText || '').match(/^[-•*]\s+/gm)) {
      bonus += 3;
    }

    return Math.min(bonus, 15);
  }

  // Calculate semantic diversity (variety of topics covered)
  calculateSemanticDiversity(article) {
    const text = normalize(
      `${article.title || ''} ${article.fullText || ''} ${article.summary || ''}`
    );

    const topicAreas = {
      artistic: ['bühne', 'inszenierung', 'regie', 'ensemble', 'aufführung'],
      critical: ['kritik', 'rezension', 'bewertung', 'urteil', 'kritisch'],
      production: ['premiere', 'produktion', 'uraufführung', 'neuproduktion'],
      audience: ['publikum', 'zuschauer', 'besucher', 'resonanz'],
      business: ['erfolg', 'einnahmen', 'besucherzahl', 'kasse', 'abonnement'],
    };

    let coveredAreas = 0;
    for (const area of Object.values(topicAreas)) {
      if (area.some((t) => text.includes(t))) {
        coveredAreas++;
      }
    }

    return coveredAreas * 3; // 3 points per topic area
  }

  // Calculate entity co-occurrence bonus
  calculateEntityCooccurrenceBonus(matches) {
    let bonus = 0;

    const { productions = [], people = [], venues = [] } = matches || {};

    // Multiple productions mentioned together
    if (productions.length >= 2) bonus += 15;

    // Multiple people mentioned together
    if (people.length >= 3) bonus += 12;
    else if (people.length >= 2) bonus += 8;

    // People and productions together (strong signal)
    if (productions.length >= 1 && people.length >= 2) bonus += 20;

    // All three entity types mentioned
    if (productions.length > 0 && people.length > 0 && venues.length > 0) bonus += 25;

    return bonus;
  }

  // Calculate engagement signal bonus (if available)
  calculateEngagementBonus(article) {
    let bonus = 0;

    if (article.viewCount) {
      if (article.viewCount > 1000) bonus += 10;
      else if (article.viewCount > 500) bonus += 5;
      else if (article.viewCount > 100) bonus += 2;
    }

    if (article.shareCount) {
      if (article.shareCount > 50) bonus += 8;
      else if (article.shareCount > 20) bonus += 4;
      else if (article.shareCount > 5) bonus += 1;
    }

    if (article.commentCount) {
      if (article.commentCount > 20) bonus += 5;
      else if (article.commentCount > 5) bonus += 2;
    }

    return Math.min(bonus, 15);
  }
}

// Predefined Weight Profiles for Different Use Cases
const WEIGHT_PROFILES = {
  // High-quality journalism focus
  QUALITY_FIRST: {
    titleExactMatch: 120,
    productionTitle: 100,
    reviewType: 50,
    contentLength: { veryShort: -50, short: -25, medium: 15, long: 25, veryLong: 40 },
    articleDepth: { veryDeep: 30, deep: 15, moderate: 5, shallow: -10 },
    sourceAuthority: { premium: 40, established: 25, reliable: 10, unknown: 0 },
    authorCredibility: { highlyCredible: 30, credible: 15, moderate: 5, unknown: 0 },
    paywallPenalty: -5, // Less penalty for quality sources
  },

  // Broad coverage focus
  BROAD_COVERAGE: {
    titleExactMatch: 80,
    productionTitle: 60,
    productionContent: 50,
    personContent: 35,
    multipleProductions: 75,
    multiplePeople: 50,
    contentLength: { veryShort: -20, short: -5, medium: 5, long: 10, veryLong: 15 },
    articleDepth: { veryDeep: 10, deep: 5, moderate: 2, shallow: 0 },
    sourceAuthority: { premium: 15, established: 10, reliable: 5, unknown: 2 },
  },

  // Real-time/breaking news focus
  REAL_TIME: {
    titleExactMatch: 100,
    premiereBonus: 50,
    recencyBonus: { fresh: 30, recent: 20, moderate: 10, old: -10 },
    contentLength: { veryShort: 10, short: 15, medium: 10, long: 5, veryLong: 2 },
    sourceAuthority: { premium: 20, established: 15, reliable: 8, unknown: 3 },
    paywallPenalty: -20,
  },

  // Premiere/event-focused
  EVENT_FOCUSED: {
    titleExactMatch: 100,
    premiereBonus: 60,
    productionTitle: 100,
    personTitle: 80,
    interviewType: 50,
    announcementType: 40,
    contentLength: { veryShort: 5, short: 15, medium: 20, long: 25, veryLong: 30 },
    recencyBonus: { fresh: 20, recent: 15, moderate: 8, old: 0 },
  },

  // Archive/historical focus
  ARCHIVE: {
    titleExactMatch: 100,
    reviewType: 60,
    contentLength: { veryShort: -30, short: -10, medium: 10, long: 25, veryLong: 40 },
    articleDepth: { veryDeep: 35, deep: 20, moderate: 8, shallow: 0 },
    sourceAuthority: { premium: 30, established: 20, reliable: 10, unknown: 2 },
    recencyBonus: { fresh: 0, recent: 0, moderate: 0, old: 0 }, // Age irrelevant
  },
};

function createScoringEngine(profileName = 'BROAD_COVERAGE') {
  const profile = WEIGHT_PROFILES[profileName] || WEIGHT_PROFILES.BROAD_COVERAGE;
  return new ScoringEngine(profile);
}

module.exports = {
  ScoringEngine,
  WEIGHT_PROFILES,
  createScoringEngine,
};
