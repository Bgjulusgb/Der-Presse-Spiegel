# Erweiterungsplan

Stand: 2026-06-09 (ueberarbeitet). Baut auf `docs/ROADMAP.md`
(Feature-Backlog) und `docs/VERBESSERUNGSPLAN.md` (Audit/Korrekturen) auf.

## 0. Ziel des Programms (Nordstern)

**Das Produkt ist der Pressespiegel der Muenchner Kammerspiele**: eine
moeglichst vollstaendige, laufend aktualisierte Sammlung aller
Berichterstattung — **jeder Treffer als Link mit Quelle, Datum, Autor und
Analyse** (Relevanz, Sentiment, Artikeltyp, Tags, „auch erschienen in") —
gebuendelt im Dashboard und in HTML-/PDF-Reports. Alles lokal, kostenlos,
ohne Pflicht-API-Keys.

Jede Erweiterung muss auf eines dieser drei Kriterien einzahlen:

1. **Abdeckung** — kein Artikel ueber die Kammerspiele wird verpasst
   (mehr Quellen, bessere Abfrage).
2. **Praezision** — keine Fehltreffer, keine Dubletten, korrekte Daten
   (Analyse, Dedup, Datums-/Metadaten-Qualitaet).
3. **Darstellung** — der Spiegel selbst: Linkliste, Analyse-Badges,
   Reports, die man direkt weitergeben kann.

Messbar machen (S): Dashboard-Kachel „Abdeckung" mit Artikeln/Woche je
Quelle, Anteil `sehr_relevant`, Dubletten-Quote, Anteil Artikel ohne
Datum — damit jede Massnahme unten ueberpruefbar wirkt.

Aufwandsangaben: S = Stunden, M = 1–3 Tage, L = ~1 Woche.

---

## 1. Abdeckung: viel mehr Suchquellen

### 1.1 Neue Feed-Quellen (S–M, nur `config/sources.json`)

Direkt als RSS/Atom verfuegbar, beim Einbau mit `test-feed` verifizieren:

| Kategorie          | Quelle                                           | Bemerkung                                                  |
| ------------------ | ------------------------------------------------ | ---------------------------------------------------------- |
| Theater-Fachpresse | Die Deutsche Buehne                              | Fachmagazin des Buehnenvereins                             |
| Theater-Fachpresse | Theater der Zeit (News)                          | teils Paywall, Link + Snippet reichen fuer den Spiegel     |
| Theater-Fachpresse | theapolis.de (News)                              | Branchen-/Personalmeldungen                                |
| Kultur Muenchen    | Muenchner Feuilleton                             | Monatszeitung, Kulturkritik                                |
| Kultur Muenchen    | muenchen.de Presse-RSS                           | Stadt Muenchen, Kulturreferat                              |
| Kultur Muenchen    | In Muenchen Magazin                              | Veranstaltungen/Buehne                                     |
| Klassik/Buehne     | BR-Klassik, crescendo.de, concerti.de            | Musiktheater-Schnittmenge                                  |
| Eigenkanal         | muenchner-kammerspiele.de                        | Presse-/News-Seite (ggf. via Sitemap/RSSHub, s. 2.4)       |
| Video              | YouTube-Kanal-RSS                                | `youtube.com/feeds/videos.xml?channel_id=…` — ohne API-Key |
| Podcast            | Deutschlandfunk Kultur „Fazit", BR2 „kulturWelt" | Episoden-RSS; Shownotes durchsuchen                        |

### 1.2 Aggregator-Backbone verbreitern (S — groesster Einzelhebel)

Die Aggregatoren finden Artikel aus Hunderten Medien, die kein eigener
Feed abdeckt — fuer die Vollstaendigkeit des Spiegels wichtiger als jede
Einzelquelle:

- **Queries aus `keywords.json` generieren statt statisch pflegen**:
  pro Produktion, pro Ensemble-Mitglied, plus Intendanz/„Muenchner
  Kammerspiele" kombiniert mit Kritik/Premiere/Interview. Neue Stuecke
  aus dem Spielplan landen damit automatisch im Backbone (heute: Queries
  haendisch in `sources.json`).
- **GDELT DOC 2.0 API** als dritter Backbone: kostenlose JSON-API ohne
  Key, rollierendes 3-Monats-Fenster der Weltpresse inkl. deutscher
  Medien (`sourcecountry:GM`, `sourcelang:ger`). Liefert URL, Titel,
  Datum, Domain — Discovery-Schicht vor dem eigenen Scraper. Connector
  in `src/news-search.js` + `pyscraper/newssearch.py`.

### 1.3 Quellen-Discovery (M)

- Auto-Discovery: Domain eingeben → `<link rel="alternate">`, `/feed`,
  `/rss`, `sitemap.xml` probieren; UI-Knopf „Feed finden" im Quellen-Tab.
- OPML-Paketierung: kuratierte Sets („Bayern-Paket", „Fachpresse-Paket")
  als importierbare OPML-Dateien in `config/`.

## 2. Abdeckung & Praezision: besseres Scraping und Datenabfrage

1. **News-Sitemaps als Fallback-Kanal (M):** Fast alle Verlage pflegen
   `sitemap_news.xml` (Google-News-Standard) mit Titel, Datum, Sprache —
   oft vollstaendiger als der RSS-Feed (manche Feeds liefern nur
   10 Items). Neuer Parser in `feed-fetcher.js`/`feedparse.py`; pro
   Quelle optionales Feld `sitemap_url`.
2. **JSON-LD-First-Extraktion (S–M):** `NewsArticle`-JSON-LD liefert
   Headline, Autor, Datum, `articleBody` strukturiert — vor Readability/
   trafilatura pruefen und bevorzugen (Node + Python). Verbessert direkt
   die Metadaten-Qualitaet der Spiegel-Eintraege.
3. **AMP-Fallback (S):** Bei Cookie-Wall/Consent-Bloat zuerst
   `<link rel="amphtml">` versuchen — schlankes HTML, oft ohne Wall;
   billiger als der Puppeteer-Fallback. Wichtig: auch wenn der Volltext
   nicht zu holen ist, **bleibt der Link mit Feed-Snippet im Spiegel**
   (Paywall-Flag statt Verwerfen — heutiges Verhalten beibehalten).
4. **RSSHub-Integration (M, optional):** Open-Source-RSS-Generator
   (AGPL, selbst hostbar via Docker, 900+ Routen) fuer Sites ohne Feed.
   Als optionale `rsshub_base_url` in den Settings; Feeds laufen durch
   die normale Pipeline.
5. **Conditional-GET ausweiten (S):** ETag/Last-Modified auch fuer
   Artikel-Re-Enrichment (Spalte `articles.etag`) — spart Bandbreite
   bei Backfills.
6. **Robots.txt-Respekt + Crawl-Budget (S):** pro Domain cachen und
   respektieren; schuetzt vor Blocks (= dauerhafte Abdeckungs-Luecken).

## 3. Praezision: Datenanalyse und -verarbeitung

1. **Themen-Cluster (M):** bestehendes `analytics/clustering.js` in UI
   und Report bringen: Artikel zu Story-Clustern gruppieren („Premiere X:
   7 Artikel, 5 Quellen, Sentiment ⌀ positiv") statt flacher Liste —
   genau die Struktur eines redaktionellen Pressespiegels.
2. **Kritikerspiegel pro Produktion (M):** alle `type:review` aggregieren
   → n Kritiken, Verteilung positiv/neutral/negativ, Kernzitate aus
   `analytics/quotes.js`; als Report-Abschnitt und Produktions-Seite.
3. **Zeitreihen pro Produktion (S–M):** Erwaehnungen pro Woche als
   Sparkline (Daten liegen in `temporal.js`; fehlt nur UI/Endpoint).
4. **Share-of-Voice (M):** Residenztheater/Volkstheater/Gaertnerplatz als
   reine Zaehl-Queries mitlaufen lassen (nicht in den Spiegel mischen) →
   Kachel „Anteil an der Muenchner Theaterberichterstattung".
5. **Golden-Fixtures Node/Python (M):** gleicher Input → gleiches
   Scoring/Sentiment/Tagging in beiden Scrapern; sichert die
   Analyse-Qualitaet, bevor neue Analytik einseitig waechst.
6. **Kuer — Wikidata-Anreicherung (M, opt-in):** kostenlose SPARQL-API
   fuer Normdaten zu Ensemble/Produktionen; verbessert NER und
   Tag-Vorschlaege. Lokal gecacht, nur auf Klick/Cron.

## 4. Programmlogik

1. **Inkrementelle Scans (M):** Wasserzeichen pro Quelle
   (`source_health.last_seen_item_date`); Standard-Scan holt nur Neues,
   `--full` als Override. Macht den taeglichen Spiegel-Lauf schnell.
2. **Re-Analyse-Kommando (S):** `pressespiegel reanalyze --last 90d`
   wendet aktuelles Scoring/Tagging auf den Bestand an (heute nur
   `retag-all`) — Pflicht nach jeder Spielplan-/Keyword-Pflege, sonst
   ist der Alt-Bestand inkonsistent analysiert.
3. **Job-Queue statt Ad-hoc-Scan (M):** Scan-Job-Objekt (queued →
   running → done, Fortschritt in %) statt boolescher Sperre; Basis fuer
   UI-Fortschritt und geplante Backfills.
4. **Regel-Engine fuer Relevanz (M):** Include-/Exclude-Regeln als in
   der UI editierbare Regeln (Wenn Quelle=X und Titel enthaelt Y →
   Score+20) — redaktionelle Feinjustierung ohne Code-Aenderung.
5. **Konfig-Validierung (S):** JSON-Schema fuer `config/*.json` +
   Pruefung in `doctor.js`.

## 5. Darstellung: der Spiegel als Produkt (Report + Dashboard)

Der Report **ist** der Pressespiegel — er hat Prioritaet vor allgemeinem
UI-Feinschliff:

1. **Clipping-Ansicht (M):** Report und Artikel-Tab nach Vorbild eines
   redaktionellen Pressespiegels: gruppiert nach Produktion/Story-Cluster
   (§3.1), je Eintrag Quelle · Datum · Autor · Link · Score/Sentiment-
   Badge · 2-Zeilen-Snippet · „auch erschienen in"-Links.
2. **Teilbare Ausgaben (S–M):** „Linkliste kopieren" (Markdown/Plaintext
   in die Zwischenablage, z. B. fuer E-Mail/Slack), Druck-Stylesheet fuer
   sauberen S/W-Ausdruck; PDF bleibt fuer das formale Dokument.
3. **Zeitungs-Typografie (S–M):** Serifen-Display fuer Schlagzeilen
   (lokal gebundelt), klare Typo-Skala, mehr Weissraum — Pressespiegel-
   Anmutung, weiterhin 100 % monochrom (Design-System in `styles.css`
   existiert bereits).
4. **Dashboard-Komposition (M):** Kacheln „Heute neu", „Top-Story der
   Woche" (groesster Cluster), „Abdeckung/Quellen-Gesundheit",
   Sparklines; konfigurierbar.
5. **Skeleton-States & leere Zustaende (S):** jede leere Ansicht erklaert
   den naechsten Schritt („Noch keine Artikel — Scan starten").
6. **Kuer:** Befehls-Palette (Ctrl/Cmd-K) + Tastaturkuerzel, Dichte-Modi,
   Lesemodus, Barrierefreiheit (AA-Kontrast, Fokus-Ringe, ARIA).

## 6. Benutzerfreundlichkeit

1. **Erststart-Assistent (M):** Quellen-Pakete waehlen, Zeitfenster fuer
   Initial-Backfill, Zeitplan — danach laeuft der Spiegel ohne Wissen
   ueber Konfigurationsdateien.
2. **Verstaendliche Fehlertexte (S):** Feed-Fehler in Klartext (403 →
   „Quelle blockiert automatisierte Abrufe — Browser-Modus aktivieren?")
   mit Aktions-Knopf.
3. **Undo statt Bestaetigungsdialog (S):** Loeschen mit 5-Sekunden-Undo.
4. **Hilfe im Kontext (S):** Suchsyntax-Spickzettel am Suchfeld;
   Tooltips fuer Score/Sentiment-Badges.
5. **Electron-Feinschliff (M):** Tray-Status, Desktop-Benachrichtigung
   bei `sehr_relevant`, Auto-Update-Hinweis.

## 7. Speicherung, Nutzung & Archivierung

1. **FTS5-Volltextindex (M):** noetig, sobald der Backfill-Bestand
   waechst (~50k Artikel); FTS5 (`content=articles`) als Vorfilter,
   BM25/Fuse auf den Top-N; Node (`node:sqlite`) und Python nutzen
   denselben Index.
2. **Lokale HTML-Snapshots (M):** bereinigtes Artikel-HTML komprimiert
   ablegen (`data/snapshots/JJJJ/MM/<id>.html.gz`, Spalte
   `snapshot_path`) — der Spiegel bleibt vollstaendig lesbar, auch wenn
   Artikel offline gehen oder hinter eine Paywall wandern. Vorbilder:
   ArchiveBox/SingleFile/monolith.
3. **Wayback-Machine-Sicherung (S–M, opt-in):** „Extern archivieren" +
   Auto-Modus fuer `sehr_relevant` via Save Page Now 2
   (`web.archive.org/save`, kostenloses archive.org-Konto, Rate-Limits,
   `if_not_archived_within`); Lookup vorab ueber die kostenlose
   CDX/Availability-API. Klar gekennzeichnet (sendet URL an archive.org).
4. **Retention & Archiv-Tiering (M):** Volltexte aelter N Monate
   komprimieren/auf Snapshot verweisen; Metadaten bleiben vollstaendig
   fuer Suche und Trends. `VACUUM`-Wartung im Doctor.
5. **Backup/Restore (S):** `pressespiegel backup` → `VACUUM INTO` +
   Konfig-ZIP; Restore-Kommando; Hinweis im Einstellungen-Tab.
6. **Volltext-Export (S):** zusaetzlich Markdown/JSONL (ein Artikel pro
   Zeile inkl. Analyse-Feldern) — Archiv fuer eigene Auswertungen.

---

## Umsetzungs-Reihenfolge (auf das Ziel ausgerichtet)

| Phase                          | Inhalt                                                                                                           | Beitrag zum Ziel                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **1 — Abdeckung**              | Generierte Aggregator-Queries (§1.2), neue Feeds (§1.1), News-Sitemaps (§2.1), JSON-LD-First (§2.2), AMP (§2.3)  | Mehr gefundene Artikel = vollstaendigerer Spiegel; groesster Hebel, kleinstes Risiko |
| **2 — Spiegel-Ausgabe**        | Story-Cluster (§3.1), Clipping-Ansicht + Linkliste kopieren (§5.1–5.2), Kritikerspiegel (§3.2), Kacheln (§5.4)   | Das eigentliche Produkt: Links + Analyse in weitergebbarer Form                      |
| **3 — Praezision & Logik**     | Re-Analyse (§4.2), inkrementelle Scans (§4.1), Golden-Fixtures (§3.5), Regel-Engine (§4.4), Konfig-Schema (§4.5) | Weniger Fehltreffer, konsistente Analyse, schnelle taegliche Laeufe                  |
| **4 — Archiv & Skalierung**    | FTS5 (§7.1), Snapshots (§7.2), Retention (§7.4), Backup (§7.5), Wayback opt-in (§7.3)                            | Spiegel bleibt ueber Jahre nutzbar, durchsuchbar und belegbar                        |
| **Kuer (jederzeit, optional)** | GDELT (§1.2), Wikidata (§3.6), RSSHub (§2.4), Befehls-Palette/Lesemodus (§5.6), Erststart-Assistent (§6.1)       | Komfort und Reichweite — erst wenn Kern rund laeuft                                  |

Jede Phase ist unabhaengig shipbar; Tests (Node + Python) und Lint sind
Pflicht pro Schritt. Externe Dienste (GDELT, Wayback, Wikidata, RSSHub-
Public-Instanz) sind ausnahmslos **optional und opt-in**, damit der
Grundsatz „alle Daten bleiben lokal, keine Pflicht-Keys, keine Kosten"
erhalten bleibt.
