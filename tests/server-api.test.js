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
  await new Promise(r => setTimeout(r, 300));
});

after(() => {
  try { httpServer && httpServer.close && httpServer.close(); } catch { /* ignore */ }
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
    'paywall=no', 'image=yes', 'dupes=hide', 'lang=de,en',
    'wordsMin=100', 'wordsMax=2000', 'readingTimeMin=1', 'readingTimeMax=10',
    'tagMode=any', 'tagNot=spam', 'tag=kultur',
    'category=sehr_relevant,relevant', 'sentiment=positiv,neutral',
    'minScore=10', 'maxScore=100', 'bookmark=no'
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
