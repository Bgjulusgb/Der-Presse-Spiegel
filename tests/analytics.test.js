'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const ner = require('../src/analytics/ner');
const mentions = require('../src/analytics/mentions');
const sourceHealth = require('../src/analytics/source-health');
const clustering = require('../src/analytics/clustering');
const freshness = require('../src/analytics/freshness');
const tonality = require('../src/analytics/tonality');
const events = require('../src/analytics/events');
const mediaResonance = require('../src/analytics/media-resonance');
const quotes = require('../src/analytics/quotes');

// Sample test articles
const sampleArticles = [
  {
    id: 1,
    title: 'Hamlet Premiere an den Muenchner Kammerspielen',
    fullText: 'Eine grossartige Auffuehrung. Die Regie war brillant. Wiebke Puls spielte eine Hauptrolle.',
    summary: 'Premiere von Hamlet',
    firstParagraph: 'An den Kammerspielen premiere von Hamlet.',
    published_date: new Date('2026-01-15T10:00:00Z'),
    source: 'Sueddeutsche Zeitung',
    relevance_score: 85,
    sentiment: 'positiv',
    word_count: 150,
  },
  {
    id: 2,
    title: 'Wokey Wokey bei den Kammerspielen erwaehnt',
    fullText: 'Die Produktion von Nora Abdel-Maksoud fasziniert das Publikum.',
    summary: 'Wokey Wokey Review',
    firstParagraph: 'Wokey Wokey ist ein grosser Erfolg.',
    published_date: new Date('2026-01-16T14:30:00Z'),
    source: 'Frankfurter Allgemeine',
    relevance_score: 70,
    sentiment: 'positiv',
    word_count: 200,
  },
  {
    id: 3,
    title: 'Neue Inszenierung zeigt Schwaechen',
    fullText: 'Die Inszenierung war enttaeuschend. Zu viele Fehler bei der Auffuehrung.',
    summary: 'Kritische Rezension',
    firstParagraph: 'Die Auffuehrung war nicht gelungen.',
    published_date: new Date('2026-01-17T09:00:00Z'),
    source: 'Die Zeit',
    relevance_score: 60,
    sentiment: 'negativ',
    word_count: 180,
  },
];

// NER Tests
test('ner.extractEntities findet Menschen', () => {
  const article = sampleArticles[0];
  const entities = ner.extractEntities(article);
  const people = entities.filter((e) => e.type === 'person');
  assert.ok(people.some((p) => p.value === 'Wiebke Puls'));
});

test('ner.extractEntities findet Produktionen', () => {
  const article = sampleArticles[1];
  const entities = ner.extractEntities(article);
  const prods = entities.filter((e) => e.type === 'production');
  assert.ok(prods.some((p) => p.value === 'Wokey Wokey'));
});

test('ner.extractEntities berechnet Konfidenz', () => {
  const article = sampleArticles[0];
  const entities = ner.extractEntities(article);
  for (const e of entities) {
    assert.ok(e.confidence >= 0 && e.confidence <= 1);
  }
});

test('ner.getEntityStats aggregiert Statistiken', () => {
  const stats = ner.getEntityStats(sampleArticles);
  assert.ok(stats.people instanceof Map);
  assert.ok(stats.people.size > 0);
});

// Mentions Tests
test('mentions.analyzeMentionTrends erstellt Zeitreihe', () => {
  const trends = mentions.analyzeMentionTrends(sampleArticles);
  assert.ok(trends.person);
  assert.ok(trends.production);
});

test('mentions.getTopMentions liefert sortierte Liste', () => {
  const top = mentions.getTopMentions(sampleArticles, 'production', 5);
  assert.ok(Array.isArray(top));
  if (top.length > 1) {
    assert.ok(top[0].mentions >= top[1].mentions);
  }
});

test('mentions.getEntityTimeline verfolgt ein Entity ueber Zeit', () => {
  const timeline = mentions.getEntityTimeline(sampleArticles, 'Wokey Wokey');
  assert.ok(Array.isArray(timeline));
  assert.ok(timeline.length > 0);
  assert.ok(timeline[0].date);
  assert.ok(timeline[0].count >= 0);
});

test('mentions.getMentionSpikes findet Anstiege', () => {
  const spikes = mentions.getMentionSpikes(sampleArticles, 3);
  assert.ok(Array.isArray(spikes));
});

// Source Health Tests
test('sourceHealth.calculateSourceMetrics berechnet Metriken', () => {
  const metrics = sourceHealth.calculateSourceMetrics(sampleArticles);
  assert.ok(Array.isArray(metrics));
  assert.equal(metrics.length, 3);
  assert.ok(metrics[0].source);
  assert.ok(metrics[0].totalArticles > 0);
  assert.ok(metrics[0].qualityScore >= 0 && metrics[0].qualityScore <= 100);
});

test('sourceHealth berechnet Bias korrekt', () => {
  const metrics = sourceHealth.calculateSourceMetrics(sampleArticles);
  const positiveSource = metrics.find((m) => m.sentimentDistribution.positiv > 50);
  assert.ok(positiveSource);
  assert.equal(positiveSource.bias, 'positive_bias');
});

test('sourceHealth sortiert nach qualityScore', () => {
  const metrics = sourceHealth.calculateSourceMetrics(sampleArticles);
  for (let i = 0; i < metrics.length - 1; i++) {
    assert.ok(metrics[i].qualityScore >= metrics[i + 1].qualityScore);
  }
});

test('sourceHealth.getSourceRanking fuegt Rang hinzu', () => {
  const ranking = sourceHealth.getSourceRanking(sampleArticles);
  assert.ok(ranking[0].rank === 1);
  assert.ok(ranking[1].rank === 2);
  assert.ok(ranking[0].trustScore);
});

// Clustering Tests
test('clustering.clusterArticles gruppiert aehnliche Artikel', () => {
  const clusters = clustering.clusterArticles(sampleArticles, 0.3);
  assert.ok(Array.isArray(clusters));
});

test('clustering.calculateClusterCoherence berechnet Zusammenhang', () => {
  const coherence = clustering.calculateClusterCoherence(sampleArticles);
  assert.ok(coherence >= 0 && coherence <= 1);
});

test('clustering.findDuplicates findet aehnliche Artikel', () => {
  const dupes = clustering.findDuplicates(sampleArticles, 0.5);
  assert.ok(Array.isArray(dupes));
});

// Freshness Tests
test('freshness.calculateFreshness berechnet Alter', () => {
  const f = freshness.calculateFreshness(sampleArticles);
  assert.equal(f.length, sampleArticles.length);
  for (const item of f) {
    assert.ok(['breaking', 'fresh', 'recent', 'week-old', 'stale', 'unknown'].includes(item.freshness));
  }
});

test('freshness.detectUpdates findet Ueberschriften-Updates', () => {
  const articles = [
    { ...sampleArticles[0], published_date: new Date('2026-01-15T10:00:00Z') },
    { ...sampleArticles[0], id: 99, published_date: new Date('2026-01-15T14:00:00Z') },
  ];
  const updates = freshness.detectUpdates(articles);
  assert.ok(updates.length > 0);
});

test('freshness.calculatePublicationVelocity berechnet Publikationrate', () => {
  const velocity = freshness.calculatePublicationVelocity(sampleArticles);
  assert.ok(velocity >= 0);
});

test('freshness.getBreakingNews findet aktuelle Artikel', () => {
  const recentArticles = [
    {
      ...sampleArticles[0],
      published_date: new Date(),
      relevance_score: 80,
    },
  ];
  const breaking = freshness.getBreakingNews(recentArticles, 50);
  assert.ok(Array.isArray(breaking));
});

// Tonality Tests
test('tonality.analyzeTonality erkennt kritischen Ton', () => {
  const article = sampleArticles[2];
  const ton = tonality.analyzeTonality(article);
  assert.equal(ton.tonality, 'critical');
  assert.ok(ton.normalized.critical > 0);
});

test('tonality.analyzeTonality erkennt enthusiastischen Ton', () => {
  const article = sampleArticles[0];
  const ton = tonality.analyzeTonality(article);
  assert.ok(['enthusiastic', 'neutral_reporting'].includes(ton.tonality));
});

test('tonality.detectSarcasm erkennt Sarkasmus', () => {
  const sarcastic = 'Natuerlich war die Auffuehrung nicht schlecht.';
  const isSarcastic = tonality.detectSarcasm(sarcastic);
  assert.ok(typeof isSarcastic === 'boolean');
});

// Events Tests
test('events.detectEvents findet Premiere-Markierung', () => {
  const article = sampleArticles[0];
  const evt = events.detectEvents(article);
  assert.ok(Array.isArray(evt));
});

test('events.groupEventsByType gruppiert nach Typ', () => {
  const groups = events.groupEventsByType(sampleArticles);
  assert.ok(typeof groups === 'object');
});

test('events.getEventTimeline erstellt Zeitleiste', () => {
  const timeline = events.getEventTimeline(sampleArticles);
  assert.ok(Array.isArray(timeline));
});

// --- Media Resonance ---
test('mediaResonance.articleResonance gewichtet Reichweite und Typ', () => {
  const review = {
    source: 'Süddeutsche Zeitung',
    relevanceScore: 90,
    articleType: 'review',
    wordCount: 600,
  };
  const shortNews = { source: 'Unbekannt', relevanceScore: 30, articleType: 'news', wordCount: 40 };
  assert.ok(mediaResonance.articleResonance(review) > mediaResonance.articleResonance(shortNews));
});

test('mediaResonance.reachWeight skaliert mit Prioritaet', () => {
  assert.ok(mediaResonance.reachWeight(100) > mediaResonance.reachWeight(50));
  assert.ok(mediaResonance.reachWeight(50) > mediaResonance.reachWeight(0));
});

test('mediaResonance.shareOfVoice summiert auf ~100%', () => {
  const arts = [
    { title: 'Wokey Wokey', fullText: 'Wokey Wokey an den Kammerspielen.', relevanceScore: 80, articleType: 'review', wordCount: 300 },
    { title: 'Pinocchio', fullText: 'Pinocchio an den Kammerspielen.', relevanceScore: 60, articleType: 'news', wordCount: 200 },
  ];
  const sov = mediaResonance.shareOfVoice(arts, 'production');
  const sum = sov.reduce((s, x) => s + x.share, 0);
  assert.ok(Math.abs(sum - 100) < 2, `Summe ${sum} sollte ~100 sein`);
});

test('mediaResonance.criticConsensus aggregiert nur Reviews', () => {
  const arts = [
    { title: 'Wokey Wokey', fullText: 'Wokey Wokey grossartig.', sentiment: 'positiv', sentimentScore: 5, articleType: 'review' },
    { title: 'Wokey Wokey', fullText: 'Wokey Wokey News.', sentiment: 'neutral', sentimentScore: 0, articleType: 'news' },
  ];
  const cons = mediaResonance.criticConsensus(arts);
  const wokey = cons.find((c) => c.production === 'Wokey Wokey');
  assert.ok(wokey);
  assert.equal(wokey.reviews, 1);
  assert.equal(wokey.consensus, 'ueberwiegend_positiv');
});

test('mediaResonance.sentimentTimeline gruppiert nach Tag', () => {
  const arts = [
    { published_date: new Date('2026-05-20'), sentiment: 'positiv', sentimentScore: 4 },
    { published_date: new Date('2026-05-20'), sentiment: 'negativ', sentimentScore: -2 },
  ];
  const tl = mediaResonance.sentimentTimeline(arts);
  assert.equal(tl.length, 1);
  assert.equal(tl[0].count, 2);
});

// --- Quotes ---
test('quotes.extractQuotes erkennt typografische Anfuehrungszeichen', () => {
  const q = quotes.extractQuotes('Die Kritik schreibt: „Ein grandioser Abend voller Witz" und mehr.');
  assert.ok(q.some((x) => x.includes('grandioser Abend')));
});

test('quotes.extractQuotes ignoriert zu kurze Fragmente', () => {
  const q = quotes.extractQuotes('Er sagte "ja" dazu.');
  assert.equal(q.length, 0);
});

test('quotes.quoteCoverage berechnet Anteil', () => {
  const arts = [
    { fullText: 'Sie sagt: „Das ist wirklich beeindruckend gemacht worden".' },
    { fullText: 'Kein Zitat hier.' },
  ];
  const cov = quotes.quoteCoverage(arts);
  assert.equal(cov.total, 2);
  assert.equal(cov.withQuotes, 1);
  assert.equal(cov.ratio, 0.5);
});

test('quotes.notableQuotes ordnet Produktion zu', () => {
  const arts = [
    { id: 1, source: 'SZ', title: 'Premiere', fullText: 'Wokey Wokey an den Kammerspielen. „Ein wirklich starker Theaterabend".' },
  ];
  const nq = quotes.notableQuotes(arts);
  assert.ok(nq.length > 0);
  assert.equal(nq[0].production, 'Wokey Wokey');
});
