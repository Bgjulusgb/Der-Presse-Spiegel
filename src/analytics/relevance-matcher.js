'use strict';

const { keywords } = require('../config');
const { normalize } = require('../analyzer');

// Advanced Relevance Matching System with Multiple Matching Strategies
class RelevanceMatcher {
  constructor() {
    this.keywords = keywords;
    this.cache = new Map();
    this.matchingStrategies = new Set(['exact', 'partial', 'contextual', 'semantic']);
  }

  // Exact substring matching (deterministic, no fuzzy)
  matchExact(haystack, needle) {
    if (!needle || needle.length < 1) return 0;
    const normalized = normalize(haystack);
    const normalizedNeedle = normalize(needle);

    let count = 0;
    let index = 0;
    while ((index = normalized.indexOf(normalizedNeedle, index)) !== -1) {
      count++;
      index += normalizedNeedle.length;
    }
    return count;
  }

  // Partial word matching (word boundaries)
  matchPartial(haystack, needle) {
    if (!needle || needle.length < 2) return 0;
    const normalized = normalize(haystack);
    const words = normalized.split(/\s+/);
    const needleWords = normalize(needle).split(/\s+/);

    if (needleWords.length === 0) return 0;
    if (needleWords.length === 1) {
      return words.filter((w) => w === needleWords[0] || w.startsWith(needleWords[0])).length;
    }

    let matches = 0;
    for (let i = 0; i <= words.length - needleWords.length; i++) {
      const window = words.slice(i, i + needleWords.length);
      const match = needleWords.every((nw, idx) => window[idx] === nw || window[idx].startsWith(nw));
      if (match) matches++;
    }
    return matches;
  }

  // Contextual matching (presence + surrounding context)
  matchContextual(text, keyword, contextWords = [], windowSize = 200) {
    const index = normalize(text).indexOf(normalize(keyword));
    if (index === -1) return 0;

    const start = Math.max(0, index - windowSize);
    const end = Math.min(text.length, index + keyword.length + windowSize);
    const window = normalize(text.slice(start, end));

    let contextMatches = 0;
    for (const contextWord of contextWords) {
      if (window.includes(normalize(contextWord))) {
        contextMatches++;
      }
    }

    return contextMatches > 0 ? 1 : 0;
  }

  // Semantic matching based on term relationships
  matchSemantic(text, keyword, relatedTerms = []) {
    const normalizedText = normalize(text);
    const normalizedKeyword = normalize(keyword);

    if (!normalizedText.includes(normalizedKeyword)) return 0;

    let score = 1; // Base match
    for (const related of relatedTerms) {
      if (normalizedText.includes(normalize(related))) {
        score += 0.5;
      }
    }

    return score;
  }

  // Multi-strategy matching that combines multiple approaches
  matchMultiStrategy(article, keyword, strategies = ['exact', 'contextual']) {
    const text = normalize(
      `${article.title || ''} ${article.fullText || ''} ${article.summary || ''}`
    );
    let totalScore = 0;
    const matchResults = {};

    if (strategies.includes('exact')) {
      const exactMatches = this.matchExact(text, keyword);
      matchResults.exact = exactMatches;
      totalScore += exactMatches * 10;
    }

    if (strategies.includes('partial')) {
      const partialMatches = this.matchPartial(text, keyword);
      matchResults.partial = partialMatches;
      totalScore += partialMatches * 5;
    }

    if (strategies.includes('contextual')) {
      const contextMatches = this.matchContextual(
        text,
        keyword,
        this.keywords.theater_context || []
      );
      matchResults.contextual = contextMatches;
      totalScore += contextMatches * 8;
    }

    if (strategies.includes('semantic')) {
      const semanticMatches = this.matchSemantic(
        text,
        keyword,
        this.keywords.theater_context || []
      );
      matchResults.semantic = semanticMatches;
      totalScore += semanticMatches * 6;
    }

    return { score: totalScore, matches: matchResults, keyword };
  }

  // Comprehensive keyword extraction from text
  extractKeywords(text, minLength = 3, maxKeywords = 20) {
    if (!text) return [];

    const words = normalize(text)
      .split(/\s+/)
      .filter((w) => w.length >= minLength);

    const wordFreq = {};
    words.forEach((word) => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });

    return Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, maxKeywords)
      .map(([word, freq]) => ({ word, frequency: freq }));
  }

  // Find related articles based on keyword overlap
  findRelated(sourceArticle, targetArticles, minOverlap = 2) {
    const sourceKeywords = this.extractKeywords(
      `${sourceArticle.title} ${sourceArticle.fullText}`,
      4,
      10
    );
    const sourceWords = new Set(sourceKeywords.map((k) => k.word));

    return targetArticles
      .map((target) => {
        const targetKeywords = this.extractKeywords(
          `${target.title} ${target.fullText}`,
          4,
          10
        );
        const overlap = targetKeywords.filter((k) => sourceWords.has(k.word));

        return {
          article: target,
          overlapCount: overlap.length,
          overlapKeywords: overlap.map((k) => k.word),
          similarity: overlap.length >= minOverlap ? 'high' : 'low',
        };
      })
      .filter((r) => r.overlapCount >= minOverlap)
      .sort((a, b) => b.overlapCount - a.overlapCount);
  }

  // Calculate relevance score for an article based on query
  calculateQueryRelevance(article, query, weights = {}) {
    const defaultWeights = {
      titleMatch: 3,
      contentMatch: 1,
      frequencyBonus: 0.5,
    };
    const w = { ...defaultWeights, ...weights };

    const title = normalize(article.title || '');
    const content = normalize(article.fullText || '');

    let score = 0;
    const matches = {
      title: [],
      content: [],
    };

    const queryTerms = normalize(query)
      .split(/\s+/)
      .filter((t) => t.length >= 3);

    for (const term of queryTerms) {
      const titleCount = this.matchExact(title, term);
      const contentCount = this.matchExact(content, term);

      if (titleCount > 0) {
        score += titleCount * w.titleMatch;
        matches.title.push(term);
      }
      if (contentCount > 0) {
        score += contentCount * w.contentMatch;
        matches.content.push(term);
      }
    }

    // Frequency bonus: articles with multiple matches get a boost
    const totalMatches = matches.title.length + matches.content.length;
    if (totalMatches > 1) {
      score += (totalMatches - 1) * w.frequencyBonus;
    }

    return {
      score,
      matches,
      matchCount: totalMatches,
      normalized: score / Math.max(queryTerms.length, 1),
    };
  }

  // Entity-specific matching (productions, people, venues)
  matchEntity(article, entity, type = 'production') {
    const text = normalize(
      `${article.title || ''} ${article.fullText || ''}`
    );
    const exactCount = this.matchExact(text, entity);
    const inTitle = this.matchExact(article.title || '', entity);

    let relevance = 'none';
    let score = 0;

    if (inTitle > 0) {
      relevance = 'very_high';
      score = inTitle * 100;
    } else if (exactCount > 2) {
      relevance = 'high';
      score = exactCount * 50;
    } else if (exactCount > 0) {
      relevance = 'medium';
      score = exactCount * 25;
    }

    return {
      entity,
      type,
      relevance,
      score,
      mentionCount: exactCount,
      inTitle: inTitle > 0,
    };
  }

  // Batch entity matching
  matchEntities(article, entities = {}, entityTypes = ['production', 'people', 'venues']) {
    const results = {
      productions: [],
      people: [],
      venues: [],
      total: 0,
    };

    for (const type of entityTypes) {
      const entityList = entities[type] || [];
      for (const entity of entityList) {
        const match = this.matchEntity(article, entity, type);
        if (match.score > 0) {
          results[type + 's'] = results[type + 's'] || [];
          results[type + 's'].push(match);
          results.total += 1;
        }
      }
    }

    // Sort by score
    Object.keys(results).forEach((key) => {
      if (Array.isArray(results[key])) {
        results[key].sort((a, b) => b.score - a.score);
      }
    });

    return results;
  }

  // Calculate overall relevance score
  calculateRelevance(article, query, entities = {}) {
    const queryRelevance = this.calculateQueryRelevance(article, query);
    const entityMatches = this.matchEntities(article, entities);

    const totalScore = queryRelevance.score + entityMatches.total * 10;

    return {
      queryRelevance,
      entityMatches,
      totalScore,
      category: this.categorizeRelevance(totalScore),
    };
  }

  // Categorize relevance score
  categorizeRelevance(score) {
    if (score >= 100) return 'highly_relevant';
    if (score >= 50) return 'relevant';
    if (score >= 20) return 'somewhat_relevant';
    if (score >= 5) return 'marginally_relevant';
    return 'not_relevant';
  }

  // Clear cache if needed
  clearCache() {
    this.cache.clear();
  }
}

module.exports = {
  RelevanceMatcher,
};
