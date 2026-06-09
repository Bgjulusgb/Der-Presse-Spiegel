'use strict';

const { sentiment } = require('../config');
const { normalize } = require('../analyzer');

// Extended Sentiment Analysis with Granular Classification and Intensity Levels
class ExtendedSentimentAnalyzer {
  constructor(config = {}) {
    this.config = {
      positiveThreshold: 2,
      negativeThreshold: -2,
      intensityLevels: 5,
      ...config,
    };
    this.setupLexicons();
  }

  setupLexicons() {
    this.positiveWords = new Set(sentiment.positive.map(normalize));
    this.negativeWords = new Set(sentiment.negative.map(normalize));
    this.negations = new Set(sentiment.negations.map(normalize));
    this.intensifiers = new Set(sentiment.intensifiers.map(normalize));

    // Extended lexicons for theater-specific sentiment
    this.theaterPositive = new Set([
      'meisterwerk',
      'brilliant',
      'glanzvoll',
      'hervorragend',
      'wunderbar',
      'erstaunlich',
      'beeindruckend',
      'fesselnd',
      'mitreissend',
    ]);

    this.theaterNegative = new Set([
      'enttaeuschend',
      'langatmig',
      'konfus',
      'unausgegoren',
      'missgelueckt',
      'peinlich',
      'absurd',
      'unbeholfen',
    ]);
  }

  // Tokenize text intelligently
  tokenize(text) {
    if (!text) return [];
    const normalized = normalize(text);
    return normalized
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .slice(0, 500); // Limit for performance
  }

  // Get word weight based on position (early words = more important)
  getPositionalWeight(index, totalLength) {
    const ratio = index / Math.max(1, totalLength);
    if (ratio < 0.1) return 1.5; // Early mention (headline/intro)
    if (ratio < 0.3) return 1.2; // First third
    if (ratio < 0.7) return 1.0; // Middle
    return 0.8; // End (less influential)
  }

  // Detect modifiers (negations, intensifiers, diminishers)
  analyzeModifiers(tokens, position) {
    let multiplier = 1;
    const window = 4; // Look back up to 4 tokens

    for (let i = Math.max(0, position - window); i < position; i++) {
      const token = tokens[i];

      if (this.intensifiers.has(token)) {
        multiplier = Math.min(multiplier * 2, 3); // Amplify (max 3x)
      } else if (this.negations.has(token)) {
        multiplier *= -1; // Flip polarity
      } else if (['eher', 'weniger', 'kaum'].includes(token)) {
        multiplier *= 0.5; // Diminish
      }
    }

    return multiplier;
  }

  // Calculate intensity level (1-5 scale)
  calculateIntensity(score, hitCount) {
    if (hitCount === 0) return 0;

    const absoluteScore = Math.abs(score);
    const intensity = Math.ceil((absoluteScore / Math.max(hitCount, 1)) * 5);

    return Math.min(intensity, 5);
  }

  // Advanced sentiment analysis with granular classification
  analyze(text) {
    if (!text) {
      return {
        label: 'neutral',
        intensity: 0,
        score: 0,
        confidence: 0,
        summary: {
          raw: 0,
          weighted: 0,
          positiveMentions: 0,
          negativeMentions: 0,
          positiveHits: [],
          negativeHits: [],
        },
        subjectivity: 'objective',
        emotionType: null,
      };
    }

    const tokens = this.tokenize(text);
    let score = 0;
    let hitCount = 0;
    const positiveHits = [];
    const negativeHits = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      let polarity = 0;

      // Check standard lexicon
      if (this.positiveWords.has(token)) polarity = 1;
      else if (this.negativeWords.has(token)) polarity = -1;
      // Check theater-specific lexicon
      else if (this.theaterPositive.has(token)) polarity = 1;
      else if (this.theaterNegative.has(token)) polarity = -1;

      if (polarity === 0) continue;

      // Apply modifiers
      const multiplier = this.analyzeModifiers(tokens, i);
      const weight = this.getPositionalWeight(i, tokens.length);
      const contribution = polarity * multiplier * weight;

      score += contribution;
      hitCount++;

      if (contribution > 0) {
        positiveHits.push(token);
      } else {
        negativeHits.push(token);
      }
    }

    // Determine primary sentiment label
    let label = 'neutral';
    if (score >= this.config.positiveThreshold) label = 'positiv';
    else if (score <= -this.config.negativeThreshold) label = 'negativ';

    // Calculate intensity (1-5)
    const intensity = this.calculateIntensity(score, hitCount);

    // Confidence: based on hit density and strength
    const confidence = hitCount > 0 ? Math.min(Math.abs(score) / Math.max(hitCount, 1), 1) : 0;

    // Detect subjectivity
    const subjectivity = hitCount > 5 ? 'subjective' : 'objective';

    // Detect emotion type for positive/negative content
    let emotionType = null;
    if (label !== 'neutral') {
      emotionType = this.detectEmotionType(text, label);
    }

    return {
      label,
      intensity,
      score,
      confidence,
      summary: {
        raw: score.toFixed(2),
        weighted: (score / Math.max(hitCount, 1)).toFixed(2),
        positiveMentions: positiveHits.length,
        negativeMentions: negativeHits.length,
        positiveHits: [...new Set(positiveHits)],
        negativeHits: [...new Set(negativeHits)],
      },
      subjectivity,
      emotionType,
      hitCount,
    };
  }

  // Detect specific emotion type within positive/negative spectrum
  detectEmotionType(text, polarity) {
    const normalized = normalize(text);

    if (polarity === 'positiv') {
      if (
        ['begeister', 'faszin', 'geniesslich', 'erfreut', 'beluemmert'].some((w) =>
          normalized.includes(w)
        )
      ) {
        return 'enthusiastic';
      }
      if (['elegant', 'raffiniert', 'subtil', 'genialen'].some((w) => normalized.includes(w))) {
        return 'admiring';
      }
      return 'positive';
    } else if (polarity === 'negativ') {
      if (
        ['enttaeuscht', 'frustriert', 'aergerlich', 'verbluefft', 'schockiert'].some((w) =>
          normalized.includes(w)
        )
      ) {
        return 'critical';
      }
      if (['frustrierend', 'maettauschend', 'laestig', 'absurd'].some((w) =>
        normalized.includes(w)
      )) {
        return 'dismissive';
      }
      return 'negative';
    }

    return null;
  }

  // Compare sentiment between two texts
  compareSentiments(text1, text2) {
    const sent1 = this.analyze(text1);
    const sent2 = this.analyze(text2);

    const scoreDiff = sent2.score - sent1.score;
    const intensityDiff = sent2.intensity - sent1.intensity;
    const confidenceDiff = sent2.confidence - sent1.confidence;

    let changeDirection = 'neutral';
    if (scoreDiff > 0.5) changeDirection = 'more_positive';
    else if (scoreDiff < -0.5) changeDirection = 'more_negative';

    return {
      text1: sent1,
      text2: sent2,
      comparison: {
        scoreDiff: scoreDiff.toFixed(2),
        intensityDiff,
        confidenceDiff: confidenceDiff.toFixed(2),
        changeDirection,
        moreSubjective: sent2.subjectivity === 'subjective' ? 'text2' : 'text1',
      },
    };
  }

  // Analyze sentiment trend in a sequence of paragraphs
  analyzeSentimentArc(text, paragraphCount = 5) {
    const paragraphs = text
      .split(/\n\n+/)
      .filter(Boolean)
      .slice(0, paragraphCount);

    if (paragraphs.length === 0) return null;

    const sentiments = paragraphs.map((p) => this.analyze(p));

    // Calculate trend
    const scores = sentiments.map((s) => s.score);
    const trend = [];
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[i - 1]) trend.push('rising');
      else if (scores[i] < scores[i - 1]) trend.push('falling');
      else trend.push('stable');
    }

    // Determine arc direction
    const firstQuarter = sentiments.slice(0, Math.ceil(sentiments.length / 4));
    const lastQuarter = sentiments.slice(-Math.ceil(sentiments.length / 4));
    const firstAvg = firstQuarter.reduce((a, s) => a + s.score, 0) / firstQuarter.length;
    const lastAvg = lastQuarter.reduce((a, s) => a + s.score, 0) / lastQuarter.length;

    let arcType = 'stable';
    if (lastAvg > firstAvg + 1) arcType = 'improving';
    else if (lastAvg < firstAvg - 1) arcType = 'deteriorating';

    return {
      sentiments,
      trend,
      arcType,
      averageIntensity:
        (sentiments.reduce((a, s) => a + s.intensity, 0) / sentiments.length).toFixed(2),
      firstHalf: firstAvg.toFixed(2),
      lastHalf: lastAvg.toFixed(2),
    };
  }

  // Extract most impactful sentiment phrases
  extractSentimentPhrases(text, maxPhrases = 5) {
    const tokens = this.tokenize(text);
    const phrases = [];
    const window = 5;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      let polarity = 0;

      if (this.positiveWords.has(token) || this.theaterPositive.has(token)) polarity = 1;
      else if (this.negativeWords.has(token) || this.theaterNegative.has(token)) polarity = -1;

      if (polarity === 0) continue;

      const start = Math.max(0, i - window);
      const end = Math.min(tokens.length, i + window + 1);
      const phrase = tokens.slice(start, end).join(' ');

      phrases.push({
        phrase,
        sentiment: polarity > 0 ? 'positive' : 'negative',
        weight: Math.abs(polarity * this.analyzeModifiers(tokens, i)),
        position: i,
      });
    }

    // Sort by weight and return top phrases
    return phrases
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxPhrases)
      .map(({ phrase, sentiment }) => ({ phrase, sentiment }));
  }
}

module.exports = {
  ExtendedSentimentAnalyzer,
};
