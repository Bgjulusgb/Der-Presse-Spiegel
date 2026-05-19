'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseQuery, tokenize, articleMatchesStructured, queryToBM25String } = require('../src/query-parser');

test('tokenize splittet einfache Worte', () => {
  const t = tokenize('hello welt');
  assert.equal(t.length, 2);
  assert.equal(t[0].type, 'term');
});

test('tokenize erkennt Phrasen', () => {
  const t = tokenize('"Wokey Wokey" Theater');
  assert.equal(t[0].type, 'phrase');
  assert.equal(t[0].value, 'Wokey Wokey');
});

test('tokenize erkennt NOT-Operator mit Minus', () => {
  const t = tokenize('Hamlet -Hamburger');
  assert.equal(t.length, 2);
  assert.equal(t[1].type, 'not');
  assert.equal(t[1].value, 'Hamburger');
});

test('tokenize erkennt Feld-Syntax', () => {
  const t = tokenize('title:Premiere source:nachtkritik');
  assert.equal(t[0].type, 'field');
  assert.equal(t[0].field, 'title');
  assert.equal(t[0].value, 'Premiere');
});

test('tokenize erkennt OR-Operator', () => {
  const t = tokenize('Hamlet OR Faust');
  assert.equal(t[1].type, 'op');
  assert.equal(t[1].value, 'OR');
});

test('parseQuery liefert strukturiert bei Operatoren', () => {
  const p = parseQuery('Hamlet -Hamburger');
  assert.equal(p.must.length, 1);
  assert.equal(p.mustNot.length, 1);
  assert.equal(p.isStructured, true);
});

test('articleMatchesStructured: NOT filtert', () => {
  const p = parseQuery('Premiere -Hamburger');
  const a1 = { title: 'Premiere in München' };
  const a2 = { title: 'Hamburger Premiere' };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: Phrase muss exakt vorkommen', () => {
  const p = parseQuery('"Wokey Wokey"');
  const a1 = { title: 'Wokey Wokey Premiere' };
  const a2 = { title: 'Wokey ist nicht Wokey' };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: Feldsuche', () => {
  const p = parseQuery('source:nachtkritik');
  const a1 = { source: 'nachtkritik.de', title: 'X' };
  const a2 = { source: 'SZ', title: 'X' };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('articleMatchesStructured: Feldsuche kombiniert mit Term', () => {
  const p = parseQuery('Hamlet sentiment:negativ');
  const a1 = { title: 'Hamlet', sentiment: 'negativ', full_text: 'Hamlet' };
  const a2 = { title: 'Hamlet', sentiment: 'positiv', full_text: 'Hamlet' };
  assert.equal(articleMatchesStructured(a1, p), true);
  assert.equal(articleMatchesStructured(a2, p), false);
});

test('queryToBM25String extrahiert reine Suchbegriffe', () => {
  const p = parseQuery('Hamlet -Hamburger source:SZ');
  assert.equal(queryToBM25String(p), 'Hamlet');
});

test('parseQuery: leerer String liefert null', () => {
  assert.equal(parseQuery(''), null);
  assert.equal(parseQuery('   '), null);
});
