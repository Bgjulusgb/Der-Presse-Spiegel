"""Scan-Orchestrierung — das Python-Pendant zu src/pipeline.js + scraper.js.

Ablauf: Feeds parallel laden (mit Conditional-GET aus source_health) →
deduplizieren/vorfiltern → Artikel-Volltexte hochparallel anreichern →
analysieren → gegen DB deduplizieren → schreiben. Geschwindigkeit kommt aus
echtem async I/O statt Thread-/Prozess-Overhead.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from .analyzer import Analyzer
from .database import Database
from .dedup import Deduplicator
from .extract import extract_article_content, extract_article_date, find_amp_url
from .feedparse import looks_like_feed, parse_feed
from .fetcher import AsyncFetcher
from .newssearch import fetch_bing_news, fetch_google_news, resolve_google_news_url
from .textutils import collapse_ws, first_paragraph, normalize_url, parse_date

log = logging.getLogger("pyscraper")


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _should_auto_skip(health, fallback_threshold: int) -> bool:
    if not health:
        return False
    failures = health["consecutive_failures"] or 0
    cls = health["last_error_class"]
    if cls == "forbidden":
        return False
    if cls in ("gone", "notfound", "dns"):
        return failures >= 5
    if cls in ("timeout", "socket"):
        return failures >= 10
    return fallback_threshold > 0 and failures >= fallback_threshold


class ScanPipeline:
    def __init__(self, config, db: Database):
        self.config = config
        self.db = db
        self.analyzer = Analyzer(
            config.keywords, config.sentiment, config.tags, config.settings
        )
        self.dedup = Deduplicator(config.source_priorities, config.dedup)
        self.scraping = config.scraping
        self._google_cache: dict[str, str] = {}

    # --- Feed-Sammeln -----------------------------------------------------
    def _enabled_feeds(self) -> list[dict]:
        auto_disable = self.scraping.get("auto_disable_after_failures", 0)
        enabled = []
        for f in self.config.feeds:
            if f.get("disabled") is True:
                continue
            health = self.db.get_source_health(f["name"])
            if health and health["enabled"] == 0:
                continue
            if _should_auto_skip(health, auto_disable):
                log.warning("Feed übersprungen (%sx %s): %s",
                            health["consecutive_failures"],
                            health["last_error_class"], f["name"])
                continue
            enabled.append(f)
        return enabled

    async def _fetch_one_feed(self, fetcher: AsyncFetcher, feed: dict) -> list[dict]:
        name = feed["name"]
        kind = feed.get("kind")
        if kind == "google-news":
            res = await fetch_google_news(fetcher, feed, self.config.keywords)
            self._record_aggregator(name, res, "google-news")
            return res["items"]
        if kind == "bing-news":
            res = await fetch_bing_news(fetcher, feed, self.config.keywords)
            self._record_aggregator(name, res, "bing-news")
            return res["items"]

        health = self.db.get_source_health(name)
        etag = health["etag"] if health else None
        last_modified = health["last_modified"] if health else None
        result = await fetcher.fetch(feed["url"], etag=etag, last_modified=last_modified)

        if result.status == 304:
            self.db.record_source_success(name, {
                "etag": etag, "last_modified": last_modified,
                "response_ms": result.elapsed_ms, "item_count": 0,
                "feed_type": "unchanged",
            })
            return []
        if not result.ok or not result.text:
            self.db.record_source_failure(name, result.error or "fetch fehlgeschlagen", {
                "response_ms": result.elapsed_ms,
                "error_class": result.error_class,
                "status_code": result.status or None,
            })
            log.warning("RSS fehlgeschlagen: %s (%s)", name, result.error_class)
            return []
        if not looks_like_feed(result.text):
            self.db.record_source_failure(name, "kein Feed-Inhalt", {
                "response_ms": result.elapsed_ms, "error_class": "parse",
            })
            return []
        try:
            parsed = parse_feed(result.text)
        except Exception as exc:  # noqa: BLE001
            self.db.record_source_failure(name, f"Parse-Fehler: {exc}", {
                "response_ms": result.elapsed_ms, "error_class": "parse",
            })
            return []

        self.db.record_source_success(name, {
            "etag": result.etag, "last_modified": result.last_modified,
            "response_ms": result.elapsed_ms, "item_count": len(parsed.items),
            "content_type": result.content_type, "feed_type": parsed.feed_type,
            "status_code": result.status,
        })
        log.info("RSS: %s -> %d Einträge (%dms)", name, len(parsed.items), result.elapsed_ms)

        items = []
        for it in parsed.items:
            url = (it.url or "").strip().replace("&amp;", "&")
            if not url:
                continue
            items.append({
                "title": it.title, "url": url, "published": it.published,
                "summary": it.summary, "content": it.content, "author": it.author,
                "source": name, "source_priority": feed.get("priority", 50),
            })
        return items

    def _record_aggregator(self, name: str, res: dict, feed_type: str):
        if res["status"] == "ok":
            self.db.record_source_success(name, {
                "item_count": len(res["items"]), "feed_type": feed_type,
            })
            log.info("%s: %s -> %d Einträge", feed_type, name, len(res["items"]))
        else:
            self.db.record_source_failure(name, "keine Treffer", {"error_class": "empty"})

    async def gather_from_feeds(self, fetcher: AsyncFetcher) -> list[dict]:
        feeds = self._enabled_feeds()
        log.info("Lade %d aktive Feeds parallel", len(feeds))
        results = await asyncio.gather(
            *(self._fetch_one_feed(fetcher, f) for f in feeds),
            return_exceptions=True,
        )
        items: list[dict] = []
        for r in results:
            if isinstance(r, Exception):
                log.debug("Feed-Task-Fehler: %s", r)
                continue
            items.extend(r)
        self.db.commit()
        return items

    # --- Anreicherung -----------------------------------------------------
    async def _fetch_article_details(self, fetcher: AsyncFetcher, item: dict) -> dict | None:
        url = item["url"]
        is_google = item.get("google_news_redirect") or "news.google.com" in url
        timeout = 10000 if is_google else self.scraping.get("request_timeout_ms", 20000)
        try:
            target = url
            if is_google:
                resolved = await resolve_google_news_url(fetcher, url, self._google_cache)
                if resolved and "news.google.com" not in resolved:
                    target = resolved
                    item["url"] = target
                else:
                    return self._from_rss(item)
            res = await fetcher.fetch(target, timeout_ms=timeout)
            if res.status == 304:
                return None
            if not res.ok or not res.text:
                return self._from_rss(item)
            # Extraktion (trafilatura/BeautifulSoup) ist CPU-lastig und blockiert
            # sonst den Event-Loop — daher in einen Worker-Thread auslagern, damit
            # die Netzwerk-Anreicherung weiter hochparallel laeuft.
            content = await asyncio.to_thread(extract_article_content, res.text, target)
            # AMP-Fallback: liefert die Hauptseite kaum Text (Consent-/Paywall-
            # HTML), hat die AMP-Version oft den vollen Artikel
            if content["paywall"] or len(content["text"] or "") < 500:
                amp_url = find_amp_url(res.text, target)
                if amp_url and amp_url != target:
                    try:
                        amp_res = await fetcher.fetch(amp_url, timeout_ms=timeout)
                        if amp_res.ok and amp_res.text:
                            amp_content = await asyncio.to_thread(
                                extract_article_content, amp_res.text, amp_url)
                            if len(amp_content["text"] or "") > len(content["text"] or ""):
                                amp_content["paywall"] = (
                                    content["paywall"] and amp_content["paywall"])
                                content = amp_content
                                log.debug("AMP-Fallback erfolgreich: %s", amp_url)
                    except Exception as exc:  # noqa: BLE001
                        log.debug("AMP-Fallback fehlgeschlagen: %s (%s)", amp_url, exc)
            published = item.get("published")
            if not published and content.get("date"):
                published = parse_date(content["date"])
            if not published:
                published = await asyncio.to_thread(extract_article_date, res.text, target)
            title = collapse_ws(item.get("title") or content["title"])
            full_text = content["text"] or item.get("content") or item.get("summary") or ""
            return {
                "url": item["url"],
                "url_normalized": normalize_url(item["url"]),
                "title": title,
                "source": item.get("source"),
                "source_priority": item.get("source_priority", 50),
                "author": item.get("author") or content["author"],
                "published_date": published,
                "full_text": full_text,
                "first_paragraph": content["first_paragraph"] or first_paragraph(full_text),
                "paywall": content["paywall"],
                "word_count": len([w for w in full_text.split() if w]),
                "from_aggregator": bool(item.get("aggregator")),
                "search_query": item.get("search_query"),
                "meta": {"fetched_at": datetime.now(timezone.utc).isoformat(),
                         "description": content["description"]},
            }
        except Exception as exc:  # noqa: BLE001
            log.debug("Artikel-Details fehlgeschlagen: %s (%s)", url, exc)
            fallback = self._from_rss(item)
            fallback["meta"]["fetch_error"] = str(exc)
            return fallback

    def _from_rss(self, item: dict) -> dict:
        text = item.get("content") or item.get("summary") or ""
        return {
            "url": item["url"],
            "url_normalized": normalize_url(item["url"]),
            "title": collapse_ws(item.get("title", "")),
            "source": item.get("source"),
            "source_priority": item.get("source_priority", 50),
            "author": item.get("author"),
            "published_date": item.get("published"),
            "full_text": text,
            "first_paragraph": first_paragraph(text),
            "paywall": False,
            "word_count": len([w for w in text.split() if w]),
            "from_aggregator": bool(item.get("aggregator")),
            "search_query": item.get("search_query"),
            "meta": {"fallback": "rss-only",
                     "fetched_at": datetime.now(timezone.utc).isoformat()},
        }

    async def enrich_items(self, fetcher: AsyncFetcher, items: list[dict],
                           from_date, to_date, enrich: bool = True) -> list[dict]:
        max_enrich = int(self.scraping.get("max_articles_per_scan", 1500))

        seen, deduped = set(), []
        for item in items:
            key = normalize_url(item["url"])
            if not key or key in seen:
                continue
            seen.add(key)
            deduped.append(item)

        from_utc, to_utc = _as_utc(from_date), _as_utc(to_date)

        def in_range(item):
            pub = _as_utc(item.get("published"))
            if pub is None:
                return True
            if from_utc and pub < from_utc:
                return False
            if to_utc and pub > to_utc:
                return False
            return True

        in_window = [i for i in deduped if in_range(i)]
        fresh = [i for i in in_window
                 if not self.db.find_by_normalized_url(normalize_url(i["url"]))]
        log.info("Anreicherung: %d neu von %d Items im Zeitraum", len(fresh), len(in_window))

        # Relevanz-Stufe bestimmen und Tier-0-Items (genug Text, kein Treffer)
        # gar nicht erst anreichern.
        before = len(fresh)
        tiered = [(self.analyzer.rss_relevance_tier(i), i) for i in fresh]
        tiered = [(t, i) for t, i in tiered if t >= 1]
        if before - len(tiered) > 0:
            log.info("Vorfilter: %d irrelevante übersprungen, %d verbleiben",
                     before - len(tiered), len(tiered))

        # Reihenfolge: klare Treffer (Tier 2) zuerst, dann nach Aktualität und
        # Quellen-Priorität. So nutzt das Anreicherungs-Budget zuerst die
        # wahrscheinlich relevanten Artikel.
        epoch = datetime.min.replace(tzinfo=timezone.utc)
        tiered.sort(key=lambda ti: (
            ti[0],
            _as_utc(ti[1].get("published")) or epoch,
            ti[1].get("source_priority", 0),
        ), reverse=True)
        fresh = [i for _, i in tiered]
        if len(fresh) > max_enrich:
            log.warning("Begrenze auf %d Artikel (von %d) — klare Treffer zuerst",
                        max_enrich, len(fresh))
            fresh = fresh[:max_enrich]

        if not enrich:
            return [self._from_rss(i) for i in fresh]

        enriched: list[dict] = []
        chunk_size = 200
        total = len(fresh)
        start = datetime.now(timezone.utc)
        for offset in range(0, total, chunk_size):
            chunk = fresh[offset:offset + chunk_size]
            results = await asyncio.gather(
                *(self._fetch_article_details(fetcher, i) for i in chunk),
                return_exceptions=True,
            )
            for r in results:
                if isinstance(r, Exception):
                    log.debug("Enrich-Fehler: %s", r)
                elif r is not None:
                    enriched.append(r)
            done = min(offset + chunk_size, total)
            elapsed = max(0.1, (datetime.now(timezone.utc) - start).total_seconds())
            log.info("Anreicherung %d/%d (~%d/min)", done, total,
                     int(done / elapsed * 60))

        out = []
        for a in enriched:
            if a.get("published_date") is None:
                a["published_date"] = datetime.now(timezone.utc)
                a["meta"]["date_warning"] = True
            pub = _as_utc(a["published_date"])
            if from_utc and pub < from_utc:
                continue
            if to_utc and pub > to_utc:
                continue
            out.append(a)
        return out

    # --- Verarbeitung -----------------------------------------------------
    def _process_article(self, raw: dict, existing: list[dict], summary: dict):
        analysis = self.analyzer.analyze(raw, raw.get("source_priority", 50))
        if not analysis["passes"]:
            log.debug("Verworfen: %s (%s)", raw.get("title"), analysis["reject_reason"])
            return
        article = {
            **raw,
            "summary": analysis["summary"],
            "relevance_score": analysis["relevance_score"],
            "sentiment": analysis["sentiment"],
            "sentiment_score": analysis["sentiment_score"],
            "category": analysis["category"],
            "article_type": analysis["article_type"],
        }
        candidate = {
            "id": None, "url": article["url"],
            "url_normalized": article["url_normalized"], "title": article["title"],
            "first_paragraph": article["first_paragraph"], "source": article["source"],
        }
        hit = self.dedup.find_duplicate(candidate, existing)

        def track(article_id):
            existing.append({
                "id": article_id, "url_normalized": article["url_normalized"],
                "title": article["title"], "first_paragraph": article["first_paragraph"],
                "source": article["source"],
                "published_date": _as_utc(article["published_date"]),
            })

        if hit:
            winner = self.dedup.choose_winner(
                {**candidate, "published_date": _as_utc(article["published_date"])},
                hit["duplicate"],
            )
            if winner is hit["duplicate"]:
                summary["duplicates_found"] += 1
            else:
                article_id, inserted = self.db.insert_article(article)
                if inserted:
                    summary["articles_added"] += 1
                    self._apply_tags(article_id, article, analysis)
                self.db.mark_as_duplicate(
                    hit["duplicate"]["id"], article_id, hit["duplicate"].get("url"))
                summary["duplicates_found"] += 1
                track(article_id)
        else:
            article_id, inserted = self.db.insert_article(article)
            if inserted:
                summary["articles_added"] += 1
                self._apply_tags(article_id, article, analysis)
                track(article_id)

    def _apply_tags(self, article_id: int, article: dict, analysis: dict):
        for tag in self.analyzer.auto_tag(article, analysis):
            try:
                self.db.add_tag(article_id, tag)
            except Exception as exc:  # noqa: BLE001
                log.debug("Tag-Fehler %s: %s", tag, exc)

    # --- Lauf -------------------------------------------------------------
    async def run(self, from_date: datetime, to_date: datetime,
                  enrich: bool = True) -> dict:
        run_id = self.db.start_scan_run(from_date, to_date)
        summary = {"sources_scanned": len(self.config.feeds), "articles_found": 0,
                   "articles_added": 0, "duplicates_found": 0, "errors": 0, "notes": ""}
        started = datetime.now(timezone.utc)
        try:
            async with AsyncFetcher(
                concurrency=self.scraping.get("max_concurrent_requests", 10),
                per_domain_ms=self.scraping.get("rate_limit_per_domain_ms", 800),
                timeout_ms=self.scraping.get("request_timeout_ms", 15000),
                max_retries=self.scraping.get("max_retries", 2),
                backoff_ms=self.scraping.get("retry_backoff_ms", 1500),
            ) as fetcher:
                items = await self.gather_from_feeds(fetcher)
                summary["articles_found"] = len(items)
                log.info("Gesammelt: %d Feed-Einträge", len(items))
                enriched = await self.enrich_items(
                    fetcher, items, from_date, to_date, enrich=enrich)
                log.info("Angereichert: %d Artikel im Zeitraum", len(enriched))

            enriched.sort(
                key=lambda a: _as_utc(a.get("published_date"))
                or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

            lookback = _as_utc(from_date).replace(microsecond=0)
            from datetime import timedelta
            lookback = lookback - timedelta(days=30)
            existing = self.db.get_recent_for_dedup(lookback)

            for raw in enriched:
                try:
                    self._process_article(raw, existing, summary)
                except Exception as exc:  # noqa: BLE001
                    summary["errors"] += 1
                    log.error("Fehler bei Artikel %s: %s", raw.get("url"), exc)
            self.db.commit()

            self.db.finish_scan_run(run_id, summary)
            summary["duration_ms"] = int(
                (datetime.now(timezone.utc) - started).total_seconds() * 1000)
            log.info("Scan abgeschlossen: %s", summary)
            return summary
        except Exception as exc:
            summary["errors"] += 1
            summary["notes"] = str(exc)
            self.db.finish_scan_run(run_id, summary)
            raise
