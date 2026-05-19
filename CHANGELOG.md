# Changelog

Alle nennenswerten Aenderungen werden hier dokumentiert.
Format: [Keep a Changelog](https://keepachangelog.com/de/1.1.0/), Versionierung: [SemVer](https://semver.org/).

## [Unreleased]

### Added
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
