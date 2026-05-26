import unittest

from pyscraper.dedup import Deduplicator


class TestDedup(unittest.TestCase):
    def setUp(self):
        self.dedup = Deduplicator(
            {"nachtkritik": 90, "default": 50},
            {"title_similarity_threshold": 0.85, "text_similarity_threshold": 0.8},
        )

    def test_url_match(self):
        cand = {"url": "https://example.com/a?utm_source=x", "title": "Andere",
                "first_paragraph": ""}
        existing = [{"id": 1, "url_normalized": "https://example.com/a",
                     "title": "Original", "first_paragraph": ""}]
        hit = self.dedup.find_duplicate(cand, existing)
        self.assertIsNotNone(hit)
        self.assertEqual(hit["reason"], "url-match")

    def test_title_similarity(self):
        cand = {"url": "https://example.com/b", "title": "Premiere am Theater heute",
                "first_paragraph": ""}
        existing = [{"id": 2, "url_normalized": "https://example.com/c",
                     "title": "Premiere am Theater heute!", "first_paragraph": ""}]
        hit = self.dedup.find_duplicate(cand, existing)
        self.assertIsNotNone(hit)
        self.assertTrue(hit["reason"].startswith("title-sim"))

    def test_no_duplicate(self):
        cand = {"url": "https://example.com/x", "title": "Komplett anderes Thema",
                "first_paragraph": "abc def ghi"}
        existing = [{"id": 3, "url_normalized": "https://example.com/y",
                     "title": "Etwas ganz Verschiedenes", "first_paragraph": "zzz yyy"}]
        self.assertIsNone(self.dedup.find_duplicate(cand, existing))

    def test_choose_winner_by_priority(self):
        a = {"source": "nachtkritik", "id": 5}
        b = {"source": "Unbekannt", "id": 4}
        self.assertIs(self.dedup.choose_winner(a, b), a)


if __name__ == "__main__":
    unittest.main()
