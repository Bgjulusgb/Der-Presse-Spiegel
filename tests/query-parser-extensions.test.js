'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { parseQuery, articleMatchesStructured } = require('../src/query-parser');

function makeArticle(props = {}) {
  return {
    id: 1,
    title: 'Test',
    full_text: '',
    summary: '',
    tags: [],
    word_count: 0,
    language: 'de',
    has_image: false,
    paywall: false,
    bookmarked: false,
    relevance_score: 50,
    article_type: 'news',
    ...props
  };
}

test('words: Filter > 500', () => {
  const q = parseQuery('words:>500');
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 600 }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 100 }), q), false);
});

test('words: Filter <=', () => {
  const q = parseQuery('words:<=100');
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 80 }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 200 }), q), false);
});

test('reading: Filter <=5 Minuten', () => {
  const q = parseQuery('reading:<=5');
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 800 }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 2000 }), q), false);
});

test('lang: de matched', () => {
  const q = parseQuery('lang:de');
  assert.equal(articleMatchesStructured(makeArticle({ language: 'de' }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ language: 'en' }), q), false);
});

test('image: yes matched bei has_image', () => {
  const q = parseQuery('image:yes');
  assert.equal(articleMatchesStructured(makeArticle({ has_image: true }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ has_image: false }), q), false);
});

test('tagnot: Ausschluss', () => {
  const q = parseQuery('tagnot:spam');
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['kultur'] }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['kultur', 'spam'] }), q), false);
});

test('tag mit tagmode:all benoetigt alle', () => {
  const q = parseQuery('tag:a tag:b tagmode:all');
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['a', 'b'] }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['a'] }), q), false);
});

test('tag mit tagmode:any reicht einer', () => {
  const q = parseQuery('tag:a tag:b tagmode:any');
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['a'] }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['c'] }), q), false);
});

test('tag mit tagmode:none schliesst aus', () => {
  const q = parseQuery('tag:a tag:b tagmode:none');
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['c'] }), q), true);
  assert.equal(articleMatchesStructured(makeArticle({ tags: ['a'] }), q), false);
});

test('FIELD_ALIASES: language -> lang', () => {
  const q = parseQuery('language:en');
  assert.equal(articleMatchesStructured(makeArticle({ language: 'en' }), q), true);
});

test('FIELD_ALIASES: wordcount -> words', () => {
  const q = parseQuery('wordcount:>=100');
  assert.equal(articleMatchesStructured(makeArticle({ word_count: 200 }), q), true);
});
