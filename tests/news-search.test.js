'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  looksLikeFeed,
  cleanGoogleNewsTitle,
  extractSourceFromGoogleTitle,
  buildGoogleNewsUrl,
  buildBingNewsUrl,
} = require('../src/news-search');

test('looksLikeFeed erkennt RSS', () => {
  assert.equal(looksLikeFeed('<?xml version="1.0"?><rss version="2.0"><channel></channel></rss>'), true);
});

test('looksLikeFeed erkennt Atom', () => {
  assert.equal(looksLikeFeed('<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true);
});

test('looksLikeFeed erkennt RDF', () => {
  assert.equal(looksLikeFeed('<rdf:RDF xmlns:rdf="..."></rdf:RDF>'), true);
});

test('looksLikeFeed lehnt HTML-Seite ab', () => {
  assert.equal(looksLikeFeed('<!DOCTYPE html><html><head><title>Bing</title></head><body></body></html>'), false);
});

test('looksLikeFeed lehnt leeren/Unsinn-Inhalt ab', () => {
  assert.equal(looksLikeFeed(''), false);
  assert.equal(looksLikeFeed(null), false);
  assert.equal(looksLikeFeed('einfach nur text'), false);
});

test('looksLikeFeed erkennt JSON Feed', () => {
  assert.equal(looksLikeFeed('{"version":"https://jsonfeed.org/version/1","items":[]}'), true);
});

test('cleanGoogleNewsTitle entfernt Quellen-Suffix', () => {
  assert.equal(cleanGoogleNewsTitle('Hamlet-Premiere gefeiert - SZ'), 'Hamlet-Premiere gefeiert');
});

test('extractSourceFromGoogleTitle liest Quelle', () => {
  assert.equal(extractSourceFromGoogleTitle('Hamlet-Premiere gefeiert - SZ'), 'SZ');
});

test('buildGoogleNewsUrl kodiert Query', () => {
  const url = buildGoogleNewsUrl('Münchner Kammerspiele');
  assert.ok(url.includes('news.google.com/rss/search'));
  assert.ok(url.includes('M%C3%BCnchner'));
});

test('buildBingNewsUrl kodiert Query', () => {
  const url = buildBingNewsUrl('Kammerspiele');
  assert.ok(url.includes('bing.com/news/search'));
  assert.ok(url.includes('format=rss'));
});
