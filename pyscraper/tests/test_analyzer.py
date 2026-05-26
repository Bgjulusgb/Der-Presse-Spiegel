import unittest

from pyscraper.analyzer import Analyzer
from pyscraper.config import load_all


class TestAnalyzer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        c = load_all()
        cls.analyzer = Analyzer(c.keywords, c.sentiment, c.tags, c.settings)

    def test_passes_required(self):
        article = {"title": "Neues an den Münchner Kammerspielen",
                   "full_text": "Ein Bericht über das Theater.",
                   "first_paragraph": "Ein Bericht über das Theater."}
        passes, reason = self.analyzer.passes_required_filter(article)
        self.assertTrue(passes, reason)

    def test_rejects_unrelated(self):
        article = {"title": "Fußball in der Bundesliga",
                   "full_text": "Ein langer Bericht über Fußball " * 30,
                   "first_paragraph": "Ein langer Bericht über Fußball."}
        passes, reason = self.analyzer.passes_required_filter(article)
        self.assertFalse(passes)
        self.assertEqual(reason, "no-required-keyword")

    def test_positive_sentiment(self):
        r = self.analyzer.analyze_sentiment(
            "Die Inszenierung war großartig, sehenswert und gelungen.")
        self.assertEqual(r["label"], "positiv")

    def test_negation_flips(self):
        r = self.analyzer.analyze_sentiment("Die Aufführung war nicht gelungen.")
        self.assertLessEqual(r["score"], 0)

    def test_headline_verdict_weighted(self):
        # Gleiche Wertung in der Schlagzeile zählt doppelt.
        body = self.analyzer.analyze_sentiment("gelungen", title="")
        head = self.analyzer.analyze_sentiment("gelungen", title="gelungen")
        self.assertGreater(head["score"], body["score"])

    def test_relevance_title_match_high(self):
        article = {"title": "Münchner Kammerspiele zeigen Wallenstein",
                   "full_text": "Premiere der Inszenierung. " * 40,
                   "first_paragraph": "Münchner Kammerspiele zeigen Wallenstein.",
                   "word_count": 120}
        rel = self.analyzer.calculate_relevance(article, source_priority=95)
        self.assertGreaterEqual(rel["score"], 80)
        self.assertEqual(rel["category"], "sehr_relevant")

    def test_lede_emphasis_adds_points(self):
        with_lede = {"title": "Theaterabend", "full_text": "Kammerspiele " * 5,
                     "first_paragraph": "Die Kammerspiele eröffnen die Spielzeit.",
                     "word_count": 50}
        without = {"title": "Theaterabend", "full_text": "Kammerspiele " * 5,
                   "first_paragraph": "Ein Abend in der Stadt.", "word_count": 50}
        self.assertGreater(
            self.analyzer.calculate_relevance(with_lede)["score"],
            self.analyzer.calculate_relevance(without)["score"],
        )

    def test_auto_tag(self):
        article = {"title": "Wallenstein an den Kammerspielen",
                   "full_text": "Eine Kritik der Inszenierung Wallenstein an den Kammerspielen.",
                   "summary": ""}
        analysis = {"sentiment": "positiv", "category": "sehr_relevant"}
        tags = self.analyzer.auto_tag(article, analysis)
        self.assertIn("produktion:wallenstein", tags)
        self.assertIn("tonalitaet:positiv", tags)
        self.assertIn("relevanz:top", tags)


if __name__ == "__main__":
    unittest.main()
