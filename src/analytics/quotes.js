'use strict';

const ner = require('./ner');

function bodyText(article) {
  if (!article) return '';
  return [
    article.fullText,
    article.full_text,
    article.summary,
    article.firstParagraph,
    article.first_paragraph,
  ]
    .filter(Boolean)
    .join(' ');
}

// Extrahiert zitierte Passagen aus einem Text. Erkennt deutsche und
// typografische Anfuehrungszeichen sowie Guillemets. Liefert getrimmte,
// sinnvoll lange Zitate (3+ Woerter, nicht zu lang).
function extractQuotes(text) {
  if (!text) return [];
  const quotes = [];
  const patterns = [
    // Deutsche/typografische Anfuehrung; schliessend tolerant (auch gerade ")
    /[„“]([^„“”"]{8,400})["“”]/g,
    /"([^"]{8,400})"/g, // gerade Anfuehrungszeichen (Paar)
    /«([^»]{8,400})»/g, // Guillemets
    /‚([^‚‘’']{8,400})['‘’]/g, // einfache typografische
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const q = m[1].replace(/\s+/g, ' ').trim();
      const words = q.split(/\s+/).filter(Boolean);
      if (words.length < 3) continue; // zu kurz, vermutlich Begriff
      if (words.length > 80) continue; // vermutlich kein echtes Zitat
      quotes.push(q);
    }
  }
  // Deduplizieren
  return Array.from(new Set(quotes));
}

// Sammelt herausragende Zitate ueber mehrere Artikel und ordnet sie der
// wahrscheinlichsten Produktion/Person zu (aus dem Artikel-Kontext).
function notableQuotes(articles, { limit = 50 } = {}) {
  const results = [];
  for (const a of articles) {
    const text = bodyText(a);
    const quotes = extractQuotes(text);
    if (quotes.length === 0) continue;
    const entities = ner.extractEntities(a);
    const production = entities.find((e) => e.type === 'production');
    const person = entities.find((e) => e.type === 'person');
    for (const q of quotes) {
      results.push({
        quote: q,
        articleId: a.id || null,
        source: a.source || null,
        title: a.title || null,
        production: production ? production.value : null,
        person: person ? person.value : null,
        length: q.length,
      });
    }
  }
  // Laengere, gehaltvollere Zitate zuerst; harte Obergrenze.
  return results.sort((x, y) => y.length - x.length).slice(0, limit);
}

// Kennzahl: Anteil der Artikel, die direkte Zitate enthalten (Indikator fuer
// originaere Berichterstattung statt blosser Meldungen).
function quoteCoverage(articles) {
  if (!articles.length) return { total: 0, withQuotes: 0, ratio: 0 };
  let withQuotes = 0;
  for (const a of articles) {
    if (extractQuotes(bodyText(a)).length > 0) withQuotes += 1;
  }
  return {
    total: articles.length,
    withQuotes,
    ratio: Math.round((withQuotes / articles.length) * 100) / 100,
  };
}

module.exports = {
  extractQuotes,
  notableQuotes,
  quoteCoverage,
};
