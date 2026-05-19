# Pressespiegel Münchner Kammerspiele

Ein vollständig **lokales** Pressespiegel-Tool für die Münchner Kammerspiele
mit grafischer Bedienoberfläche, Desktop-App (`.exe`/`.dmg`/`.AppImage`)
und ohne jegliche kostenpflichtigen APIs.

**Alles bleibt auf dem eigenen Rechner.** Keine Cloud, keine externen Dienste,
kein E-Mail-Versand. Reports landen lokal in `reports/`, die Datenbank in `data/`.

## Was das Tool tut

- **Google News + Bing News als universelle Pflicht-Backbone** – keyword-basiert,
  immer erreichbar, liefert 100+ Artikel pro Scan über alle deutschen Quellen
- Saugt RSS-/Atom-/RDF-/JSON-Feeds seriöser Theater- und Kulturredaktionen ab
  (35 Quellen vorkonfiguriert)
- **HTTP-Client `undici`** mit HTTP/2, rotierenden User-Agents, Auto-Encoding-Detection
  (UTF-8, ISO-8859-1, Windows-1252), Conditional GET (ETag/Last-Modified),
  Proxy-Support
- **Puppeteer-Fallback** für Cloudflare-geschützte Seiten (SZ, FAZ, ZEIT, …) –
  automatisch bei 403/429
- **`@mozilla/readability`** für saubere Artikel-Extraktion (gleiche Engine wie
  Firefox-Lesemodus)
- **Google-News-URL-Resolver** – löst die `news.google.com/rss/articles/CBMi…`
  Redirects zu den echten Quell-URLs auf
- HTML-Strip in Feed-Items (saubere Summaries ohne `<a href>`-Reste)
- Multi-Stufen Duplikat-Erkennung (URL → Titel-Levenshtein → Text-Cosine)
- **Hybride Suche** mit BM25 + Fuse.js + Synonyme + Time-Decay + did-you-mean
- Such-Syntax: `"exakte Phrase"`, `-NOT`, `OR`, `title:`, `source:`, `sentiment:`
- Relevanz-Scoring nach aktuellem Spielplan, Ensemble, Spielstätten
- Sentiment-Analyse mit Theater-spezifischem Wortbuch
- **Lesezeichen**, **Tags**, **Trends**, **Mentions-Wolke**, **CSV/JSON-Export**
- Moderne **Web-UI** mit 11 Tabs, **Desktop-App** (Electron) als `.exe`/`.dmg`/`.AppImage`
- Live-Updates per WebSocket während Scans

## Schnellstart

```bash
git clone <repo>
cd Der-Presse-Spiegel
npm install

# Grafische Oberfläche im Browser:
npm run ui                    # öffnet http://localhost:4711

# Als Desktop-App (Electron):
npm run electron

# Als .exe / .dmg / .AppImage bauen:
npm run build:win             # Windows: installer + portable
npm run build:linux           # Linux: AppImage + deb
npm run build:mac             # macOS: dmg + zip
npm run build:all             # alle Plattformen
```

Die fertige `.exe` landet in `dist/Pressespiegel-2.0.0-x64.exe`.

## Bedienoberfläche (Web-UI / Electron)

Die UI hat 9 Tabs:

1. **Dashboard** — Übersicht, Top-Artikel, Sentiment-Donut, Quellen-Statistik
2. **Artikel** — Filterbare/durchsuchbare Liste mit BM25-Hybrid-Suche.
   Tastenkürzel `/` fokussiert die Suche.
3. **Scan** — Scan starten mit Datums-Picker, Live-Log per WebSocket,
   Feed-Gesundheit
4. **Reports** — HTML/PDF-Reports generieren, auflisten, öffnen, löschen
5. **Suchbegriffe** — Spielplan, Ensemble, Personen, Ausschluss
   live als Chips bearbeiten (Tab `Suchbegriffe`)
6. **Quellen** — RSS-Feeds verwalten, einzeln aktivieren/deaktivieren,
   **Test-Button** prüft sofort, ob ein Feed erreichbar ist und wie viele
   Einträge er liefert
7. **Duplikate** — Duplikat-Prüfung der letzten 90 Tage starten
8. **Einstellungen** — Scraping, Dedup-Schwellen, Cron-Zeitpläne
9. **Logs** — letzte 200 Log-Einträge

### Live-Funktionen über WebSocket

Während ein Scan läuft, sendet der Server Live-Log-Events an die UI.
Du siehst in Echtzeit, welches Feed gerade abgerufen wird, wie viele
Artikel gefunden wurden und wenn Fehler auftreten.

## CLI-Befehle

```bash
pressespiegel ui                                    # GUI im Browser
pressespiegel electron                              # Desktop-App

pressespiegel scan --last 7d                        # Scan
pressespiegel report --last 30d --open              # Report + Browser

pressespiegel search "Pinocchio"                    # Lokale Suche
pressespiegel stats --last 30d
pressespiegel health

pressespiegel test-feed <url>                       # Einzelnen Feed testen
pressespiegel test-all-feeds                        # Alle Feeds prüfen
pressespiegel dedupe --dry-run
pressespiegel open                                  # Neuesten Report öffnen
pressespiegel list-reports

pressespiegel config list
pressespiegel config add-keyword "..." --type productions
pressespiegel config add-source "..." --priority 80

pressespiegel schedule                              # Cron-Modus
```

## Such-Algorithmus

Drei-Stufen-Pipeline:

### 1. Pflichtfilter
Mindestens einer der `required`-Begriffe (`Kammerspiele`, …) muss vorkommen.
Treffer auf `exclude` (Hamburger/Berliner Kammerspiele, Stellenanzeige, …)
führen sofort zum Verwerfen.

### 2. Relevanz-Scoring

| Faktor | Punkte |
|---|---:|
| Required-Begriff im Titel | +80 |
| Required-Begriff im Text (max. 5×) | +10/Treffer |
| Produktion im Titel | +50 |
| Produktion im Text mit Kammerspiele-Kontext (±400 Zeichen) | +25 |
| Produktion im Text ohne Kontext | +12 |
| Fuzzy-Match Produktion (Tippfehler) | +30 |
| Titel kombiniert Kammerspiele + Produktion | +100 |
| Person im Titel | +40 |
| Person im Text mit Kontext | +20 |
| Spielstätte | +10 |
| Theater-Kontext (≥2 Begriffe) | +8 |
| Typ: Kritik / Interview / Ankündigung | +30 / +25 / +20 |
| Premiere erwähnt | +20 |
| Kurzer Artikel (<100 Worte) | −20 |
| Sehr kurz (<50 Worte) | −50 |
| Top-Quelle (Score ≥95) | +15 |

Schwellen: `sehr_relevant`≥80, `relevant`≥50, `moeglich_relevant`≥30.

### 3. Volltextsuche (UI)

In der Artikel-UI wird jede Suchanfrage über zwei Engines parallel ausgewertet
und gewichtet zusammengeführt:

- **BM25** (Term-Frequency × Inverse-Document-Frequency, mit Stemming + Stopwortfilter)
  fängt exakte und teilweise Übereinstimmungen ab
- **Fuse.js** (Bitap mit Levenshtein-Distanz, Threshold 0.45) fängt
  Tippfehler und Wortdrehungen

Gewichtung: 65 % BM25 + 35 % Fuse. Der Suchindex wird pro Anfrage neu gebaut
(ist bei ein paar tausend Artikeln in <50 ms erledigt).

## Feed-Fetcher

Robuste Pipeline pro Feed:

1. **Browser-ähnliche Header** (Firefox-UA, Accept-Encoding, Sec-Fetch-*).
   Umgeht die meisten einfachen Bot-Blocker.
2. **Conditional GET** mit ETag und Last-Modified (pro Feed in DB gespeichert).
   Spart Bandbreite, vermeidet Rate-Limits, reduziert Ladezeiten beim
   wiederholten Scan um >80 %.
3. **Auto-Encoding** aus HTTP-Header, BOM, XML-Declaration, Meta-Tag.
   Korrekt umgewandelt mit `iconv-lite`.
4. **Multi-Format-Parser**: RSS 2.0, Atom, RDF (RSS 1.0), JSON Feed
5. **Puppeteer-Fallback** für Feeds mit Cloudflare-Schutz (per Feed `use_browser: true`)
6. **Retry mit Exponential Backoff** bei vorübergehenden Netzwerkfehlern
7. **Rate-Limit pro Domain** (Default 1 Request/Sekunde)
8. **Feed-Health-Tracking**: ETag/Last-Modified/Response-Zeit/Itemzahl
   werden pro Feed in der DB festgehalten

## Duplikat-Erkennung

Pro Artikel werden drei Stufen geprüft:

1. **URL-Match** nach Entfernung aller Tracking-Parameter (utm_*, gclid, fbclid, …)
2. **Titel-Ähnlichkeit** via Levenshtein > 85 %
3. **Text-Ähnlichkeit** auf erstem Absatz via Cosine > 80 %

Bei Treffer: Sieger nach Quellen-Priorität (nachtkritik=SZ=FAZ=100 → …),
alle URLs als "auch erschienen in" mit dem Sieger verknüpft.

## Aktueller Spielplan & Ensemble

Vorkonfiguriert in `config/keywords.json`:

**Produktionen 2025/26**: Wachse oder weiche · Eurydike und Orpheus ·
Wokey Wokey · Pinocchio · Love me tender · Enjoy Schatz · Mein kleines
Prachttier · Meister und Margarita · Fräulein Else · Fremd · Bevor ich
es vergesse · Play Auerbach · Mephisto · Very Rich Angels · Tristan
(und Isolde) · Wallenstein · Was ihr wollt

**Personen**: Barbara Mundel (Intendantin), Daniel Veldhoen, Viola Hasselberg,
das gesamte Ensemble (Wiebke Puls, Walter Hess, Samuel Koch, Thomas Schmauser,
Annette Paulmann, Lucy Wilke, Luisa Wöllisch, Stefan Merki, Edmund
Telgenkämper, Jelena Kuljić, …), aktuelle Gastregien (Nora Abdel-Maksoud,
Wu Tsang, Felicitas Brucker, Anna Smolar, Leonie Böhm, …).

Anpassen über die UI (Tab "Suchbegriffe") oder per CLI.

## Projekt-Struktur

```
.
├── bin/cli.js                # CLI-Einstiegspunkt
├── electron/
│   ├── main.js               # Electron Main-Prozess
│   └── preload.js            # Sicherer Bridge
├── web/
│   ├── index.html            # SPA-UI
│   ├── styles.css            # Design-System mit Dark-Mode
│   └── app.js                # UI-Logik + WebSocket
├── src/
│   ├── analyzer.js           # Relevanz + Sentiment + Artikeltyp
│   ├── config.js             # JSON + .env laden
│   ├── database.js           # SQLite (WAL), Schema, Feed-Health
│   ├── deduplicator.js       # Multi-Level Dedup
│   ├── feed-fetcher.js       # Robuster RSS/Atom/JSON Fetcher
│   ├── logger.js             # Winston (Console + File)
│   ├── pipeline.js           # fetch → analyze → dedupe → save
│   ├── puppeteer-fetcher.js  # Browser-Fallback für blockierte Feeds
│   ├── reporter.js           # HTML + PDF Reports
│   ├── scheduler.js          # Cron-Jobs (lokal)
│   ├── scraper.js            # Artikel-Extraction
│   ├── search.js             # BM25 + Fuse.js Hybrid
│   ├── server.js             # Express + WebSocket
│   └── utils.js              # URL, Levenshtein, Cosine, Date
├── config/
│   ├── sources.json          # RSS-Quellen + Prioritäten
│   ├── keywords.json         # Spielplan, Ensemble
│   ├── settings.json         # Tool-Settings
│   └── sentiment.json        # Theater-Wortschatz
├── tests/                    # 78 Unit + Integration Tests
├── data/                     # SQLite-DB (lokal)
├── logs/                     # Logs (lokal)
├── reports/                  # HTML/PDF Reports (lokal)
├── dist/                     # Gebaute Apps (.exe, .dmg, .AppImage)
└── package.json
```

## Tech-Stack (alles neueste Versionen)

| Bereich | Library | Version |
|---|---|---|
| HTTP | axios | ^1.16 |
| Encoding | iconv-lite | ^0.7 |
| XML | xml2js, cheerio | ^0.6, ^1.2 |
| HTML-Entities | he | ^1.2 |
| RSS-Fallback | rss-parser | ^3.13 |
| Browser | puppeteer | ^25.0 |
| Datenbank | better-sqlite3 | ^12.10 |
| Suche | fuse.js, natural | ^7.3, ^8.1 |
| Datum | date-fns | ^4.2 |
| Server | express | ^5.2 |
| WebSocket | ws | ^8.20 |
| Scheduler | node-cron | ^4.2 |
| Logging | winston | ^3.19 |
| CLI | commander | ^14.0 |
| Concurrency | p-limit | ^3.1 |
| Desktop | electron | ^42.1 |
| Build | electron-builder | ^26.8 |
| Tests | Node built-in test | — |

## Tests

```bash
npm test
```

**78 Tests, 100 % grün.** Coverage:

- `utils.test.js` — URL-Normalize, Levenshtein, Cosine, Date-Parse, Escape
- `analyzer.test.js` — Relevanz, Sentiment + Negationen, Fuzzy, Kontext
- `deduplicator.test.js` — 3-stufige Dedup, Winner-Selection
- `scraper.test.js` — Datums-Extraction aus Meta/JSON-LD/URL/Text
- `search.test.js` — BM25, Fuse-Hybrid, Stemming, Suggestions
- `feed-fetcher.test.js` — RSS/Atom/RDF/JSON parsen, Encoding-Detection,
  HTML-Entity-Decoding

## Edge Cases

- **Cloudflare/Bot-Block**: Puppeteer-Fallback automatisch via `use_browser: true`
- **Paywall**: erkannt und markiert; RSS-Snippet wird verwertet
- **Kein Datum**: Multi-Stage-Detection (Meta → JSON-LD → time-Element → URL → Text)
- **Falsches Encoding**: Auto-Detection und Re-Decoding mit iconv-lite
- **RSS-Feed down**: Eintrag in `source_health`, andere Feeds laufen weiter
- **Tracking-Parameter**: vor URL-Vergleich entfernt
- **Schwester-Theater**: Hamburger/Berliner/Wiener Kammerspiele per Exclude
- **Tippfehler in Suche**: Fuse-Hybrid fängt das ab
- **HTML-Entities in Titeln**: `he`-Decoder
- **304 Not Modified**: korrekt erkannt, kein Re-Fetch nötig

## Datenschutz

Alles bleibt lokal:
- SQLite-DB in `data/`
- HTML/PDF-Reports in `reports/`
- Logs in `logs/`
- Konfiguration in `config/`

**Es werden keine Daten an Server, Cloud oder per E-Mail versandt.**
Lediglich die konfigurierten RSS-Feeds werden abgerufen — exakt was
jeder Browser bei einem Besuch dieser Seiten auch tut.

## Lizenz

MIT
