import unittest
from datetime import datetime, timezone

from pyscraper.textutils import (
    cosine_similarity,
    first_paragraph,
    js_iso,
    levenshtein_similarity,
    normalize,
    normalize_url,
    parse_date,
)


class TestNormalize(unittest.TestCase):
    def test_umlaut_folding(self):
        self.assertEqual(normalize("Münchner Kammerspiele"), "muenchner kammerspiele")
        self.assertEqual(normalize("Größe"), "groesse")
        self.assertEqual(normalize("Café"), "cafe")


class TestNormalizeUrl(unittest.TestCase):
    def test_strips_tracking_and_sorts(self):
        a = normalize_url("https://Example.com/Artikel?utm_source=x&b=2&a=1#frag")
        self.assertEqual(a, "https://example.com/artikel?a=1&b=2")

    def test_trailing_slash_removed(self):
        self.assertEqual(normalize_url("https://example.com/path/"),
                         "https://example.com/path")

    def test_same_url_different_tracking_match(self):
        a = normalize_url("https://example.com/x?gclid=1")
        b = normalize_url("https://example.com/x?fbclid=2")
        self.assertEqual(a, b)


class TestSimilarity(unittest.TestCase):
    def test_levenshtein_identical(self):
        self.assertEqual(levenshtein_similarity("Premiere", "Premiere"), 1.0)

    def test_levenshtein_close(self):
        self.assertGreater(levenshtein_similarity("Kammerspiele", "Kammerspielе"[:-1] + "e"), 0.8)

    def test_cosine_overlap(self):
        s = cosine_similarity("das theater spielt heute", "das theater spielt morgen")
        self.assertGreater(s, 0.5)


class TestDates(unittest.TestCase):
    def test_js_iso_format(self):
        dt = datetime(2026, 5, 1, 10, 30, 0, tzinfo=timezone.utc)
        self.assertEqual(js_iso(dt), "2026-05-01T10:30:00.000Z")

    def test_parse_rfc822(self):
        d = parse_date("Thu, 01 May 2026 10:00:00 GMT")
        self.assertEqual((d.year, d.month, d.day), (2026, 5, 1))

    def test_parse_iso_z(self):
        d = parse_date("2026-05-01T10:00:00Z")
        self.assertEqual(d.year, 2026)


class TestFirstParagraph(unittest.TestCase):
    def test_first_block_only(self):
        self.assertEqual(first_paragraph("Absatz eins.\n\nAbsatz zwei."), "Absatz eins.")


if __name__ == "__main__":
    unittest.main()
