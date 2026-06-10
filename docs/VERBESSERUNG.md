# Verbesserung — Umsetzungsrunde Erweiterungsplan

Stand: 2026-06-09. Diese Runde setzt die Phasen 1–3 des
`docs/ERWEITERUNGSPLAN.md` in den wirkungsvollsten Punkten um, dokumentiert
den anschliessenden Debugging-Pass und die daraus folgenden Korrekturen.

## 1. Umgesetzte Erweiterungen ✓

| Plan-Ref | Erweiterung                                           | Umsetzung                                                                                                                                                                                                                                                                                 |
| -------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| §1.2     | **Aggregator-Queries aus `keywords.json` generieren** | `expandFeedQueries()` (Node) + `expand_feed_queries()` (Python), Feld `queries_from`/`max_queries` pro Aggregator-Feed in `sources.json`. Wirkung: Produktionen 10→24, Ensemble 8→24, Bing 2→12 Queries — neue Stuecke/Ensemble-Mitglieder landen automatisch im Backbone. 10 neue Tests. |
| §2.3     | **AMP-Fallback**                                      | Liefert die Hauptseite kaum Text oder Paywall-Signale, wird `<link rel="amphtml">` aufgeloest und die AMP-Version extrahiert (Node `findAmpUrl` + Python `find_amp_url`); der laengere Text gewinnt. Billiger als der Puppeteer-Fallback.                                                 |
| §4.2     | **`pressespiegel reanalyze --last 90d`**              | Neues CLI-Kommando + `reanalyzeArticles()` in der Pipeline + `updateArticleAnalysis()` in der DB: aktuelles Scoring/Sentiment/Tagging auf den Bestand anwenden — Pflicht nach jeder Spielplan-/Keyword-Pflege.                                                                            |
| §5.2     | **Linkliste als Markdown**                            | `/api/export?format=md` (Spiegel als weitergebbare Markdown-Linkliste inkl. „auch erschienen in") und UI-Knopf **„Linkliste kopieren"** im Artikel-Tab (kopiert die aktuell gefilterte Trefferliste in die Zwischenablage).                                                               |
| §1.1     | **Neue Quellen (verifiziert)**                        | Muenchner Feuilleton, concerti, crescendo — alle drei live gegen den Projekt-Fetcher getestet (`test-feed`).                                                                                                                                                                              |

## 2. Debugging-Pass: Befunde und Korrekturen

1. ✓ **Markdown-Injektion in Linkliste**: `[`/`]` in Artikel-Titeln brachen
   das `[Titel](URL)`-Format in Export und Zwischenablage → Titel werden
   jetzt fuer das Link-Label bereinigt (Server + Web-UI).
2. ✓ **Dokumentation nachgezogen**: README (CLI-Kommandos, Export-Formate,
   `queries_from`-Feld), ERWEITERUNGSPLAN-Status der umgesetzten Punkte.
3. **Kein Befund** bei: Zirkular-Import `news-search`→`config`,
   `autoTag`-Kompatibilitaet (akzeptiert `fullText` und `full_text`),
   Markdown-Export nutzt deduplizierte Artikelmenge, `state.articles`
   in der UI traegt geparste `also_on`-Listen.

## 3. Quellen-Kandidaten (in der Sandbox nicht verifizierbar)

Die Egress-Policy der Entwicklungsumgebung blockt einige Verlage — diese
Kandidaten bitte lokal mit `pressespiegel test-feed <url>` pruefen und bei
Erfolg in `config/sources.json` aufnehmen:

- Die Deutsche Buehne (rss.xml / feed-Pfad pruefen)
- Theater der Zeit (Feed-Autodiscovery auf der News-Seite)
- BR-Klassik Nachrichten-Feed
- theapolis.de News
- In Muenchen Magazin, kulturvollzug.de
- muenchen.de / Rathaus-Umschau (RSS-Pfad recherchieren)

## 4. Runde 2 — umgesetzt ✓ (2026-06-09)

1. ✓ **News-Sitemaps** (§2.1): `parseNewsSitemap()` (Node) +
   `parse_news_sitemap()` (Python) fuer Google-News-Sitemaps; optionales
   Feld `sitemap_url` pro Quelle in `sources.json`. Die Sitemap ergaenzt
   den Feed (Dedup per URL) und springt ein, wenn der Feed down ist.
   Hinweis: konkrete Sitemap-URLs der grossen Verlage waren aus der
   Sandbox nicht verifizierbar (Egress-Policy) — lokal pruefen, Muster:
   `https://<verlag>/sitemap-news.xml`.
2. ✓ **JSON-LD-First-Extraktion** (§2.2, Node): `tryJsonLdArticle()`
   liest `NewsArticle`/`Article`-JSON-LD (inkl. `@graph`); ein
   substanzieller `articleBody` (≥200 Zeichen, laenger als die Heuristik)
   gewinnt, Headline/Autor/Description fuellen Luecken. Python nutzt
   JSON-LD bereits via trafilatura.
3. ✓ **Veraltete README-Doku korrigiert**: Troubleshooting-Abschnitt und
   Tech-Stack verwiesen noch auf `better-sqlite3`/`npm run fix-sqlite` —
   beides existiert seit der Migration auf `node:sqlite` nicht mehr.

## 5. Naechste Runde (Backlog aus dem Erweiterungsplan)

1. **Story-Cluster in UI/Report** (§3.1) + **Kritikerspiegel** (§3.2) —
   Clipping-Struktur statt flacher Liste.
2. **Inkrementelle Scans** (§4.1) — Wasserzeichen pro Quelle.
3. **FTS5-Index** (§7.1) und **HTML-Snapshots** (§7.2) — sobald der
   Backfill-Bestand waechst.
4. **Sitemap-URLs nachtragen**: fuer Merkur/tz/AZ/SZ lokal die
   `sitemap-news.xml`-Pfade verifizieren und in `sources.json` eintragen.

## 6. Verifikation

Runde 1:

- ESLint: 0 Fehler, 0 Warnungen
- Node: 370 Tests gruen (5 neue: Query-Expansion, AMP)
- Python: 49 Tests gruen (6 neue: Query-Expansion, AMP)
- `python3 -m pyscraper selftest`: ok
- Live-Check: `test-feed` gegen Muenchner Feuilleton ok; Query-Expansion
  gegen reale `keywords.json`/`sources.json` geprueft

Runde 2:

- Node: 376 Tests gruen (4 neue: Sitemap-Parser, JSON-LD-Extraktion)
- Python: 51 Tests gruen (2 neue: Sitemap-Parser)
- ESLint sauber, `pyscraper selftest` ok
