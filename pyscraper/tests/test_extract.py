import unittest
from datetime import timezone

from pyscraper.extract import (
    extract_article_content,
    extract_article_date,
    try_relative_date,
    try_url_date,
)

HTML = """<html><head>
<meta property="og:title" content="Großer Theaterabend - Beispielzeitung"/>
<meta name="author" content="von Anna Beispiel"/>
<meta property="article:published_time" content="2026-05-01T18:30:00Z"/>
<meta property="og:description" content="Eine Beschreibung"/>
</head><body>
<nav>Navigation entfernen</nav>
<article>
<p>Dies ist der erste lange Absatz mit genügend Inhalt für die Erkennung des Artikels.</p>
<p>Ein zweiter Absatz, der das Inszenierungsthema weiter vertieft und ausführt.</p>
</article>
<footer>Footer</footer>
</body></html>"""


class TestExtract(unittest.TestCase):
    def test_content(self):
        c = extract_article_content(HTML, "https://example.com/x")
        self.assertEqual(c["title"], "Großer Theaterabend")
        self.assertEqual(c["author"], "Anna Beispiel")
        self.assertIn("erste lange Absatz", c["text"])
        self.assertNotIn("Navigation entfernen", c["text"])
        self.assertEqual(c["description"], "Eine Beschreibung")

    def test_date_from_meta(self):
        d = extract_article_date(HTML, "https://example.com/x")
        self.assertEqual((d.year, d.month, d.day), (2026, 5, 1))

    def test_url_date(self):
        d = try_url_date("https://example.com/2026/05/01/titel")
        self.assertEqual((d.year, d.month, d.day), (2026, 5, 1))

    def test_relative_date(self):
        from datetime import datetime
        now = datetime(2026, 5, 10, 12, 0, tzinfo=timezone.utc)
        d = try_relative_date("vor 2 Tagen aktualisiert", now=now)
        self.assertEqual(d.day, 8)

    def test_paywall(self):
        html = '<html><body><div class="paywall">Abo</div></body></html>'
        self.assertTrue(extract_article_content(html, "u")["paywall"])


if __name__ == "__main__":
    unittest.main()


class TestFindAmpUrl(unittest.TestCase):
    def test_finds_and_resolves_relative(self):
        from pyscraper.extract import find_amp_url

        html = '<html><head><link rel="amphtml" href="/amp/artikel-1"></head></html>'
        self.assertEqual(
            find_amp_url(html, "https://example.com/artikel-1"),
            "https://example.com/amp/artikel-1",
        )
        self.assertIsNone(find_amp_url("<html></html>", "https://example.com/"))
        self.assertIsNone(find_amp_url("", "https://example.com/"))
