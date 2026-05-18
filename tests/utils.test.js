'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeUrl,
  levenshteinSimilarity,
  cosineSimilarity,
  parseDateRange,
  truncate,
  escapeHtml,
  tokenize
} = require('../src/utils');

test('normalizeUrl entfernt Tracking-Parameter', () => {
  const a = 'https://www.example.com/artikel?utm_source=newsletter&id=1';
  const b = 'https://www.example.com/artikel?id=1';
  assert.equal(normalizeUrl(a), normalizeUrl(b));
});

test('normalizeUrl entfernt trailing slash', () => {
  assert.equal(normalizeUrl('https://x.de/foo/'), normalizeUrl('https://x.de/foo'));
});

test('normalizeUrl behandelt ungueltige URLs', () => {
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl('not-a-url'), 'not-a-url');
});

test('levenshteinSimilarity erkennt identische Strings', () => {
  assert.equal(levenshteinSimilarity('hallo welt', 'hallo welt'), 1);
});

test('levenshteinSimilarity erkennt Aehnlichkeit', () => {
  const sim = levenshteinSimilarity(
    'Hamlet Premiere an den Kammerspielen',
    'Hamlet Premiere bei den Kammerspielen'
  );
  assert.ok(sim > 0.85, `erwartet > 0.85, ist ${sim}`);
});

test('levenshteinSimilarity bei sehr unterschiedlichen Strings', () => {
  const sim = levenshteinSimilarity('Hello World', 'Bayern Muenchen');
  assert.ok(sim < 0.3);
});

test('cosineSimilarity erkennt identische Texte', () => {
  const sim = cosineSimilarity(
    'die kammerspiele zeigen hamlet am freitag',
    'die kammerspiele zeigen hamlet am freitag'
  );
  assert.ok(sim >= 0.99);
});

test('cosineSimilarity erkennt aehnliche Texte', () => {
  const sim = cosineSimilarity(
    'Die Muenchner Kammerspiele zeigen Hamlet in einer neuen Inszenierung am Freitag',
    'Die Kammerspiele Muenchen praesentieren Hamlet am Freitag in einer neuen Inszenierung'
  );
  assert.ok(sim > 0.6, `erwartet > 0.6, ist ${sim}`);
});

test('cosineSimilarity erkennt unterschiedliche Texte', () => {
  const sim = cosineSimilarity(
    'Fussball Bundesliga FC Bayern',
    'Theater Premiere Hamlet Kammerspiele'
  );
  assert.ok(sim < 0.2);
});

test('parseDateRange --last 7d', () => {
  const { from, to } = parseDateRange({ last: '7d' });
  const diff = (to - from) / (1000 * 3600 * 24);
  assert.ok(diff >= 6.9 && diff <= 8);
});

test('parseDateRange --from --to', () => {
  const { from, to } = parseDateRange({ from: '2026-01-01', to: '2026-01-31' });
  assert.equal(from.getFullYear(), 2026);
  assert.equal(from.getMonth(), 0);
  assert.equal(to.getFullYear(), 2026);
  assert.equal(to.getMonth(), 0);
});

test('parseDateRange wirft bei ungueltigem Format', () => {
  assert.throws(() => parseDateRange({ last: 'foo' }));
  assert.throws(() => parseDateRange({ from: '2026/01/01' }));
});

test('parseDateRange Default ist letzte 7 Tage', () => {
  const { from, to } = parseDateRange({});
  const diff = (to - from) / (1000 * 3600 * 24);
  assert.ok(diff >= 6.9 && diff <= 8);
});

test('truncate kuerzt korrekt', () => {
  assert.equal(truncate('Hallo Welt', 100), 'Hallo Welt');
  const result = truncate('Hallo Welt das ist ein Test', 10);
  assert.ok(result.length <= 10);
  assert.ok(result.endsWith('…'));
});

test('escapeHtml escaped korrekt', () => {
  assert.equal(escapeHtml('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
});

test('tokenize ignoriert kurze Tokens', () => {
  const tokens = tokenize('Die Kammerspiele in Muenchen sind super');
  assert.ok(tokens.includes('kammerspiele'));
  assert.ok(tokens.includes('muenchen'));
  assert.ok(!tokens.includes('in'));
});
