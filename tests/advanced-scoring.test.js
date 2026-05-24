'use strict';

const { test, describe } = require('node:test');
const assert = require('assert');
const { ScoringEngine, createScoringEngine, WEIGHT_PROFILES } = require('../src/analytics/scoring');
const { ArticleWeightingSystem } = require('../src/analytics/weighting');
const { ExtendedSentimentAnalyzer } = require('../src/analytics/sentiment-extended');
const { TemporalAnalyzer } = require('../src/analytics/temporal');

// Sample test articles
const sampleArticles = [
  {
    title: 'Kammerspiele präsentiert: Das Leben ist ein Traum - Premiere mit Standing Ovations',
    fullText: `Die Kammerspiele haben Theatergeschichte geschrieben. Mit der neuesten Inszenierung
      von "Das Leben ist ein Traum" gelang Regisseur Michael Schulz ein Meisterwerk. Die Premiere
      am Freitag wurde vom Publikum begeistert aufgenommen. Barbara Mundel spielte die Hauptrolle
      brillant. Das Ensemble zeigte eine harmonische, kraftvolle Leistung. Kritiker lobten die
      innovative Bühnentechnik und die subtile Charakterentwicklung. Ein wahrhaft hervorragendes
      Theaterereignis, das lange im Gedächtnis bleiben wird.`,
    source: 'sueddeutsche.de',
    pubDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    articleType: 'review',
    author: 'Hans Mueller',
    sentiment: 'positiv',
  },
  {
    title: 'Interview mit Ensemble-Mitglied Marina Schmidt',
    fullText: `Marina Schmidt, langjähriges Mitglied der Kammerspiele, spricht über ihre Erfahrungen
      und zukünftige Pläne. Sie beschreibt die Zusammenarbeit im Ensemble als bereichernd.
      Die nächste Produktion wird in München aufgeführt. Schmidt betont die Wichtigkeit von
      kontinuierlichem Training und Austausch mit Kollegen.`,
    source: 'br.de',
    pubDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    articleType: 'interview',
    author: 'Anna Bauer',
    sentiment: 'positiv',
  },
  {
    title: 'Ankündigung: Neue Produktionen ab Oktober',
    fullText: `Die Kammerspiele kündigen drei neue Produktionen für die kommende Spielzeit an.
      Das Ensemble wird sich klassischen und modernen Stücken widmen. Die Tickets sind ab sofort
      erhältlich. Besucher können sich auf innovative Inszenierungen freuen.`,
    source: 'muenchner-merkur.de',
    pubDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    articleType: 'announcement',
    sentiment: 'neutral',
  },
  {
    title: 'Kammerspiele kuendigen Spielplan an',
    fullText: `Kurzinfo ueber den kommenden Spielplan der Muenchner Kammerspiele.`,
    source: 'kulturseiten.de',
    pubDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    articleType: 'news',
    sentiment: 'neutral',
  },
];

describe('Advanced Scoring System - ScoringEngine', async () => {
  test('creates default scoring engine', async () => {
    const engine = new ScoringEngine();
    assert.ok(engine.weights);
    assert.strictEqual(engine.weights.titleExactMatch, 100);
  });

  test('createScoringEngine loads predefined profiles', async () => {
    const broadProfile = createScoringEngine('BROAD_COVERAGE');
    assert.ok(broadProfile);

    const qualityProfile = createScoringEngine('QUALITY_FIRST');
    assert.ok(qualityProfile);
    assert.strictEqual(qualityProfile.weights.titleExactMatch, 120);
  });

  test('calculates recency bonus correctly', async () => {
    const engine = new ScoringEngine();

    const todayBonus = engine.calculateRecencyBonus(new Date().toISOString());
    assert.strictEqual(todayBonus, 15); // fresh

    const oldDateBonus = engine.calculateRecencyBonus(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()
    );
    assert.strictEqual(oldDateBonus, 0); // old
  });

  test('evaluates source authority', async () => {
    const engine = new ScoringEngine();

    const premiumScore = engine.evaluateSourceAuthority('https://sueddeutsche.de', 'SZ');
    assert.strictEqual(premiumScore, engine.weights.sourceAuthority.premium);

    const unknownScore = engine.evaluateSourceAuthority('https://obscuresite.com', 'Unknown');
    assert.strictEqual(unknownScore, engine.weights.sourceAuthority.reliable);
  });

  test('detects competitive content', async () => {
    const engine = new ScoringEngine();

    const text1 = 'Kammerspiele und Residenztheater treten in künstlerischen Wettbewerb';
    const competitive = engine.detectCompetitiveContent(text1, 'Kammerspiele');
    assert.strictEqual(competitive, 15);

    const text2 = 'Nur Kammerspiele ohne Konkurrenz';
    const notCompetitive = engine.detectCompetitiveContent(text2, 'Kammerspiele');
    assert.strictEqual(notCompetitive, 0);
  });

  test('calculates structural bonus', async () => {
    const engine = new ScoringEngine();

    const article = {
      fullText: `Paragraph 1.

Paragraph 2 mit "direktem Zitat" und Link https://example.com

Paragraph 3 mit weiterer Information.`,
    };

    const bonus = engine.calculateStructuralBonus(article);
    assert.ok(bonus > 0);
    assert.ok(bonus <= 15);
  });

  test('all profiles exist in WEIGHT_PROFILES', async () => {
    assert.ok(WEIGHT_PROFILES.QUALITY_FIRST);
    assert.ok(WEIGHT_PROFILES.BROAD_COVERAGE);
    assert.ok(WEIGHT_PROFILES.REAL_TIME);
    assert.ok(WEIGHT_PROFILES.EVENT_FOCUSED);
    assert.ok(WEIGHT_PROFILES.ARCHIVE);
  });
});

describe('Advanced Scoring System - ExtendedSentimentAnalyzer', async () => {
  test('analyzes sentiment with intensity', async () => {
    const analyzer = new ExtendedSentimentAnalyzer();

    const result = analyzer.analyze(
      'Das ist ein brillant, hervorragendes Meisterwerk der Aufführungskunst!'
    );

    assert.strictEqual(result.label, 'positiv');
    assert.ok(result.intensity > 0);
    assert.ok(result.confidence > 0);
    assert.strictEqual(result.hitCount > 0, true);
  });

  test('detects theater-specific sentiment', async () => {
    const analyzer = new ExtendedSentimentAnalyzer();

    const result = analyzer.analyze(
      'Die Inszenierung war glanzvoll und beeindruckend, das Ensemble brillant!'
    );

    assert.strictEqual(result.label, 'positiv');
    assert.ok(result.summary.positiveMentions > 0);
  });

  test('calculates sentiment intensity levels 0-5', async () => {
    const analyzer = new ExtendedSentimentAnalyzer();

    const weak = analyzer.analyze('etwas gut');
    assert.ok(weak.intensity >= 0 && weak.intensity <= 5);

    const strong = analyzer.analyze(
      'wunderbar, brillant, hervorragend, faszinierend, meisterhaft, genial'
    );
    assert.ok(strong.intensity > weak.intensity);
  });

  test('compares two sentiment texts', async () => {
    const analyzer = new ExtendedSentimentAnalyzer();

    const comparison = analyzer.compareSentiments(
      'Das war mittelmäßig',
      'Das war absolut brillant und hervorragend!'
    );

    assert.ok(comparison.text1);
    assert.ok(comparison.text2);
    assert.ok(comparison.comparison.changeDirection === 'more_positive');
  });

  test('analyzes sentiment arc through paragraphs', async () => {
    const analyzer = new ExtendedSentimentAnalyzer();

    const text = `Anfangs war die Aufführung schwach und enttäuschend.

Doch dann verbesserte sich alles erheblich.

Die zweite Hälfte war wunderbar und inspirierend.`;

    const arc = analyzer.analyzeSentimentArc(text, 3);

    assert.ok(arc);
    assert.strictEqual(arc.sentiments.length, 3);
    assert.ok(arc.arcType === 'improving' || arc.arcType === 'stable' || arc.arcType === 'deteriorating');
  });

  test('extracts impactful sentiment phrases', async () => {
    const analyzer = new ExtendedSentimentAnalyzer();

    const phrases = analyzer.extractSentimentPhrases(
      'Das ist brillant, absolut hervorragend und wirklich wunderbar inszeniert'
    );

    assert.ok(Array.isArray(phrases));
    assert.ok(phrases.length > 0);
    assert.ok(phrases[0].sentiment);
    assert.ok(phrases[0].phrase);
  });
});

describe('Advanced Scoring System - ArticleWeightingSystem', async () => {
  test('calculates article weight', async () => {
    const system = new ArticleWeightingSystem('BROAD_COVERAGE');
    const weight = system.calculateWeight(sampleArticles[0]);

    assert.ok(weight);
    assert.ok(weight.totalScore >= 0);
    assert.ok(weight.adjustedScore >= 0);
    assert.ok(weight.category);
    assert.ok(weight.priority);
    assert.ok(weight.confidence >= 0 && weight.confidence <= 1);
  });

  test('categorizes scores correctly', async () => {
    const system = new ArticleWeightingSystem();

    assert.strictEqual(system.categorizeScore(120), 'excellent');
    assert.strictEqual(system.categorizeScore(80), 'very_good');
    assert.strictEqual(system.categorizeScore(60), 'good');
    assert.strictEqual(system.categorizeScore(40), 'acceptable');
    assert.strictEqual(system.categorizeScore(20), 'marginal');
    assert.strictEqual(system.categorizeScore(5), 'poor');
  });

  test('calculates priority levels', async () => {
    const system = new ArticleWeightingSystem();

    const weight = system.calculateWeight(sampleArticles[0]); // Recent review article
    assert.ok(weight.priority >= 1 && weight.priority <= 5);
  });

  test('provides detailed breakdown', async () => {
    const system = new ArticleWeightingSystem();
    const weight = system.calculateWeight(sampleArticles[0]);

    assert.ok(weight.breakdown);
    assert.ok(weight.breakdown.dataCompleteness);
    assert.ok(weight.breakdown.contentQuality);
    assert.ok(weight.breakdown.sentiment);
    assert.ok(weight.breakdown.bonusBreakdown);
  });

  test('compares multiple articles', async () => {
    const system = new ArticleWeightingSystem();
    const comparison = system.compareArticles(sampleArticles);

    assert.ok(Array.isArray(comparison));
    assert.strictEqual(comparison.length, sampleArticles.length);
    assert.ok(comparison[0].weight.adjustedScore >= comparison[1].weight.adjustedScore);
  });

  test('processes article batch', async () => {
    const system = new ArticleWeightingSystem();
    const batch = system.processArticleBatch(sampleArticles);

    assert.ok(batch.articles);
    assert.ok(batch.summary);
    assert.strictEqual(batch.articles.length, sampleArticles.length);
    assert.ok(batch.summary.averageScore >= 0);
    assert.ok(batch.summary.distribution);
  });

  test('changes profile dynamically', async () => {
    const system = new ArticleWeightingSystem('BROAD_COVERAGE');
    assert.strictEqual(system.profile, 'BROAD_COVERAGE');

    system.setProfile('QUALITY_FIRST');
    assert.strictEqual(system.profile, 'QUALITY_FIRST');

    system.setProfile('EVENT_FOCUSED');
    assert.strictEqual(system.profile, 'EVENT_FOCUSED');
  });

  test('lists available profiles', async () => {
    const system = new ArticleWeightingSystem();
    const profiles = system.getAvailableProfiles();

    assert.ok(profiles.includes('QUALITY_FIRST'));
    assert.ok(profiles.includes('BROAD_COVERAGE'));
    assert.ok(profiles.includes('REAL_TIME'));
  });

  test('calculates score distribution', async () => {
    const system = new ArticleWeightingSystem();
    const distribution = system.getScoreDistribution(sampleArticles);

    assert.ok(distribution.min >= 0);
    assert.ok(distribution.max >= distribution.min);
    assert.ok(distribution.average);
    assert.ok(distribution.median);
    assert.ok(distribution.standardDeviation);
  });
});

describe('Advanced Scoring System - TemporalAnalyzer', async () => {
  test('tracks articles on timeline', async () => {
    const analyzer = new TemporalAnalyzer();

    sampleArticles.forEach((article) => {
      analyzer.addArticle(article, Math.random() * 100);
    });

    assert.strictEqual(analyzer.articleTimeline.length, sampleArticles.length);
  });

  test('registers events', async () => {
    const analyzer = new TemporalAnalyzer();

    analyzer.registerEvent(new Date(), 'Premiere von Stück X', 'premiere');
    analyzer.registerEvent(new Date(), 'Ensemble-Wechsel', 'personnel_change');

    assert.strictEqual(analyzer.eventMarkers.length, 2);
  });

  test('calculates coverage density', async () => {
    const analyzer = new TemporalAnalyzer();

    sampleArticles.forEach((article) => {
      analyzer.addArticle(article, 50);
    });

    const density = analyzer.getCoverageDensity(new Date(), 30);

    assert.ok(density);
    assert.ok(density.totalArticles >= 0);
    assert.ok(density.density >= 0);
  });

  test('analyzes trend over time', async () => {
    const analyzer = new TemporalAnalyzer();

    sampleArticles.forEach((article) => {
      analyzer.addArticle(article, Math.random() * 100);
    });

    const trend = analyzer.analyzeTrend(
      new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      new Date()
    );

    assert.ok(trend);
    assert.ok(trend.trend === 'increasing' || trend.trend === 'decreasing' || trend.trend === 'stable');
  });

  test('calculates article velocity', async () => {
    const analyzer = new TemporalAnalyzer();

    sampleArticles.forEach((article) => {
      analyzer.addArticle(article, 50);
    });

    const velocity = analyzer.calculateVelocity(7);

    assert.ok(velocity);
    assert.ok(velocity.articlesInWindow >= 0);
    assert.ok(velocity.averagePerDay);
  });

  test('analyzes sentiment evolution', async () => {
    const analyzer = new TemporalAnalyzer();

    sampleArticles.forEach((article) => {
      analyzer.addArticle(article, 50);
    });

    const evolution = analyzer.analyzeSentimentEvolution(
      new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      new Date()
    );

    assert.ok(evolution);
    assert.ok(evolution.overallSentiment);
    assert.ok(evolution.dominantSentiment);
  });

  test('detects anomalies in coverage', async () => {
    const analyzer = new TemporalAnalyzer();

    sampleArticles.forEach((article) => {
      analyzer.addArticle(article, 50);
    });

    const anomalies = analyzer.detectAnomalies(30);

    assert.ok(Array.isArray(anomalies));
    // Anomalies array could be empty or contain items
  });

  test('provides timeline summary', async () => {
    const analyzer = new TemporalAnalyzer();

    sampleArticles.forEach((article) => {
      analyzer.addArticle(article, 50);
    });

    const summary = analyzer.getTimelineSummary();

    assert.ok(summary);
    assert.strictEqual(summary.totalArticles, sampleArticles.length);
    assert.ok(summary.dateRange);
  });
});

describe('Integration Tests', async () => {
  test('different profiles produce different weights', async () => {
    const article = sampleArticles[0];

    const broadSystem = new ArticleWeightingSystem('BROAD_COVERAGE');
    const qualitySystem = new ArticleWeightingSystem('QUALITY_FIRST');
    const realtimeSystem = new ArticleWeightingSystem('REAL_TIME');

    const broadWeight = broadSystem.calculateWeight(article);
    const qualityWeight = qualitySystem.calculateWeight(article);
    const realtimeWeight = realtimeSystem.calculateWeight(article);

    // Weights should differ due to different profiles
    assert.ok(
      broadWeight.adjustedScore !== qualityWeight.adjustedScore ||
        qualityWeight.adjustedScore !== realtimeWeight.adjustedScore
    );
  });

  test('full pipeline: sentiment -> weight -> temporal analysis', async () => {
    const analyzer = new ExtendedSentimentAnalyzer();
    const weighting = new ArticleWeightingSystem();
    const temporal = new TemporalAnalyzer();

    sampleArticles.forEach((article) => {
      const sentiment = analyzer.analyze(article.fullText);
      const weight = weighting.calculateWeight(article);
      temporal.addArticle(
        { ...article, sentiment: sentiment.label },
        weight.adjustedScore
      );
    });

    const timeline = temporal.getTimelineSummary();
    assert.strictEqual(timeline.totalArticles, sampleArticles.length);

    const comparison = weighting.compareArticles(sampleArticles);
    assert.ok(comparison.length > 0);
  });
});
