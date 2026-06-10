'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const server = require('../src/server');

let port;
let httpServer;
const baseUrl = () => `http://127.0.0.1:${port}`;

before(async () => {
  port = 4900 + Math.floor(Math.random() * 100);
  const { server: srv } = await server.start({ port });
  httpServer = srv;
  await new Promise((r) => setTimeout(r, 300));
});

after(() => {
  try {
    httpServer && httpServer.close && httpServer.close();
  } catch {
    /* ignore */
  }
});

async function get(url) {
  const res = await fetch(baseUrl() + url);
  const json = await res.json();
  return { status: res.status, json };
}

test('GET /api/health antwortet ok', async () => {
  const { status, json } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(json.status, 'ok');
});

test('GET /api/articles ohne Filter liefert valides Schema', async () => {
  const { status, json } = await get('/api/articles?last=30d');
  assert.equal(status, 200);
  assert.ok('total' in json);
  assert.ok('returned' in json);
  assert.ok(Array.isArray(json.articles));
});

test('GET /api/articles?facets=true liefert facets-Block', async () => {
  const { status, json } = await get('/api/articles?last=30d&facets=true');
  assert.equal(status, 200);
  assert.ok(json.facets, 'facets-Block muss vorhanden sein');
  assert.ok(Array.isArray(json.facets.category));
  assert.ok(Array.isArray(json.facets.sentiment));
  assert.ok(Array.isArray(json.facets.source));
  assert.ok(Array.isArray(json.facets.language));
  assert.ok(Array.isArray(json.facets.paywall));
  assert.ok(Array.isArray(json.facets.image));
});

test('GET /api/articles mit neuen Filtern liefert kein 500', async () => {
  const params = [
    'paywall=no',
    'image=yes',
    'dupes=hide',
    'lang=de,en',
    'wordsMin=100',
    'wordsMax=2000',
    'readingTimeMin=1',
    'readingTimeMax=10',
    'tagMode=any',
    'tagNot=spam',
    'tag=kultur',
    'category=sehr_relevant,relevant',
    'sentiment=positiv,neutral',
    'minScore=10',
    'maxScore=100',
    'bookmark=no',
  ];
  const { status, json } = await get('/api/articles?last=30d&' + params.join('&'));
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.articles));
});

test('GET /api/articles?tagMode=invalid macht keinen Crash', async () => {
  const { status } = await get('/api/articles?last=30d&tagMode=NOT_A_REAL_MODE');
  assert.equal(status, 200);
});

test('GET /api/articles?image=yes filtert konsistent', async () => {
  const { json } = await get('/api/articles?last=30d&image=yes');
  for (const a of json.articles) {
    assert.ok(a.has_image, `${a.title}: has_image fehlt`);
  }
});

test('GET /api/articles?dupes=hide filtert Duplikate', async () => {
  const { json } = await get('/api/articles?last=30d&dupes=hide');
  for (const a of json.articles) {
    assert.equal(a.duplicate_of, null, `${a.title}: duplicate_of muss null sein`);
  }
});

test('GET /api/articles?lang=de filtert konsistent', async () => {
  const { json } = await get('/api/articles?last=30d&lang=de');
  for (const a of json.articles) {
    assert.equal(a.language, 'de', `${a.title}: language=${a.language}`);
  }
});

test('GET /api/sources liefert stats und healthStatus pro Feed', async () => {
  const { status, json } = await get('/api/sources');
  assert.equal(status, 200);
  assert.ok(json.stats);
  assert.ok(typeof json.stats.ok === 'number');
  assert.ok(typeof json.stats.degraded === 'number');
  assert.ok(typeof json.stats.blocked === 'number');
  assert.ok(typeof json.stats.dead === 'number');
  assert.ok(typeof json.stats.total === 'number');
  if (json.feeds.length > 0) {
    assert.ok(json.feeds[0].healthStatus);
  }
});

async function post(url, body = {}) {
  const res = await fetch(baseUrl() + url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('POST /api/sources/bulk-disable-dead antwortet ok', async () => {
  const { status, json } = await post('/api/sources/bulk-disable-dead');
  assert.equal(status, 200);
  assert.ok(json.ok);
  assert.ok(typeof json.disabled === 'number');
});

test('POST /api/sources/bulk-mark-blocked-browser antwortet ok', async () => {
  const { status, json } = await post('/api/sources/bulk-mark-blocked-browser');
  assert.equal(status, 200);
  assert.ok(json.ok);
  assert.ok(typeof json.updated === 'number');
});

test('POST /api/sources/opml-preview ohne opml liefert 400', async () => {
  const { status, json } = await post('/api/sources/opml-preview', {});
  assert.equal(status, 400);
  assert.ok(json.error);
});

test('POST /api/sources/opml-preview mit invaliderem XML antwortet trotzdem strukturiert', async () => {
  const { status, json } = await post('/api/sources/opml-preview', {
    opml: '<opml><body></body></opml>',
  });
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.previews));
  assert.equal(json.count, 0);
});

test('GET /api/analytics/entities liefert valides Schema', async () => {
  const { status, json } = await get('/api/analytics/entities?last=30d');
  assert.equal(status, 200);
  assert.ok(json.entities, 'entities-Block muss vorhanden sein');
  assert.ok('person' in json.entities);
  assert.ok('production' in json.entities);
  assert.ok(Array.isArray(json.entities.person));
});

test('GET /api/analytics/source-quality liefert sources-Array', async () => {
  const { status, json } = await get('/api/analytics/source-quality?last=30d');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.sources));
});

test('GET /api/analytics/mention-trends liefert spikes-Array', async () => {
  const { status, json } = await get('/api/analytics/mention-trends?last=30d');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.spikes));
});

test('GET /api/analytics/tonality liefert Verteilung', async () => {
  const { status, json } = await get('/api/analytics/tonality?last=30d');
  assert.equal(status, 200);
  assert.ok(json.tonalityDistribution && typeof json.tonalityDistribution === 'object');
});

test('GET /api/analytics/events liefert timeline', async () => {
  const { status, json } = await get('/api/analytics/events?last=30d');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.timeline));
});

test('GET /api/analytics/clusters liefert clusters-Array', async () => {
  const { status, json } = await get('/api/analytics/clusters?last=30d');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.clusters));
});

test('GET /api/analytics/top-entities liefert entities-Array', async () => {
  const { status, json } = await get('/api/analytics/top-entities?last=30d&type=person&limit=10');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.entities));
  assert.equal(json.type, 'person');
});

test('GET /api/analytics/event-counts liefert events-Array', async () => {
  const { status, json } = await get('/api/analytics/event-counts?last=30d');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.events));
});

test('GET /api/analytics/resonance liefert overall + byProduction', async () => {
  const { status, json } = await get('/api/analytics/resonance?last=30d');
  assert.equal(status, 200);
  assert.ok(json.overall && typeof json.overall === 'object');
  assert.ok(Array.isArray(json.byProduction));
});

test('GET /api/analytics/share-of-voice liefert Array + dimension', async () => {
  const { status, json } = await get('/api/analytics/share-of-voice?dimension=production&last=30d');
  assert.equal(status, 200);
  assert.equal(json.dimension, 'production');
  assert.ok(Array.isArray(json.shareOfVoice));
});

test('GET /api/analytics/sentiment-timeline liefert timeline-Array', async () => {
  const { status, json } = await get('/api/analytics/sentiment-timeline?last=30d');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.timeline));
});

test('GET /api/analytics/critic-consensus liefert consensus-Array', async () => {
  const { status, json } = await get('/api/analytics/critic-consensus?last=30d');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.consensus));
});

test('GET /api/analytics/quotes liefert quotes + coverage', async () => {
  const { status, json } = await get('/api/analytics/quotes?last=30d');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.quotes));
  assert.ok(json.coverage && typeof json.coverage === 'object');
});

test('GET /api/export?format=md liefert Markdown-Linkliste', async () => {
  const res = await fetch(baseUrl() + '/api/export?format=md&last=7d');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/markdown/);
  const body = await res.text();
  assert.match(body, /^# Pressespiegel Muenchner Kammerspiele/);
  assert.match(body, /Zeitraum: /);
});

test('GET /api/export mit unbekanntem Format -> 400', async () => {
  const { status, json } = await get('/api/export?format=xlsx&last=7d');
  assert.equal(status, 400);
  assert.ok(json.error);
});
