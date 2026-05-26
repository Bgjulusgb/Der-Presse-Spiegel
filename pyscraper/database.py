"""SQLite-Schreibschicht — schreibt in dieselbe DB wie die Node-App.

Schema und Spalten sind identisch zu src/database.js. Die DDL ist hier als
CREATE TABLE IF NOT EXISTS hinterlegt, damit der Python-Scraper auch eine noch
nicht existierende DB selbst bootstrappen kann (z. B. im CI). WAL + busy_timeout
sorgen dafür, dass parallele Lesezugriffe der Node-UI nicht blockieren.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

from .textutils import js_iso

_SCHEMA = """
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

CREATE TABLE IF NOT EXISTS article_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(article_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_article_tags_tag ON article_tags(tag);
CREATE INDEX IF NOT EXISTS idx_article_tags_article ON article_tags(article_id);

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
  last_error TEXT,
  etag TEXT,
  last_modified TEXT,
  last_response_ms INTEGER,
  last_item_count INTEGER,
  content_type TEXT,
  feed_type TEXT,
  enabled INTEGER DEFAULT 1,
  last_error_class TEXT,
  last_status_code INTEGER,
  last_via_browser INTEGER DEFAULT 0
);
"""


class Database:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA busy_timeout = 10000")
        self.conn.executescript(_SCHEMA)
        self._ensure_health_columns()
        self.conn.commit()

    def _ensure_health_columns(self):
        cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(source_health)")}
        for name, ddl in (
            ("last_error_class", "last_error_class TEXT"),
            ("last_status_code", "last_status_code INTEGER"),
            ("last_via_browser", "last_via_browser INTEGER DEFAULT 0"),
        ):
            if name not in cols:
                self.conn.execute(f"ALTER TABLE source_health ADD COLUMN {ddl}")

    def close(self):
        self.conn.close()

    # --- Lesen ------------------------------------------------------------
    def find_by_normalized_url(self, url_normalized: str):
        return self.conn.execute(
            "SELECT * FROM articles WHERE url_normalized = ?", (url_normalized,)
        ).fetchone()

    def get_recent_for_dedup(self, from_date: datetime) -> list[dict]:
        rows = self.conn.execute(
            """SELECT id, url_normalized, title, first_paragraph, source, published_date
               FROM articles
               WHERE published_date >= ? AND duplicate_of IS NULL AND deleted_at IS NULL""",
            (js_iso(from_date),),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_source_health(self, source: str):
        return self.conn.execute(
            "SELECT * FROM source_health WHERE source = ?", (source,)
        ).fetchone()

    # --- Schreiben --------------------------------------------------------
    def insert_article(self, article: dict) -> tuple[int, bool]:
        row = {
            "url": article.get("url"),
            "url_normalized": article.get("url_normalized"),
            "title": article.get("title"),
            "source": article.get("source"),
            "author": article.get("author"),
            "published_date": js_iso(article.get("published_date")),
            "full_text": article.get("full_text"),
            "first_paragraph": article.get("first_paragraph"),
            "summary": article.get("summary"),
            "word_count": article.get("word_count", 0),
            "relevance_score": article.get("relevance_score", 0),
            "sentiment": article.get("sentiment"),
            "sentiment_score": article.get("sentiment_score", 0),
            "category": article.get("category"),
            "article_type": article.get("article_type"),
            "paywall": 1 if article.get("paywall") else 0,
            "also_on": json.dumps(article["also_on"]) if article.get("also_on") else None,
            "meta": json.dumps(article["meta"]) if article.get("meta") else None,
        }
        try:
            cur = self.conn.execute(
                """INSERT INTO articles (
                       url, url_normalized, title, source, author, published_date,
                       full_text, first_paragraph, summary, word_count,
                       relevance_score, sentiment, sentiment_score, category,
                       article_type, paywall, also_on, meta
                   ) VALUES (
                       :url, :url_normalized, :title, :source, :author, :published_date,
                       :full_text, :first_paragraph, :summary, :word_count,
                       :relevance_score, :sentiment, :sentiment_score, :category,
                       :article_type, :paywall, :also_on, :meta
                   )""",
                row,
            )
            return int(cur.lastrowid), True
        except sqlite3.IntegrityError as exc:
            if "UNIQUE" in str(exc):
                existing = self.find_by_normalized_url(row["url_normalized"])
                return int(existing["id"]), False
            raise

    def add_tag(self, article_id: int, tag: str):
        self.conn.execute(
            "INSERT OR IGNORE INTO article_tags (article_id, tag) VALUES (?, ?)",
            (article_id, tag),
        )

    def mark_as_duplicate(self, article_id: int, original_id: int, additional_url: str | None):
        original = self.conn.execute(
            "SELECT also_on FROM articles WHERE id = ?", (original_id,)
        ).fetchone()
        existing = []
        if original and original["also_on"]:
            try:
                existing = json.loads(original["also_on"]) or []
            except (ValueError, TypeError):
                existing = []
        if additional_url and additional_url not in existing:
            existing.append(additional_url)
        self.conn.execute(
            "UPDATE articles SET also_on = ? WHERE id = ?",
            (json.dumps(existing), original_id),
        )
        self.conn.execute(
            "UPDATE articles SET duplicate_of = ?, also_on = NULL WHERE id = ?",
            (original_id, article_id),
        )

    # --- Scan-Runs --------------------------------------------------------
    def start_scan_run(self, from_date: datetime, to_date: datetime) -> int:
        cur = self.conn.execute(
            "INSERT INTO scan_runs (from_date, to_date) VALUES (?, ?)",
            (js_iso(from_date), js_iso(to_date)),
        )
        self.conn.commit()
        return int(cur.lastrowid)

    def finish_scan_run(self, run_id: int, summary: dict):
        self.conn.execute(
            """UPDATE scan_runs
               SET finished_at = CURRENT_TIMESTAMP,
                   sources_scanned = :sources_scanned,
                   articles_found = :articles_found,
                   articles_added = :articles_added,
                   duplicates_found = :duplicates_found,
                   errors = :errors,
                   notes = :notes
               WHERE id = :id""",
            {
                "id": run_id,
                "sources_scanned": summary.get("sources_scanned", 0),
                "articles_found": summary.get("articles_found", 0),
                "articles_added": summary.get("articles_added", 0),
                "duplicates_found": summary.get("duplicates_found", 0),
                "errors": summary.get("errors", 0),
                "notes": summary.get("notes"),
            },
        )
        self.conn.commit()

    # --- Source-Health ----------------------------------------------------
    def record_source_success(self, source: str, info: dict):
        self.conn.execute(
            """INSERT INTO source_health (
                   source, last_success, consecutive_failures, etag, last_modified,
                   last_response_ms, last_item_count, content_type, feed_type,
                   last_error_class, last_status_code, last_via_browser)
               VALUES (?, CURRENT_TIMESTAMP, 0, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
               ON CONFLICT(source) DO UPDATE SET
                   last_success = CURRENT_TIMESTAMP,
                   consecutive_failures = 0,
                   last_error = NULL,
                   last_error_class = NULL,
                   last_status_code = excluded.last_status_code,
                   last_via_browser = excluded.last_via_browser,
                   etag = COALESCE(excluded.etag, source_health.etag),
                   last_modified = COALESCE(excluded.last_modified, source_health.last_modified),
                   last_response_ms = excluded.last_response_ms,
                   last_item_count = excluded.last_item_count,
                   content_type = excluded.content_type,
                   feed_type = excluded.feed_type""",
            (
                source, info.get("etag"), info.get("last_modified"),
                info.get("response_ms", 0), info.get("item_count", 0),
                info.get("content_type"), info.get("feed_type"),
                info.get("status_code"), 1 if info.get("via_browser") else 0,
            ),
        )

    def record_source_failure(self, source: str, error: str, info: dict):
        self.conn.execute(
            """INSERT INTO source_health (
                   source, last_failure, consecutive_failures, last_error,
                   last_response_ms, last_error_class, last_status_code)
               VALUES (?, CURRENT_TIMESTAMP, 1, ?, ?, ?, ?)
               ON CONFLICT(source) DO UPDATE SET
                   last_failure = CURRENT_TIMESTAMP,
                   consecutive_failures = consecutive_failures + 1,
                   last_error = excluded.last_error,
                   last_error_class = excluded.last_error_class,
                   last_status_code = excluded.last_status_code,
                   last_response_ms = excluded.last_response_ms""",
            (
                source, str(error)[:500], info.get("response_ms", 0),
                info.get("error_class"), info.get("status_code"),
            ),
        )

    def commit(self):
        self.conn.commit()
