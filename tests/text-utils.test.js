'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const T = require('../src/text-utils');

test('normalizeUmlauts ersetzt ä/ö/ü/ß', () => {
  assert.equal(T.normalizeUmlauts('Müller über Lärm Straße'), 'Mueller ueber Laerm Strasse');
});

test('normalizeUmlauts null-safe', () => {
  assert.equal(T.normalizeUmlauts(null), '');
  assert.equal(T.normalizeUmlauts(undefined), '');
  assert.equal(T.normalizeUmlauts(''), '');
});

test('expandUmlautVariants liefert ä↔ae und Umlaut-frei', () => {
  const v = T.expandUmlautVariants('Müller');
  assert.ok(v.includes('müller'));
  assert.ok(v.includes('mueller'));
});

test('germanCompoundSplit erkennt Opernpremiere', () => {
  const parts = T.germanCompoundSplit('Opernpremiere');
  assert.deepEqual(parts, ['oper', 'premiere']);
});

test('germanCompoundSplit erkennt Theateraufführung', () => {
  const parts = T.germanCompoundSplit('Theateraufführung');
  assert.ok(parts[0] === 'theater');
  assert.ok(parts[1].includes('auffuehrung'));
});

test('germanCompoundSplit liefert leere Liste fuer kurze Woerter', () => {
  assert.deepEqual(T.germanCompoundSplit('Hamlet'), []);
  assert.deepEqual(T.germanCompoundSplit('Oper'), []);
});

test('germanCompoundSplit erkennt Inszenierungspremiere', () => {
  const parts = T.germanCompoundSplit('Inszenierungspremiere');
  assert.deepEqual(parts, ['inszenierung', 'premiere']);
});

test('colognePhonetic: Müller und Mueller geben identischen Code', () => {
  assert.equal(T.colognePhonetic('Müller'), T.colognePhonetic('Mueller'));
});

test('colognePhonetic: Tschaikowsky und Tschaikowski geben identischen Code', () => {
  assert.equal(T.colognePhonetic('Tschaikowsky'), T.colognePhonetic('Tschaikowski'));
});

test('colognePhonetic: Maier und Meyer geben identischen Code', () => {
  assert.equal(T.colognePhonetic('Maier'), T.colognePhonetic('Meyer'));
});

test('colognePhonetic: leerer/null Input liefert leeren String', () => {
  assert.equal(T.colognePhonetic(''), '');
  assert.equal(T.colognePhonetic(null), '');
});

test('detectLanguage: deutscher Text', () => {
  const text =
    'Die Premiere am Münchner Theater war ein voller Erfolg gestern Abend mit großer Resonanz.';
  assert.equal(T.detectLanguage(text), 'de');
});

test('detectLanguage: kurzer Text fällt auf Fallback', () => {
  assert.equal(T.detectLanguage('hi', { fallback: 'de' }), 'de');
  assert.equal(T.detectLanguage('hi', { fallback: 'en' }), 'en');
});

test('detectLanguage: franzoesischer Text', () => {
  const text =
    'La première au théâtre était un grand succès ce soir avec un public enthousiaste et nombreux.';
  assert.equal(T.detectLanguage(text), 'fr');
});

test('estimateReadingMinutes: 200 Worte = 1 Minute', () => {
  const text = 'wort '.repeat(200).trim();
  assert.equal(T.estimateReadingMinutes(text), 1);
});

test('estimateReadingMinutes: leerer Text = 1 Minute (min)', () => {
  assert.equal(T.estimateReadingMinutes(''), 1);
});

test('extractTopKeywords: liefert relevante Begriffe', () => {
  const text =
    'Die Inszenierung von Hamlet an den Kammerspielen war herausragend. Die Regie hat brilliante Arbeit geleistet. Hamlet als Figur stand im Mittelpunkt.';
  const kws = T.extractTopKeywords(text, { limit: 5 });
  assert.ok(kws.includes('hamlet') || kws.includes('inszenierung'));
});

test('splitSentences: zerlegt Text in Saetze', () => {
  const text = 'Erster Satz. Zweiter Satz! Dritter Satz?';
  const sents = T.splitSentences(text);
  assert.equal(sents.length, 3);
});

test('extractSnippet: liefert relevanten Satz fuer Begriff', () => {
  const text = 'Erster Satz. Zweiter Satz mit Hamlet drin. Dritter Satz ist normal.';
  const snippet = T.extractSnippet(text, ['Hamlet']);
  assert.ok(snippet.includes('Hamlet'));
});

test('extractSnippet: leerer Text liefert leeren String', () => {
  assert.equal(T.extractSnippet('', ['x']), '');
});

test('hasImage: erkennt image_url', () => {
  assert.equal(T.hasImage({ image_url: 'https://example.com/x.jpg' }), true);
  assert.equal(T.hasImage({}), false);
});

test('hasImage: erkennt og_image aus meta-Objekt', () => {
  assert.equal(T.hasImage({ meta: { og_image: 'x.jpg' } }), true);
});

test('hasImage: erkennt og_image aus meta-String (JSON)', () => {
  assert.equal(T.hasImage({ meta: '{"og_image":"x.jpg"}' }), true);
});
