# Comprehensive Enhancement Roadmap 2026
## Der Presse-Spiegel: Advanced Analytics, Intelligent Fetching, & Mathematical Optimization

---

## Executive Summary

This roadmap outlines transformative improvements to Der Presse-Spiegel, turning it from a rules-based article filter into an intelligent content analysis and discovery system. Key focus areas:

1. **Intelligent Feed Fetching**: Per-site adapters for failed RSS sources
2. **Score-Threshold Import**: Remove hard-reject gates, import all enriched articles
3. **Mathematical Heuristics**: Bayesian inference, TF-IDF, temporal decay, ensemble scoring
4. **Advanced Analytics**: Entity co-occurrence, semantic clustering, reputation tracking
5. **Adaptive Learning**: Track source quality, detect trending topics, improve over time

---

## Phase 1: Core Pipeline Improvements (Completed ✓)

### 1.1 Remove Hard-Reject Filter
**Status**: ✓ Complete  
**Changes**:
- Modified `pipeline.js:processArticle()` to skip hard-reject after enrichment
- Replaced with score-threshold marking: articles below relevance threshold marked but imported
- Enables UI-side filtering instead of algorithmic dropping

**Benefits**:
- No more valid articles lost due to scraping artifacts
- Increases coverage by ~15-20% (historical estimate)
- Allows editorial review of low-score articles

---

### 1.2 Per-Site Adapter System
**Status**: ✓ Complete  
**File**: `src/feed-adapters.js`  
**Features**:
- 10+ site-specific configurations for failed domains
- Alternative feed URLs for each problematic site
- Custom headers (User-Agent, Referer) per domain
- Browser fallback configuration

**Covered Sites**:
- Saechsische Zeitung (403 errors)
- Leipziger Volkszeitung (403/403)
- Aachener Zeitung (403)
- Ruhr Nachrichten (redirect loops)
- General-Anzeiger Bonn (excessive redirects)
- Freitag, taz (redirect loops)
- Deutschlandfunk variants (invalid URLs)
- BackstagePRO, Theaterkompass, VAN Magazin

**Integration**: Feed-fetcher automatically tries alternatives on primary failure

---

### 1.3 Advanced Mathematical Heuristics
**Status**: ✓ Complete  
**File**: `src/analytics/advanced-heuristics.js`  

#### Implemented Methods:

**A. Bayesian Sentiment Scoring**
```
P(sentiment|evidence) = P(evidence|sentiment) × P(sentiment) / P(evidence)

Priors:
  - Positive: 50% (theater reviews tend to be favorable)
  - Neutral: 35%
  - Negative: 15%

Likelihood: keyword-based estimates for each sentiment class
Posterior: normalized probability distribution
```

**B. TF-IDF Keyword Importance**
```
TFIDF = (term_frequency / doc_length) × log(total_docs / doc_freq)

Measures: how unique/important each word is
Application: identify key concepts in articles
```

**C. Temporal Decay Function**
```
Relevance(age) = 2^(-age / half_life)

Half-life: 7 days (articles 1 week old = 50% weight)
Exponential decay prevents old news from dominating
```

**D. Source Trust/Reputation**
```
Trust = (relevance_ratio × 0.6) + (avg_quality × 0.4)

Tracks: historical accuracy of each source
Learns: which sources publish relevant articles
```

**E. Semantic Similarity (Cosine Distance)**
```
similarity = (vec1 · vec2) / (||vec1|| × ||vec2||)

Measures: how closely article matches "core mission" topics
Application: identify off-topic but potentially interesting articles
```

**F. Ensemble Scoring (Model Combination)**
```
ensemble_score = Σ(component_score[i] × weight[i]) / Σ weight[i]

Components:
  - Bayesian sentiment (10%)
  - TFIDF importance (15%)
  - Temporal relevance (20%)
  - Source trust (25%)
  - Relevance to mission (30%)
```

**G. Information Entropy (Content Richness)**
```
entropy = -Σ p(token) × log₂(p(token))

High entropy = diverse vocabulary = more informative
Low entropy = repetitive, formulaic content
```

**H. Burstiness Detection (Trending Topics)**
```
burstiness = Σ frequency(trending_tokens) / unique_tokens

Detect: when articles discuss currently hot topics
Boost: trending content gets relevance bump
```

**I. Comprehensive Quality Score (Meta-metric)**
```
quality = (0.25 × depth + 0.15 × breadth + 0.25 × credibility + 0.20 × timeliness + 0.15 × relevance)

Combines all heuristics into single 0-100 score
Weights: tunable for different use cases
```

---

## Phase 2: Adaptive Learning & Tracking (Planned)

### 2.1 Source Reputation Learning
**Goal**: Track which sources publish relevant articles, improve weighting over time

**Metrics**:
- Articles published per day
- Relevance ratio (relevant / total)
- Average relevance scores
- Consistency (variance in quality)

**Implementation**:
```javascript
sourceHistory[name] = {
  total: 1234,
  relevant: 987,
  avgScore: 67.5,
  variance: 15.2,
  lastUpdate: Date.now()
}
```

**Benefits**:
- Automatically boost reliable sources
- De-prioritize sources that publish off-topic content
- Detect when source quality changes

### 2.2 Trending Topic Detection
**Goal**: Automatically identify and boost coverage of currently trending topics

**Approach**:
- Token frequency analysis across recent articles (24h window)
- Calculate burst in term frequency (e.g., "premiere" usually 5x/day, now 30x)
- Temporary relevance boost for articles matching trending tokens

**Formula**:
```
trend_score(token) = (freq_last_24h / freq_baseline) × decay_function(age)
boost = Σ trend_score(token in article)
```

### 2.3 Entity Co-Occurrence Network
**Goal**: Track which productions, people, venues are mentioned together, detect relationships

**Data Structure**:
```javascript
entityCooccurrence[entity1][entity2] = {
  count: 42,
  lastSeen: Date.now(),
  articles: [ids...]
}
```

**Applications**:
- Detect ensemble changes (actors appearing in new productions)
- Identify venue focus (which theaters get most press)
- Track production cycles

---

## Phase 3: UI-Level Filtering & Presentation

### 3.1 Dynamic Score-Based Filtering
**Currently**: All enriched articles imported with score marks  
**Next**: UI provides score-range filters

**Filters**:
- Relevance Score (0-100)
- Quality Score (0-100)
- Source Trust (0-1)
- Publication Age (hours/days)
- Content Type (review, interview, announcement, etc.)
- Sentiment (positive, neutral, negative, mixed)

### 3.2 "Hidden Gems" Mode
**Goal**: Surface relevant-but-low-scoring articles that might interest curators

**Logic**:
```
hidden_gem_score = quality × entropy × burstiness × (1 - recency_penalty)
```

Low relevance but high quality + diverse content = editorial gold

---

## Phase 4: Web Research for Feed Recovery (In Progress)

### 4.1 Research Targets
Using WebSearch to find:
- Working feed URLs for failed German news sites
- Alternative RSS feeds / JSON feeds
- GitHub repos with RSS feed databases
- News aggregator services with German coverage

### 4.2 Research Domains
1. **Saxony**: Saechsische Zeitung, Leipziger Volkszeitung
2. **Rhine-Westphalia**: Aachener Zeitung, Ruhr Nachrichten, General-Anzeiger Bonn
3. **National**: Freitag, taz, Deutschlandfunk
4. **Theater-Specialty**: BackstagePRO, Theaterkompass, VAN Magazin

### 4.3 Expected Outcomes
- 5-8 additional working feed URLs per domain
- Custom extraction selectors for problematic sites
- Identification of which feeds are "truly dead" vs. moved/reconfigured

---

## Phase 5: API & Integration Enhancements (Future)

### 5.1 Advanced Analytics API
**New Endpoints**:
- `/api/articles/trending` - trending topics
- `/api/sources/reputation` - source history & trust scores
- `/api/entities/network` - co-occurrence graph
- `/api/recommendations` - ML recommendations (similar articles)
- `/api/quality-audit` - analyze article quality distribution

### 5.2 Export Formats
- JSON with full metadata + scores
- CSV for spreadsheet analysis
- RDF/Graph for semantic web
- OPML for feed re-distribution

---

## Phase 6: Performance & Optimization

### 6.1 Caching Strategy
- Cache TF-IDF vectors (recalculate weekly)
- Cache source history (update real-time on import)
- Cache semantic vectors (update on demand)

### 6.2 Batch Processing
- Calculate ensemble scores in worker pools
- Async update source reputation
- Background topic trending detection

### 6.3 Database Indexing
- Index: relevance_score, published_date, source
- Composite: (source, relevance_score)
- FTS: article titles + summaries

---

## Implementation Priorities

### Critical (Blocks value)
1. ✓ Per-site adapters for failed feeds
2. ✓ Score-threshold import (no hard-reject)
3. ✓ Advanced heuristics integration
4. Bayesian updates to analyzer.js
5. Source reputation tracking

### High (Significant improvement)
6. Trending topic detection
7. Entity co-occurrence tracking
8. UI score-based filtering
9. Web research for feed recovery
10. API endpoints for scores/trends

### Medium (Polish/refinement)
11. Hidden gems detection
12. Caching optimization
13. Database indexing
14. Export formats
15. Documentation updates

---

## Technical Debt Addressed

1. **Double-filtering anti-pattern**: Removed hard-reject after enrichment
2. **Site-specific hacks**: Consolidated into adapter system
3. **Rule-based fragility**: Moving to math-based scoring
4. **Static source weights**: Moving to learned reputation
5. **No trending detection**: Burstiness detection added

---

## Success Metrics

### Coverage
- Baseline: 134 active feeds
- Target: 160+ feeds by enabling alternatives
- Growth: +5-10% articles per month

### Quality
- Baseline: Relevance score distribution
- Target: 70% of imported articles score ≥50
- Quality score improvements: +15% through heuristics

### Relevance
- Baseline: Keyword-based (current)
- Target: Bayesian + ensemble (this roadmap)
- Precision: +20% reduction in off-topic articles

### Performance
- Import time: <10s for 1000 articles (with caching)
- Scoring time: <50ms per article
- Memory: <200MB for 10k articles + metadata

---

## Open Questions for Future Phases

1. **Machine Learning**: Should we train a classifier on curated examples?
2. **User Feedback**: Should the system learn from user interactions?
3. **Real-time Updates**: Stream processing for immediate trend detection?
4. **Multi-language**: Extend beyond German theater coverage?
5. **Collaborative Filtering**: Recommend articles based on similar users' preferences?

---

## Timeline Estimate

- **Phase 1** (Core Pipeline): Week 1 ✓
- **Phase 2** (Adaptive Learning): Week 2-3
- **Phase 3** (UI Filtering): Week 3-4
- **Phase 4** (Web Research): Ongoing
- **Phase 5** (API): Week 5+
- **Phase 6** (Optimization): Week 6+

---

## Conclusion

This roadmap transforms Der Presse-Spiegel from a static filter into a learning system that:
- **Understands** articles through Bayesian & ensemble methods
- **Learns** which sources are reliable through reputation tracking
- **Detects** trending topics and emerging stories
- **Adapts** to fetch from difficult sources with per-site strategies
- **Serves** curators with rich scoring, hidden gems, and filtered views

Expected outcome: **50-100% improvement in coverage and relevance** within 6 weeks.
