'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyze,
  analyzeSentiment,
  calculateRelevance,
  passesRequiredFilter,
  detectArticleType,
  categorize,
  extractExcerpt,
  findContextualMatch,
  articleBodyText,
} = require('../src/analyzer');

test('passesRequiredFilter akzeptiert Kammerspiele-Artikel', () => {
  const article = {
    title: 'Hamlet an den Muenchner Kammerspielen',
    fullText: 'Eine grossartige Inszenierung an den Kammerspielen.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, true);
});

test('passesRequiredFilter lehnt irrelevante Artikel ab', () => {
  const article = {
    title: 'Fussball-Bundesliga',
    fullText: 'Bayern Muenchen hat gewonnen.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, false);
});

test('passesRequiredFilter findet Keyword im summary (RSS-only Fallback)', () => {
  const article = {
    title: 'Neue Inszenierung sorgt fuer Diskussion',
    fullText: '',
    summary: 'Die Muenchner Kammerspiele zeigen ein neues Stueck.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, true);
});

test('passesRequiredFilter findet Keyword in firstParagraph', () => {
  const article = {
    title: 'Premiere am Wochenende',
    firstParagraph: 'An den Kammerspielen beginnt die neue Spielzeit.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, true);
});

test('articleBodyText vereint alle Textfelder', () => {
  const text = articleBodyText({
    fullText: 'A',
    summary: 'B',
    firstParagraph: 'C',
    meta: { description: 'D' },
  });
  for (const part of ['A', 'B', 'C', 'D']) assert.ok(text.includes(part));
});

test('articleBodyText ist robust bei leerem Artikel', () => {
  assert.equal(articleBodyText(null), '');
  assert.equal(articleBodyText({}), '');
});

test('passesRequiredFilter respektiert exclude-Liste', () => {
  const article = {
    title: 'Stellenanzeige bei den Kammerspielen',
    fullText: 'Die Muenchner Kammerspiele suchen eine Stellenanzeige.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, false);
  assert.ok(result.reason.startsWith('exclude:'));
});

test('passesRequiredFilter laesst Werbe-Label im gescrapten Volltext durch', () => {
  // Regression: gescrapter Volltext enthaelt UI-Labels wie "Werbung"/"Anzeige"
  // (Cookie-Banner, Werbeflaechen). Diese duerfen valide Artikel NICHT mehr
  // ausschliessen, solange Kammerspiele im Titel/Text steht.
  const article = {
    title: 'Premiere an den Muenchner Kammerspielen gefeiert',
    fullText:
      'Die Muenchner Kammerspiele zeigen eine grandiose Inszenierung. ANZEIGE Newsletter abonnieren. Werbung. Mehr aus dem Ressort.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, true);
});

test('passesRequiredFilter behaelt Vergleichsartikel mit Muenchner Bezug', () => {
  const article = {
    title: 'Theater-Vergleich',
    fullText: 'Die Muenchner Kammerspiele und die Hamburger Kammerspiele im Vergleich.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, true);
});

test('rssLikelyRelevant Vorfilter: Keyword vorhanden -> true', () => {
  const { rssLikelyRelevant } = require('../src/analyzer');
  assert.equal(
    rssLikelyRelevant({ title: 'Muenchner Kammerspiele Premiere', summary: 'x'.repeat(200) }),
    true
  );
});

test('rssLikelyRelevant Vorfilter: viel Text ohne Keyword -> false', () => {
  const { rssLikelyRelevant } = require('../src/analyzer');
  assert.equal(
    rssLikelyRelevant({ title: 'Fussball heute', summary: 'Bayern Muenchen gewinnt das Spiel. '.repeat(20) }),
    false
  );
});

test('rssLikelyRelevant Vorfilter: wenig Text -> true (im Zweifel anreichern)', () => {
  const { rssLikelyRelevant } = require('../src/analyzer');
  assert.equal(rssLikelyRelevant({ title: 'Theater News', summary: 'kurz' }), true);
});

test('calculateRelevance gibt Titel-Match mehr Punkte', () => {
  const titleMatch = calculateRelevance(
    {
      title: 'Muenchner Kammerspiele: Hamlet-Premiere',
      fullText: 'Ein Theaterabend.',
    },
    100
  );
  const textOnly = calculateRelevance(
    {
      title: 'Premiere im Theater',
      fullText: 'Die Muenchner Kammerspiele zeigen Hamlet.',
    },
    100
  );
  assert.ok(titleMatch.score > textOnly.score);
});

test('calculateRelevance bestraft kurze Artikel', () => {
  const result = calculateRelevance(
    {
      title: 'Muenchner Kammerspiele',
      fullText: 'Kurz.',
    },
    50
  );
  const longResult = calculateRelevance(
    {
      title: 'Muenchner Kammerspiele',
      fullText: 'Lorem ipsum dolor sit amet. '.repeat(50),
    },
    50
  );
  assert.ok(longResult.score > result.score);
});

test('categorize liefert korrekte Kategorien', () => {
  assert.equal(categorize(100), 'sehr_relevant');
  assert.equal(categorize(80), 'sehr_relevant');
  assert.equal(categorize(60), 'relevant');
  assert.equal(categorize(40), 'moeglich_relevant');
  assert.equal(categorize(10), 'irrelevant');
});

test('analyzeSentiment erkennt positive Texte', () => {
  const result = analyzeSentiment('Eine grossartige, brillante und sehenswerte Inszenierung.');
  assert.equal(result.label, 'positiv');
  assert.ok(result.score > 0);
});

test('analyzeSentiment erkennt negative Texte', () => {
  const result = analyzeSentiment('Eine enttaeuschende, langweilige und missglueckte Vorstellung.');
  assert.equal(result.label, 'negativ');
  assert.ok(result.score < 0);
});

test('analyzeSentiment beruecksichtigt Negationen', () => {
  const positive = analyzeSentiment('Die Inszenierung war grossartig.');
  const negated = analyzeSentiment('Die Inszenierung war nicht grossartig.');
  assert.ok(positive.score > negated.score);
});

test('analyzeSentiment liefert neutral bei normalem Text', () => {
  const result = analyzeSentiment('Die Vorstellung dauerte zwei Stunden mit einer Pause.');
  assert.equal(result.label, 'neutral');
});

test('detectArticleType erkennt Kritiken', () => {
  const type = detectArticleType({
    title: 'Hamlet Premiere',
    fullText: 'Die Inszenierung auf der Buehne. Die Regie. Die Auffuehrung war beeindruckend.',
  });
  assert.equal(type, 'review');
});

test('detectArticleType erkennt Interviews', () => {
  const type = detectArticleType({
    title: 'Interview mit Frau Mundel',
    fullText: 'Im Gespraech sagt sie: Wir wollen mehr. Sie erklaert: Das ist wichtig.',
  });
  assert.equal(type, 'interview');
});

test('extractExcerpt respektiert Maximallaenge', () => {
  const article = {
    fullText: 'Lorem ipsum dolor sit amet. '.repeat(100),
  };
  const excerpt = extractExcerpt(article, 50);
  assert.ok(excerpt.length <= 51);
});

test('passesRequiredFilter schliesst Hamburger Kammerspiele aus', () => {
  const article = {
    title: 'Hamburger Kammerspiele zeigen neues Stueck',
    fullText: 'Die Hamburger Kammerspiele zeigen eine neue Inszenierung.',
  };
  const result = passesRequiredFilter(article);
  assert.equal(result.passes, false);
  assert.ok(result.reason.includes('hamburger'));
});

test('calculateRelevance erkennt aktuelle Produktion "Wokey Wokey"', () => {
  const article = {
    title: 'Wokey Wokey an den Kammerspielen',
    fullText:
      'Nora Abdel-Maksoud inszeniert ihr Stueck Wokey Wokey an den Muenchner Kammerspielen.',
  };
  const result = calculateRelevance(article, 100);
  assert.ok(result.score >= 80, `erwarte sehr_relevant, score=${result.score}`);
  assert.equal(result.category, 'sehr_relevant');
});

test('calculateRelevance erkennt Ensemble-Mitglied Wiebke Puls', () => {
  const article = {
    title: 'Wiebke Puls in neuer Rolle',
    fullText:
      'Die Schauspielerin Wiebke Puls vom Ensemble der Muenchner Kammerspiele uebernimmt eine Hauptrolle. Die Inszenierung ist beeindruckend.',
  };
  const result = calculateRelevance(article, 100);
  assert.ok(result.score >= 50);
  assert.ok(result.matches.people.length > 0);
});

test('calculateRelevance gibt mehr Punkte bei Titel + Produktion', () => {
  const both = calculateRelevance(
    {
      title: 'Pinocchio an den Kammerspielen',
      fullText: 'Eine Inszenierung von Wu Tsang.',
    },
    100
  );
  const textOnly = calculateRelevance(
    {
      title: 'Theaternachricht',
      fullText: 'Bei den Muenchner Kammerspielen laeuft Pinocchio.',
    },
    100
  );
  assert.ok(both.score > textOnly.score + 30);
});

test('findContextualMatch findet Wort in Naehe', () => {
  const text = 'an den muenchner kammerspielen feierte pinocchio premiere';
  const ctx = findContextualMatch(text, 'pinocchio', ['kammerspielen'], 100);
  assert.equal(ctx, true);
});

test('findContextualMatch ignoriert wenn zu weit weg', () => {
  const text = 'pinocchio. ' + 'foo bar baz '.repeat(200) + 'kammerspielen.';
  const ctx = findContextualMatch(text, 'pinocchio', ['kammerspielen'], 100);
  assert.equal(ctx, false);
});

test('extractExcerpt liefert woertlichen Textanfang ohne Umsortierung', () => {
  const article = {
    title: 'Hamlet Premiere',
    fullText:
      'Das Wetter war schoen am Abend. Die Premiere von Hamlet an den Muenchner Kammerspielen war ein Erfolg. Der Verkehr stockte.',
  };
  const excerpt = extractExcerpt(article, 300);
  // Muss woertlich am Original-Anfang beginnen (keine Generierung/Umsortierung).
  assert.ok(article.fullText.startsWith(excerpt.replace(/…$/, '').trim()));
});

test('analyze vollstaendiger Durchlauf', () => {
  const article = {
    title: 'Brillante Hamlet-Premiere an den Muenchner Kammerspielen',
    fullText:
      'Eine grossartige Inszenierung. Die Auffuehrung war beeindruckend. ' +
      'Die Regie zeigt Mut. Das Ensemble ueberzeugt. ' +
      'Premiere. '.repeat(20),
    wordCount: 60,
  };
  const result = analyze(article, 100);
  assert.equal(result.passes, true);
  assert.equal(result.sentiment, 'positiv');
  assert.ok(result.relevanceScore > 50);
  assert.ok(['relevant', 'sehr_relevant'].includes(result.category));
});

test('calculateArticleDepth bewertet Artikel-Tiefe', () => {
  const { calculateArticleDepth } = require('../src/analyzer');
  const shallow = { fullText: 'Kurzer Text.' };
  const deep = { fullText: 'Langer Text mit viel Inhalt. '.repeat(50) };
  const shallowDepth = calculateArticleDepth(shallow);
  const deepDepth = calculateArticleDepth(deep);
  assert.ok(deepDepth > shallowDepth);
});

test('calculateMirrorRelevance bewertet Pressespiegel-Relevanz', () => {
  const { calculateMirrorRelevance } = require('../src/analyzer');
  const article = {
    title: 'Kammerspiele zeigen Hamlet',
    fullText: 'Die Muenchner Kammerspiele praesentieren Hamlet mit Ensemble.',
  };
  const score = calculateMirrorRelevance(article);
  assert.ok(score > 0);
  assert.ok(score <= 100);
});

test('analyzeSentiment berechnet Konfidenz', () => {
  const { analyzeSentiment } = require('../src/analyzer');
  const result = analyzeSentiment('Sehr sehr positiv und grossartig.');
  assert.ok(result.confidence >= 0 && result.confidence <= 1);
  assert.ok(result.hitCount >= 0);
});
