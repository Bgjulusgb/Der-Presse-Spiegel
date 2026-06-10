import unittest

from pyscraper.newssearch import (
    build_bing_news_url,
    build_google_news_url,
    clean_google_news_title,
    expand_feed_queries,
    extract_source_from_google_title,
)


class TestNewsSearch(unittest.TestCase):
    def test_build_urls(self):
        g = build_google_news_url("Münchner Kammerspiele")
        self.assertIn("news.google.com/rss/search", g)
        self.assertIn("M%C3%BCnchner", g)
        b = build_bing_news_url("Kammerspiele")
        self.assertIn("bing.com/news/search", b)
        self.assertIn("format=rss", b)

    def test_google_title_helpers(self):
        self.assertEqual(
            clean_google_news_title("Hamlet-Premiere gefeiert - SZ"),
            "Hamlet-Premiere gefeiert",
        )
        self.assertEqual(
            extract_source_from_google_title("Hamlet-Premiere gefeiert - SZ"), "SZ"
        )

    def test_expand_generates_from_keyword_sets(self):
        feed = {"queries": ['"Münchner Kammerspiele"'], "queries_from": ["productions"]}
        kw = {"productions": ["Wokey Wokey", "Wallenstein"]}
        self.assertEqual(
            expand_feed_queries(feed, kw),
            [
                '"Münchner Kammerspiele"',
                '"Wokey Wokey" Kammerspiele',
                '"Wallenstein" Kammerspiele',
            ],
        )

    def test_expand_people_need_full_name(self):
        feed = {"queries_from": ["people"]}
        kw = {"people": ["Barbara Mundel", "Mundel"]}
        self.assertEqual(expand_feed_queries(feed, kw), ['"Barbara Mundel" Kammerspiele'])

    def test_expand_dedupes_and_caps(self):
        feed = {
            "queries": ['"wallenstein" kammerspiele'],
            "queries_from": ["productions"],
            "max_queries": 2,
        }
        kw = {"productions": ["Wallenstein", "Pinocchio", "Mephisto"]}
        queries = expand_feed_queries(feed, kw)
        self.assertEqual(
            queries, ['"wallenstein" kammerspiele', '"Pinocchio" Kammerspiele']
        )

    def test_expand_without_queries_from(self):
        self.assertEqual(expand_feed_queries({"queries": ["a b c"]}, {}), ["a b c"])


if __name__ == "__main__":
    unittest.main()
