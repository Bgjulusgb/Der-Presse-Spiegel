'use strict';

const { keywords, sentiment, settings } = require('./config');
const { levenshteinSimilarity } = require('./utils');

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[áàâ]/g, 'a')
    .replace(/[éèê]/g, 'e')
    .replace(/[íìî]/g, 'i')
    .replace(/[óòô]/g, 'o')
    .replace(/[úùû]/g, 'u')
    .replace(/[ñ]/g, 'n')
    .replace(/[ç]/g, 'c')
    .replace(/[ł]/g, 'l');
}

function preparedKeywords() {
  return {
    required: keywords.required.map(normalize),
    productions: keywords.productions.map(normalize),
    people: keywords.people.map(normalize),
    venues: (keywords.venues || []).map(normalize),
    theaterContext: (keywords.theater_context || []).map(normalize),
    exclude: (keywords.exclude || []).map(normalize),
    excludeTitle: (keywords.exclude_title || []).map(normalize),
    munichSpecific: (keywords.munich_specific || []).map(normalize),
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

function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function findFuzzyMatch(haystack, needle, threshold = 0.88) {
  if (!needle || !haystack) return false;
  if (haystack.includes(needle)) return true;
  if (needle.length < 6) return false;
  const words = haystack.split(/\s+/);
  const needleWords = needle.split(/\s+/);
  if (needleWords.length === 1) {
    for (const w of words) {
      if (w.length < 5) continue;
      if (levenshteinSimilarity(w, needle) >= threshold) return true;
    }
    return false;
  }
  for (let i = 0; i <= words.length - needleWords.length; i++) {
    const window = words.slice(i, i + needleWords.length).join(' ');
    if (levenshteinSimilarity(window, needle) >= threshold) return true;
  }
  return false;
}

// Builds the full searchable body text from all available fields
function articleBodyText(article) {
  if (!article) return '';
  return [
    article.fullText,
    article.summary,
    article.firstParagraph,
    article.content,
    article.meta && article.meta.description,
  ]
    .filter(Boolean)
    .join(' ');
}

// Estimatiert die Tiefe eines Artikels basierend auf Länge, Struktur, Detailgrad
function calculateArticleDepth(article) {
  const text = articleBodyText(article);
  const wordCount = (text || '').split(/\s+/).filter(Boolean).length;
  const sentences = splitSentences(text);
  const paragraphs = (article.fullText || '').split(/\n\n+/).filter(Boolean).length;

  let depth = 0;

  // Längenlevel
  if (wordCount >= 1000) depth += 3;
  else if (wordCount >= 500) depth += 2;
  else if (wordCount >= 200) depth += 1;

  // Struktur
  if (sentences.length >= 10) depth += 1;
  if (paragraphs >= 3) depth += 1;

  // Detailgrad: Zitate, Namen, spezifische Details
  const hasQuotes = text.match(/[""„"«»]/g);
  if (hasQuotes) depth += 1;

  const personMentions = KW.people.filter((p) => text.includes(p)).length;
  if (personMentions >= 2) depth += 1;

  return Math.min(depth, 5); // Max 5 Tiefe-Level
}

// Berechnet wie "spiegelhaft" ein Artikel ist (relevant für Pressespiegel-Funktion)
function calculateMirrorRelevance(article) {
  const text = normalize(articleBodyText(article));
  const title = normalize(article.title || '');
  let score = 0;

  // Wie direkt bezieht sich Artikel auf Kammerspiele?
  const requiredCount = KW.required.filter((k) => text.includes(k)).length;
  if (requiredCount >= 2) score += 30; // Mehrfach erwähnt
  else if (requiredCount >= 1) score += 15; // Erwähnt

  // Ist Artikel speziell ÜBER Kammerspiele oder nur erwähnt?
  if (title.match(/kammerspiele/i)) score += 40; // Titel
  if (text.match(/kammerspiele.*premiere|premiere.*kammerspiele/)) score += 20;
  if (text.match(/kammerspiele.*ensemble|ensemble.*kammerspiele/)) score += 15;

  // Wie relevant ist der Kontext?
  const contextWords = KW.theaterContext.filter((c) => text.includes(c)).length;
  score += Math.min(contextWords, 4) * 5;

  // Ist es originale Berichterstattung oder nur Ankündigung?
  const isReview = article.articleType === 'review';
  if (isReview) score += 25;

  return Math.min(score, 100);
}

function passesRequiredFilter(article) {
  const title = normalize(article.title || '');
  const text = normalize(articleBodyText(article));
  const haystack = `${title} ${text}`;

  const hasRequired = KW.required.some((k) => haystack.includes(k));
  if (!hasRequired) return { passes: false, reason: 'no-required-keyword' };

  // Strukturelle Ausschluesse (Stellenanzeige, Leserbrief etc.) nur im Titel
  // pruefen. Diese Begriffe tauchen sonst als UI-Labels (Cookie-Banner,
  // Werbeflaechen) im gescrapten Volltext auf und filtern valide Artikel raus.
  const firstPara = normalize(article.firstParagraph || '');
  const titleScope = `${title} ${firstPara}`;
  const titleExcludeHit = KW.excludeTitle.find((k) => titleScope.includes(k));
  if (titleExcludeHit) return { passes: false, reason: `exclude:${titleExcludeHit}` };

  // Orts-Disambiguierung (Hamburger/Berliner Kammerspiele etc.): nur dann
  // ausschliessen, wenn der Artikel nicht eindeutig die Muenchner Kammerspiele
  // benennt. So bleiben Vergleichs-/Uebersichtsartikel erhalten.
  const mentionsMunich = KW.munichSpecific.some((k) => haystack.includes(k));
  if (!mentionsMunich) {
    const excludeHit = KW.exclude.find((k) => haystack.includes(k));
    if (excludeHit) return { passes: false, reason: `exclude:${excludeHit}` };
  }

  return { passes: true };
}

// Leichtgewichtiger Vorfilter fuer RSS-Items VOR dem teuren Volltext-Fetch.
// Ziel: tausende offensichtlich irrelevante Artikel gar nicht erst anreichern.
// Konservativ: nur ueberspringen, wenn genug Text vorliegt UND kein
// Pflicht-Keyword vorkommt. Items mit wenig Text werden angereichert (im
// Zweifel fuer den Artikel), da das Keyword erst im Volltext stehen koennte.
function rssLikelyRelevant(item) {
  if (!item) return false;
  const title = normalize(item.title || '');
  const body = normalize(
    [item.summary, item.content, item.contentSnippet, item.description].filter(Boolean).join(' ')
  );
  const haystack = `${title} ${body}`;

  // Pflicht-Keyword direkt vorhanden -> sicher relevant.
  if (KW.required.some((k) => haystack.includes(k))) return true;

  // Zu wenig Beschreibungstext, um sicher zu urteilen -> anreichern.
  if (body.length < 120) return true;

  // Genug Text, aber kein Pflicht-Keyword -> ueberspringen.
  return false;
}

function detectArticleType(article) {
  const text = normalize(`${article.title || ''} ${articleBodyText(article)}`);
  const indicators = (list) => list.filter((w) => text.includes(normalize(w))).length;
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

function findContextualMatch(text, keyword, contextWords, windowChars = 200) {
  const idx = text.indexOf(keyword);
  if (idx === -1) return false;
  const start = Math.max(0, idx - windowChars);
  const end = Math.min(text.length, idx + keyword.length + windowChars);
  const window = text.slice(start, end);
  return contextWords.some((c) => window.includes(c));
}

// Verbesserte Relevanz-Berechnung mit mehr Kontext
function calculateRelevance(article, sourcePriority = 50) {
  const w = keywords.scoring_weights;
  const title = normalize(article.title || '');
  const text = normalize(articleBodyText(article));
  const haystack = `${title} ${text}`;
  let score = 0;
  const reasons = [];
  const matches = {
    required: [],
    productions: [],
    people: [],
    venues: [],
    theaterContext: false,
  };

  // Bestätige dass Kammerspiele im Titel ist (Top-Priorität für Pressespiegel)
  let titleHasRequired = false;
  for (const req of KW.required) {
    if (title.includes(req)) {
      score += w.title_exact_match || 100;
      reasons.push(`Titel: "${req}"`);
      titleHasRequired = true;
      matches.required.push(req);
      break;
    }
  }

  // Wenn nicht im Titel, suche im Text mit Häufigkeits-Bonus
  if (!titleHasRequired) {
    for (const req of KW.required) {
      if (text.includes(req)) {
        const count = countOccurrences(text, req);
        const pts = (w.required_keyword || 15) * Math.min(count, 5);
        score += pts;
        reasons.push(`${count}x "${req}" im Text (+${pts})`);
        matches.required.push(req);
        break;
      }
    }
  }

  // Produktionen: Top Priorität nach Kammerspiele selbst
  let productionInTitle = false;
  let productionCount = 0;
  for (const p of KW.productions) {
    if (!p || p.length < 3) continue;
    if (title.includes(p)) {
      score += w.production_in_title || 60;
      reasons.push(`Produktion im Titel: ${p}`);
      matches.productions.push(p);
      productionInTitle = true;
      productionCount++;
    } else if (text.includes(p)) {
      const isContextual = findContextualMatch(text, p, KW.required, 400);
      const count = countOccurrences(text, p);
      const basePoints = w.production_match || 35;
      const pts = isContextual ? basePoints * Math.min(count, 3) : Math.floor(basePoints / 2);
      score += pts;
      reasons.push(`Produktion: ${p}${isContextual ? ' (Kontext OK)' : ''} (${count}x, +${pts})`);
      matches.productions.push(p);
      productionCount++;
    } else if (p.length >= 8 && findFuzzyMatch(haystack, p, 0.9)) {
      score += w.fuzzy_title_match || 40;
      reasons.push(`Produktion (fuzzy): ${p}`);
      matches.productions.push(p);
      productionCount++;
    }
  }

  // Bonus für mehrere Produktionen
  if (productionCount > 1) {
    score += w.multiple_productions_bonus || 50;
    reasons.push(`Mehrere Produktionen (+${w.multiple_productions_bonus || 50})`);
  }

  // Bonus wenn sowohl Kammerspiele als auch Produktion im Titel
  if (productionInTitle && titleHasRequired) {
    score += w.title_with_production || 120;
    reasons.push('Fokus: Kammerspiele + Produktion im Titel');
  }

  // Ensemble-Mitglieder: wichtig aber sekundär
  let personCount = 0;
  for (const person of KW.people) {
    if (!person || person.length < 4) continue;
    if (title.includes(person)) {
      score += w.people_in_title || 50;
      reasons.push(`Person im Titel: ${person}`);
      matches.people.push(person);
      personCount++;
    } else if (text.includes(person)) {
      const isContextual = findContextualMatch(text, person, KW.required, 400);
      const pts = isContextual ? w.people_match || 25 : Math.floor((w.people_match || 25) / 2);
      score += pts;
      reasons.push(`Person: ${person}${isContextual ? ' (Kontext OK)' : ''} (+${pts})`);
      matches.people.push(person);
      personCount++;
    }
  }

  if (personCount > 1) {
    score += w.multiple_people_bonus || 30;
    reasons.push(`${personCount} Ensemble-Mitglieder erwähnt (+${w.multiple_people_bonus || 30})`);
  }

  // Veranstaltungsorte
  for (const venue of KW.venues) {
    if (!venue || venue.length < 5) continue;
    if (text.includes(venue) || title.includes(venue)) {
      score += w.venue_match || 15;
      matches.venues.push(venue);
    }
  }

  // Theater-Kontext Bonus
  const contextHits = KW.theaterContext.filter((c) => haystack.includes(c)).length;
  if (contextHits >= 2) {
    score += w.theater_context_bonus || 12;
    matches.theaterContext = true;
    reasons.push(`Theater-Kontext (${contextHits} Begriffe)`);
  }

  // Artikel-Typ Bonusse
  const type = detectArticleType(article);
  if (type === 'review') {
    score += w.review || 40;
    reasons.push('Typ: Kritik/Review (sehr relevant für Pressespiegel)');
  } else if (type === 'interview') {
    score += w.interview || 35;
    reasons.push('Typ: Interview');
  } else if (type === 'announcement') {
    score += w.announcement || 25;
    reasons.push('Typ: Ankündigung');
  }

  // Premiere-Erkennung
  if (haystack.includes('premiere')) {
    score += w.premiere_bonus || 30;
    reasons.push('Premiere-Berichterstattung');
  }

  // Fokussierte Berichterstattung
  if (titleHasRequired && productionInTitle) {
    score += w.exclusive_mention_bonus || 25;
    reasons.push('Fokussierte Berichterstattung (Kammerspiele + Produktion)');
  }

  // Wort-Länge und Substanz
  const wordCount =
    article.wordCount || (article.fullText || '').split(/\s+/).filter(Boolean).length;
  const minWords = keywords.thresholds.min_word_count || 50;
  const shortThreshold = keywords.thresholds.short_article_word_count || 100;

  if (wordCount > 0 && wordCount < minWords) {
    score += w.very_short_article_penalty || -40;
    reasons.push('sehr kurz - möglicherweise Sektor-Erwähnung');
  } else if (wordCount > 0 && wordCount < shortThreshold) {
    score += w.short_article_penalty || -15;
    reasons.push('kurz - begrenzte Details');
  } else if (wordCount >= 300 && wordCount < 500) {
    score += 8;
    reasons.push('mittlere Länge (+8)');
  } else if (wordCount >= 500) {
    score += 15;
    reasons.push('umfassend/ausführlich (+15)');
  }

  // Quelle/Publikation-Priorität
  if (sourcePriority >= 95) {
    score += 25;
    reasons.push('Premium-Quelle (SZ, FAZ, etc.) (+25)');
  } else if (sourcePriority >= 80) {
    score += 15;
    reasons.push('etablierte Quelle (+15)');
  } else if (sourcePriority >= 60) {
    score += 8;
    reasons.push('zuverlässige Quelle (+8)');
  }

  // Tiefe-Faktor
  const depth = calculateArticleDepth(article);
  if (depth >= 4) {
    score += 10;
    reasons.push('tiefgehendes Reporting (+10)');
  } else if (depth >= 2) {
    score += 5;
    reasons.push('strukturiert/detailliert (+5)');
  }

  // Paywall Bestrafung (wenn Artikel nicht volltextig erreichbar ist)
  if (article.paywall) {
    score -= 10;
    reasons.push('hinter Paywall (-10)');
  }

  const category = categorize(score);
  return {
    score: Math.max(0, score),
    reasons,
    category,
    articleType: type,
    matches,
    depth,
    mirrorRelevance: calculateMirrorRelevance(article),
  };
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
    if (stem.length < 4) continue;
    if (token.length >= stem.length && token.length <= stem.length + 4 && token.startsWith(stem)) {
      return true;
    }
  }
  return false;
}

// Verbesserte Sentiment-Analyse speziell für Theater-Rezensionen
function analyzeSentiment(text) {
  if (!text) return { label: 'neutral', score: 0, positiveHits: [], negativeHits: [], confidence: 0 };
  const normalized = normalize(text);
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const positiveSet = new Set(sentiment.positive.map(normalize));
  const negativeSet = new Set(sentiment.negative.map(normalize));
  const negations = new Set(sentiment.negations.map(normalize));
  const intensifiers = new Set(sentiment.intensifiers.map(normalize));

  let score = 0;
  const positiveHits = [];
  const negativeHits = [];
  let hitCount = 0;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    let weight = 1;
    let polarity = 0;
    if (matchesAnyStem(tok, positiveSet)) polarity = 1;
    else if (matchesAnyStem(tok, negativeSet)) polarity = -1;
    if (polarity === 0) continue;

    // Prüfe Negationen in den 3 vorherigen Token
    for (let j = Math.max(0, i - 3); j < i; j++) {
      if (negations.has(tokens[j])) polarity = -polarity;
      if (intensifiers.has(tokens[j])) weight = 2;
    }

    score += polarity * weight;
    hitCount++;
    if (polarity > 0) positiveHits.push(tok);
    else negativeHits.push(tok);
  }

  const t = sentiment.thresholds || { positive: 2, negative: -2 };
  let label = 'neutral';
  if (score >= (t.positive || 2)) label = 'positiv';
  else if (score <= (t.negative || -2)) label = 'negativ';

  // Berechne Konfidenz basierend auf Hit-Anzahl und Score-Stärke
  const confidence = hitCount > 0 ? Math.min(Math.abs(score) / Math.max(hitCount, 1), 1) : 0;

  return { label, score, positiveHits, negativeHits, confidence, hitCount };
}

function generateSummary(article, maxLength) {
  const limit = maxLength || (settings.reports && settings.reports.max_summary_length) || 320;
  const text = (article.fullText || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= limit) return text;
  const sentences = splitSentences(text);
  if (sentences.length === 0) return text.slice(0, limit) + '…';
  const normalizedTitle = normalize(article.title || '');
  const requiredHits = KW.required;
  const productionHits = KW.productions;

  const scored = sentences.slice(0, 30).map((s, idx) => {
    const ns = normalize(s);
    let sc = 0;
    if (idx === 0) sc += 4; // Intro ist wichtig
    if (idx < 3) sc += 2; // Frühe Sätze
    for (const r of requiredHits) if (ns.includes(r)) sc += 5; // Kammerspiele-Erwähnung
    for (const p of productionHits) if (p.length >= 4 && ns.includes(p)) sc += 4; // Produktion
    if (
      normalizedTitle &&
      levenshteinSimilarity(ns.slice(0, 80), normalizedTitle.slice(0, 80)) > 0.3
    )
      sc += 2;
    if (s.length < 30) sc -= 2; // Strafen für sehr kurze Sätze
    return { s, sc, idx };
  });
  scored.sort((a, b) => b.sc - a.sc || a.idx - b.idx);

  let summary = '';
  for (const { s } of scored) {
    if ((summary + ' ' + s).trim().length > limit) continue;
    summary = (summary + ' ' + s).trim();
    if (summary.length >= limit * 0.7) break;
  }
  if (!summary) summary = text.slice(0, limit) + '…';
  return summary;
}

// Haupt-Analyse-Funktion mit erweiterten Metadaten
function analyze(article, sourcePriority = 50) {
  const filter = passesRequiredFilter(article);
  const relevance = calculateRelevance(article, sourcePriority);
  const sentimentResult = analyzeSentiment(`${article.title} ${article.fullText || ''}`);
  const summary = generateSummary(article);
  const depth = calculateArticleDepth(article);

  return {
    passes: filter.passes,
    rejectReason: filter.reason,
    relevanceScore: relevance.score,
    relevanceReasons: relevance.reasons,
    relevanceMatches: relevance.matches,
    category: relevance.category,
    articleType: relevance.articleType,
    sentiment: sentimentResult.label,
    sentimentScore: sentimentResult.score,
    sentimentConfidence: sentimentResult.confidence,
    sentimentHits: {
      positive: sentimentResult.positiveHits,
      negative: sentimentResult.negativeHits,
    },
    summary,
    depth,
    mirrorRelevance: relevance.mirrorRelevance,
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
  findContextualMatch,
  findFuzzyMatch,
  normalize,
  articleBodyText,
  calculateArticleDepth,
  calculateMirrorRelevance,
  rssLikelyRelevant,
};
