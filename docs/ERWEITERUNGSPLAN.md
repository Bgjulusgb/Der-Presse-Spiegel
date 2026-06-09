# Erweiterungsplan

Stand: 2026-06-09. Baut auf `docs/ROADMAP.md` (Feature-Backlog) und
`docs/VERBESSERUNGSPLAN.md` (Audit/Korrekturen) auf. Fokus dieses Plans:
**Ausbau** des Programms entlang von sieben Achsen — Quellen, Scraping &
Datenabfrage, Datenanalyse, Programmlogik, Dashboard-UI/UX, Benutzer-
freundlichkeit sowie Speicherung & Archivierung. Alle vorgeschlagenen
Dienste sind **kostenlos nutzbar bzw. Open Source** und brechen das
Datenschutz-Versprechen (alles lokal, keine Pflicht-API-Keys) nicht.

Aufwandsangaben: S = Stunden, M = 1–3 Tage, L = ~1 Woche.

---

## 1. Viel mehr Suchquellen

### 1.1 Neue Feed-Quellen (S–M, nur `config/sources.json`)

Direkt als RSS/Atom verfuegbar, beim Einbau mit `test-feed` verifizieren:

| Kategorie          | Quelle                                           | Bemerkung                                                  |
| ------------------ | ------------------------------------------------ | ---------------------------------------------------------- |
| Theater-Fachpresse | Die Deutsche Buehne                              | Fachmagazin des Buehnenvereins                             |
| Theater-Fachpresse | Theater der Zeit (News)                          | teils Paywall, Snippets reichen                            |
| Theater-Fachpresse | theapolis.de (News)                              | Branchen-/Personalmeldungen                                |
| Kultur Muenchen    | Muenchner Feuilleton                             | Monatszeitung, Kulturkritik                                |
| Kultur Muenchen    | muenchen.de Presse-RSS                           | Stadt Muenchen, Kulturreferat                              |
| Kultur Muenchen    | In Muenchen Magazin                              | Veranstaltungen/Buehne                                     |
| Klassik/Buehne     | BR-Klassik, crescendo.de, concerti.de            | Musiktheater-Schnittmenge                                  |
| Eigenkanal         | muenchner-kammerspiele.de                        | Presse-/News-Seite (ggf. via Sitemap/RSSHub, s. 2.3)       |
| Video              | YouTube-Kanal-RSS                                | `youtube.com/feeds/videos.xml?channel_id=…` — ohne API-Key |
| Podcast            | Deutschlandfunk Kultur „Fazit", BR2 „kulturWelt" | Episoden-RSS; Shownotes durchsuchen                        |

### 1.2 Aggregator-Backbone verbreitern (S)

- Mehr Google-/Bing-News-Query-Permutationen: pro Produktion, pro
  Ensemble-Mitglied, plus Intendanz/„Muenchner Kammerspiele" + Kritik/
  Premiere/Interview. Queries generieren statt pflegen: beim Scan aus
  `keywords.json` ableiten (heute statisch in `sources.json`).
- **GDELT DOC 2.0 API** als dritter Backbone: kostenlose JSON-API ohne
  Key, durchsucht ein rollierendes 3-Monats-Fenster der Weltpresse inkl.
  deutscher Medien (`sourcecountry:GM`, `sourcelang:ger`). Liefert URL,
  Titel, Datum, Domain — perfekt als Discovery-Schicht vor dem eigenen
  Scraper. Neuer Connector `src/news-search.js` + `pyscraper/newssearch.py`.

### 1.3 Soziale Resonanz (M, optional zuschaltbar)

- **Bluesky**: oeffentliche AppView-Such-API (`app.bsky.feed.searchPosts`)
  ohne Login — Erwaehnungen von „Kammerspiele" als eigener Quellentyp
  `social`, getrennt vom Pressespiegel ausgewiesen.
- **Mastodon**: oeffentliche Hashtag-Timelines (`/api/v1/timelines/tag/…`)
  grosser Instanzen als JSON, ohne Key.
- **Reddit**: `reddit.com/r/Munich/search.json?q=Kammerspiele` — JSON ohne
  Key (User-Agent setzen).
- Eigene Relevanz-/Dedup-Regeln (kein Volltext-Scraping, kein Sentiment
  auf 280-Zeichen-Posts ueberbewerten); im Dashboard als separates Modul
  „Soziale Resonanz".

### 1.4 Quellen-Discovery (M)

- Auto-Discovery: gegebene Domain → `<link rel="alternate">`,
  `/feed`, `/rss`, `sitemap.xml` probieren; UI-Knopf „Feed finden" im
  Quellen-Tab.
- OPML-Paketierung: kuratierte Quellen-Sets („Bayern-Paket",
  „Fachpresse-Paket") als importierbare OPML-Dateien in `config/`.

## 2. Besseres Scraping & Datenabfrage (JSON / RSS / HTML / freie APIs)

1. **News-Sitemaps als Fallback-Kanal (M):** Fast alle Verlage pflegen
   `sitemap_news.xml` (Google-News-Standard) mit Titel, Datum, Sprache —
   oft vollstaendiger als der RSS-Feed. Neuer Parser in
   `feed-fetcher.js`/`feedparse.py`; pro Quelle optionales Feld
   `sitemap_url`. Behebt auch Quellen, deren RSS nur 10 Items liefert.
2. **JSON-LD-First-Extraktion (S–M):** `NewsArticle`-JSON-LD liefert
   Headline, Autor, Datum, `articleBody` strukturiert — vor Readability/
   trafilatura pruefen und bevorzugen (beide Welten, Node + Python).
3. **AMP-Fallback (S):** Bei Cookie-Wall/Consent-Bloat zuerst
   `<link rel="amphtml">` versuchen — schlankes HTML, oft ohne Wall;
   billiger als der Puppeteer-Fallback.
4. **RSSHub-Integration (M, optional):** Open-Source-RSS-Generator
   (AGPL, selbst hostbar via Docker, 900+ Routen) fuer Sites ohne Feed
   (Instagram/X-Ersatz, Nischen-Seiten). Als optionale `rsshub_base_url`
   in den Settings; Feeds laufen dann durch die normale Pipeline.
5. **Conditional-GET ausweiten (S):** ETag/Last-Modified gibt es schon
   fuer Feeds — auch fuer Artikel-Re-Enrichment nutzen (Spalte
   `articles.etag`), spart Bandbreite bei Backfills.
6. **Robots.txt-Respekt + Crawl-Budget (S):** `robots.txt` einmal pro
   Domain cachen und respektieren; schuetzt vor Blocks und ist fair.

## 3. Mehr & bessere Datenanalyse / -verarbeitung

1. **Share-of-Voice (M):** Vergleichsgroesse Residenztheater/Volkstheater/
   Gaertnerplatz mitzaehlen (eigene Zaehl-Queries im Aggregator-Backbone,
   nicht in den Pressespiegel mischen) → Dashboard-Kachel „Anteil an der
   Muenchner Theaterberichterstattung".
2. **Themen-Cluster pro Woche (M):** bestehendes `analytics/clustering.js`
   in die UI bringen: Artikel zu Story-Clustern gruppieren („Premiere X:
   7 Artikel, 5 Quellen, Sentiment ⌀ positiv") statt flacher Liste.
3. **Entity-Anreicherung via Wikidata (M):** kostenlose SPARQL-API
   (`query.wikidata.org/sparql`, JSON, ohne Key) einmalig/woechentlich:
   Ensemble-Personen → Normdaten, Geburtsjahr, weitere Engagements;
   Produktionen → Autor/Werk. Ergebnis in neue Tabelle `entities`,
   verbessert NER-Praezision und Tag-Vorschlaege. Cache lokal, Abruf
   nur auf Klick/Cron (Datenschutz: nur Namen oeffentlicher Personen).
4. **Kritiken-Konsens (M):** pro Produktion alle `type:review` aggregieren
   → „Kritikerspiegel" (n Kritiken, Verteilung positiv/neutral/negativ,
   Zitate aus `analytics/quotes.js`) als Report-Abschnitt.
5. **Zeitreihen pro Produktion (S–M):** Erwaehnungen pro Woche als
   Sparkline (Daten existieren via `temporal.js`; fehlt nur UI/Endpoint).
6. **Qualitaet vor Quantitaet:** Analyse-Doppelpflege Node/Python per
   Golden-Fixtures absichern (siehe VERBESSERUNGSPLAN §6), bevor neue
   Analytik einseitig waechst.

## 4. Programmlogik

1. **Inkrementelle Scans (M):** Scan-Wasserzeichen pro Quelle
   (`source_health.last_seen_item_date`); Standard-Scan holt nur Neues
   seit letztem Lauf — schneller, weniger Dedup-Arbeit. `--full` als
   Override.
2. **Job-Queue statt Ad-hoc-Scan (M):** Ein Scan-Job-Objekt (queued →
   running → done, Fortschritt in %) statt boolescher Sperre; Basis fuer
   UI-Fortschrittsbalken und geplante Backfills.
3. **Re-Analyse-Kommando (S):** `pressespiegel reanalyze --last 90d`
   wendet aktuelles Scoring/Tagging auf Bestandsartikel an (heute nur
   `retag-all` fuer Tags) — wichtig nach jeder Keyword-/Settings-Pflege.
4. **Regel-Engine fuer Relevanz (M):** Include-/Exclude-Regeln aus
   `keywords.json` in deklarative, in der UI editierbare Regeln heben
   (Wenn Quelle=X und Titel enthaelt Y → Score+20). Reduziert
   Code-Aenderungen fuer redaktionelle Feinjustierung.
5. **Konfig-Validierung (S):** JSON-Schema fuer `config/*.json` +
   Pruefung in `doctor.js`; verhindert stille Fehler durch Tippfehler.

## 5. Dashboard-UI/UX (minimalistisch Schwarz-Weiss)

Das strikte monochrome Design-System (hell/dunkel, Graustufen statt
Farbe) existiert bereits in `web/styles.css` — Ausbau heisst hier
**Verfeinerung und Bedienbarkeit**:

1. **Zeitungs-Typografie (S–M):** Serifen-Display-Schrift fuer
   Schlagzeilen (lokal gebundelt, z. B. Source Serif/IBM Plex Serif),
   klare Typo-Skala, mehr Weissraum — das „Pressespiegel"-Gefuehl
   einer gedruckten Zeitung, weiterhin 100 % monochrom.
2. **Befehls-Palette (M):** `Ctrl/Cmd-K` — Suche, Tab-Wechsel, „Scan
   starten", „Report erzeugen", gespeicherte Suchen; Tastaturkuerzel
   (j/k Artikel-Navigation, b Lesezeichen, / Suche) mit `?`-Overlay.
3. **Dichte-Modi (S):** Kompakt/Komfort-Umschalter fuer die
   Artikelliste (Zeilenhoehe, sichtbare Metadaten).
4. **Lesemodus (M):** Artikel-Detail als ablenkungsfreie Volltext-
   Ansicht (gespeicherter Text), Druck-Stylesheet fuer sauberen
   S/W-Ausdruck einzelner Artikel und des Dashboards.
5. **Skeleton-States & leere Zustaende (S):** Ladeplatzhalter statt
   Spinner; jede leere Ansicht erklaert den naechsten Schritt
   („Noch keine Artikel — Scan starten").
6. **Barrierefreiheit (S–M):** AA-Kontrast im Grau-Schema pruefen
   (gerade `--c-text-muted` auf `--c-surface-2`), Fokus-Ringe,
   ARIA-Labels fuer Tabs/Modals, `prefers-reduced-motion`.
7. **Dashboard-Komposition (M):** Kacheln „Heute neu", „Top-Story der
   Woche" (groesster Cluster), „Quellen-Gesundheit", Sparklines —
   konfigurierbar, welche Kacheln sichtbar sind.

## 6. Benutzerfreundlichkeit

1. **Erststart-Assistent (M):** Beim ersten `ui`-Start: Quellen-Pakete
   waehlen, Zeitfenster fuer Initial-Backfill, optional Zeitplan —
   danach laeuft alles ohne Konfigurationsdateien-Wissen.
2. **Verstaendliche Fehlertexte (S):** Feed-Fehler in der UI in
   Klartext uebersetzen (403 → „Quelle blockiert automatisierte
   Abrufe — Browser-Modus aktivieren?") mit Aktions-Knopf.
3. **Undo statt Bestaetigungsdialog (S):** Loeschen von Reports/
   Lesezeichen mit 5-Sekunden-Undo-Toast.
4. **Hilfe im Kontext (S):** Suchsyntax-Spickzettel als Popover am
   Suchfeld; Tooltip-Erklaerungen fuer Score/Sentiment-Badges.
5. **Electron-Feinschliff (M):** Tray-Icon mit „Letzter Scan / Neue
   Top-Artikel", Desktop-Benachrichtigung bei `sehr_relevant`
   (verknuepft mit VERBESSERUNGSPLAN §5.2), Auto-Update-Hinweis.

## 7. Datenspeicherung, Nutzung & Archivierung

1. **FTS5-Volltextindex (M):** wichtigste Speicher-Erweiterung — siehe
   VERBESSERUNGSPLAN §5.1; Voraussetzung fuer dauerhaft schnelle Suche
   ueber den wachsenden Archivbestand.
2. **Lokale HTML-Snapshots (M):** Beim Enrichment optional das bereinigte
   Artikel-HTML als komprimierte Datei ablegen
   (`data/snapshots/JJJJ/MM/<id>.html.gz`, Pfad in neuer Spalte
   `snapshot_path`) — Artikel bleiben lesbar, auch wenn die Quelle
   offline geht oder hinter eine Paywall wandert. Open-Source-Vorbilder:
   ArchiveBox/SingleFile/monolith.
3. **Wayback-Machine-Sicherung (S–M, opt-in):** „Extern archivieren"-
   Knopf + optionaler Auto-Modus fuer `sehr_relevant`: Save Page Now 2
   (`web.archive.org/save`, kostenloses archive.org-Konto mit
   S3-Keys; Rate-Limits beachten, `if_not_archived_within` nutzen).
   Vor Abruf existierender Snapshots: kostenlose CDX/Availability-API.
   Klar als „sendet URL an archive.org" gekennzeichnet (opt-in, da
   externe Uebertragung).
4. **Retention & Archiv-Tiering (M):** Einstellbare Politik: Volltexte
   aelter als N Monate komprimieren oder auf Snapshot verweisen,
   Metadaten bleiben fuer Suche/Trends vollstaendig. `VACUUM`-Wartung
   im Doctor.
5. **Backup/Restore (S):** `pressespiegel backup` → `VACUUM INTO`
   (konsistent trotz WAL) + Konfig-Ordner als ZIP; Restore-Kommando;
   Hinweis im Einstellungen-Tab.
6. **Volltext-Export (S):** Export erweitert um Markdown/JSONL
   (ein Artikel pro Zeile, inkl. Analyse-Feldern) — macht das Archiv
   fuer eigene Auswertungen/Werkzeuge nutzbar.

---

## Umsetzungs-Reihenfolge (Vorschlag)

| Phase                       | Inhalt                                                                                                                         | Warum zuerst                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **1 — Fundament**           | FTS5 (§7.1), inkrementelle Scans (§4.1), Konfig-Validierung (§4.5), Backup (§7.5)                                              | Alles Weitere erzeugt mehr Daten — Speicher/Suche muessen vorher skalieren |
| **2 — Quellen & Abfrage**   | Neue Feeds + generierte Aggregator-Queries (§1.1–1.2), News-Sitemaps (§2.1), JSON-LD-First (§2.2), AMP-Fallback (§2.3)         | Groesster Hebel fuer „mehr Artikel" bei geringem Risiko                    |
| **3 — Analyse & Dashboard** | Story-Cluster in UI (§3.2), Kritikerspiegel (§3.4), Dashboard-Kacheln + Typografie (§5.1, 5.7), Befehls-Palette (§5.2)         | Macht die neuen Datenmengen nutzbar und sichtbar                           |
| **4 — Archiv & Komfort**    | Snapshots (§7.2), Wayback opt-in (§7.3), Retention (§7.4), Erststart-Assistent (§6.1), GDELT/Bluesky/Wikidata (§1.2, 1.3, 3.3) | Langzeitwert + Kuer; externe Dienste bewusst zuletzt und opt-in            |

Jede Phase ist unabhaengig shipbar; Tests (Node + Python) und Lint
bleiben Pflicht pro Schritt. Externe Dienste (GDELT, Wayback, Wikidata,
Bluesky/Mastodon/Reddit, RSSHub-Public-Instanz) sind ausnahmslos
**optional und opt-in**, damit der Grundsatz „alle Daten bleiben lokal,
keine Pflicht-Keys, keine Kosten" erhalten bleibt.
