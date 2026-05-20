'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { autoTag, tagCategoryColor, getCategories } = require('../src/tagger');

test('autoTag erkennt Produktion (Wallenstein + Kammerspiele)', () => {
  const tags = autoTag(
    {
      title: 'Wallenstein an den Kammerspielen',
      fullText: 'Schillers Wallenstein in einer Inszenierung an den Muenchner Kammerspielen.',
    },
    { sentiment: 'positiv', category: 'sehr_relevant' }
  );
  assert.ok(tags.includes('produktion:wallenstein'));
});

test('autoTag erkennt nicht Wallenstein wenn Kammerspiele fehlt', () => {
  const tags = autoTag(
    {
      title: 'Wallenstein in Stuttgart',
      fullText: 'Eine Inszenierung von Wallenstein am Schauspiel Stuttgart.',
    },
    { sentiment: 'positiv', category: 'irrelevant' }
  );
  assert.ok(!tags.includes('produktion:wallenstein'));
});

test('autoTag erkennt Person', () => {
  const tags = autoTag(
    {
      title: 'Premiere',
      fullText: 'Barbara Mundel sagt im Gespraech...',
    },
    {}
  );
  assert.ok(tags.includes('person:mundel'));
});

test('autoTag erkennt Premiere als Ereignis', () => {
  const tags = autoTag(
    {
      title: 'Premiere am Freitag',
      fullText: 'Die Erstauffuehrung findet statt.',
    },
    {}
  );
  assert.ok(tags.includes('ereignis:premiere'));
});

test('autoTag setzt Tonalitaet basierend auf Sentiment', () => {
  const tags = autoTag({ title: 'X', fullText: 'Y' }, { sentiment: 'negativ' });
  assert.ok(tags.includes('tonalitaet:negativ'));
});

test('autoTag setzt Relevanz', () => {
  const tags = autoTag({ title: 'X', fullText: 'Y' }, { category: 'sehr_relevant' });
  assert.ok(tags.includes('relevanz:top'));
});

test('autoTag erkennt Form: Interview', () => {
  const tags = autoTag(
    {
      title: 'Im Gespraech mit Mundel',
      fullText: 'Frage: Wie war es? Antwort: Gut.',
    },
    {}
  );
  assert.ok(tags.includes('form:interview'));
});

test('autoTag erkennt Paywall-Tag', () => {
  const tags = autoTag(
    {
      title: 'X',
      fullText: 'Y',
      paywall: true,
    },
    {}
  );
  assert.ok(tags.includes('qualitaet:paywall'));
});

test('tagCategoryColor liefert Farbe pro Kategorie', () => {
  const color = tagCategoryColor('produktion:wallenstein');
  assert.ok(color.startsWith('#'));
});

test('getCategories liefert Kategorien-Mapping', () => {
  const cats = getCategories();
  assert.ok(typeof cats === 'object');
  assert.ok(cats.produktion);
});
