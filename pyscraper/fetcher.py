"""Asynchroner HTTP-Client auf Basis von aiohttp.

Der Geschwindigkeitsgewinn gegenüber dem sequentiellen Worst-Case kommt aus
echtem async I/O: Hunderte Feeds/Artikel werden gleichzeitig geladen,
limitiert nur durch eine globale Parallelitäts-Schranke und ein faires
Pro-Domain-Rate-Limit (damit eine einzelne Seite nicht überrannt wird).
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field

import aiohttp

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
]

_DEFAULT_HEADERS = {
    "Accept": (
        "application/rss+xml, application/xml, text/xml, application/atom+xml, "
        "application/json;q=0.9, text/html;q=0.8, */*;q=0.5"
    ),
    "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
    # aiohttp dekomprimiert gzip/deflate nativ; brotli nur falls Lib vorhanden.
    "Accept-Encoding": "gzip, deflate",
    "Upgrade-Insecure-Requests": "1",
}

_RETRYABLE = {"timeout", "socket", "dns", "server", "ratelimit"}


@dataclass
class FetchResult:
    status: int
    url: str
    final_url: str
    text: str | None = None
    headers: dict = field(default_factory=dict)
    etag: str | None = None
    last_modified: str | None = None
    content_type: str | None = None
    error: str | None = None
    error_class: str | None = None
    elapsed_ms: int = 0

    @property
    def ok(self) -> bool:
        return self.error is None and 200 <= self.status < 300


def classify_status(status: int) -> str:
    if status == 403:
        return "forbidden"
    if status == 404:
        return "notfound"
    if status == 410:
        return "gone"
    if status == 429:
        return "ratelimit"
    if 500 <= status < 600:
        return "server"
    return "http"


def classify_exception(exc: Exception) -> str:
    if isinstance(exc, asyncio.TimeoutError):
        return "timeout"
    name = type(exc).__name__
    if isinstance(exc, aiohttp.ClientConnectorDNSError) or "DNS" in name:
        return "dns"
    if isinstance(exc, aiohttp.ServerTimeoutError):
        return "timeout"
    if isinstance(exc, aiohttp.ClientConnectionError):
        return "socket"
    return "unknown"


_CHARSET_RE = re.compile(rb'charset=["\']?([^;"\'\s>]+)', re.IGNORECASE)
_XML_ENC_RE = re.compile(rb'<\?xml[^>]+encoding=["\']([^"\']+)["\']', re.IGNORECASE)
_META_CHARSET_RE = re.compile(rb'<meta[^>]+charset=["\']?([^>"\'\s/]+)', re.IGNORECASE)


def detect_encoding(buffer: bytes, content_type: str | None) -> str:
    if content_type:
        m = _CHARSET_RE.search(content_type.encode("latin-1", "ignore"))
        if m:
            return m.group(1).decode("ascii", "ignore").lower()
    if buffer[:3] == b"\xef\xbb\xbf":
        return "utf-8"
    if buffer[:2] == b"\xff\xfe":
        return "utf-16-le"
    if buffer[:2] == b"\xfe\xff":
        return "utf-16-be"
    head = buffer[:4096]
    m = _XML_ENC_RE.search(head)
    if m:
        return m.group(1).decode("ascii", "ignore").lower()
    m = _META_CHARSET_RE.search(head)
    if m:
        return m.group(1).decode("ascii", "ignore").lower()
    return "utf-8"


def decode_buffer(buffer: bytes, encoding: str) -> str:
    enc = (encoding or "utf-8").lower().replace("_", "-")
    if enc in ("utf-8", "utf8"):
        return buffer.decode("utf-8", errors="replace")
    try:
        return buffer.decode(enc, errors="replace")
    except (LookupError, UnicodeDecodeError):
        return buffer.decode("utf-8", errors="replace")


class AsyncFetcher:
    """Verwaltet eine aiohttp-Session, globale Parallelität und faires
    Pro-Domain-Throttling. Als Async-Contextmanager benutzen."""

    def __init__(
        self,
        *,
        concurrency: int = 10,
        per_domain_ms: int = 800,
        timeout_ms: int = 15000,
        max_retries: int = 2,
        backoff_ms: int = 1500,
    ):
        self.concurrency = max(1, concurrency)
        self.per_domain_s = max(0, per_domain_ms) / 1000.0
        self.timeout_s = max(1, timeout_ms) / 1000.0
        self.max_retries = max(0, max_retries)
        self.backoff_s = max(0, backoff_ms) / 1000.0
        self._sem = asyncio.Semaphore(self.concurrency)
        self._domain_locks: dict[str, asyncio.Lock] = {}
        self._domain_next: dict[str, float] = {}
        self._ua_counter = 0
        self._session: aiohttp.ClientSession | None = None

    async def __aenter__(self) -> "AsyncFetcher":
        connector = aiohttp.TCPConnector(
            limit=self.concurrency * 2,
            ttl_dns_cache=300,
            enable_cleanup_closed=True,
        )
        self._session = aiohttp.ClientSession(connector=connector)
        return self

    async def __aexit__(self, *exc):
        if self._session:
            await self._session.close()

    def _domain(self, url: str) -> str:
        try:
            return aiohttp.helpers.URL(url).host or ""
        except Exception:
            return ""

    async def _throttle(self, url: str) -> None:
        if self.per_domain_s <= 0:
            return
        domain = self._domain(url)
        if not domain:
            return
        lock = self._domain_locks.setdefault(domain, asyncio.Lock())
        async with lock:
            now = time.monotonic()
            nxt = self._domain_next.get(domain, 0.0)
            wait = nxt - now
            if wait > 0:
                await asyncio.sleep(wait)
            self._domain_next[domain] = max(now, nxt) + self.per_domain_s

    def _next_ua(self, attempt: int) -> str:
        return USER_AGENTS[attempt % len(USER_AGENTS)]

    async def fetch(
        self,
        url: str,
        *,
        etag: str | None = None,
        last_modified: str | None = None,
        timeout_ms: int | None = None,
    ) -> FetchResult:
        timeout = aiohttp.ClientTimeout(
            total=(timeout_ms / 1000.0) if timeout_ms else self.timeout_s
        )
        start = time.monotonic()
        last_error: str | None = None
        last_class: str | None = None

        for attempt in range(self.max_retries + 1):
            headers = dict(_DEFAULT_HEADERS)
            headers["User-Agent"] = self._next_ua(attempt)
            if etag:
                headers["If-None-Match"] = etag
            if last_modified:
                headers["If-Modified-Since"] = last_modified

            await self._throttle(url)
            try:
                async with self._sem:
                    assert self._session is not None
                    async with self._session.get(
                        url,
                        headers=headers,
                        timeout=timeout,
                        allow_redirects=True,
                        max_redirects=6,
                    ) as resp:
                        status = resp.status
                        if status == 304:
                            return FetchResult(
                                status=304, url=url, final_url=str(resp.url),
                                headers=dict(resp.headers), etag=etag,
                                last_modified=last_modified,
                                elapsed_ms=int((time.monotonic() - start) * 1000),
                            )
                        if status == 429:
                            retry_after = int(resp.headers.get("Retry-After", "0") or 0)
                            last_error = f"HTTP 429 für {url}"
                            last_class = "ratelimit"
                            if attempt < self.max_retries:
                                wait = retry_after or self.backoff_s * (2 ** attempt)
                                await asyncio.sleep(wait)
                                continue
                            break
                        if status >= 400:
                            last_error = f"HTTP {status} für {url}"
                            last_class = classify_status(status)
                            if last_class in _RETRYABLE and attempt < self.max_retries:
                                await asyncio.sleep(self.backoff_s * (2 ** attempt))
                                continue
                            return FetchResult(
                                status=status, url=url, final_url=str(resp.url),
                                headers=dict(resp.headers), error=last_error,
                                error_class=last_class,
                                elapsed_ms=int((time.monotonic() - start) * 1000),
                            )
                        buffer = await resp.read()
                        content_type = resp.headers.get("Content-Type")
                        encoding = detect_encoding(buffer, content_type)
                        text = decode_buffer(buffer, encoding)
                        return FetchResult(
                            status=status, url=url, final_url=str(resp.url),
                            text=text, headers=dict(resp.headers),
                            etag=resp.headers.get("ETag"),
                            last_modified=resp.headers.get("Last-Modified"),
                            content_type=content_type,
                            elapsed_ms=int((time.monotonic() - start) * 1000),
                        )
            except Exception as exc:  # noqa: BLE001 — wir klassifizieren selbst
                last_error = str(exc) or type(exc).__name__
                last_class = classify_exception(exc)
                if last_class in _RETRYABLE and attempt < self.max_retries:
                    await asyncio.sleep(self.backoff_s * (2 ** attempt))
                    continue
                break

        return FetchResult(
            status=0, url=url, final_url=url, error=last_error or "unbekannt",
            error_class=last_class or "unknown",
            elapsed_ms=int((time.monotonic() - start) * 1000),
        )
