"""Kommandozeile für den Python-Scraper.

Beispiele:
    python -m pyscraper scan --last 7d
    python -m pyscraper scan --from 2026-01-01 --to 2026-01-31 --concurrency 20
    python -m pyscraper scan --last 24h --no-enrich      # nur Feed-Ebene, kein Volltext
    python -m pyscraper selftest                         # offline, ohne Netzwerk
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import re
import sys
from datetime import datetime, time, timedelta, timezone


def _setup_logging(level: str):
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )


def _sub_months(dt: datetime, months: int) -> datetime:
    month_index = dt.month - 1 - months
    year = dt.year + month_index // 12
    month = month_index % 12 + 1
    day = min(dt.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
                       else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return dt.replace(year=year, month=month, day=day)


def parse_date_range(last: str | None, frm: str | None, to: str | None):
    """Port von utils.js parseDateRange — unterstützt zusätzlich 'Nh' (Stunden)."""
    now = datetime.now(timezone.utc)
    if last:
        m = re.match(r"^(\d+)\s*([dDmMhH])$", last)
        if not m:
            raise ValueError(f"Ungültiges --last Format: {last} (erwartet z. B. 7d, 30d, 3m, 24h)")
        value, unit = int(m.group(1)), m.group(2).lower()
        end = datetime.combine(now.date(), time.max, tzinfo=timezone.utc)
        if unit == "h":
            return now - timedelta(hours=value), now
        if unit == "d":
            start = datetime.combine((now - timedelta(days=value)).date(), time.min,
                                     tzinfo=timezone.utc)
        else:
            start = datetime.combine(_sub_months(now, value).date(), time.min,
                                     tzinfo=timezone.utc)
        return start, end

    start = end = None
    if frm:
        start = datetime.combine(datetime.strptime(frm, "%Y-%m-%d").date(), time.min,
                                 tzinfo=timezone.utc)
    if to:
        end = datetime.combine(datetime.strptime(to, "%Y-%m-%d").date(), time.max,
                               tzinfo=timezone.utc)
    if not start:
        start = datetime.combine((now - timedelta(days=7)).date(), time.min,
                                 tzinfo=timezone.utc)
    if not end:
        end = datetime.combine(now.date(), time.max, tzinfo=timezone.utc)
    return start, end


async def _run_scan(args) -> int:
    from .config import load_all
    from .database import Database
    from .pipeline import ScanPipeline

    config = load_all()
    if args.concurrency:
        config.settings["scraping"]["max_concurrent_requests"] = args.concurrency
    if args.limit:
        config.settings["scraping"]["max_articles_per_scan"] = args.limit

    from_date, to_date = parse_date_range(args.last, getattr(args, "from"), args.to)
    db_path = args.db or config.db_path()
    db = Database(db_path)
    try:
        pipeline = ScanPipeline(config, db)
        summary = await pipeline.run(from_date, to_date, enrich=not args.no_enrich)
    finally:
        db.close()

    print("\n=== Scan-Zusammenfassung ===")
    print(f"Zeitraum:        {from_date.date()} bis {to_date.date()}")
    print(f"Feeds gescannt:  {summary['sources_scanned']}")
    print(f"Items gefunden:  {summary['articles_found']}")
    print(f"Neu hinzugefügt: {summary['articles_added']}")
    print(f"Duplikate:       {summary['duplicates_found']}")
    print(f"Fehler:          {summary['errors']}")
    print(f"Dauer:           {summary.get('duration_ms', 0) / 1000:.1f}s")
    print(f"Datenbank:       {db_path}")
    return 0


def _run_selftest() -> int:
    """Offline-Rauchtest: Parser + Analyse ohne Netzwerk."""
    from .analyzer import Analyzer
    from .config import load_all
    from .feedparse import parse_feed

    sample = """<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0"><channel><title>Test</title>
    <item><title>Großartige Premiere an den Münchner Kammerspielen</title>
      <link>https://example.com/2026/05/01/premiere</link>
      <pubDate>Thu, 01 May 2026 10:00:00 GMT</pubDate>
      <description>Die Inszenierung von Wallenstein war sehenswert und gelungen.</description>
    </item></channel></rss>"""
    parsed = parse_feed(sample)
    assert parsed.items and parsed.items[0].url, "Feed-Parsing fehlgeschlagen"

    config = load_all()
    analyzer = Analyzer(config.keywords, config.sentiment, config.tags, config.settings)
    article = {
        "title": parsed.items[0].title,
        "full_text": parsed.items[0].summary,
        "first_paragraph": parsed.items[0].summary,
        "word_count": 12,
    }
    result = analyzer.analyze(article, source_priority=90)
    print("Self-Test OK")
    print(f"  Feed-Items:   {len(parsed.items)}")
    print(f"  passes:       {result['passes']}")
    print(f"  Relevanz:     {result['relevance_score']} ({result['category']})")
    print(f"  Sentiment:    {result['sentiment']} (score {result['sentiment_score']})")
    print(f"  Artikeltyp:   {result['article_type']}")
    assert result["passes"], "Relevanz-Filter sollte greifen"
    assert result["sentiment"] == "positiv", "Sentiment sollte positiv sein"
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="pyscraper", description="Schneller async Press-Spiegel-Scraper")
    sub = parser.add_subparsers(dest="command", required=True)

    scan = sub.add_parser("scan", help="Feeds abrufen, anreichern und in die DB schreiben")
    scan.add_argument("--last", help="Zeitraum relativ, z. B. 7d, 30d, 3m, 24h")
    scan.add_argument("--from", dest="from", help="Startdatum YYYY-MM-DD")
    scan.add_argument("--to", help="Enddatum YYYY-MM-DD")
    scan.add_argument("--concurrency", type=int, help="Parallele Requests (Override)")
    scan.add_argument("--limit", type=int, help="Max. Artikel pro Scan (Override)")
    scan.add_argument("--no-enrich", action="store_true",
                      help="Nur Feed-Ebene, keinen Volltext laden")
    scan.add_argument("--db", help="Pfad zur SQLite-DB (Override)")
    scan.add_argument("--log-level", default="info")

    st = sub.add_parser("selftest", help="Offline-Rauchtest ohne Netzwerk")
    st.add_argument("--log-level", default="warning")

    args = parser.parse_args(argv)
    _setup_logging(getattr(args, "log_level", "info"))

    if args.command == "scan":
        return asyncio.run(_run_scan(args))
    if args.command == "selftest":
        return _run_selftest()
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main())
