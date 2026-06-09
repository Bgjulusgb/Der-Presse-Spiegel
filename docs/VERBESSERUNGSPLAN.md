# Verbesserungs-, Korrektur- und Erweiterungsplan

Stand: 2026-06-09 — Ergebnis eines vollstaendigen Code-Audits (Node `src/`,
`web/`, `bin/`, Python `pyscraper/`) inkl. Lint, Tests und Dependency-Pruefung.
Ergaenzt die langfristige Feature-Liste in `docs/ROADMAP.md` um konkrete
Korrektur- und Wartungs-Items.

Ausgangslage des Audits:

- 365 Node-Tests gruen, 42 Python-Tests gruen
- ESLint: 1 Fehler (CI-brechend, da `npm run lint` in der CI laeuft) + 13 Warnungen
- `npm audit`: 1 moderate Vulnerability (`ip-address`, transitiv via puppeteer)

---

## 1. In dieser Session behobene Punkte ✓

| Bereich                      | Problem                                                                                                                                                                          | Fix                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/analytics/scoring.js`   | `assessAuthorCredibility()` berechnete einen Score, der nie verwendet wurde (ESLint-Fehler `no-useless-assignment`, brach die CI)                                                | Konsistente Byline liefert jetzt `authorCredibility.moderate`; toter Code entfernt |
| `src/analytics/weighting.js` | `calculateBaseScore()` hiess "content relevance", pruefte aber nur den Titel — der Artikeltext (`text`/`combined`) wurde berechnet und verworfen                                 | Erwaehnung im Text (ohne Titel-Treffer) gibt jetzt +20                             |
| `src/server.js`              | `ResponseCache.middleware()` schrieb in die modulglobale Variable `cache` statt in die eigene Instanz (fragile Closure; zweite Instanz haette in den falschen Cache geschrieben) | `self = this` + try/catch um den Cache-Write                                       |
| `src/server.js`              | Keine Obergrenzen fuer `limit`/`period` — `?limit=999999999` oder `?period=99999d` konnten Speicher/CPU binden                                                                   | Caps: Artikel 2000, Trends 730 Tage, Logs 2000                                     |
| `src/server.js`              | `/api/reports/:filename` lieferte/loeschte jede Datei im Reports-Ordner                                                                                                          | Nur noch `.html`/`.pdf` erlaubt (zusaetzlich zu `path.basename`)                   |
| `src/server.js`              | Tote `validateInput`-Middleware (nie verwendet; `express.json({limit:'100kb'})` deckt das ab)                                                                                    | Entfernt                                                                           |
| `web/app.js`                 | `showScanSummary()` erzeugte ein DOM-Element, das nie eingehaengt wurde                                                                                                          | Toter Code entfernt                                                                |
| Diverse `src/analytics/*`    | 11 ESLint-Warnungen (ungenutzte Imports/Variablen, `prefer-const`)                                                                                                               | Bereinigt — Lint ist jetzt komplett sauber                                         |
| Dependencies                 | `ip-address` ≤10.1.0 (moderate, XSS-Advisory GHSA-v2v4-37r5-5v8g)                                                                                                                | `npm audit fix` → 0 Vulnerabilities                                                |

## 2. Geprueft und als korrekt befunden (Fehlalarme)

Diese Stellen sahen in der Analyse verdaechtig aus, sind aber **korrekt** —
dokumentiert, damit kuenftige Audits sie nicht erneut anfassen:

- **`pyscraper/pipeline.py` Dedup-Markierung**: `mark_as_duplicate(alt, neu)`
  ist richtig herum — gewinnt der neue Artikel, wird der alte als Duplikat
  des neuen markiert und seine URL in `also_on` des Gewinners uebernommen.
- **`pyscraper/database.py` `record_source_success`**: 9 Platzhalter, 9
  Parameter — die Reihenfolge stimmt (das `NULL` fuer `last_error_class`
  ist ein SQL-Literal, kein Platzhalter).
- **`src/analyzer.js` Regexe ohne `/i`**: unnoetig, da `normalize()` den
  Text vorher lowercased.
- **`src/deduplicator.js` `chooseWinner`**: bei gleicher Quellen-Prioritaet
  gewinnt bewusst die aeltere Veroeffentlichung (Original vor Nachdruck).
- **Sentiment-Negation** (`analyzer.js`): doppelte Negation hebt sich auf —
  linguistisch gewollt.
- **`feed-fetcher.js` `[^]` im Regex**: valides JavaScript ("beliebiges
  Zeichen inkl. Newline").

## 3. Offene Korrekturen (kurzfristig, P1)

1. **`src/scheduler.js` — Monatsbericht scannt nicht.** `weeklyReport()`
   ruft vor dem Report `runScan()` auf, `monthlyReport()` nicht.
   Entweder vereinheitlichen (Scan mit kleinem Lookback vor dem Report)
   oder die Absicht im Code dokumentieren.
2. **`also_on`-Merge beim Gewinnerwechsel** (Node + Python): verliert ein
   bereits gespeicherter Artikel gegen einen neuen, wird sein eigenes
   `also_on` auf `NULL` gesetzt statt in den Gewinner gemerged —
   "auch erschienen in"-Eintraege gehen verloren.
3. **URL-Datums-Heuristik zu breit** (`src/scraper.js` + `pyscraper/extract.py`):
   `(\d{4})[/\-_](\d{1,2})[/\-_](\d{1,2})` matcht auch Versions-/ID-Muster
   in URLs. Plausibilitaetsfenster (z. B. Jahr 2000–heute+1) und Pfad-Position
   pruefen.
4. **`query-parser.js` MUST-Semantik dokumentieren**: ein `+term` wird bei
   vorhandenen OR-Termen nicht erzwungen (`must` greift nur, wenn `should`
   leer ist). Falls gewollt (Pre-Filter vor BM25-Ranking), als Kommentar
   festhalten; sonst strikt machen + Tests anpassen.
5. **`pyscraper/extract.py`**: verschluckte Selector-Exceptions zumindest
   per `log.debug` sichtbar machen.

## 4. Wartung & Dependencies (P1–P2)

- **Minor/Patch-Updates** (risikoarm, von Tests abgedeckt): axios, date-fns,
  electron, electron-builder, eslint, fuse.js, lru-cache, prettier,
  puppeteer, undici, ws → `npm update`.
- **Major-Updates mit Migrationsaufwand** (separat angehen, ESM-Umstellung!):
  chalk 5, p-limit 7 (beide ESM-only — erst sinnvoll, wenn das Projekt auf
  ESM migriert), commander 15 (Changelog pruefen).
- **CI erweitern**: `npm audit --omit=dev --audit-level=high` als
  nicht-blockierender Step; `eslint --max-warnings 0`, damit neue
  Warnungen nicht wieder auflaufen.

## 5. Erweiterungen (mittelfristig, P2)

1. **SQLite FTS5-Volltextindex**: Die Suche laedt derzeit alle Artikel in
   den Speicher und rankt per BM25 in JS. Ab ~50k Artikeln (Backfill!)
   wird das spuerbar. FTS5 (`content=articles`) als Vorfilter, BM25/Fuse
   nur noch auf den Top-N — Node (`node:sqlite`) und Python koennen
   denselben Index nutzen.
2. **Benachrichtigungen bei Top-Treffern**: optionaler lokaler Kanal
   (Desktop-Notification via Electron, optional ntfy/E-Mail) wenn ein
   Artikel mit `category=sehr_relevant` eingeht.
3. **DB-Backup/Restore**: `pressespiegel backup` (VACUUM INTO) + Restore;
   gerade fuer ein Desktop-Tool mit lokaler DB wichtig.
4. **Server-Routen-Tests**: `tests/server-api.test.js` ausbauen
   (Fehlerpfade, neue Limit-Caps, Report-Dateinamen-Validierung).
5. **OpenAPI aktuell halten**: `docs/openapi.yaml` gegen `src/server.js`
   automatisiert pruefen (Drift-Gefahr bei 30+ Endpoints).

## 6. Langfristig (P3)

- **Doppelte Analyse-Logik Node/Python zusammenfuehren**: Relevanz-Scoring,
  Sentiment und Tagging existieren zweimal (src/analyzer.js und
  pyscraper/analyzer.py) und koennen driften. Optionen: gemeinsame
  Golden-Test-Fixtures (gleicher Input → gleicher Output in beiden Welten)
  oder eine Seite zur Referenz erklaeren.
- **ESM-Migration** des Node-Teils (oeffnet chalk 5 / p-limit 7 u. a.).
- **Semantische Suche** via lokale Embeddings (siehe ROADMAP P3) — passt
  zum Datenschutz-Versprechen, wenn das Modell lokal laeuft.
- **E2E-Tests** der Web-UI (Playwright) fuer die zwoelf Tabs.
