"""Text- und URL-Hilfen — portiert aus src/utils.js und src/analyzer.js.

Diese Funktionen müssen sich byte-genau wie ihre JS-Pendants verhalten, weil
beide Implementierungen in dieselbe SQLite-DB schreiben (gleiche
url_normalized-Werte, gleiches published_date-Format, gleiche Dedup-Treffer).
"""

from __future__ import annotations

import html
import math
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

TRACKING_PARAMS = {
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
    "gclid", "fbclid", "ref", "referrer", "cmpid", "mc_cid", "mc_eid",
    "wt_mc", "wt_zmc", "_ga", "s_cid", "icmp", "spm",
}

_UMLAUT_MAP = str.maketrans({
    "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
})
_ACCENT_MAP = str.maketrans({
    "á": "a", "à": "a", "â": "a",
    "é": "e", "è": "e", "ê": "e",
    "í": "i", "ì": "i", "î": "i",
    "ó": "o", "ò": "o", "ô": "o",
    "ú": "u", "ù": "u", "û": "u",
    "ñ": "n", "ç": "c", "ł": "l",
})


def normalize(text) -> str:
    """Wie analyzer.js normalize(): lowercase + Umlaut-/Akzent-Faltung."""
    s = "" if text is None else str(text)
    s = s.lower()
    # Umlaut-Ersatz erzeugt Mehrzeichen-Token, daher zuerst als Strings ersetzen.
    s = s.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    return s.translate(_ACCENT_MAP)


def normalize_url(url) -> str:
    """Port von utils.js normalizeUrl(): Tracking-Parameter entfernen, Query
    sortieren, Hash entfernen, Trailing-Slash kappen, komplett lowercase."""
    if not url:
        return ""
    try:
        parts = urlsplit(url)
        if not parts.scheme or not parts.netloc:
            raise ValueError("kein absolutes URL")
        pairs = [
            (k, v)
            for k, v in parse_qsl(parts.query, keep_blank_values=True)
            if k.lower() not in TRACKING_PARAMS
        ]
        pairs.sort(key=lambda kv: kv[0])
        query = urlencode(pairs, quote_via=quote)
        normalized = urlunsplit((parts.scheme, parts.netloc, parts.path, query, ""))
        if normalized.endswith("/"):
            normalized = normalized[:-1]
        return normalized.lower()
    except Exception:
        return str(url).lower().strip()


_TOKEN_RE = re.compile(r"[^\w\s]", re.UNICODE)


def tokenize(text) -> list[str]:
    s = _TOKEN_RE.sub(" ", str(text).lower())
    return [t for t in s.split() if len(t) >= 3]


def levenshtein_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    s1, s2 = a.lower(), b.lower()
    len1, len2 = len(s1), len(s2)
    max_len = max(len1, len2)
    if max_len == 0:
        return 1.0
    prev = list(range(len2 + 1))
    curr = [0] * (len2 + 1)
    for i in range(1, len1 + 1):
        curr[0] = i
        c1 = s1[i - 1]
        for j in range(1, len2 + 1):
            cost = 0 if c1 == s2[j - 1] else 1
            curr[j] = min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
        prev, curr = curr, prev
    return 1 - prev[len2] / max_len


def cosine_similarity(text_a: str, text_b: str) -> float:
    if not text_a or not text_b:
        return 0.0
    tokens_a = tokenize(text_a)
    tokens_b = tokenize(text_b)
    if not tokens_a or not tokens_b:
        return 0.0
    freq_a: dict[str, int] = {}
    freq_b: dict[str, int] = {}
    for t in tokens_a:
        freq_a[t] = freq_a.get(t, 0) + 1
    for t in tokens_b:
        freq_b[t] = freq_b.get(t, 0) + 1
    dot = mag_a = mag_b = 0.0
    for t in set(freq_a) | set(freq_b):
        a = freq_a.get(t, 0)
        b = freq_b.get(t, 0)
        dot += a * b
        mag_a += a * a
        mag_b += b * b
    if mag_a == 0 or mag_b == 0:
        return 0.0
    return dot / (math.sqrt(mag_a) * math.sqrt(mag_b))


_TAG_RE = re.compile(r"<[^>]+>")
_STYLE_RE = re.compile(r"<style[^>]*>.*?</style>", re.IGNORECASE | re.DOTALL)
_SCRIPT_RE = re.compile(r"<script[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL)
_WS_RE = re.compile(r"\s+")


def strip_html(value) -> str:
    if not value:
        return ""
    s = _STYLE_RE.sub("", str(value))
    s = _SCRIPT_RE.sub("", s)
    s = _TAG_RE.sub(" ", s)
    s = html.unescape(s)
    return _WS_RE.sub(" ", s).strip()


def collapse_ws(value) -> str:
    if not value:
        return ""
    return _WS_RE.sub(" ", str(value)).strip()


def first_paragraph(text: str, max_chars: int = 800) -> str:
    """Port von deduplicator.js extractFirstParagraph()."""
    if not text:
        return ""
    cleaned = text.replace("\r\n", "\n").strip()
    first_block = re.split(r"\n\s*\n", cleaned)[0]
    return first_block[:max_chars]


def js_iso(dt: datetime | None) -> str | None:
    """Erzeugt exakt das Format von JS Date.toISOString():
    'YYYY-MM-DDTHH:MM:SS.mmmZ' (immer UTC, Millisekunden)."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def parse_date(value) -> datetime | None:
    """Robustes Datums-Parsing für RSS (RFC822) und Atom/ISO-8601."""
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    s = str(value).strip()
    if not s:
        return None
    # RFC822 / RFC1123 (typische RSS-pubDate)
    try:
        dt = parsedate_to_datetime(s)
        if dt is not None:
            return dt
    except (TypeError, ValueError, IndexError):
        pass
    # ISO 8601 (Atom). fromisoformat akzeptiert ab Python 3.11 auch 'Z'.
    iso = s.replace("Z", "+00:00") if s.endswith("Z") else s
    try:
        return datetime.fromisoformat(iso)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d.%m.%Y"):
        try:
            return datetime.strptime(s[:10], fmt)
        except ValueError:
            continue
    return None
