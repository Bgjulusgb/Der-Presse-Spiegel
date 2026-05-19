'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BM25Index,
  hybridSearch,
  tokenizeAndStem,
  highlightTerms,
  suggestQueries
} = require('../src/search');

const articles = [
  {
    id: 1,
    title: 'Pinocchio an den Muenchner Kammerspielen',
    summary: 'Wu Tsang inszeniert Pinocchio im Schauspielhaus.',
    full_text: 'Die Inszenierung von Wu Tsang an den Muenchner Kammerspielen begeistert. Pinocchio ist eine grossartige Auffuehrung.',
    source: 'SZ',
    author: 'Egbert Tholl'
  },
  {
    id: 2,
    title: 'Wallenstein-Premiere',
    summary: 'Schillers Wallenstein an den Kammerspielen.',
    full_text: 'Eine kraftvolle Inszenierung von Wallenstein an den Muenchner Kammerspielen. Walter Hess ueberzeugt.',
    source: 'FAZ',
    author: null
  },
  {
    id: 3,
    title: 'Theaterkritik: Hamlet in Hamburg',
    summary: 'Ein Hamlet jenseits der Kammerspiele.',
    full_text: 'Die Auffuehrung war konfus und enttaeuschend.',
    source: 'Welt',
    author: null
  }
];

test('tokenizeAndStem normalisiert und stemmt deutsche Worte', () => {
  const tokens = tokenizeAndStem('Die Inszenierungen der Kammerspiele begeistern');
  assert.ok(tokens.length > 0);
  assert.ok(tokens.some(t => t.startsWith('inszen')));
  assert.ok(tokens.some(t => t.startsWith('kammerspiel')));
});

test('tokenizeAndStem entfernt Stopwoerter', () => {
  const tokens = tokenizeAndStem('die der das und in mit');
  assert.equal(tokens.length, 0);
});

test('BM25Index findet relevanten Artikel', () => {
  const idx = new BM25Index(articles);
  const results = idx.search('Pinocchio', 5);
  assert.ok(results.length > 0);
  assert.equal(results[0].article.id, 1);
});

test('BM25Index bewertet Titel-Treffer hoeher', () => {
  const idx = new BM25Index(articles);
  const wallenstein = idx.search('Wallenstein', 5);
  assert.equal(wallenstein[0].article.id, 2);
});

test('hybridSearch kombiniert BM25 + Fuzzy', () => {
  const results = hybridSearch(articles, 'Pinocchio', { limit: 5 });
  assert.ok(results.length > 0);
  assert.equal(results[0].article.id, 1);
  assert.ok(results[0].score > 0);
});

test('hybridSearch findet bei Tippfehler ebenfalls Treffer', () => {
  const results = hybridSearch(articles, 'Pinokio', { limit: 5 });
  assert.ok(results.some(r => r.article.id === 1));
});

test('hybridSearch findet Mehr-Wort-Anfragen', () => {
  const results = hybridSearch(articles, 'Wu Tsang Inszenierung', { limit: 5 });
  assert.equal(results[0].article.id, 1);
});

test('hybridSearch ohne Query liefert ungewichtet zurueck', () => {
  const results = hybridSearch(articles, '', { limit: 5 });
  assert.equal(results.length, articles.length);
});

test('highlightTerms markiert Treffer', () => {
  const out = highlightTerms('Eine Inszenierung an den Kammerspielen', 'Inszenierung');
  assert.ok(out.includes('<mark>'));
});

test('suggestQueries liefert Vorschlaege fuer Praefix', () => {
  const suggestions = suggestQueries('pino', articles);
  assert.ok(suggestions.length > 0);
});

test('suggestQueries liefert leere Liste fuer kurze Praefixe', () => {
  assert.equal(suggestQueries('p', articles).length, 0);
});
