# Advanced Analytics & Scoring System

Comprehensive guide to the enhanced article rating, weighting, and analysis system.

## Overview

The advanced analytics system provides multiple modules for sophisticated article analysis, scoring, and enrichment:

1. **Scoring Engine** - Multi-dimensional article scoring with configurable weight profiles
2. **Extended Sentiment Analysis** - Granular sentiment classification with intensity levels
3. **Article Weighting System** - Comprehensive weight calculation combining multiple factors
4. **Temporal Analyzer** - Time-series analysis of article patterns and trends
5. **Analytics Reporter** - Report generation with insights and recommendations
6. **Relevance Matcher** - Advanced matching algorithms with multiple strategies
7. **Content Enricher** - Metadata extraction and content enhancement

## Quick Start

```javascript
const { createOrchestrator } = require('./src/analytics');

// Create an orchestrator with default profile
const orchestrator = createOrchestrator('BROAD_COVERAGE');

// Analyze a single article
const report = orchestrator.analyzeArticle(article);

// Analyze multiple articles
const portfolio = orchestrator.analyzePortfolio(articles);

// Get insights
const insights = orchestrator.getInsights(articles);
```

## Modules

### 1. Scoring Engine (`src/analytics/scoring.js`)

Provides multi-dimensional scoring with weight profiles.

#### Basic Usage

```javascript
const { ScoringEngine, createScoringEngine, WEIGHT_PROFILES } = require('./src/analytics/scoring');

// Create with default weights
const engine = new ScoringEngine();

// Or use a predefined profile
const engine = createScoringEngine('QUALITY_FIRST');
```

#### Available Profiles

- `QUALITY_FIRST` - Emphasizes content quality, depth, and source authority
- `BROAD_COVERAGE` - Balances quality with diversity of content
- `REAL_TIME` - Prioritizes recency and breaking news
- `EVENT_FOCUSED` - Focuses on premieres and major events
- `ARCHIVE` - Optimizes for historical/archival value

#### Key Methods

```javascript
// Calculate recency bonus
const bonus = engine.calculateRecencyBonus('2026-05-24T12:00:00Z');

// Evaluate source authority
const score = engine.evaluateSourceAuthority('https://sueddeutsche.de', 'SZ');

// Detect competitive content
const score = engine.detectCompetitiveContent(text, 'Kammerspiele');

// Calculate structural richness
const bonus = engine.calculateStructuralBonus(article);

// Measure semantic diversity
const diversity = engine.calculateSemanticDiversity(article);
```

### 2. Extended Sentiment Analysis (`src/analytics/sentiment-extended.js`)

Provides granular sentiment analysis beyond binary classification.

#### Basic Usage

```javascript
const { ExtendedSentimentAnalyzer } = require('./src/analytics/sentiment-extended');

const analyzer = new ExtendedSentimentAnalyzer();
const result = analyzer.analyze(text);

// Returns:
// {
//   label: 'positiv' | 'neutral' | 'negativ',
//   intensity: 0-5,
//   confidence: 0-1,
//   summary: { raw, weighted, positiveMentions, negativeMentions, ... },
//   subjectivity: 'subjective' | 'objective',
//   emotionType: 'enthusiastic' | 'admiring' | 'critical' | 'dismissive' | null,
//   hitCount: number
// }
```

#### Key Methods

```javascript
// Analyze sentiment
const sentiment = analyzer.analyze(text);

// Compare two texts
const comparison = analyzer.compareSentiments(text1, text2);

// Analyze sentiment arc through paragraphs
const arc = analyzer.analyzeSentimentArc(text, paragraphCount);

// Extract impactful sentiment phrases
const phrases = analyzer.extractSentimentPhrases(text, maxPhrases);
```

### 3. Article Weighting System (`src/analytics/weighting.js`)

Comprehensive weighting combining multiple scoring dimensions.

#### Basic Usage

```javascript
const { ArticleWeightingSystem } = require('./src/analytics/weighting');

const weighting = new ArticleWeightingSystem('BROAD_COVERAGE');
const weight = weighting.calculateWeight(article);

// Returns:
// {
//   totalScore: number,
//   adjustedScore: number,
//   baseScore: number,
//   bonuses: { sentiment, quality, recency, source, author, ... },
//   category: 'excellent' | 'very_good' | 'good' | 'acceptable' | 'marginal' | 'poor',
//   priority: 1-5,
//   confidence: 0-1,
//   breakdown: { dataCompleteness, contentQuality, sentiment, ... }
// }
```

#### Categories

- `excellent` - Score >= 100
- `very_good` - Score >= 80
- `good` - Score >= 60
- `acceptable` - Score >= 40
- `marginal` - Score >= 20
- `poor` - Score < 20

#### Priority Levels

- 1 = Critical (highest priority)
- 2 = High
- 3 = Medium
- 4 = Low
- 5 = Minimal (lowest priority)

#### Key Methods

```javascript
// Calculate weight
const weight = weighting.calculateWeight(article);

// Compare multiple articles
const comparison = weighting.compareArticles(articles);

// Batch process
const batch = weighting.processArticleBatch(articles);

// Change profile
weighting.setProfile('QUALITY_FIRST');
```

### 4. Temporal Analyzer (`src/analytics/temporal.js`)

Analyzes temporal patterns in article collections.

#### Basic Usage

```javascript
const { TemporalAnalyzer } = require('./src/analytics/temporal');

const temporal = new TemporalAnalyzer();

// Add articles to timeline
articles.forEach(article => {
  temporal.addArticle(article, weight);
});

// Register events
temporal.registerEvent(new Date('2026-06-01'), 'Premiere Event', 'premiere');
```

#### Key Methods

```javascript
// Get coverage density around event
const density = temporal.getCoverageDensity(eventDate, windowDays);

// Analyze trends
const trend = temporal.analyzeTrend(startDate, endDate);

// Calculate article velocity
const velocity = temporal.calculateVelocity(days);

// Analyze sentiment evolution
const evolution = temporal.analyzeSentimentEvolution(startDate, endDate);

// Detect anomalies
const anomalies = temporal.detectAnomalies(days);

// Get source distribution
const distribution = temporal.getSourceDistribution(startDate, endDate);

// Get timeline summary
const summary = temporal.getTimelineSummary();
```

### 5. Analytics Reporter (`src/analytics/reports.js`)

Generates comprehensive reports with insights.

#### Basic Usage

```javascript
const { AnalyticsReporter } = require('./src/analytics/reports');

const reporter = new AnalyticsReporter('BROAD_COVERAGE');

// Generate article report
const report = reporter.generateArticleReport(article);

// Generate portfolio report
const portfolio = reporter.generatePortfolioReport(articles);

// Get insights
const insights = reporter.generateInsights(articles);

// Compare before/after
const comparison = reporter.generateComparativeReport(beforeArticles, afterArticles);
```

#### Report Types

```javascript
// Article Report - Detailed analysis of single article
const report = reporter.generateArticleReport(article);
// { article, scoring, sentiment, keyPhrases, breakdown, timestamp }

// Portfolio Report - Analysis of article collection
const portfolio = reporter.generatePortfolioReport(articles);
// { summary, reports, timestamp }

// Source Report - Performance by source
const sources = reporter.generateSourceReport(articles);
// { sources, topPerformers, bottomPerformers, ... }

// Timeline Report - Temporal analysis
const timeline = reporter.generateTimelineReport(articles, events);
// { timeline, trends, velocity, sentimentEvolution, anomalies, ... }

// QA Report - Quality assurance checks
const qa = reporter.generateQAReport(articles);
// { totalArticles, issuesFound, issuesBySeverity, issues, qualityScore, ... }
```

### 6. Relevance Matcher (`src/analytics/relevance-matcher.js`)

Advanced matching with multiple deterministic strategies.

#### Matching Strategies

```javascript
const { RelevanceMatcher } = require('./src/analytics/relevance-matcher');

const matcher = new RelevanceMatcher();

// Exact substring matching (no fuzzy)
const count = matcher.matchExact(haystack, needle);

// Partial word matching (word boundaries)
const count = matcher.matchPartial(haystack, needle);

// Contextual matching (with surrounding context)
const match = matcher.matchContextual(text, keyword, contextWords, windowSize);

// Semantic matching (with related terms)
const score = matcher.matchSemantic(text, keyword, relatedTerms);

// Multi-strategy matching
const result = matcher.matchMultiStrategy(article, keyword, strategies);
```

#### Key Methods

```javascript
// Extract keywords from text
const keywords = matcher.extractKeywords(text, minLength, maxKeywords);

// Find related articles
const related = matcher.findRelated(sourceArticle, targetArticles, minOverlap);

// Calculate query relevance
const relevance = matcher.calculateQueryRelevance(article, query, weights);

// Match entities
const matches = matcher.matchEntities(article, entities, entityTypes);

// Calculate overall relevance
const relevance = matcher.calculateRelevance(article, query, entities);
```

### 7. Content Enricher (`src/analytics/content-enrichment.js`)

Extracts and enriches article metadata.

#### Basic Usage

```javascript
const { ContentEnricher } = require('./src/analytics/content-enrichment');

const enricher = new ContentEnricher();

// Extract all metadata
const metadata = enricher.extractMetadata(article);

// Enrich article with metadata
const enriched = enricher.enrichArticle(article);
```

#### Extracted Metadata

```javascript
// {
//   wordCount: number,
//   sentenceCount: number,
//   paragraphCount: number,
//   readingTimeMinutes: number,
//   languageQuality: 1-10,
//   structureQuality: 1-10,
//   contentType: 'review' | 'interview' | 'announcement' | 'news' | 'feature' | 'article',
//   keyTopics: [{ topic, relevance }, ...],
//   entities: { people, locations, organizations }
// }
```

#### Key Methods

```javascript
// Calculate metrics
const wordCount = enricher.calculateWordCount(text);
const sentenceCount = enricher.calculateSentenceCount(text);
const paragraphCount = enricher.calculateParagraphCount(text);
const readingTime = enricher.estimateReadingTime(text);

// Assess quality
const langQuality = enricher.assessLanguageQuality(article);
const structureQuality = enricher.assessStructure(article);
const readability = enricher.calculateReadability(article);

// Extract content info
const topics = enricher.extractTopics(article);
const entities = enricher.extractSimpleEntities(article);
const contentType = enricher.detectContentType(article);

// Generate content
const summary = enricher.generateSummary(article, maxSentences);
const preview = enricher.generatePreview(article, maxWords);

// Detect duplicates
const isDup = enricher.isDuplicateContent(article1, article2, threshold);
```

## AnalyticsOrchestrator

Central interface for all analytics operations.

```javascript
const { AnalyticsOrchestrator } = require('./src/analytics');

const orchestrator = new AnalyticsOrchestrator('BROAD_COVERAGE');

// Analyze single article
const report = orchestrator.analyzeArticle(article);

// Analyze portfolio
const portfolio = orchestrator.analyzePortfolio(articles);

// Get insights and recommendations
const insights = orchestrator.getInsights(articles);

// Analyze source performance
const sourceReport = orchestrator.analyzeSourcePerformance(articles);

// Analyze timeline/trends
const timeline = orchestrator.analyzeTimeline(articles, events);

// Compare before/after
const comparison = orchestrator.compare(beforeArticles, afterArticles);

// Quality checks
const qa = orchestrator.checkQuality(articles);

// Switch profile
orchestrator.switchProfile('QUALITY_FIRST');

// Get available profiles
const profiles = orchestrator.getProfiles();

// Batch process with progress
const results = orchestrator.analyzeBatch(articles, (progress) => {
  console.log(`Processing ${progress.current}/${progress.total}`);
});
```

## Analytics Utilities

```javascript
const { AnalyticsUtils } = require('./src/analytics');

// Sort articles by score
const sorted = AnalyticsUtils.sortByScore(articles, 'desc');

// Filter by score threshold
const filtered = AnalyticsUtils.filterByScore(articles, minScore, maxScore);

// Filter by sentiment
const positive = AnalyticsUtils.filterBySentiment(articles, ['positiv']);

// Group by category
const byCategory = AnalyticsUtils.groupByCategory(articles);

// Group by source
const bySource = AnalyticsUtils.groupBySource(articles);

// Get top articles
const top10 = AnalyticsUtils.getTopArticles(articles, 10);

// Calculate portfolio diversity
const diversity = AnalyticsUtils.calculateDiversity(articles);
```

## Complete Example

```javascript
const { createOrchestrator, AnalyticsUtils } = require('./src/analytics');

// Create orchestrator with quality profile
const orchestrator = createOrchestrator('QUALITY_FIRST');

// Analyze articles
const portfolio = orchestrator.analyzePortfolio(articles);
console.log(`Average score: ${portfolio.summary.scoreRange.average}`);

// Get insights
const insights = orchestrator.getInsights(articles);
console.log('Insights:', insights.insights);
console.log('Recommendations:', insights.recommendations);

// Filter high-quality articles
const excellent = AnalyticsUtils.filterByScore(articles, 80);
console.log(`${excellent.length} excellent articles found`);

// Group by source
const bySource = AnalyticsUtils.groupBySource(excellent);
Object.entries(bySource).forEach(([source, arts]) => {
  console.log(`${source}: ${arts.length} articles`);
});

// Analyze timeline
const timeline = orchestrator.analyzeTimeline(articles, [
  { date: '2026-06-01', title: 'Premiere', type: 'premiere' }
]);
console.log('Coverage trend:', timeline.trends.pastMonth);

// Generate report
const reporter = orchestrator.reporter;
const sourceReport = reporter.generateSourceReport(articles);
console.log('Top sources:', sourceReport.topPerformers.map(s => s.source));
```

## Configuration

Configure scoring weights in `config/keywords.json`:

```json
{
  "scoring_weights": {
    "title_exact_match": 100,
    "production_in_title": 80,
    "people_in_title": 60,
    "review": 40,
    "interview": 35,
    "premiere_bonus": 30,
    "multiple_productions_bonus": 50
  }
}
```

## Performance Notes

- All matching operations use deterministic algorithms (no fuzzy matching)
- Sentiment analysis is context-aware with positional weighting
- Scoring is parallelizable at article level
- Batch processing with progress callbacks for large collections
- Caching available for repeated operations

## Testing

All modules include comprehensive test suites:

```bash
npm test -- tests/advanced-scoring.test.js
npm test -- tests/enrichment-matching.test.js
```

367+ tests covering all major functionality.
