"""Lädt die gemeinsam genutzten JSON-Konfigurationen des Projekts.

Der Python-Scraper teilt sich Quellen, Keywords, Sentiment-Wörterbuch und
Einstellungen mit der Node-Anwendung. Es gibt bewusst keine zweite
Konfigurationsquelle: alles kommt aus ``config/*.json`` im Projekt-Root.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config"


def _load(name: str) -> dict[str, Any]:
    path = CONFIG_DIR / name
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def load_all() -> "Config":
    return Config(
        settings=_load("settings.json"),
        sources=_load("sources.json"),
        keywords=_load("keywords.json"),
        sentiment=_load("sentiment.json"),
        tags=_load("tags.json"),
    )


class Config:
    def __init__(self, settings, sources, keywords, sentiment, tags):
        self.settings = settings
        self.sources = sources
        self.keywords = keywords
        self.sentiment = sentiment
        self.tags = tags

    @property
    def feeds(self) -> list[dict]:
        return self.sources.get("feeds", [])

    @property
    def source_priorities(self) -> dict:
        return self.sources.get("source_priorities", {})

    @property
    def scraping(self) -> dict:
        return self.settings.get("scraping", {})

    @property
    def dedup(self) -> dict:
        return self.settings.get("deduplication", {})

    def db_path(self) -> Path:
        """Pfad zur SQLite-DB — exakt der gleiche wie in der Node-App."""
        raw = self.settings.get("database", {}).get("path", "./data/pressespiegel.db")
        p = Path(raw)
        if not p.is_absolute():
            p = (ROOT / raw).resolve()
        return p


# Modulweite Singleton-Instanz; Tests können load_all() erneut aufrufen.
CONFIG = load_all() if os.environ.get("PYSCRAPER_SKIP_AUTOLOAD") != "1" else None
