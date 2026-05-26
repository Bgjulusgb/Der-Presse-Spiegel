"""Mehrstufige Duplikat-Erkennung — Port von src/deduplicator.js.

Stufen: (1) normalisierte URL identisch, (2) Titel-Levenshtein über Schwelle,
(3) Cosine-Ähnlichkeit des ersten Absatzes. Bei Treffer entscheidet die
Quellen-Priorität (sonst das frühere Datum, sonst die kleinere ID) über den
Sieger.
"""

from __future__ import annotations

from .textutils import cosine_similarity, levenshtein_similarity, normalize_url


class Deduplicator:
    def __init__(self, source_priorities: dict, dedup_settings: dict):
        self.source_priorities = source_priorities or {}
        self.title_threshold = dedup_settings.get("title_similarity_threshold", 0.85)
        self.text_threshold = dedup_settings.get("text_similarity_threshold", 0.8)
        self.default_priority = self.source_priorities.get("default", 50)

    def source_priority(self, source_name: str | None) -> int:
        if not source_name:
            return self.default_priority
        lower = source_name.lower()
        for key, priority in self.source_priorities.items():
            if key == "default":
                continue
            if key.lower() in lower:
                return priority
        return self.default_priority

    def find_duplicate(self, candidate: dict, candidates: list[dict]) -> dict | None:
        cand_url = normalize_url(candidate.get("url", ""))
        cand_title = (candidate.get("title") or "").strip()
        cand_first = candidate.get("first_paragraph") or ""

        for existing in candidates:
            if not existing or not existing.get("id"):
                continue
            if candidate.get("id") and existing["id"] == candidate["id"]:
                continue

            if existing.get("url_normalized") and cand_url and \
                    existing["url_normalized"] == cand_url:
                return {"duplicate": existing, "reason": "url-match"}

            title_sim = levenshtein_similarity(cand_title, existing.get("title") or "")
            if title_sim >= self.title_threshold:
                return {"duplicate": existing, "reason": f"title-sim:{title_sim:.2f}"}

            if cand_first and existing.get("first_paragraph"):
                text_sim = cosine_similarity(cand_first, existing["first_paragraph"])
                if text_sim >= self.text_threshold:
                    return {"duplicate": existing, "reason": f"text-sim:{text_sim:.2f}"}
        return None

    def choose_winner(self, a: dict, b: dict) -> dict:
        prio_a = self.source_priority(a.get("source"))
        prio_b = self.source_priority(b.get("source"))
        if prio_a != prio_b:
            return a if prio_a > prio_b else b
        date_a = a.get("published_date")
        date_b = b.get("published_date")
        if date_a and date_b and date_a != date_b:
            return a if date_a < date_b else b
        id_a = a.get("id") or float("inf")
        id_b = b.get("id") or float("inf")
        return a if id_a < id_b else b
