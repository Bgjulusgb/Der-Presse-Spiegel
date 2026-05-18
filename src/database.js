'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const logger = require('./logger');
const { settings } = require('./config');
const { safeJsonParse } = require('./utils');

const dbPath = path.resolve(settings.database.path);
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      url_normalized TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      source TEXT,
      author TEXT,
      published_date DATETIME,
      found_date DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      full_text TEXT,
      first_paragraph TEXT,
      summary TEXT,
      word_count INTEGER DEFAULT 0,
      relevance_score INTEGER DEFAULT 0,
      sentiment TEXT,
      sentiment_score INTEGER DEFAULT 0,
      category TEXT,
      article_type TEXT,
      paywall INTEGER DEFAULT 0,
      duplicate_of INTEGER REFERENCES articles(id) ON DELETE SET NULL,
      also_on TEXT,
      deleted_at DATETIME,
      meta TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_published_date ON articles(published_date);
    CREATE INDEX IF NOT EXISTS idx_relevance ON articles(relevance_score);
    CREATE INDEX IF NOT EXISTS idx_source ON articles(source);
    CREATE INDEX IF NOT EXISTS idx_duplicate_of ON articles(duplicate_of);
    CREATE INDEX IF NOT EXISTS idx_url_normalized ON articles(url_normalized);

    CREATE TABLE IF NOT EXISTS scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      finished_at DATETIME,
      from_date DATETIME,
      to_date DATETIME,
      sources_scanned INTEGER DEFAULT 0,
      articles_found INTEGER DEFAULT 0,
      articles_added INTEGER DEFAULT 0,
      duplicates_found INTEGER DEFAULT 0,
      errors INTEGER DEFAULT 0,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS source_health (
      source TEXT PRIMARY KEY,
      last_success DATETIME,
      last_failure DATETIME,
      consecutive_failures INTEGER DEFAULT 0,
      last_error TEXT
    );
  `);
}

migrate();
logger.debug('Datenbank initialisiert', { path: dbPath });

const stmts = {
  insertArticle: db.prepare(`
    INSERT INTO articles (
      url, url_normalized, title, source, author, published_date,
      full_text, first_paragraph, summary, word_count,
      relevance_score, sentiment, sentiment_score, category,
      article_type, paywall, also_on, meta
    ) VALUES (
      @url, @url_normalized, @title, @source, @author, @published_date,
      @full_text, @first_paragraph, @summary, @word_count,
      @relevance_score, @sentiment, @sentiment_score, @category,
      @article_type, @paywall, @also_on, @meta
    )
  `),
  findByNormalizedUrl: db.prepare('SELECT * FROM articles WHERE url_normalized = ?'),
  findById: db.prepare('SELECT * FROM articles WHERE id = ?'),
  markDuplicate: db.prepare(`
    UPDATE articles SET duplicate_of = @duplicate_of, also_on = @also_on
    WHERE id = @id
  `),
  appendAlsoOn: db.prepare(`
    UPDATE articles SET also_on = @also_on WHERE id = @id
  `),
  byDateRange: db.prepare(`
    SELECT * FROM articles
    WHERE published_date >= @from AND published_date <= @to
      AND duplicate_of IS NULL
      AND deleted_at IS NULL
    ORDER BY relevance_score DESC, published_date DESC
  `),
  byDateRangeAll: db.prepare(`
    SELECT * FROM articles
    WHERE published_date >= @from AND published_date <= @to
      AND deleted_at IS NULL
    ORDER BY published_date DESC
  `),
  recentForDedup: db.prepare(`
    SELECT id, url_normalized, title, first_paragraph, source, published_date
    FROM articles
    WHERE published_date >= @from
      AND duplicate_of IS NULL
      AND deleted_at IS NULL
  `),
  highRelevanceSince: db.prepare(`
    SELECT * FROM articles
    WHERE relevance_score >= @threshold
      AND found_date >= @since
      AND duplicate_of IS NULL
      AND deleted_at IS NULL
    ORDER BY relevance_score DESC
  `),
  stats: db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN duplicate_of IS NULL THEN 1 ELSE 0 END) AS unique_articles,
      SUM(CASE WHEN duplicate_of IS NOT NULL THEN 1 ELSE 0 END) AS duplicates,
      SUM(CASE WHEN sentiment = 'positiv' THEN 1 ELSE 0 END) AS positive,
      SUM(CASE WHEN sentiment = 'negativ' THEN 1 ELSE 0 END) AS negative,
      SUM(CASE WHEN sentiment = 'neutral' THEN 1 ELSE 0 END) AS neutral,
      SUM(CASE WHEN paywall = 1 THEN 1 ELSE 0 END) AS paywalled
    FROM articles
    WHERE published_date >= @from AND published_date <= @to
      AND deleted_at IS NULL
  `),
  bySource: db.prepare(`
    SELECT source, COUNT(*) as count
    FROM articles
    WHERE published_date >= @from AND published_date <= @to
      AND duplicate_of IS NULL AND deleted_at IS NULL
    GROUP BY source
    ORDER BY count DESC
  `),
  insertScanRun: db.prepare(`
    INSERT INTO scan_runs (from_date, to_date) VALUES (@from, @to)
  `),
  finishScanRun: db.prepare(`
    UPDATE scan_runs
    SET finished_at = CURRENT_TIMESTAMP,
        sources_scanned = @sources_scanned,
        articles_found = @articles_found,
        articles_added = @articles_added,
        duplicates_found = @duplicates_found,
        errors = @errors,
        notes = @notes
    WHERE id = @id
  `),
  upsertHealthSuccess: db.prepare(`
    INSERT INTO source_health (source, last_success, consecutive_failures)
    VALUES (@source, CURRENT_TIMESTAMP, 0)
    ON CONFLICT(source) DO UPDATE SET
      last_success = CURRENT_TIMESTAMP,
      consecutive_failures = 0,
      last_error = NULL
  `),
  upsertHealthFailure: db.prepare(`
    INSERT INTO source_health (source, last_failure, consecutive_failures, last_error)
    VALUES (@source, CURRENT_TIMESTAMP, 1, @error)
    ON CONFLICT(source) DO UPDATE SET
      last_failure = CURRENT_TIMESTAMP,
      consecutive_failures = consecutive_failures + 1,
      last_error = @error
  `),
  healthAll: db.prepare('SELECT * FROM source_health ORDER BY source')
};

function insertArticle(article) {
  const row = {
    url: article.url,
    url_normalized: article.urlNormalized,
    title: article.title,
    source: article.source || null,
    author: article.author || null,
    published_date: article.publishedDate ? article.publishedDate.toISOString() : null,
    full_text: article.fullText || null,
    first_paragraph: article.firstParagraph || null,
    summary: article.summary || null,
    word_count: article.wordCount || 0,
    relevance_score: article.relevanceScore || 0,
    sentiment: article.sentiment || null,
    sentiment_score: article.sentimentScore || 0,
    category: article.category || null,
    article_type: article.articleType || null,
    paywall: article.paywall ? 1 : 0,
    also_on: article.alsoOn ? JSON.stringify(article.alsoOn) : null,
    meta: article.meta ? JSON.stringify(article.meta) : null
  };
  try {
    const result = stmts.insertArticle.run(row);
    return { id: result.lastInsertRowid, inserted: true };
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      const existing = stmts.findByNormalizedUrl.get(article.urlNormalized);
      return { id: existing.id, inserted: false };
    }
    throw err;
  }
}

function markAsDuplicate(articleId, originalId, additionalUrl) {
  const original = stmts.findById.get(originalId);
  const existing = safeJsonParse(original.also_on, []) || [];
  if (additionalUrl && !existing.includes(additionalUrl)) {
    existing.push(additionalUrl);
  }
  stmts.appendAlsoOn.run({ id: originalId, also_on: JSON.stringify(existing) });
  stmts.markDuplicate.run({
    id: articleId,
    duplicate_of: originalId,
    also_on: null
  });
}

function findByNormalizedUrl(urlNormalized) {
  return stmts.findByNormalizedUrl.get(urlNormalized);
}

function getArticlesByRange(from, to, { includeDuplicates = false } = {}) {
  const params = { from: from.toISOString(), to: to.toISOString() };
  const stmt = includeDuplicates ? stmts.byDateRangeAll : stmts.byDateRange;
  return stmt.all(params).map(parseArticleRow);
}

function getRecentForDedup(fromDate) {
  return stmts.recentForDedup.all({ from: fromDate.toISOString() });
}

function getHighRelevanceSince(threshold, since) {
  return stmts.highRelevanceSince
    .all({ threshold, since: since.toISOString() })
    .map(parseArticleRow);
}

function getStats(from, to) {
  const range = { from: from.toISOString(), to: to.toISOString() };
  const raw = stmts.stats.get(range);
  const overview = {
    total: raw.total || 0,
    unique_articles: raw.unique_articles || 0,
    duplicates: raw.duplicates || 0,
    positive: raw.positive || 0,
    negative: raw.negative || 0,
    neutral: raw.neutral || 0,
    paywalled: raw.paywalled || 0
  };
  return {
    overview,
    bySource: stmts.bySource.all(range)
  };
}

function startScanRun(from, to) {
  const result = stmts.insertScanRun.run({
    from: from.toISOString(),
    to: to.toISOString()
  });
  return result.lastInsertRowid;
}

function finishScanRun(id, summary) {
  stmts.finishScanRun.run({
    id,
    sources_scanned: summary.sourcesScanned || 0,
    articles_found: summary.articlesFound || 0,
    articles_added: summary.articlesAdded || 0,
    duplicates_found: summary.duplicatesFound || 0,
    errors: summary.errors || 0,
    notes: summary.notes || null
  });
}

function recordSourceSuccess(source) {
  stmts.upsertHealthSuccess.run({ source });
}

function recordSourceFailure(source, error) {
  stmts.upsertHealthFailure.run({ source, error: String(error).slice(0, 500) });
}

function getSourceHealth() {
  return stmts.healthAll.all();
}

function parseArticleRow(row) {
  if (!row) return null;
  return {
    ...row,
    also_on: safeJsonParse(row.also_on, []),
    meta: safeJsonParse(row.meta, {}),
    paywall: !!row.paywall
  };
}

function transaction(fn) {
  return db.transaction(fn);
}

function close() {
  db.close();
}

module.exports = {
  db,
  insertArticle,
  markAsDuplicate,
  findByNormalizedUrl,
  getArticlesByRange,
  getRecentForDedup,
  getHighRelevanceSince,
  getStats,
  startScanRun,
  finishScanRun,
  recordSourceSuccess,
  recordSourceFailure,
  getSourceHealth,
  transaction,
  close
};
