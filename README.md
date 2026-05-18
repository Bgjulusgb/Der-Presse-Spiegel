# Pressespiegel Muenchner Kammerspiele

Ein vollstaendig **lokales** Node.js-Tool zur Beobachtung der Presse
rund um die Muenchner Kammerspiele.

**Alles bleibt auf dem eigenen Rechner.**
Keine Cloud-API, kein E-Mail-Versand, keine externen Dienste. Reports werden lokal als HTML/PDF im Ordner `reports/` abgelegt.

## Was das Tool tut

- Saugt RSS-Feeds von seriosen Theater- und Kulturredaktionen ab
  (nachtkritik.de, SZ, FAZ, ZEIT, BR, Deutschlandfunk Kultur, taz, Spiegel,
  Welt, Merkur, AZ, tz, …)
- Reichert jeden Artikel an: holt den Volltext, extrahiert Datum, Autor, Paywall-Status
- Erkennt Duplikate (URL, Titel-Levenshtein, Text-Cosine) – behaelt den
  hochwertigsten Treffer und merkt alle weiteren Fundstellen
- Bewertet jeden Artikel nach **aktuellem Spielplan** der Kammerspiele
  (Wokey Wokey, Pinocchio, Wallenstein, Mephisto, Tristan, Eurydike und
  Orpheus, …), nach Ensemble-Namen (Wiebke Puls, Walter Hess, Samuel Koch, …),
  nach Spielstaetten und Theater-Kontext
- Sentiment-Analyse mit Theater-spezifischem Wortbuch
  (positiv/negativ/neutral, mit Negationen und Verstaerkern)
- Erstellt einen modernen, interaktiven HTML-Report mit Live-Filter,
  Live-Suche (Taste `/`), Sortierung, Dark-Mode und mobile-responsive
  Layout. Optional PDF via Puppeteer.

## Schnellstart

```bash
git clone <repo>
cd Der-Presse-Spiegel
npm install

# Zuletzt 7 Tage scannen
npm start scan --last 7d

# Report erstellen und im Browser oeffnen
npm start report --last 7d --open
```

## CLI-Befehle

```bash
pressespiegel scan --last 7d                       # Letzte 7 Tage scannen
pressespiegel scan --from 2026-05-01 --to 2026-05-31

pressespiegel report --last 30d --open             # HTML-Report + im Browser
pressespiegel report --last 7d --format pdf        # PDF
pressespiegel report --last 7d --format both       # HTML + PDF

pressespiegel open                                 # Neuesten Report oeffnen
pressespiegel list-reports                         # Alle Reports auflisten

pressespiegel search "Pinocchio"                   # In lokaler DB suchen
pressespiegel search "Mundel" --limit 50

pressespiegel stats --last 30d                     # Statistiken
pressespiegel health                               # Feed-Gesundheit

pressespiegel config list                          # Konfiguration zeigen
pressespiegel config add-keyword "Neues Stueck" --type productions
pressespiegel config add-keyword "Neuer Regisseur" --type people
pressespiegel config remove-keyword "Hamlet" --type productions
pressespiegel config add-source "https://example.com/rss" --name "Beispiel" --priority 70

pressespiegel dedupe --dry-run                     # Duplikate suchen
pressespiegel dedupe                               # Duplikate markieren

pressespiegel schedule                             # Cron-Modus (Vordergrund)
```

## Such-Algorithmus

Stufenweise Bewertung jedes Artikels:

1. **Pflichtfilter**: Ohne mindestens einen `required`-Begriff (`Kammerspiele`,
   `Muenchner Kammerspiele`) wird verworfen. Treffer auf `exclude` (Hamburger
   Kammerspiele, Berliner Kammerspiele, Stellenanzeige …) werden auch verworfen.

2. **Relevanz-Scoring**:
   - Required im Titel: **+80**
   - Required im Text (bis 5x): **+10 pro Treffer**
   - Aktuelle Produktion im Titel (Pinocchio, Wallenstein, …): **+50**
   - Aktuelle Produktion im Text mit Kammerspiele-Kontext: **+25**
   - Aktuelle Produktion im Text ohne Kontext: **+12**
   - Fuzzy-Match (Tippfehler) auf Produktion: **+30**
   - Kammerspiele + Produktion im selben Titel: zusaetzlich **+100**
   - Ensemble-Mitglied / Regie / Dramaturgie im Titel: **+40**
   - Im Text mit Kontext: **+20**
   - Spielstaette (Schauspielhaus, Werkraum, Therese-Giehse-Halle): **+10**
   - Theater-Kontext (≥2 Begriffe wie Inszenierung, Buehne, Ensemble): **+8**
   - Typ: Kritik **+30**, Interview **+25**, Ankuendigung **+20**
   - Premiere erwaehnt: **+20**
   - Kurzer Artikel (<100 Worte): **-20**, sehr kurz (<50): **-50**
   - Top-Quelle (nachtkritik, SZ, FAZ, BR, DLF): **+15**

3. **Kategorisierung**:
   - Score ≥ 80 → **sehr_relevant** (★★★)
   - Score ≥ 50 → **relevant** (★★)
   - Score ≥ 30 → **moeglich_relevant** (★)
   - darunter → verworfen

## Duplikat-Erkennung (dreistufig)

1. **URL-Match** nach Entfernung aller Tracking-Parameter
2. **Titel-Aehnlichkeit** via Levenshtein > 85 %
3. **Text-Aehnlichkeit** auf erstem Absatz via Cosine > 80 %

Bei Duplikat-Treffer: Sieger nach Quellen-Prioritaet
(nachtkritik = SZ = 100, FAZ = BR = DLF = 95, ZEIT = 90 …),
alle anderen URLs werden als "auch erschienen in" verlinkt.

## Aktueller Spielplan (in `config/keywords.json`)

**Produktionen 2025/26**: Wachse oder weiche · Eurydike und Orpheus ·
Wokey Wokey · Pinocchio · Love me tender · Enjoy Schatz · Mein kleines
Prachttier · Meister und Margarita · Fraeulein Else · Fremd · Bevor ich
es vergesse · Play Auerbach · Mephisto · Very Rich Angels · Tristan (und
Isolde) · Wallenstein · Was ihr wollt

**Personen**: Barbara Mundel (Intendantin), Daniel Veldhoen (Kuenstlerische
Leitung), Viola Hasselberg (stv. Intendantin), das gesamte Ensemble
(Wiebke Puls, Walter Hess, Samuel Koch, Thomas Schmauser, Annette Paulmann,
Lucy Wilke, Luisa Woellisch, Stefan Merki, Edmund Telgenkaemper, Jelena
Kuljic, …), aktuelle Gastregien (Nora Abdel-Maksoud, Wu Tsang, Felicitas
Brucker, Anna Smolar, Leonie Boehm, Maxi Schafroth, Sarah Kohm, …).

Anpassen via:
```bash
pressespiegel config add-keyword "Neue Inszenierung" --type productions
pressespiegel config add-keyword "Neuer Schauspieler" --type people
```

## UI/UX der HTML-Reports

- Sticky-Toolbar mit Live-Suche, Filter (Kategorie, Sentiment, Quelle),
  Sortierung (Score / Datum)
- Tastatur-Shortcut: `/` fokussiert die Suche, `Esc` setzt zurueck
- Dark-Mode-Toggle (speichert Praeferenz lokal)
- Responsive: funktioniert auch auf Tablet/Mobil
- Donut-Chart fuer Sentiment, Balken fuer Zeitverlauf, Quellen-Tabelle
- Pro Artikel: Kategorie-Badge, Sentiment-Badge, Artikeltyp, Score,
  Paywall-Hinweis, "auch erschienen in"-Liste, Trefferbegruendungen
- Print-optimiert (Filter werden ausgeblendet)

## Projekt-Struktur

```
.
├── bin/cli.js               # CLI-Einstiegspunkt (Commander)
├── src/
│   ├── analyzer.js          # Relevanz + Sentiment + Artikeltyp
│   ├── config.js            # JSON-Konfig + .env laden
│   ├── database.js          # SQLite (WAL), Schema, Statements
│   ├── deduplicator.js      # Multi-Level Duplikat-Erkennung
│   ├── logger.js            # Winston (Console + File, rotierend)
│   ├── pipeline.js          # fetch -> analyze -> dedupe -> save
│   ├── reporter.js          # HTML + optional PDF
│   ├── scheduler.js         # Cron-Jobs (lokal, keine E-Mail)
│   ├── scraper.js           # RSS, HTTP-Fetch, HTML-Extraction
│   └── utils.js             # URL, Levenshtein, Cosine, Date-Parse
├── config/
│   ├── sources.json         # 17 RSS-Quellen mit Prioritaeten
│   ├── keywords.json        # Pflicht/Produktionen/Personen/Venues
│   ├── settings.json        # Tool-Einstellungen
│   └── sentiment.json       # Theater-Wortschatz
├── tests/                   # 56 Unit-Tests (node --test)
├── data/                    # SQLite-DB (lokal)
├── logs/                    # Log-Dateien (lokal)
├── reports/                 # HTML/PDF-Reports (lokal)
├── package.json
└── .env.example             # Nur Logging-Settings, kein SMTP
```

## Tests

```bash
npm test
```

56 Unit-Tests mit Node built-in `--test` (keine Test-Framework-Dependency).

Bereiche:
- Utils (URL-Normalize, Levenshtein, Cosine, Datums-Parsing, Escaping)
- Analyzer (Relevanz, Sentiment mit Negationen, Stem-Match, Artikeltyp,
  Kontext-Suche, Fuzzy-Match, Hamburger-Kammerspiele-Ausschluss)
- Deduplicator (alle 3 Stufen, Winner-Selection)
- Scraper (Datums-Extraktion aus Meta/JSON-LD/URL/Text, Paywall)

## Edge Cases

- **Paywall**: erkannt und markiert; RSS-Snippet bleibt verwertbar
- **Kein Datum**: Warnung im Log, aktuelles Datum + `date_warning` Flag
- **RSS-Feed down**: Eintrag in `source_health`, andere Feeds laufen weiter
- **Tracking-Parameter** (utm_*, gclid, fbclid, …): vor URL-Vergleich entfernt
- **Schwester-Theater**: Hamburger/Berliner/Wiener Kammerspiele per Exclude
- **Artikel ohne Volltext**: Fallback auf RSS-`contentSnippet`
- **Tippfehler in Produktion**: Fuzzy-Match via Levenshtein
- **Stueck im Text, aber nicht im Kammerspiele-Kontext**: halber Score

## Logging

- Console: farbig, Level `info`
- Datei: JSON in `logs/pressespiegel.log` (rotierend, max 10 MB, 14 Tage)
- Errors zusaetzlich in `logs/error.log`
- Level via `LOG_LEVEL` in `.env` steuerbar

## Automatisierung

Cron-Modus (Reports werden lokal abgelegt, kein E-Mail-Versand):

```bash
# In tmux, screen, pm2 oder systemd:
pressespiegel schedule
```

Vorkonfiguriert (in `config/settings.json` aenderbar):
- **Daily Scan**: 06:00 Uhr (letzte 24 h)
- **Wochenbericht**: Montag 08:00 Uhr (in `reports/` abgelegt)
- **Monatsbericht**: 1. des Monats 08:00 Uhr (in `reports/` abgelegt)

## Datenschutz

Alles, was dieses Tool tut, passiert lokal:
- SQLite-DB in `data/`
- HTML/PDF-Reports in `reports/`
- Logs in `logs/`
- Konfiguration in `config/`

Es werden **keine** Daten an Server, Cloud-Dienste oder per E-Mail versandt.
Lediglich die RSS-Feeds der eingestellten Nachrichtenquellen werden abgerufen –
exakt das, was jeder Browser bei einem Besuch dieser Webseiten auch tut.

## Lizenz

MIT
