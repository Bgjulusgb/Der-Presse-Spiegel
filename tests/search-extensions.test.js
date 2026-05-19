'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const {
  hybridSearch,
  snippetFor,
  queryTerms,
  tokenizeAndStem,
  tokenizePhonetic,
  clearSearchCache
} = require('../src/search');

const now = new Date().toISOString();
const articles = [
  { id: 1, title: 'Hamlet-Inszenierung an den Kammerspielen', summary: 'Ein neuer Hamlet von Regisseur Karin Mueller.', full_text: 'Die Kammerspielepremiere war herausragend. Hamlet im Mittelpunkt.', source: 'SZ', source_priority: 90, published_date: now, relevance_score: 80 },
  { id: 2, title: 'Opernpremiere am Nationaltheater', summary: 'Die neue Opernpremiere begeisterte das Publikum.', full_text: 'Eine glanzvolle Opernaufführung im Nationaltheater München.', source: 'SZ', source_priority: 80, published_date: now, relevance_score: 70 },
  { id: 3, title: 'Tschaikowski-Konzert in Berlin', summary: 'Pjotr Tschaikowski wird gespielt.', full_text: 'Tschaikowski-Werke standen im Mittelpunkt.', source: 'taz', source_priority: 70, published_date: now, relevance_score: 60 }
];

test('hybridSearch: Compound-Split findet "opern" in "Opernpremiere"', () => {
  clearSearchCache();
  const results = hybridSearch(articles, 'opern', { limit: 5 });
  assert.ok(results.length >= 1, 'Should find at least one article');
  const ids = results.map(r => r.article.id);
  assert.ok(ids.includes(2), 'Opernpremiere should be found via compound split');
});

test('hybridSearch: Compound-Split findet "kammerspiele" in "Kammerspielen"', () => {
  clearSearchCache();
  const results = hybridSearch(articles, 'kammerspiele', { limit: 5 });
  assert.ok(results.length >= 1);
  assert.equal(results[0].article.id, 1);
});

test('hybridSearch: Phonetik findet Tschaikowsky via Tschaikowski', () => {
  clearSearchCache();
  const results = hybridSearch(articles, 'Tschaikowsky', { limit: 5 });
  assert.ok(results.length >= 1, 'Phonetic search should find similar names');
  const ids = results.map(r => r.article.id);
  assert.ok(ids.includes(3), 'Tschaikowsky article should be found via phonetic match');
});

test('hybridSearch: LRU-Cache liefert konsistente Ergebnisse', () => {
  clearSearchCache();
  const first = hybridSearch(articles, 'hamlet', { limit: 5 });
  const second = hybridSearch(articles, 'hamlet', { limit: 5 });
  assert.equal(first.length, second.length);
  assert.equal(first[0].article.id, second[0].article.id);
});

test('hybridSearch: cache:false umgeht den Cache', () => {
  clearSearchCache();
  const first = hybridSearch(articles, 'hamlet', { limit: 5, cache: false });
  assert.ok(first.length >= 1);
});

test('hybridSearch: NOT-Operator bleibt vom DidYouMean-Fallback unberuehrt', () => {
  clearSearchCache();
  const arts = [
    { id: 1, title: 'Hamlet Premiere München' },
    { id: 2, title: 'Hamburger Hamlet Premiere' }
  ];
  const results = hybridSearch(arts, 'Hamlet -Hamburger', { limit: 5 });
  assert.equal(results.length, 1);
  assert.equal(results[0].article.id, 1);
});

test('snippetFor: liefert Satz mit Query-Term', () => {
  clearSearchCache();
  const snippet = snippetFor(articles[0], 'Hamlet');
  assert.ok(snippet.includes('Hamlet') || snippet.includes('hamlet'));
});

test('snippetFor: leeres Article-Objekt liefert leeren String', () => {
  assert.equal(snippetFor(null, 'x'), '');
});

test('queryTerms: extrahiert Begriffe aus Query', () => {
  const terms = queryTerms('hamlet kammerspiele');
  assert.ok(terms.includes('hamlet'));
});

test('tokenizeAndStem: Compound-Split-Option erweitert Tokens', () => {
  const tokens = tokenizeAndStem('Opernpremiere', { withCompoundSplit: true });
  assert.ok(tokens.length >= 2, 'Compound split should produce multiple tokens');
});

test('tokenizePhonetic: liefert Set von Codes', () => {
  const codes = tokenizePhonetic('Müller Tschaikowski Hamlet');
  assert.ok(codes.size >= 2);
});
