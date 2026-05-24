'use strict';

const { test, describe } = require('node:test');
const assert = require('assert');
const { RelevanceMatcher } = require('../src/analytics/relevance-matcher');
const { ContentEnricher } = require('../src/analytics/content-enrichment');

const sampleArticle = {
  title: 'Kammerspiele präsentiert: Das Leben ist ein Traum - Premiere',
  fullText: `Die Münchner Kammerspiele haben mit der Premiere von "Das Leben ist ein Traum"
    Theatergeschichte geschrieben. Unter der Regie von Michael Schulz gelang eine innovative
    Inszenierung. Das Ensemble zeigte beeindruckende Leistungen. Die Zuschauer reagierten
    begeistert mit Standing Ovations. Kritiker lobten die subtile Charakterentwicklung und
    die moderne Bühnentechnik. Ein wahrhaft hervorragendes Theaterereignis.`,
  summary: 'Premiere der Kammerspiele mit großem Erfolg',
  source: 'sueddeutsche.de',
  pubDate: new Date().toISOString(),
  author: 'Hans Mueller',
};

const targetArticles = [
  {
    title: 'Interview: Barbara Mundel über ihre Rollen',
    fullText: `Barbara Mundel, Ensemble-Mitglied der Kammerspiele, spricht über ihre Karriere
      und zukünftige Rollen. Sie beschreibt die Arbeit mit Regisseur Michael Schulz als bereichernd.`,
  },
  {
    title: 'Neue Spielzeit: Programmübersicht',
    fullText: `Die Münchner Kammerspiele kündigen ihre neue Spielzeit an. Das Ensemble wird sich
      klassischen und modernen Stücken widmen. Tickets sind ab sofort erhältlich.`,
  },
];

describe('RelevanceMatcher', async () => {
  test('matchExact finds exact substrings', async () => {
    const matcher = new RelevanceMatcher();
    const count = matcher.matchExact('Kammerspiele München', 'Kammerspiele');
    assert.strictEqual(count, 1);
  });

  test('matchExact counts multiple occurrences', async () => {
    const matcher = new RelevanceMatcher();
    const count = matcher.matchExact(
      'Kammerspiele Kammerspiele Kammerspiele',
      'Kammerspiele'
    );
    assert.strictEqual(count, 3);
  });

  test('matchPartial finds word boundaries', async () => {
    const matcher = new RelevanceMatcher();
    const count = matcher.matchPartial('Das Leben ist schoen', 'Leben ist');
    assert.ok(count > 0);
  });

  test('matchContextual finds contextual matches', async () => {
    const matcher = new RelevanceMatcher();
    const result = matcher.matchContextual(sampleArticle.fullText, 'Premiere', ['Kammerspiele']);
    assert.strictEqual(result, 1);
  });

  test('matchSemantic finds semantic relationships', async () => {
    const matcher = new RelevanceMatcher();
    const result = matcher.matchSemantic(sampleArticle.fullText, 'Premiere', [
      'Kammerspiele',
      'Inszenierung',
    ]);
    assert.ok(result > 0);
  });

  test('extractKeywords extracts top keywords', async () => {
    const matcher = new RelevanceMatcher();
    const keywords = matcher.extractKeywords(sampleArticle.fullText, 3, 5);
    assert.ok(keywords.length > 0);
    assert.ok(keywords[0].word);
    assert.ok(keywords[0].frequency >= 1);
  });

  test('findRelated finds related articles', async () => {
    const matcher = new RelevanceMatcher();
    const related = matcher.findRelated(sampleArticle, targetArticles, 1);
    assert.ok(related.length > 0);
    assert.ok(related[0].overlapCount > 0);
  });

  test('calculateQueryRelevance scores queries', async () => {
    const matcher = new RelevanceMatcher();
    const relevance = matcher.calculateQueryRelevance(sampleArticle, 'Kammerspiele premiere');
    assert.ok(relevance.score > 0);
    assert.ok(relevance.matchCount > 0);
  });

  test('matchEntity finds entity mentions', async () => {
    const matcher = new RelevanceMatcher();
    const match = matcher.matchEntity(sampleArticle, 'Kammerspiele', 'production');
    assert.ok(match.score > 0);
    assert.ok(match.mentionCount > 0);
  });

  test('matchEntities finds multiple entities', async () => {
    const matcher = new RelevanceMatcher();
    const matches = matcher.matchEntities(sampleArticle, {
      production: ['Kammerspiele', 'Das Leben ist ein Traum'],
      people: ['Michael Schulz'],
    });
    assert.ok(matches.productions.length > 0);
  });

  test('calculateRelevance combines all scoring', async () => {
    const matcher = new RelevanceMatcher();
    const relevance = matcher.calculateRelevance(sampleArticle, 'Kammerspiele premiere', {
      production: ['Kammerspiele'],
    });
    assert.ok(relevance.totalScore > 0);
    assert.ok(relevance.category);
  });

  test('categorizeRelevance categorizes scores', async () => {
    const matcher = new RelevanceMatcher();
    assert.strictEqual(matcher.categorizeRelevance(150), 'highly_relevant');
    assert.strictEqual(matcher.categorizeRelevance(70), 'relevant');
    assert.strictEqual(matcher.categorizeRelevance(3), 'not_relevant');
  });

  test('matchMultiStrategy uses multiple approaches', async () => {
    const matcher = new RelevanceMatcher();
    const result = matcher.matchMultiStrategy(sampleArticle, 'Kammerspiele', [
      'exact',
      'partial',
    ]);
    assert.ok(result.score > 0);
    assert.ok(result.matches.exact >= 0);
  });
});

describe('ContentEnricher', async () => {
  test('calculateWordCount counts words', async () => {
    const enricher = new ContentEnricher();
    const count = enricher.calculateWordCount('Das ist ein Test mit fünf Wörtern');
    assert.strictEqual(count, 7);
  });

  test('calculateSentenceCount counts sentences', async () => {
    const enricher = new ContentEnricher();
    const count = enricher.calculateSentenceCount('Das ist ein Test. Und hier noch einer!');
    assert.strictEqual(count, 2);
  });

  test('calculateParagraphCount counts paragraphs', async () => {
    const enricher = new ContentEnricher();
    const count = enricher.calculateParagraphCount('Paragraph 1.\n\nParagraph 2.\n\nParagraph 3.');
    assert.strictEqual(count, 3);
  });

  test('estimateReadingTime calculates reading time', async () => {
    const enricher = new ContentEnricher();
    const longText = 'word '.repeat(400); // ~400 words
    const minutes = enricher.estimateReadingTime(longText);
    assert.ok(minutes >= 1 && minutes <= 3);
  });

  test('assessLanguageQuality returns score 1-10', async () => {
    const enricher = new ContentEnricher();
    const score = enricher.assessLanguageQuality(sampleArticle);
    assert.ok(score >= 1 && score <= 10);
  });

  test('assessStructure returns structure score', async () => {
    const enricher = new ContentEnricher();
    const score = enricher.assessStructure(sampleArticle);
    assert.ok(score >= 0 && score <= 10);
  });

  test('detectContentType identifies article types', async () => {
    const enricher = new ContentEnricher();
    const type = enricher.detectContentType(sampleArticle);
    assert.ok(['review', 'interview', 'announcement', 'news', 'feature', 'article'].includes(type));
  });

  test('extractTopics extracts article topics', async () => {
    const enricher = new ContentEnricher();
    const topics = enricher.extractTopics(sampleArticle);
    assert.ok(topics.length > 0);
    assert.ok(topics[0].topic);
    assert.ok(topics[0].relevance > 0);
  });

  test('extractSimpleEntities finds entities', async () => {
    const enricher = new ContentEnricher();
    const entities = enricher.extractSimpleEntities(sampleArticle);
    assert.ok(entities.people || entities.locations || entities.organizations);
  });

  test('generateSummary creates summary', async () => {
    const enricher = new ContentEnricher();
    const summary = enricher.generateSummary(sampleArticle, 2);
    assert.ok(summary.length > 0);
  });

  test('generatePreview creates preview', async () => {
    const enricher = new ContentEnricher();
    const preview = enricher.generatePreview(sampleArticle, 20);
    assert.ok(preview.length > 0);
  });

  test('enrichArticle adds all metadata', async () => {
    const enricher = new ContentEnricher();
    const enriched = enricher.enrichArticle(sampleArticle);
    assert.ok(enriched._metadata);
    assert.ok(enriched._summary);
    assert.ok(enriched._preview);
    assert.ok(enriched._readabilityScore >= 0);
  });

  test('calculateReadability scores readability', async () => {
    const enricher = new ContentEnricher();
    const score = enricher.calculateReadability(sampleArticle);
    assert.ok(score >= 1 && score <= 10);
  });

  test('detectLanguage detects article language', async () => {
    const enricher = new ContentEnricher();
    const lang = enricher.detectLanguage(sampleArticle);
    assert.ok(lang);
  });

  test('isDuplicateContent detects duplicates', async () => {
    const enricher = new ContentEnricher();
    const isDup = enricher.isDuplicateContent(sampleArticle, sampleArticle);
    assert.strictEqual(isDup, true);
  });

  test('isDuplicateContent detects non-duplicates', async () => {
    const enricher = new ContentEnricher();
    const isDup = enricher.isDuplicateContent(sampleArticle, targetArticles[0], 0.95);
    assert.strictEqual(isDup, false);
  });

  test('extractMetadata returns complete metadata', async () => {
    const enricher = new ContentEnricher();
    const metadata = enricher.extractMetadata(sampleArticle);
    assert.ok(metadata.wordCount >= 0);
    assert.ok(metadata.sentenceCount >= 0);
    assert.ok(metadata.paragraphCount >= 0);
    assert.ok(metadata.readingTimeMinutes >= 0);
    assert.ok(metadata.languageQuality);
    assert.ok(metadata.structureQuality);
    assert.ok(metadata.contentType);
    assert.ok(Array.isArray(metadata.keyTopics));
    assert.ok(metadata.entities);
  });
});

describe('Integration - Matching and Enrichment', async () => {
  test('can use matcher and enricher together', async () => {
    const matcher = new RelevanceMatcher();
    const enricher = new ContentEnricher();

    const enriched = enricher.enrichArticle(sampleArticle);
    const relevance = matcher.calculateQueryRelevance(enriched, 'Kammerspiele');

    assert.ok(enriched._metadata);
    assert.ok(relevance.score > 0);
  });

  test('can find and enrich related articles', async () => {
    const matcher = new RelevanceMatcher();
    const enricher = new ContentEnricher();

    const related = matcher.findRelated(sampleArticle, targetArticles);
    const enrichedRelated = related.map((r) => enricher.enrichArticle(r.article));

    assert.ok(enrichedRelated.length > 0);
    assert.ok(enrichedRelated[0]._metadata);
  });
});
