"""Relevanz-, Sentiment- und Tag-Analyse — Port von src/analyzer.js + tagger.js.

Bleibt bewusst deterministisch (keine generierten Zusammenfassungen, kein
Fuzzy-Matching), passend zur Entscheidung des Projekts, halluzinationsfrei zu
arbeiten. Zwei gezielte Verbesserungen gegenüber dem JS-Original sind als
LEDE-/HEADLINE-Kommentare markiert.
"""

from __future__ import annotations

import re

from .textutils import collapse_ws, normalize


def _count_occurrences(haystack: str, needle: str) -> int:
    if not needle:
        return 0
    count = idx = 0
    while True:
        idx = haystack.find(needle, idx)
        if idx == -1:
            break
        count += 1
        idx += len(needle)
    return count


def _split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


class Analyzer:
    def __init__(self, keywords: dict, sentiment: dict, tags: dict, settings: dict):
        self.kw_raw = keywords
        self.sent = sentiment
        self.tags_cfg = tags
        self.weights = keywords.get("scoring_weights", {})
        self.thresholds = keywords.get("thresholds", {})
        self.reports = settings.get("reports", {})

        self.required = [normalize(k) for k in keywords.get("required", [])]
        self.productions = [normalize(k) for k in keywords.get("productions", [])]
        self.people = [normalize(k) for k in keywords.get("people", [])]
        self.venues = [normalize(k) for k in keywords.get("venues", [])]
        self.theater_context = [normalize(k) for k in keywords.get("theater_context", [])]
        self.exclude = [normalize(k) for k in keywords.get("exclude", [])]
        self.exclude_title = [normalize(k) for k in keywords.get("exclude_title", [])]
        self.munich_specific = [normalize(k) for k in keywords.get("munich_specific", [])]

        self.positive_set = {normalize(w) for w in sentiment.get("positive", [])}
        self.negative_set = {normalize(w) for w in sentiment.get("negative", [])}
        self.negations = {normalize(w) for w in sentiment.get("negations", [])}
        self.intensifiers = {normalize(w) for w in sentiment.get("intensifiers", [])}
        self.sent_thresholds = sentiment.get("thresholds", {"positive": 2, "negative": -2})

    # --- Hilfen -----------------------------------------------------------
    def _body_text(self, article: dict) -> str:
        meta = article.get("meta") or {}
        return " ".join(
            str(p) for p in (
                article.get("full_text"),
                article.get("summary"),
                article.get("first_paragraph"),
                article.get("content"),
                meta.get("description"),
            ) if p
        )

    def _word_count(self, article: dict) -> int:
        if article.get("word_count"):
            return article["word_count"]
        return len([w for w in (article.get("full_text") or "").split() if w])

    # --- Vorfilter --------------------------------------------------------
    def rss_relevance_tier(self, item: dict) -> int:
        """Bewertet ein RSS-Item VOR dem teuren Volltext-Fetch.

        2 = klarer Treffer (Pflicht-Keyword / Person / Produktion im RSS-Text),
        1 = zu wenig Text für ein sicheres Urteil (im Zweifel anreichern),
        0 = genug Text, aber kein Treffer → überspringen.

        Verbesserung ggü. JS: Statt nur True/False zurückzugeben, erlaubt die
        Stufung der Pipeline, klare Treffer beim Anreicherungs-Budget *zuerst*
        zu bedienen — so verdrängen neue, aber irrelevante Kurzmeldungen nicht
        die eigentlich relevanten Artikel.
        """
        title = normalize(item.get("title", ""))
        body = normalize(" ".join(
            str(p) for p in (item.get("summary"), item.get("content"),
                             item.get("description")) if p
        ))
        haystack = f"{title} {body}"
        if (any(k in haystack for k in self.required)
                or any(p in haystack for p in self.people if len(p) >= 6)
                or any(p in haystack for p in self.productions if len(p) >= 8)):
            return 2
        if len(body) < 120:
            return 1
        return 0

    def rss_likely_relevant(self, item: dict) -> bool:
        return self.rss_relevance_tier(item) >= 1

    def passes_required_filter(self, article: dict) -> tuple[bool, str | None]:
        title = normalize(article.get("title", ""))
        text = normalize(self._body_text(article))
        haystack = f"{title} {text}"

        has_required = any(k in haystack for k in self.required)
        has_person = any(p in haystack for p in self.people if len(p) >= 6)
        has_prod = any(p in haystack for p in self.productions if len(p) >= 8)
        if not (has_required or has_person or has_prod):
            return False, "no-required-keyword"

        first_para = normalize(article.get("first_paragraph", ""))
        title_scope = f"{title} {first_para}"
        for k in self.exclude_title:
            if k in title_scope:
                return False, f"exclude:{k}"

        mentions_munich = any(k in haystack for k in self.munich_specific)
        if not mentions_munich:
            for k in self.exclude:
                if k in haystack:
                    return False, f"exclude:{k}"
        return True, None

    # --- Artikeltyp -------------------------------------------------------
    def detect_article_type(self, article: dict) -> str:
        text = normalize(f"{article.get('title', '')} {self._body_text(article)}")

        def count(key):
            return sum(1 for w in self.sent.get(key, []) if normalize(w) in text)

        review = count("review_indicators")
        interview = count("interview_indicators")
        announcement = count("announcement_indicators")
        mx = max(review, interview, announcement)
        if mx == 0:
            return "news"
        if mx == review:
            return "review"
        if mx == interview:
            return "interview"
        return "announcement"

    # --- Tiefe ------------------------------------------------------------
    def article_depth(self, article: dict) -> int:
        text = self._body_text(article)
        word_count = len([w for w in text.split() if w])
        sentences = _split_sentences(text)
        paragraphs = len([p for p in re.split(r"\n\n+", article.get("full_text", "")) if p])
        depth = 0
        if word_count >= 1000:
            depth += 3
        elif word_count >= 500:
            depth += 2
        elif word_count >= 200:
            depth += 1
        if len(sentences) >= 10:
            depth += 1
        if paragraphs >= 3:
            depth += 1
        if re.search(r'[“”„"«»]', text):
            depth += 1
        person_mentions = sum(1 for p in self.people if p in normalize(text))
        if person_mentions >= 2:
            depth += 1
        return min(depth, 5)

    # --- Relevanz ---------------------------------------------------------
    def _contextual(self, text, keyword, window=400) -> bool:
        idx = text.find(keyword)
        if idx == -1:
            return False
        start = max(0, idx - window)
        end = min(len(text), idx + len(keyword) + window)
        win = text[start:end]
        return any(r in win for r in self.required)

    def calculate_relevance(self, article: dict, source_priority: int = 50) -> dict:
        w = self.weights
        title = normalize(article.get("title", ""))
        text = normalize(self._body_text(article))
        lede = normalize(article.get("first_paragraph", ""))
        haystack = f"{title} {text}"
        score = 0
        reasons: list[str] = []

        title_has_required = False
        for req in self.required:
            if req in title:
                score += w.get("title_exact_match", 110)
                reasons.append(f'Titel: "{req}"')
                title_has_required = True
                break
        if not title_has_required:
            for req in self.required:
                if req in text:
                    count = min(_count_occurrences(text, req), 5)
                    pts = w.get("required_keyword", 18) * count
                    score += pts
                    reasons.append(f'{count}x "{req}" im Text (+{pts})')
                    break

        production_in_title = False
        production_count = 0
        for p in self.productions:
            if not p or len(p) < 3:
                continue
            if p in title:
                score += w.get("production_in_title", 70)
                reasons.append(f"Produktion im Titel: {p}")
                production_in_title = True
                production_count += 1
            elif p in text:
                contextual = self._contextual(text, p)
                count = min(_count_occurrences(text, p), 3)
                base = w.get("production_match", 40)
                pts = base * count if contextual else base // 2
                score += pts
                reasons.append(f"Produktion: {p} (+{pts})")
                production_count += 1
        if production_count > 1:
            score += w.get("multiple_productions_bonus", 60)
        if production_in_title and title_has_required:
            score += w.get("title_with_production", 130)
            reasons.append("Fokus: Kammerspiele + Produktion im Titel")

        person_count = 0
        for person in self.people:
            if not person or len(person) < 4:
                continue
            if person in title:
                score += w.get("people_in_title", 55)
                person_count += 1
            elif person in text:
                contextual = self._contextual(text, person)
                pts = w.get("people_match", 28) if contextual else w.get("people_match", 28) // 2
                score += pts
                person_count += 1
        if person_count > 1:
            score += w.get("multiple_people_bonus", 35)

        for venue in self.venues:
            if not venue or len(venue) < 5:
                continue
            if venue in text or venue in title:
                score += w.get("venue_match", 18)

        context_hits = sum(1 for c in self.theater_context if c in haystack)
        if context_hits >= 2:
            score += w.get("theater_context_bonus", 15)
            reasons.append(f"Theater-Kontext ({context_hits} Begriffe)")

        art_type = self.detect_article_type(article)
        if art_type == "review":
            score += w.get("review", 50)
            reasons.append("Typ: Kritik/Review")
        elif art_type == "interview":
            score += w.get("interview", 40)
        elif art_type == "announcement":
            score += w.get("announcement", 30)

        if "premiere" in haystack:
            score += w.get("premiere_bonus", 35)

        # LEDE-EMPHASIS (Verbesserung ggü. JS): Steht das Thema bereits im
        # ersten Absatz, ist der Artikel mit hoher Wahrscheinlichkeit *über*
        # die Kammerspiele und nicht nur eine Randerwähnung -> Pressespiegel-
        # Relevanz höher gewichten.
        if lede and (any(r in lede for r in self.required)
                     or any(p in lede for p in self.productions if len(p) >= 8)):
            score += 12
            reasons.append("Thema im Lede (+12)")

        word_count = self._word_count(article)
        min_words = self.thresholds.get("min_word_count", 50)
        short_thr = self.thresholds.get("short_article_word_count", 100)
        if 0 < word_count < min_words:
            score += w.get("very_short_article_penalty", -35)
        elif 0 < word_count < short_thr:
            score += w.get("short_article_penalty", -12)
        elif 300 <= word_count < 500:
            score += 8
        elif word_count >= 500:
            score += 15

        if source_priority >= 95:
            score += 25
        elif source_priority >= 80:
            score += 15
        elif source_priority >= 60:
            score += 8

        depth = self.article_depth(article)
        if depth >= 4:
            score += 10
        elif depth >= 2:
            score += 5

        if article.get("paywall"):
            score -= 10

        return {
            "score": max(0, score),
            "reasons": reasons,
            "category": self.categorize(max(0, score)),
            "article_type": art_type,
            "depth": depth,
        }

    def categorize(self, score: int) -> str:
        t = self.thresholds
        if score >= t.get("very_relevant", 80):
            return "sehr_relevant"
        if score >= t.get("relevant", 50):
            return "relevant"
        if score >= t.get("maybe_relevant", 30):
            return "moeglich_relevant"
        return "irrelevant"

    # --- Sentiment --------------------------------------------------------
    def _matches_any_stem(self, token: str, stems: set[str]) -> bool:
        if token in stems:
            return True
        for stem in stems:
            if len(stem) < 4:
                continue
            if len(stem) <= len(token) <= len(stem) + 4 and token.startswith(stem):
                return True
        return False

    def analyze_sentiment(self, text: str, title: str = "") -> dict:
        if not text:
            return {"label": "neutral", "score": 0, "confidence": 0, "hit_count": 0}
        normalized = normalize(text)
        title_norm = normalize(title)
        tokens = [t for t in re.split(r"[^a-z0-9]+", normalized) if t]
        title_tokens = {t for t in re.split(r"[^a-z0-9]+", title_norm) if t}

        score = 0
        hit_count = 0
        for i, tok in enumerate(tokens):
            polarity = 0
            weight = 1
            if self._matches_any_stem(tok, self.positive_set):
                polarity = 1
            elif self._matches_any_stem(tok, self.negative_set):
                polarity = -1
            if polarity == 0:
                continue
            for j in range(max(0, i - 3), i):
                if tokens[j] in self.negations:
                    polarity = -polarity
                if tokens[j] in self.intensifiers:
                    weight = 2
            # HEADLINE-VERDICT (Verbesserung ggü. JS): Wertungen in der
            # Schlagzeile wiegen schwerer — Rezensionen verraten ihr Urteil oft
            # schon im Titel.
            if tok in title_tokens:
                weight *= 2
            score += polarity * weight
            hit_count += 1

        t = self.sent_thresholds
        label = "neutral"
        if score >= t.get("positive", 2):
            label = "positiv"
        elif score <= t.get("negative", -2):
            label = "negativ"
        confidence = min(abs(score) / max(hit_count, 1), 1) if hit_count else 0
        return {"label": label, "score": score, "confidence": confidence,
                "hit_count": hit_count}

    # --- Auszug -----------------------------------------------------------
    def extract_excerpt(self, article: dict, max_length: int | None = None) -> str:
        limit = max_length or self.reports.get("max_summary_length", 320)
        text = collapse_ws(article.get("full_text") or article.get("first_paragraph") or "")
        if not text:
            return ""
        if len(text) <= limit:
            return text
        window = text[:limit]
        last_end = max(window.rfind(". "), window.rfind("! "), window.rfind("? "))
        if last_end >= limit * 0.5:
            return window[:last_end + 1].strip()
        last_space = window.rfind(" ")
        return (window[:last_space] if last_space > 0 else window).strip() + "…"

    # --- Haupt-Analyse ----------------------------------------------------
    def analyze(self, article: dict, source_priority: int = 50) -> dict:
        passes, reason = self.passes_required_filter(article)
        relevance = self.calculate_relevance(article, source_priority)
        sentiment = self.analyze_sentiment(
            f"{article.get('title', '')} {article.get('full_text', '')}",
            title=article.get("title", ""),
        )
        return {
            "passes": passes,
            "reject_reason": reason,
            "relevance_score": relevance["score"],
            "relevance_reasons": relevance["reasons"],
            "category": relevance["category"],
            "article_type": relevance["article_type"],
            "sentiment": sentiment["label"],
            "sentiment_score": sentiment["score"],
            "sentiment_confidence": sentiment["confidence"],
            "summary": self.extract_excerpt(article),
            "depth": relevance["depth"],
        }

    # --- Tagging ----------------------------------------------------------
    def auto_tag(self, article: dict, analysis: dict) -> list[str]:
        haystack = normalize(
            f"{article.get('title', '')} {article.get('full_text', '')} "
            f"{article.get('summary', '')}"
        )
        tags: list[str] = []
        seen: set[str] = set()

        def add(tag):
            if tag not in seen:
                seen.add(tag)
                tags.append(tag)

        for rule in self.tags_cfg.get("rules", []):
            if rule.get("if_sentiment"):
                if analysis.get("sentiment") == rule["if_sentiment"]:
                    add(rule["tag"])
                continue
            if rule.get("if_category"):
                if analysis.get("category") == rule["if_category"]:
                    add(rule["tag"])
                continue
            if rule.get("if_paywall") is True:
                if article.get("paywall"):
                    add(rule["tag"])
                continue
            match_text = rule.get("match_text")
            if isinstance(match_text, list):
                if not any(normalize(t) in haystack for t in match_text):
                    continue
                min_req = rule.get("min_required")
                if isinstance(min_req, list):
                    if not all(normalize(t) in haystack for t in min_req):
                        continue
                add(rule["tag"])
        return tags
