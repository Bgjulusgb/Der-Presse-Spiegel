# Changelog

Alle nennenswerten Aenderungen werden hier dokumentiert.
Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung: [SemVer](https://semver.org/).

## [Unreleased]

### Added — Feed-Robustheit & Operations (4 Bereiche)

**Bereich 1: sources.json bereinigt**

- Tote Feeds entfernt: Badische Zeitung, Wiener Zeitung (Kultur), MunichNOW, Stuttgart Journal, The Munich Eye, German Brief, Reuters Germany, MUH Bayerische Aspekte.
- URLs korrigiert: Bundesregierung (neue Feed-IDs `1151242`/`1151244`), deutschland.de, Berliner Zeitung + Kultur, VAN Magazin, euronews, Freitag, Perlentaucher, Theaterkompass.
- Stuttgarter Nachrichten ersetzt durch Stuttgarter Zeitung (alter Feed eingestellt).
- **23 Feeds** mit `use_browser: true` + `retry_delay: 3000` markiert (BR24/BR Klassik, DLF Kultur Feuilleton/Fazit/Nova, ZEIT/MDR/SWR/WDR/rbb24/3sat Kultur, FAZ Buehne&Konzert, n-tv, Augsburger Allgemeine, Berliner Morgenpost, Hamburger Abendblatt, Saechsische, Braunschweiger, Main-Post, BackstagePRO) — bekannt für 403-Sperren auf RSS-Endpoints, jetzt automatisch über Puppeteer.
- Bundesregierung Pressemitteilungen + FAZ Buehne und Konzert + BR24 Kultur als neue Feeds.

**Bereich 2: feed-fetcher.js robuster**

- `USER_AGENTS` ersetzt durch **`BROWSER_PROFILES`** — 5 vollständige Browser-Fingerprints (Chrome/Win, Safari/Mac, Firefox/Win, Firefox/Linux, Chrome/Mac) mit Accept, Accept-Language, Accept-Encoding, Sec-Fetch-\*, Sec-Ch-Ua, Upgrade-Insecure-Requests, DNT.
- **Per-Domain-Backoff**: Nach 3x HTTP 403 in 60s → 5min Cooldown pro Host. Stats in `getDomainFailureStats()`.
- **403-Auto-Puppeteer-Fallback**: Bei HTTP 403 ohne `use_browser:true` wird der Browser einmalig versucht — kein dauerhaftes Flag-Setting nötig.
- **Referer-Header** für ARD-Domains (br.de, mdr.de, swr.de, wdr.de, rbb24.de, ndr.de, sr.de, hr.de, deutschlandfunk.de, deutschlandfunkkultur.de, 3sat.de, zdf.de) — simuliert internen Aufruf.
- `classifyError()`: kategorisiert Fehler in `forbidden|notfound|gone|server|ratelimit|dns|timeout|socket|unknown` für gezielte Retry/Auto-Disable-Regeln.

**Bereich 3: Feed-Health + Scan-Summary + neue Auto-Disable-Regeln**

- DB-Schema: neue Spalten `last_error_class`, `last_status_code`, `last_via_browser` in `source_health` (Auto-Migration via ALTER TABLE).
- `database.classifyFeedHealth(h)`: liefert `ok|degraded|blocked|dead|unknown` aus error-class und consecutive_failures.
- **Auto-Disable-Schwellen je Fehlerklasse**:
  - HTTP 403 → **niemals** (sind strukturelle Sperren, kein echter Fehler)
  - HTTP 404 / 410 / DNS-Fehler → nach **5** Fehlern in Folge
  - Timeout / Socket-Fehler → nach **10** Fehlern in Folge
- **WebSocket scan_summary**: nach jedem Scan strukturierter Broadcast mit `total_feeds`, `ok`, `blocked_403`, `dead`, `new_articles`, `duplicates_removed`, `duration_ms`.

**Bereich 4: UI**

- Sources-Tab: **Feed-Health-Stats-Zeile** mit klickbaren Pills `[✓ ok] [◐ degraded] [⊘ blocked] [✕ dead] [ø unknown] [gesamt]`. Klick auf eine Pille filtert die Feed-Liste.
- Erweiterte Test-Diagnose: HTTP-Code, Antwortzeit, Item-Count, **letztes Item-Datum**, **via-Browser**-Badge, errorClass bei Fehlern.
- **Massen-Aktionen**: „Alle toten Feeds deaktivieren" + „Alle geblockt auf Browser-Modus" mit Bestätigungs-Snackbar.
- **OPML-Import mit Vorschau**: Textarea + Vorschau-Knopf führt HEAD-Validierung pro Feed durch und zeigt grüne/gelbe/rote Zeilen mit HTTP-Status, Antwortzeit, Duplikat-Markierung.
- Dashboard: scan_summary-Box mit farbcodierter Grid (gesamt/ok/blocked/dead/Artikel/Duplikate/Dauer).
- CSS für health-pills, opml-rows, scan-summary-grid in Light- und Dark-Mode.

### Added — vorheriger Stand (search/filter/RSS)

- **`docs/ROADMAP.md`** mit priorisierter Verbesserungs-/Erweiterungsliste (P0–P3, ~80 Items).
- **39 weitere Tests** in `tests/feed-fetcher-extensions.test.js`, `tests/feed-health.test.js`, plus erweiterte `tests/server-api.test.js` (Total jetzt 208, vorher 169).
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
