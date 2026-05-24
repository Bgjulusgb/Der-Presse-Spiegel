'use strict';

const { normalize } = require('../analyzer');

// Content Enrichment System - Adds structured metadata and enhancement
class ContentEnricher {
  // Extract and structure metadata from article
  extractMetadata(article) {
    const metadata = {
      wordCount: this.calculateWordCount(article.fullText || ''),
      sentenceCount: this.calculateSentenceCount(article.fullText || ''),
      paragraphCount: this.calculateParagraphCount(article.fullText || ''),
      readingTimeMinutes: this.estimateReadingTime(article.fullText || ''),
      languageQuality: this.assessLanguageQuality(article),
      structureQuality: this.assessStructure(article),
      contentType: this.detectContentType(article),
      keyTopics: this.extractTopics(article),
      entities: this.extractSimpleEntities(article),
    };

    return metadata;
  }

  // Calculate word count
  calculateWordCount(text) {
    if (!text) return 0;
    return text.split(/\s+/).filter(Boolean).length;
  }

  // Calculate sentence count
  calculateSentenceCount(text) {
    if (!text) return 0;
    return text.split(/[.!?]+/).filter(Boolean).length;
  }

  // Calculate paragraph count
  calculateParagraphCount(text) {
    if (!text) return 0;
    return text.split(/\n\n+/).filter(Boolean).length;
  }

  // Estimate reading time in minutes
  estimateReadingTime(text) {
    const avgWordsPerMinute = 200;
    const wordCount = this.calculateWordCount(text);
    return Math.ceil(wordCount / avgWordsPerMinute);
  }

  // Assess language quality (basic heuristics)
  assessLanguageQuality(article) {
    const text = article.fullText || '';
    let score = 5; // Base score

    // Penalize spelling/grammar issues (very basic check)
    const commonMisspellings = ['teh', 'taht', 'wich', 'theyll', 'thier'];
    const misspellingCount = commonMisspellings.filter((word) =>
      normalize(text).includes(word)
    ).length;
    score -= misspellingCount;

    // Reward proper punctuation
    const punctuationCount = (text.match(/[.!?]/g) || []).length;
    if (punctuationCount > 5) score += 1;

    // Penalize excessive exclamation marks (signs of low quality)
    const exclamationCount = (text.match(/!/g) || []).length;
    if (exclamationCount > 5) score -= 1;

    // Reward proper quote usage
    if (text.match(/["„"«»]/)) score += 1;

    return Math.max(1, Math.min(10, score));
  }

  // Assess structure quality
  assessStructure(article) {
    let score = 0;

    // Has multiple paragraphs
    const paragraphs = this.calculateParagraphCount(article.fullText || '');
    if (paragraphs >= 3) score += 3;
    if (paragraphs >= 5) score += 2;

    // Has sentences of varying length (indicates variety)
    const sentences = (article.fullText || '').split(/[.!?]+/).filter(Boolean);
    const sentenceLengths = sentences.map((s) => s.trim().split(/\s+/).length);
    const avgLength = sentenceLengths.reduce((a, b) => a + b, 0) / sentenceLengths.length;
    const variance =
      sentenceLengths.reduce((a, b) => a + Math.pow(b - avgLength, 2), 0) / sentenceLengths.length;
    if (variance > 10) score += 2; // Good sentence variety

    // Has numbered/bulleted lists
    if ((article.fullText || '').match(/^[-•*\d.]+\s+/gm)) score += 2;

    // Has proper title
    if (article.title && article.title.length > 10) score += 2;

    return Math.min(10, score);
  }

  // Detect content type
  detectContentType(article) {
    const text = normalize(article.fullText || '').substring(0, 500);
    const title = normalize(article.title || '');

    // Review/critique
    if (
      text.includes('kritik') ||
      text.includes('rezension') ||
      text.includes('besprechung') ||
      title.includes('kritik')
    ) {
      return 'review';
    }

    // Interview
    if (
      text.includes('interview') ||
      text.includes('frage:') ||
      text.includes('antwort:') ||
      title.includes('interview')
    ) {
      return 'interview';
    }

    // Announcement
    if (
      text.includes('kuendigt an') ||
      text.includes('kündigt an') ||
      text.includes('spielplan') ||
      title.includes('ankuendigung')
    ) {
      return 'announcement';
    }

    // News/Report
    if (
      text.includes('berichtet') ||
      text.includes('mitteilte') ||
      text.includes('erklaerte') ||
      text.includes('erklärt')
    ) {
      return 'news';
    }

    // Feature/Deep dive
    if (text.length > 1000 && this.calculateParagraphCount(article.fullText || '') >= 5) {
      return 'feature';
    }

    return 'article';
  }

  // Extract main topics from article
  extractTopics(article) {
    const text = normalize(article.fullText || '');
    const topics = [];

    const topicPatterns = {
      theater: ['buehne', 'bühne', 'inszenierung', 'premiere', 'aufführung'],
      casting: ['casting', 'besetzung', 'rolle', 'darsteller'],
      direction: ['regie', 'regisseur', 'inszeniert'],
      ensemble: ['ensemble', 'ensemble-'],
      production: ['produktion', 'spielzeit', 'spielplan'],
      awards: ['preis', 'award', 'auszeichnung'],
      audience: ['publikum', 'zuschauer', 'besucher'],
      reviews: ['kritik', 'rezension', 'bewertung'],
    };

    for (const [topic, keywords] of Object.entries(topicPatterns)) {
      if (keywords.some((k) => text.includes(k))) {
        const count = keywords.filter((k) => text.includes(k)).length;
        topics.push({ topic, relevance: Math.min(count, 5) });
      }
    }

    return topics.sort((a, b) => b.relevance - a.relevance);
  }

  // Extract basic named entities
  extractSimpleEntities(article) {
    const text = article.fullText || '';
    const entities = {
      people: [],
      locations: [],
      organizations: [],
    };

    // Simple pattern matching for capitalized words (basic NER)
    const words = text.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      // If word starts with capital letter and is not at sentence start
      if (
        word.length > 3 &&
        /^[A-Z]/.test(word) &&
        i > 0 &&
        words[i - 1].match(/[^.!?]$/)
      ) {
        // Basic heuristics for entity type
        if (this.looksLikePerson(word)) {
          entities.people.push(word);
        } else if (this.looksLikeLocation(word)) {
          entities.locations.push(word);
        } else if (this.looksLikeOrganization(word)) {
          entities.organizations.push(word);
        }
      }
    }

    // Deduplicate
    entities.people = [...new Set(entities.people)].slice(0, 10);
    entities.locations = [...new Set(entities.locations)].slice(0, 10);
    entities.organizations = [...new Set(entities.organizations)].slice(0, 10);

    return entities;
  }

  // Simple heuristic: looks like a person name
  looksLikePerson(word) {
    // Ends with common German suffixes or preceded by title words
    return /[a-z]$/.test(word) && word.length > 4;
  }

  // Simple heuristic: looks like a location
  looksLikeLocation(word) {
    return word.length > 4 && /[mnstd]$/.test(word.toLowerCase());
  }

  // Simple heuristic: looks like organization
  looksLikeOrganization(word) {
    return /theater|spielstatte|buehne|ensemble/i.test(word);
  }

  // Generate content summary
  generateSummary(article, maxSentences = 3) {
    const sentences = (article.fullText || '')
      .split(/[.!?]+/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (sentences.length === 0) return '';

    // Score sentences by importance
    const scored = sentences.slice(0, Math.min(sentences.length, 10)).map((sentence, idx) => {
      let score = 0;

      // First sentence is important
      if (idx === 0) score += 3;

      // Contains title keywords
      if (article.title) {
        const titleWords = article.title.split(/\s+/);
        const titleMatches = titleWords.filter((w) =>
          normalize(sentence).includes(normalize(w))
        ).length;
        score += titleMatches * 2;
      }

      // Contains important keywords
      const importantWords = ['premiere', 'inszenierung', 'ensemble', 'kritik'];
      const matches = importantWords.filter((w) => normalize(sentence).includes(w)).length;
      score += matches;

      return { sentence, score, idx };
    });

    // Sort by score but maintain some chronological order
    scored.sort((a, b) => b.score - a.score);
    const summary = scored
      .slice(0, maxSentences)
      .sort((a, b) => a.idx - b.idx)
      .map((s) => s.sentence)
      .join(' ');

    return summary;
  }

  // Generate article preview/excerpt
  generatePreview(article, maxWords = 100) {
    const text = article.fullText || article.summary || '';
    if (!text) return '';

    const words = text.split(/\s+/);
    const preview = words.slice(0, maxWords).join(' ');

    if (words.length > maxWords) {
      return preview + '…';
    }
    return preview;
  }

  // Enrich article with all metadata
  enrichArticle(article) {
    return {
      ...article,
      _metadata: this.extractMetadata(article),
      _summary: this.generateSummary(article),
      _preview: this.generatePreview(article, 75),
      _readabilityScore: this.calculateReadability(article),
    };
  }

  // Calculate readability score (simplified)
  calculateReadability(article) {
    const text = article.fullText || '';
    const wordCount = this.calculateWordCount(text);
    const sentenceCount = this.calculateSentenceCount(text);

    if (sentenceCount === 0) return 0;

    const avgWordsPerSentence = wordCount / sentenceCount;
    let score = 10;

    // Optimal sentence length is 10-20 words
    if (avgWordsPerSentence < 10) score += 2;
    else if (avgWordsPerSentence > 25) score -= 2;

    // Optimal paragraph length is 50-150 words
    const paragraphCount = this.calculateParagraphCount(text);
    if (paragraphCount > 0) {
      const avgWordsPerParagraph = wordCount / paragraphCount;
      if (avgWordsPerParagraph < 50) score -= 1;
      else if (avgWordsPerParagraph > 200) score -= 1;
    }

    return Math.max(1, Math.min(10, score));
  }

  // Detect article language (simplified, assumes German for now)
  detectLanguage(article) {
    const germanWords = ['der', 'die', 'das', 'und', 'zu', 'den', 'von', 'ist'];
    const text = normalize(article.fullText || '').split(/\s+/);
    const matches = germanWords.filter((w) => text.includes(w)).length;

    if (matches > text.length * 0.05) return 'de';
    return 'unknown';
  }

  // Check for duplicate or near-duplicate content
  isDuplicateContent(article1, article2, threshold = 0.85) {
    const text1 = normalize(article1.fullText || '');
    const text2 = normalize(article2.fullText || '');

    if (text1 === text2) return true;

    // Simple similarity check
    const set1 = new Set(text1.split(/\s+/));
    const set2 = new Set(text2.split(/\s+/));

    const common = [...set1].filter((w) => set2.has(w)).length;
    const total = new Set([...set1, ...set2]).size;
    const similarity = common / Math.max(total, 1);

    return similarity >= threshold;
  }
}

module.exports = {
  ContentEnricher,
};
