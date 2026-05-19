# Changelog

Alle nennenswerten Aenderungen werden hier dokumentiert.
Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- **`docs/ROADMAP.md`** mit priorisierter Verbesserungs-/Erweiterungsliste (P0–P3, ~80 Items).
- **`src/text-utils.js`**: Umlaut-Normalisierung (ä↔ae), Variants-Expansion, deutsches Compound-Splitting mit Scoring-Heuristik, Kölner-Phonetik-Encoding, Spracherkennung (`franc-min`), Lesezeit-Schätzung, Keyword-Extraktion (`keyword-extractor`), Satz-Splitter, sentence-boundary Snippet-Extraktion, `hasImage`-Detector.
- **`src/search.js`** Such-Algorithmus-Erweiterungen:
  - BM25-Index nutzt Compound-Split bei Indexierung — `kammerspiele` findet `Kammerspielen` und `Opernpremiere`.
  - Phonetik-Index (Kölner Phonetik) auf Titel/Summary — Suche nach `Tschaikowsky` findet `Tschaikowski`.
  - LRU-Cache (`lru-cache`, 200 Eintraege, 60s TTL) fuer wiederholte Queries.
  - Automatischer Did-you-mean-Fallback bei 0 Treffern und nicht-strukturierter Query.
  - `snippetFor(article, query)` extrahiert satz-genauen Kontext-Snippet.
- **`src/query-parser.js`** neue Feldoperatoren: `words:>500`, `words:<=100`, `reading:<=5`, `lang:de`, `image:yes`, `tagnot:spam`, `tag:a tag:b tagmode:all|any|none`. Plus Aliase `language→lang`, `wordcount→words`, `readingtime→reading`.
- **`/api/articles`** neue Query-Parameter: `tagMode`, `tagNot`, `wordsMin`, `wordsMax`, `readingTimeMin`, `readingTimeMax`, `paywall`, `image`, `lang`, `dupes=hide`, `facets=true`.
- **Facets-Endpoint**: `?facets=true` liefert Aggregations-Block fuer Kategorie, Sentiment, Quelle, Tag, Sprache, Paywall, Image, Type.
- **Did-you-mean-Antwortfeld**: bei Fallback-Suggestion enthält API-Response `didYouMean`.
- **26 neue RSS-Quellen** in 5 Kategorien (Total jetzt 104, vorher 78):
  - **ÖR-Kultur (+9)**: DLF Buechermarkt/Fazit/Kompressor/Nova, BR Klassik/Kultur-Buehne, NDR/MDR/WDR/hr2/rbb24/SWR Kultur.
  - **Theater-Fachpresse (+5)**: Perlentaucher, Monopol Magazin, VAN Magazin, Theaterkompass, BackstagePRO.
  - **Ueberregional (+3)**: Cicero, Freitag, Jungle.World, Frankfurter Rundschau Kultur.
  - **Lokal (+5)**: Berliner Zeitung Kultur, Tagesspiegel Berlin, Hamburger Abendblatt Kultur, Wiener Zeitung Kultur, kreuzer Leipzig.
- **53 neue Tests** in `tests/text-utils.test.js`, `tests/search-extensions.test.js`, `tests/query-parser-extensions.test.js`, `tests/server-api.test.js` (Total jetzt 169, vorher 116).
- Chunked enrichment mit Fortschrittsanzeige (alle 100 Artikel ein Log-Update mit ETA).
- `scraping.max_articles_per_scan` (Default 1500) verhindert endlose Scans.
- Tastenkuerzel-Overlay (Taste `?`), Quick-Filter-Pills, Active-Filter-Chips, Gespeicherte Suchen.
- BM25-Suche: Proximity-Boost, Coverage-Penalty, Title-Stem-Bonus.
- API `/api/articles`: kommaseparierte Mehrfach-Filter (category/sentiment/source/tag/type) plus minScore/maxScore.
- Docker Support (Dockerfile + docker-compose.yml), GitHub Actions CI/Release Workflows, Dependabot, Issue Templates.
- ESLint 9 (Flat Config) + Prettier + npm Scripts.
- Dokumentation: `CONTRIBUTING.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/DEVELOPMENT.md`, `docs/openapi.yaml`.

### Changed
- Default-Scraping-Settings: 8 statt 4 parallele Requests, 15s Timeout, 2 Retries, 800ms Rate-Limit, Auto-Disable nach 6 Fehlern.
- Dark-Mode-Kontrast deutlich verbessert (Text, Surfaces, Status-Badges).
- Paywall-Erkennung erweitert um FAZ+, taz+, Welt+, Piano, deutsche Phrasen ("Bezahlinhalt", "jetzt abonnieren").
- Feed-Health-Liste sortiert nach Fehlern, mit Response-Time und ✓/✕ Icons.

### Removed
- Quelle "Koelner Stadt-Anzeiger" entfernt.
- Quelle "ARD Mediathek - Kultur" entfernt (Endpoint liefert dauerhaft HTTP 404).

### Fixed
- `config/sources.json` enthielt zwei JSON-Dokumente mit `=======`-Merge-Marker und liess `src/config.js` mit SyntaxError abstuerzen.
- `web/app.js:637` hatte ein gebrochenes Template-Literal, das `'+'+(t.change > 0 ? '+' : ''}5` als Text in die Trends-UI rendern liess.
- Browser-Warnung "Could not parse CSS stylesheet" konnte durch `NaN%` in dynamisch erzeugten Inline-Styles ausgeloest werden. Alle Renderer in `web/app.js` und `src/reporter.js` nutzen jetzt `safeNum`/`clampPct`/`toFixed(2)`.
- Source-Test-Ergebnis-Badge hatte `<span class="badge ...">[XML</span>` und ein leeres Fehler-Badge.
- Pipeline blockierte bei grossen Scans nach "Anreicherung ... neu, ... schon in DB" stundenlang ohne Log-Ausgabe.

## [2.0.0] - vor diesem Release

- Vorherige Versionen siehe Git-Historie.
