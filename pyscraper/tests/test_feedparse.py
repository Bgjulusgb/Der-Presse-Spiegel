import unittest

from pyscraper.feedparse import detect_format, looks_like_feed, parse_feed

RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"
     xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Kultur</title>
<item>
  <title>Premiere an den Kammerspielen</title>
  <link>https://example.com/a</link>
  <guid>https://example.com/a</guid>
  <pubDate>Thu, 01 May 2026 10:00:00 GMT</pubDate>
  <description>Kurzbeschreibung</description>
  <content:encoded>&lt;p&gt;Voller Text&lt;/p&gt;</content:encoded>
  <dc:creator>Max Muster</dc:creator>
  <category>Theater</category>
</item></channel></rss>"""

ATOM = """<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>Atom Feed</title>
<entry>
  <title>Atom Artikel</title>
  <link rel="alternate" href="https://example.com/atom"/>
  <id>tag:example,2026:1</id>
  <published>2026-05-01T08:00:00Z</published>
  <summary>Zusammenfassung</summary>
  <author><name>Erika Muster</name></author>
</entry></feed>"""

RDF = """<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns="http://purl.org/rss/1.0/"
         xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel rdf:about="https://example.com"><title>RDF Feed</title></channel>
<item rdf:about="https://example.com/rdf">
  <title>RDF Artikel</title>
  <link>https://example.com/rdf</link>
  <dc:date>2026-05-01</dc:date>
  <description>RDF Beschreibung</description>
</item></rdf:RDF>"""

JSONFEED = """{"version":"https://jsonfeed.org/version/1","title":"JSON",
"items":[{"id":"1","url":"https://example.com/json","title":"JSON Artikel",
"date_published":"2026-05-01T09:00:00Z","content_text":"Inhalt",
"author":{"name":"Autor"}}]}"""


class TestDetect(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(detect_format(RSS), "rss")
        self.assertEqual(detect_format(ATOM), "atom")
        self.assertEqual(detect_format(RDF), "rdf")
        self.assertEqual(detect_format(JSONFEED), "json")

    def test_looks_like_feed_rejects_html(self):
        self.assertFalse(looks_like_feed("<!doctype html><html><body>x</body></html>"))
        self.assertTrue(looks_like_feed(RSS))


class TestParse(unittest.TestCase):
    def test_rss(self):
        feed = parse_feed(RSS)
        self.assertEqual(len(feed.items), 1)
        it = feed.items[0]
        self.assertEqual(it.url, "https://example.com/a")
        self.assertEqual(it.author, "Max Muster")
        self.assertIn("Voller Text", it.content)
        self.assertIsNotNone(it.published)

    def test_atom(self):
        feed = parse_feed(ATOM)
        self.assertEqual(feed.items[0].url, "https://example.com/atom")
        self.assertEqual(feed.items[0].author, "Erika Muster")

    def test_rdf(self):
        feed = parse_feed(RDF)
        self.assertEqual(feed.items[0].url, "https://example.com/rdf")
        self.assertEqual(feed.items[0].title, "RDF Artikel")

    def test_json(self):
        feed = parse_feed(JSONFEED)
        self.assertEqual(feed.items[0].url, "https://example.com/json")
        self.assertEqual(feed.items[0].author, "Autor")


if __name__ == "__main__":
    unittest.main()
