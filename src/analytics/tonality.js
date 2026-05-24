'use strict';

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');
}

function analyzeTonality(article) {
  const text = normalize(
    `${article.title || ''} ${article.fullText || article.full_text || article.summary || ''}`
  );
  const tokens = text.split(/[^a-z0-9]+/).filter(Boolean);

  const tonalities = {
    critical: 0,
    enthusiastic: 0,
    neutral: 0,
    cautious: 0,
  };

  const criticalWords = ['kritik', 'schwach', 'fehler', 'problem', 'mangel', 'fehlgeschlagen', 'enttaeuschend'];
  const enthusiasticWords = ['brillant', 'genialer', 'begeistert', 'faszinierend', 'meisterhaft', 'erfolgreich'];
  const cautiousWords = ['koennten', 'moechte', 'versucht', 'hoffentlich', 'fraglich', 'zweifelhaft'];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (criticalWords.some((w) => token.includes(w))) {
      tonalities.critical++;
    } else if (enthusiasticWords.some((w) => token.includes(w))) {
      tonalities.enthusiastic++;
    } else if (cautiousWords.some((w) => token.includes(w))) {
      tonalities.cautious++;
    }
  }

  const total = Object.values(tonalities).reduce((a, b) => a + b, 0);
  if (total === 0) {
    tonalities.neutral = 1;
    return {
      tonality: 'neutral_reporting',
      scores: tonalities,
      normalized: { critical: 0, enthusiastic: 0, neutral: 1, cautious: 0 },
    };
  }

  const normalized = {};
  for (const [key, value] of Object.entries(tonalities)) {
    normalized[key] = Math.round((value / total) * 100) / 100;
  }

  let dominantTone = 'neutral_reporting';
  let maxScore = 0;
  for (const [tone, score] of Object.entries(normalized)) {
    if (score > maxScore) {
      maxScore = score;
      dominantTone = tone;
    }
  }

  return {
    tonality: dominantTone,
    scores: tonalities,
    normalized,
    isMixed: maxScore < 0.5,
  };
}

function detectSarcasm(text) {
  const sarcasmMarkers = ['natuerlich', 'klasse', 'ausgezeichnet', 'super'];
  const normalized = normalize(text);

  // Simple heuristic: sarcasm markers combined with negative context
  const hasSarcasmMarker = sarcasmMarkers.some((m) => normalized.includes(m));
  const hasNegativeContext = normalized.includes('nicht') || normalized.includes('kein');

  return hasSarcasmMarker && hasNegativeContext;
}

function analyzeTonalityContrast(articles) {
  const byDate = new Map();

  for (const article of articles) {
    if (!article.published_date) continue;
    const dateKey = format(new Date(article.published_date), 'yyyy-MM-dd');
    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
    byDate.get(dateKey).push(article);
  }

  const contrasts = [];
  for (const [date, dayArticles] of byDate) {
    const tonalities = dayArticles.map((a) => ({
      article: a.id,
      ...analyzeTonality(a),
    }));

    // Detect if some articles are very critical while others enthusiastic
    const criticalCount = tonalities.filter((t) => t.tonality === 'critical').length;
    const enthusiasticCount = tonalities.filter((t) => t.tonality === 'enthusiastic').length;

    if (criticalCount > 0 && enthusiasticCount > 0) {
      contrasts.push({
        date,
        contrast: 'critic_divide',
        criticalArticles: criticalCount,
        enthusiasticArticles: enthusiasticCount,
        totalArticles: dayArticles.length,
      });
    }
  }

  return contrasts;
}

const { format } = require('date-fns');

module.exports = {
  analyzeTonality,
  detectSarcasm,
  analyzeTonalityContrast,
  normalize,
};
