"""Volltext-, Paywall- und Datums-Extraktion aus Artikel-HTML.

Faithful port der Heuristiken aus src/scraper.js: Rausch-Selektoren entfernen,
den dichtesten Inhalts-Container per Text-/Absatz-Score wählen, Paywall an
bekannten Markern erkennen und das Veröffentlichungsdatum mehrstufig auflösen
(Meta-Tags → JSON-LD → <time> → URL-Muster → relative/explizite Textdaten).
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone

from bs4 import BeautifulSoup

from .textutils import collapse_ws, first_paragraph

try:  # trafilatura ist die primäre, qualitativ beste Extraktions-Engine.
    import trafilatura  # type: ignore

    _HAS_TRAFILATURA = True
except Exception:  # pragma: no cover - optionaler Schwergewichts-Dep
    _HAS_TRAFILATURA = False

log = logging.getLogger("pyscraper")

REMOVE_SELECTORS = [
    "script", "style", "noscript", "iframe", "embed", "object", "nav",
    "header", "footer", "aside", "form",
    ".ad", ".ads", ".advertisement", ".advertising", ".banner",
    ".newsletter", ".newsletter-signup", ".subscribe", ".related",
    ".related-articles", ".recommendations", ".read-more", ".share",
    ".social", ".social-share", ".sharing", ".comments", ".comment-section",
    ".disqus", ".cookie", ".cookie-banner", ".gdpr", ".popup", ".modal",
    ".overlay", ".breadcrumb", ".breadcrumbs", ".tags", ".taglist",
    ".author-box", ".author-info", ".image-credit", ".photo-credit", "amp-ad",
]

ARTICLE_SELECTORS = [
    '[itemprop="articleBody"]', "article.article", "div.article-body",
    "div.article__body", "div.entry-content", "div.post-content",
    "div.content__article-body", "div.story-body", "div.text-block",
    "main article", "article", "main",
]

PAYWALL_SIGNALS = [
    "paywall", "sz-plus", "sueddeutsche-plus", "spplus", "subscriber-only",
    "plus-artikel", "nur-fuer-abonnenten", "abo-artikel", "premium-content",
    '"isaccessibleforfree":false', '"isaccessibleforfree": false',
    "data-paywall", 'class="paywall', "paid-content", "metered-content",
    "piano-paywall", "fazplus", "faz-plus", "taz-plus", "welt-plus",
    "weltplus", "zeit-plus", "zeitplus", "plus.zeit.de", "spiegel-plus",
    "handelsblatt-plus", "nzz-plus", "jetzt-abonnieren", "bezahlinhalt",
    "register-wall", "hard-paywall", "unbegrenzt-lesen", '"haspaywall":true',
    '"paywall":true', "tinypass", "digital-abo", "weiterlesen-mit-plus",
]

MONTHS = {
    "januar": 1, "jan": 1, "februar": 2, "feb": 2, "maerz": 3, "märz": 3,
    "mar": 3, "april": 4, "apr": 4, "mai": 5, "juni": 6, "jun": 6, "juli": 7,
    "jul": 7, "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9,
    "oktober": 10, "okt": 10, "oct": 10, "november": 11, "nov": 11,
    "dezember": 12, "dez": 12, "dec": 12,
}

_META_DATE_SELECTORS = [
    ("meta", {"property": "article:published_time"}),
    ("meta", {"property": "article:published"}),
    ("meta", {"name": "article:published_time"}),
    ("meta", {"property": "og:published_time"}),
    ("meta", {"name": "published"}),
    ("meta", {"name": "pubdate"}),
    ("meta", {"name": "publish-date"}),
    ("meta", {"name": "date"}),
    ("meta", {"itemprop": "datePublished"}),
    ("meta", {"name": "DC.date.issued"}),
    ("meta", {"name": "parsely-pub-date"}),
    ("meta", {"name": "sailthru.date"}),
]


def _try_parse(value: str) -> datetime | None:
    if not value:
        return None
    iso = value.strip()
    if iso.endswith("Z"):
        iso = iso[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(iso)
    except ValueError:
        pass
    try:
        from .textutils import parse_date
        return parse_date(value)
    except Exception:
        return None


_AMP_LINK = re.compile(r'<link[^>]+rel=["\']amphtml["\'][^>]*>', re.I)
_HREF = re.compile(r'href=["\']([^"\']+)["\']', re.I)


def find_amp_url(html: str, base_url: str) -> str | None:
    """AMP-Version einer Seite (<link rel="amphtml">) — schlankes Markup,
    oft ohne Cookie-/Consent-Wall; billiger als ein Browser-Fallback."""
    if not html:
        return None
    link = _AMP_LINK.search(html)
    if not link:
        return None
    href = _HREF.search(link.group(0))
    if not href:
        return None
    from urllib.parse import urljoin

    try:
        return urljoin(base_url, href.group(1))
    except ValueError:
        return None


def try_url_date(url: str) -> datetime | None:
    if not url:
        return None
    m = re.search(r"(\d{4})[/\-_](\d{1,2})[/\-_](\d{1,2})", url)
    if not m:
        return None
    year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if not (1990 <= year and 1 <= month <= 12 and 1 <= day <= 31):
        return None
    try:
        d = datetime(year, month, day, tzinfo=timezone.utc)
    except ValueError:
        return None
    # Zukunftsdaten sind keine plausiblen Publikationsdaten (URL-Muster wie
    # Versions-/ID-Nummern); kleine Toleranz fuer Zeitzonen-Versatz
    if d > datetime.now(timezone.utc) + timedelta(days=2):
        return None
    return d


def try_relative_date(text: str, now: datetime | None = None) -> datetime | None:
    if not text:
        return None
    now = now or datetime.now(timezone.utc)
    t = text.lower()
    rel = re.search(
        r"vor\s+(\d{1,3})\s+(minute|minuten|stunde|stunden|tag|tagen|woche|wochen)", t
    )
    if rel:
        n = int(rel.group(1))
        unit = rel.group(2)
        if unit.startswith("minute"):
            return now - timedelta(minutes=n)
        if unit.startswith("stunde"):
            return now - timedelta(hours=n)
        if unit.startswith("tag"):
            return now - timedelta(days=n)
        if unit.startswith("woche"):
            return now - timedelta(weeks=n)
    time_m = re.search(r"(\d{1,2}):(\d{2})", t)

    def apply_time(d: datetime) -> datetime:
        if time_m:
            return d.replace(hour=int(time_m.group(1)), minute=int(time_m.group(2)),
                             second=0, microsecond=0)
        return d.replace(hour=0, minute=0, second=0, microsecond=0)

    if re.search(r"\bvorgestern\b", t):
        return apply_time(now - timedelta(days=2))
    if re.search(r"\bgestern\b", t):
        return apply_time(now - timedelta(days=1))
    if re.search(r"\bheute\b|\bvor\s+wenigen\b|\bgerade\s+eben\b|\bsoeben\b", t):
        return apply_time(now)
    return None


def try_text_date(text: str) -> datetime | None:
    if not text:
        return None
    m = re.search(
        r"(\d{1,2})\.\s*(Januar|Februar|M[aä]rz|April|Mai|Juni|Juli|August|"
        r"September|Oktober|November|Dezember|Jan|Feb|M[aä]r|Apr|Jun|Jul|Aug|"
        r"Sep|Sept|Okt|Nov|Dez)\.?\s*(\d{4})",
        text, re.IGNORECASE,
    )
    if m:
        day = int(m.group(1))
        month = MONTHS.get(m.group(2).lower().replace(".", ""))
        year = int(m.group(3))
        if month:
            try:
                return datetime(year, month, day, tzinfo=timezone.utc)
            except ValueError:
                return None
    m2 = re.search(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", text)
    if m2:
        try:
            return datetime(int(m2.group(3)), int(m2.group(2)), int(m2.group(1)),
                            tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def extract_article_date(html: str, url: str) -> datetime | None:
    if not html:
        return try_url_date(url)
    soup = BeautifulSoup(html, "html.parser")

    for name, attrs in _META_DATE_SELECTORS:
        el = soup.find(name, attrs=attrs)
        if el and el.get("content"):
            d = _try_parse(el["content"])
            if d:
                return d

    for node in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = node.string or node.get_text()
        if not raw:
            continue
        try:
            data = json.loads(raw)
        except (ValueError, TypeError):
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) \
            if isinstance(data, dict) else [data]
        for item in items:
            if not isinstance(item, dict):
                continue
            for key in ("datePublished", "dateCreated", "uploadDate", "dateModified"):
                if item.get(key):
                    d = _try_parse(str(item[key]))
                    if d:
                        return d

    time_el = soup.find("time", attrs={"datetime": True})
    if time_el:
        d = _try_parse(time_el["datetime"])
        if d:
            return d

    url_date = try_url_date(url)
    if url_date:
        return url_date

    body_text = soup.get_text(" ")[:4000]
    text_date = try_text_date(body_text)
    if text_date:
        return text_date
    return try_relative_date(body_text[:400])


def _trafilatura_extract(html: str, url: str) -> dict | None:
    """Hauptinhalt + Metadaten via trafilatura (beste Extraktionsqualität,
    mehrsprachig). Gibt None zurück, wenn nichts Brauchbares gefunden wird."""
    if not _HAS_TRAFILATURA:
        return None
    try:
        raw = trafilatura.extract(
            html, url=url, output_format="json", with_metadata=True,
            favor_recall=True, include_comments=False, include_tables=False,
        )
    except Exception:
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        return None
    text = (data.get("text") or "").strip()
    if not text:
        return None
    return {
        "title": (data.get("title") or "").strip(),
        "author": (data.get("author") or "").strip() or None,
        "text": text,
        "excerpt": (data.get("excerpt") or "").strip(),
        "date": data.get("date"),
    }


def extract_article_content(html: str, url: str) -> dict:
    empty = {"title": "", "author": None, "description": "", "text": "",
             "first_paragraph": "", "paywall": False, "date": None}
    if not html:
        return empty

    html_lower = html.lower()
    paywall = any(sig in html_lower for sig in PAYWALL_SIGNALS)

    soup = BeautifulSoup(html, "html.parser")
    for sel in REMOVE_SELECTORS:
        try:
            for el in soup.select(sel):
                el.decompose()
        except Exception as exc:
            log.debug("REMOVE_SELECTOR %r fehlgeschlagen: %s", sel, exc)
            continue

    title = (
        _meta(soup, "property", "og:title")
        or _meta(soup, "name", "twitter:title")
        or _tag_text(soup, "h1")
        or _tag_text(soup, "title")
    )
    title = collapse_ws(title)
    title = re.split(r"\s[-–|·]\s", title)[0].strip() or title

    author = (
        _meta(soup, "name", "author")
        or _meta(soup, "property", "article:author")
        or _class_text(soup, "author")
        or _class_text(soup, "byline")
    )
    if author:
        author = re.sub(r"^(von|by)\s+", "", collapse_ws(author), flags=re.IGNORECASE)
        if len(author) > 80:
            author = None

    description = collapse_ws(
        _meta(soup, "property", "og:description")
        or _meta(soup, "name", "description")
        or _meta(soup, "name", "twitter:description")
    )

    best_container = None
    best_score = 0
    for sel in ARTICLE_SELECTORS:
        try:
            els = soup.select(sel)
        except Exception as exc:
            log.debug("ARTICLE_SELECTOR %r fehlgeschlagen: %s", sel, exc)
            continue
        for el in els:
            text = el.get_text(" ", strip=True)
            if len(text) < 200:
                continue
            score = len(text) + len(el.find_all("p")) * 100
            if score > best_score:
                best_score = score
                best_container = el
        if best_container is not None and best_score > 1000:
            break
    if best_container is None:
        best_container = soup.body or soup

    paragraphs = []
    for el in best_container.find_all(["p", "h2", "h3", "blockquote", "li"]):
        text = collapse_ws(el.get_text(" "))
        if len(text) >= 25:
            paragraphs.append(text)
    if not paragraphs:
        fallback = collapse_ws(best_container.get_text(" "))
        if fallback:
            paragraphs.append(fallback)
    bs4_text = "\n\n".join(paragraphs)

    # trafilatura bevorzugen, wenn es spürbar mehr/saubereren Text liefert.
    text, date = bs4_text, None
    traf = _trafilatura_extract(html, url)
    if traf and len(traf["text"]) >= max(200, int(len(bs4_text) * 0.8)):
        text = traf["text"]
        if traf["title"] and len(traf["title"]) > 5:
            title = re.split(r"\s[-–|·]\s", traf["title"])[0].strip() or traf["title"]
        if traf["author"] and not author:
            author = traf["author"]
        if traf["excerpt"] and not description:
            description = traf["excerpt"]
        date = traf["date"]

    return {
        "title": title,
        "author": author,
        "description": description,
        "text": text,
        "first_paragraph": first_paragraph(text),
        "paywall": paywall,
        "date": date,
    }


def _meta(soup, attr: str, value: str) -> str:
    el = soup.find("meta", attrs={attr: value})
    return el.get("content", "") if el else ""


def _tag_text(soup, name: str) -> str:
    el = soup.find(name)
    return el.get_text(" ", strip=True) if el else ""


def _class_text(soup, cls: str) -> str:
    el = soup.find(class_=cls)
    return el.get_text(" ", strip=True) if el else ""
