"""Parser für RSS 2.0, Atom, RDF (RSS 1.0) und JSON Feed.

Bewusst nur Standard-Bibliothek (xml.etree) — robust gegen die in der Praxis
sehr unterschiedlichen Feed-Dialekte deutscher Nachrichtenseiten. Namespaces
werden über den lokalen Tag-Namen aufgelöst, statt feste Präfixe anzunehmen.
"""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime

from .textutils import parse_date, strip_html


@dataclass
class FeedItem:
    title: str = ""
    url: str = ""
    guid: str = ""
    published: datetime | None = None
    summary: str = ""
    content: str = ""
    author: str = ""
    categories: list[str] = field(default_factory=list)


@dataclass
class ParsedFeed:
    title: str = ""
    items: list[FeedItem] = field(default_factory=list)
    feed_type: str = "unknown"


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _children_map(el: ET.Element) -> dict[str, list[ET.Element]]:
    out: dict[str, list[ET.Element]] = {}
    for child in el:
        out.setdefault(_local(child.tag), []).append(child)
    return out


def _text(els: list[ET.Element] | None) -> str:
    if not els:
        return ""
    el = els[0]
    return strip_html("".join(el.itertext()))


def looks_like_feed(text: str) -> bool:
    if not text:
        return False
    head = text[:2048].lower()
    if re.match(r"^\s*\{", text) and "jsonfeed.org" in head:
        return True
    if re.search(r"<!doctype html|<html[\s>]", head) and not re.search(
        r"<rss|<feed|<rdf:rdf", head
    ):
        return False
    return bool(re.search(r"<rss[\s>]|<feed[\s>]|<rdf:rdf|<channel[\s>]", head))


def detect_format(text: str) -> str:
    if text.lstrip().startswith("{") and "jsonfeed.org" in text[:1024]:
        return "json"
    low = text[:1024].lower()
    if "<rdf:rdf" in low:
        return "rdf"
    if re.search(r"<rss[\s>]", low) or "<channel" in low:
        return "rss"
    if re.search(r"<feed[\s>]", low):
        return "atom"
    return "unknown"


def parse_feed(text: str) -> ParsedFeed:
    fmt = detect_format(text)
    if fmt == "json":
        return _parse_json(text)
    root = ET.fromstring(text)
    rname = _local(root.tag).lower()
    if rname == "rss":
        return _parse_rss(root)
    if rname == "feed":
        return _parse_atom(root)
    if rname == "rdf":
        return _parse_rdf(root, text)
    # Fallback: nach channel/item suchen.
    if root.find(".//{*}channel") is not None or root.find(".//{*}item") is not None:
        return _parse_rss(root)
    raise ValueError("Unbekanntes Feed-Format")


def _parse_rss(root: ET.Element) -> ParsedFeed:
    channel = None
    for child in root:
        if _local(child.tag) == "channel":
            channel = child
            break
    if channel is None:
        channel = root
    cm = _children_map(channel)
    title = _text(cm.get("title"))
    items = [_rss_item(it) for it in cm.get("item", [])]
    return ParsedFeed(title=title, items=items, feed_type="rss")


def _rss_item(el: ET.Element) -> FeedItem:
    m = _children_map(el)
    link = _text(m.get("link")) or _text(m.get("guid"))
    return FeedItem(
        title=_text(m.get("title")),
        url=link,
        guid=_text(m.get("guid")),
        published=parse_date(_text(m.get("pubDate")) or _text(m.get("date"))),
        summary=_text(m.get("description")) or _text(m.get("summary")),
        content=_text(m.get("encoded")) or _text(m.get("content")),
        author=_text(m.get("creator")) or _text(m.get("author")),
        categories=[_text([c]) for c in m.get("category", []) if _text([c])],
    )


def _parse_atom(root: ET.Element) -> ParsedFeed:
    cm = _children_map(root)
    title = _text(cm.get("title"))
    items = [_atom_entry(e) for e in cm.get("entry", [])]
    return ParsedFeed(title=title, items=items, feed_type="atom")


def _atom_entry(el: ET.Element) -> FeedItem:
    m = _children_map(el)
    link = ""
    links = m.get("link", [])
    if links:
        alt = next(
            (l for l in links if l.get("rel") in (None, "alternate")), links[0]
        )
        link = alt.get("href") or _text([alt])
    author = ""
    if m.get("author"):
        author = _text(_children_map(m["author"][0]).get("name")) or _text(m["author"])
    cats = [c.get("term") or _text([c]) for c in m.get("category", [])]
    return FeedItem(
        title=_text(m.get("title")),
        url=link,
        guid=_text(m.get("id")),
        published=parse_date(_text(m.get("published")) or _text(m.get("updated"))),
        summary=_text(m.get("summary")),
        content=_text(m.get("content")),
        author=author,
        categories=[c for c in cats if c],
    )


def _parse_rdf(root: ET.Element, text: str) -> ParsedFeed:
    title = ""
    items: list[FeedItem] = []
    for child in root:
        name = _local(child.tag)
        if name == "channel":
            title = _text(_children_map(child).get("title"))
        elif name == "item":
            items.append(_rdf_item(child))
    return ParsedFeed(title=title, items=items, feed_type="rdf")


def _rdf_item(el: ET.Element) -> FeedItem:
    m = _children_map(el)
    about = el.get("{http://www.w3.org/1999/02/22-rdf-syntax-ns#}about")
    link = _text(m.get("link")) or about or ""
    return FeedItem(
        title=_text(m.get("title")),
        url=link,
        guid=link,
        published=parse_date(_text(m.get("date"))),
        summary=_text(m.get("description")),
        content=_text(m.get("encoded")),
        author=_text(m.get("creator")),
        categories=[_text([c]) for c in m.get("subject", []) if _text([c])],
    )


def _parse_json(text: str) -> ParsedFeed:
    data = json.loads(text)
    items = []
    for it in data.get("items", []):
        author = ""
        if isinstance(it.get("author"), dict):
            author = it["author"].get("name", "")
        elif it.get("authors"):
            author = it["authors"][0].get("name", "")
        items.append(
            FeedItem(
                title=it.get("title", ""),
                url=it.get("url") or it.get("id", ""),
                guid=it.get("id", ""),
                published=parse_date(it.get("date_published")),
                summary=it.get("summary", ""),
                content=it.get("content_text") or it.get("content_html", ""),
                author=author,
                categories=it.get("tags", []) or [],
            )
        )
    return ParsedFeed(title=data.get("title", ""), items=items, feed_type="json")
