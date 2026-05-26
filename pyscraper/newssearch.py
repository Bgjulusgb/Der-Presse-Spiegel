"""Google-News- und Bing-News-Connectoren — Port von src/news-search.js.

Diese beiden Aggregatoren sind das "Pflicht-Backbone": pro Feed werden mehrere
Suchanfragen abgesetzt und die Treffer dedupliziert. Google-News-Links zeigen
auf einen Redirector — die echte Artikel-URL wird beim Enrichment aufgelöst.
"""

from __future__ import annotations

import re
from urllib.parse import quote

from .feedparse import looks_like_feed, parse_feed
from .fetcher import AsyncFetcher


def build_google_news_url(query: str, hl="de", gl="DE", ceid="DE:de") -> str:
    return (
        f"https://news.google.com/rss/search?q={quote(query)}"
        f"&hl={hl}&gl={gl}&ceid={ceid}"
    )


def build_bing_news_url(query: str, mkt="de-DE") -> str:
    return f"https://www.bing.com/news/search?q={quote(query)}&format=rss&mkt={mkt}"


def extract_source_from_google_title(title: str) -> str | None:
    if not title:
        return None
    m = re.search(r"\s+-\s+([^-]+)$", title)
    return m.group(1).strip() if m else None


def clean_google_news_title(title: str) -> str:
    if not title:
        return ""
    return re.sub(r"\s+-\s+[^-]+$", "", title).strip()


async def fetch_google_news(fetcher: AsyncFetcher, feed: dict) -> dict:
    queries = feed.get("queries") or [feed.get("query", "Münchner Kammerspiele")]
    seen: dict[str, dict] = {}
    for query in queries:
        url = build_google_news_url(query)
        res = await fetcher.fetch(url, timeout_ms=20000)
        if not res.ok or not res.text or not looks_like_feed(res.text):
            continue
        try:
            parsed = parse_feed(res.text)
        except Exception:
            continue
        for item in parsed.items:
            if not item.url:
                continue
            source_name = extract_source_from_google_title(item.title) or "Google News"
            clean_title = clean_google_news_title(item.title)
            key = f"{clean_title}::{source_name}"
            if key in seen:
                continue
            seen[key] = {
                "title": clean_title,
                "url": item.url,
                "guid": item.guid,
                "published": item.published,
                "summary": item.summary,
                "content": item.content,
                "author": item.author,
                "source": f"{source_name} (via Google News)",
                "source_priority": feed.get("priority", 80),
                "google_news_redirect": True,
                "aggregator": True,
                "search_query": query,
            }
    return {"status": "ok" if seen else "error", "items": list(seen.values())}


async def fetch_bing_news(fetcher: AsyncFetcher, feed: dict) -> dict:
    queries = feed.get("queries") or [feed.get("query", "Münchner Kammerspiele")]
    seen: dict[str, dict] = {}
    for query in queries:
        url = build_bing_news_url(query)
        res = await fetcher.fetch(url, timeout_ms=20000)
        if not res.ok or not res.text or not looks_like_feed(res.text):
            continue
        try:
            parsed = parse_feed(res.text)
        except Exception:
            continue
        for item in parsed.items:
            if not item.url or item.url in seen:
                continue
            seen[item.url] = {
                "title": item.title,
                "url": item.url,
                "guid": item.guid,
                "published": item.published,
                "summary": item.summary,
                "content": item.content,
                "author": item.author,
                "source": feed.get("name", "Bing News"),
                "source_priority": feed.get("priority", 70),
                "aggregator": True,
                "search_query": query,
            }
    return {"status": "ok" if seen else "error", "items": list(seen.values())}


_META_REFRESH = re.compile(r'http-equiv=["\']refresh["\'][^>]*content=["\'][^"\']*url=([^"\']+)', re.I)
_CANONICAL = re.compile(r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)', re.I)
_OG_URL = re.compile(r'<meta[^>]+property=["\']og:url["\'][^>]+content=["\']([^"\']+)', re.I)
_JS_REDIRECT = re.compile(r'window\.location\.replace\(["\']([^"\']+)["\']\)')


async def resolve_google_news_url(fetcher: AsyncFetcher, url: str, cache: dict) -> str:
    if not url or "news.google.com" not in url:
        return url
    if url in cache:
        return cache[url]
    res = await fetcher.fetch(url, timeout_ms=15000)
    resolved = url
    if res.ok and res.text:
        html = res.text
        for rx in (_META_REFRESH, _CANONICAL, _OG_URL, _JS_REDIRECT):
            m = rx.search(html)
            if m:
                cand = m.group(1).strip().strip("'\"")
                if cand.startswith("http") and "news.google.com" not in cand:
                    resolved = cand
                    break
        if resolved == url and "news.google.com" not in res.final_url:
            resolved = res.final_url
    cache[url] = resolved
    return resolved
