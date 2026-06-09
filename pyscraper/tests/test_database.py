import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from pyscraper.database import Database


class TestDatabase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Database(Path(self.tmp.name) / "test.db")

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def _article(self, url="https://example.com/a", **kw):
        base = {
            "url": url, "url_normalized": url, "title": "Titel",
            "source": "Test", "published_date": datetime(2026, 5, 1, tzinfo=timezone.utc),
            "full_text": "Text", "first_paragraph": "Text", "summary": "Text",
            "word_count": 1, "relevance_score": 50, "sentiment": "neutral",
            "category": "relevant", "article_type": "news", "paywall": False,
            "meta": {"x": 1},
        }
        base.update(kw)
        return base

    def test_insert_and_dedupe_unique(self):
        aid, inserted = self.db.insert_article(self._article())
        self.assertTrue(inserted)
        aid2, inserted2 = self.db.insert_article(self._article())
        self.assertFalse(inserted2)
        self.assertEqual(aid, aid2)

    def test_published_date_iso_format(self):
        self.db.insert_article(self._article())
        row = self.db.find_by_normalized_url("https://example.com/a")
        self.assertEqual(row["published_date"], "2026-05-01T00:00:00.000Z")

    def test_tags(self):
        aid, _ = self.db.insert_article(self._article())
        self.db.add_tag(aid, "produktion:wallenstein")
        self.db.add_tag(aid, "produktion:wallenstein")  # idempotent
        count = self.db.conn.execute(
            "SELECT COUNT(*) c FROM article_tags WHERE article_id=?", (aid,)
        ).fetchone()["c"]
        self.assertEqual(count, 1)

    def test_mark_duplicate(self):
        winner, _ = self.db.insert_article(self._article("https://example.com/orig"))
        loser, _ = self.db.insert_article(self._article("https://example.com/dup"))
        # Signatur wie in der Node-Pipeline: (loser_id, winner_id, url)
        self.db.mark_as_duplicate(loser, winner, "https://example.com/dup")
        row = self.db.find_by_normalized_url("https://example.com/dup")
        self.assertEqual(row["duplicate_of"], winner)

    def test_mark_duplicate_merges_also_on(self):
        import json as _json

        winner, _ = self.db.insert_article(self._article("https://example.com/orig"))
        loser, _ = self.db.insert_article(self._article("https://example.com/dup"))
        # Der Verlierer hat bereits eigene "auch erschienen in"-Fundstellen
        self.db.conn.execute(
            "UPDATE articles SET also_on = ? WHERE id = ?",
            (_json.dumps(["https://mirror.example/a"]), loser),
        )
        self.db.mark_as_duplicate(loser, winner, "https://example.com/dup")
        row = self.db.find_by_normalized_url("https://example.com/orig")
        merged = _json.loads(row["also_on"])
        self.assertIn("https://mirror.example/a", merged)
        self.assertIn("https://example.com/dup", merged)
        # Verlierer traegt selbst keine also_on-Liste mehr
        dup_row = self.db.find_by_normalized_url("https://example.com/dup")
        self.assertIsNone(dup_row["also_on"])

    def test_scan_run_and_health(self):
        rid = self.db.start_scan_run(
            datetime(2026, 5, 1, tzinfo=timezone.utc),
            datetime(2026, 5, 7, tzinfo=timezone.utc))
        self.db.finish_scan_run(rid, {"articles_added": 3, "errors": 0})
        self.db.record_source_success("Test", {"item_count": 5, "feed_type": "rss"})
        self.db.record_source_failure("Other", "boom", {"error_class": "timeout"})
        health = self.db.get_source_health("Other")
        self.assertEqual(health["consecutive_failures"], 1)
        self.assertEqual(health["last_error_class"], "timeout")


if __name__ == "__main__":
    unittest.main()
