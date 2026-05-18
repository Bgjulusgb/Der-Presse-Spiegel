# Pressespiegel-Tool fuer die Muenchner Kammerspiele

Ein vollstaendiges, produktionsreifes Node.js-Tool zur automatischen
Beobachtung der Presse rund um die Muenchner Kammerspiele.

**Komplett ohne kostenpflichtige APIs** – arbeitet ausschliesslich mit RSS-Feeds
und Web-Scraping.

## Features

- **Multi-Source RSS-Crawler** mit Retry-Logik und Rate-Limiting pro Domain
- **Intelligente Datums-Extraktion** aus Meta-Tags, JSON-LD, URL, Text
- **Mehrstufige Duplikat-Erkennung**: URL, Titel-Levenshtein, Text-Cosine
- **Relevanz-Scoring** mit konfigurierbaren Keywords und Gewichtungen
- **Sentiment-Analyse** auf Basis eines Theater-spezifischen Wortbuchs
  inkl. Negationen und Verstaerkern
- **Artikeltyp-Erkennung**: Kritik, Interview, Ankuendigung, News
- **HTML- & PDF-Reports** mit Sentiment-Pie, Zeitverlauf und Quellen-Statistik
- **SQLite-Persistenz** (WAL-Mode) mit vollstaendigem Schema
- **Cron-Scheduler** fuer taegliche Scans, Wochen-/Monatsberichte und Alerts
- **E-Mail-Versand** ueber SMTP (nodemailer)
- **CLI mit Commander** und Unit-Tests via Node built-in test runner

## Schnellstart

```bash
git clone <repo>
cd Der-Presse-Spiegel
npm install

cp .env.example .env

npm start scan --last 7d

npm start report --last 7d --format both
```

## Projekt-Struktur

```
.
├── bin/
│   └── cli.js               # CLI-Einstiegspunkt
├── src/
│   ├── analyzer.js          # Relevanz + Sentiment + Artikeltyp
│   ├── config.js            # JSON-Konfig + .env laden
│   ├── database.js          # SQLite-Wrapper, Schema, Statements
│   ├── deduplicator.js      # Multi-Level Duplikat-Erkennung
│   ├── logger.js            # Winston-Logger (Console + File)
│   ├── mailer.js            # SMTP-Versand (nodemailer)
│   ├── pipeline.js          # Scan-Pipeline: fetch -> analyze -> dedupe -> save
│   ├── reporter.js          # HTML- und PDF-Report-Generation
│   ├── scheduler.js         # Cron-Jobs (taeglich, woechentlich, monatlich)
│   ├── scraper.js           # RSS-Feeds, HTTP-Fetch, HTML-Extraction
│   └── utils.js             # URL-Normalize, Levenshtein, Cosine, Date-Parse
├── config/
│   ├── sources.json         # RSS-Feeds + Prioritaeten
│   ├── keywords.json        # Required/Productions/People/Exclude
│   ├── settings.json        # Tool-Einstellungen
│   └── sentiment.json       # Theater-Wortbuch fuer Sentiment
├── tests/                   # Unit-Tests (node --test)
├── data/                    # SQLite-DB (auto-generiert)
├── logs/                    # Log-Dateien (auto-generiert)
├── reports/                 # Generierte HTML/PDF-Reports
├── package.json
└── .env.example
```

## CLI-Befehle

### Scan – Artikel suchen und speichern

```bash
npm start scan --from 2026-01-01 --to 2026-01-31
npm start scan --last 7d
npm start scan --last 3m
```

### Report – HTML/PDF generieren

```bash
npm start report --last 7d --format html
npm start report --last 30d --format pdf
npm start report --period weekly --format both
npm start report --from 2026-01-01 --to 2026-01-31 --title "Januar 2026"
```

### Suche in lokaler Datenbank

```bash
npm start search "Hamlet Premiere"
npm start search "Barbara Mundel" --limit 50
```

### Konfiguration

```bash
npm start config list
npm start config add-keyword "Neue Produktion" --type productions
npm start config add-keyword "Neuer Regisseur" --type people
npm start config add-source "https://example.com/rss" --name "Beispiel" --priority 70
```

### Statistiken

```bash
npm start stats --last 30d
npm start stats --from 2026-01-01 --to 2026-12-31
```

### Duplikate pruefen

```bash
npm start dedupe --dry-run
npm start dedupe --since 2026-01-01
```

### Feed-Gesundheit

```bash
npm start health
```

### Scheduler (Cron-Modus)

```bash
npm start schedule
```

Dieser Befehl startet den Scheduler im Vordergrund.
Lass den Prozess via `pm2`, `systemd` oder Docker laufen.

## Konfiguration

### `config/sources.json`

Liste der RSS-Feeds mit Prioritaet (hoehere Prio = bei Duplikaten bevorzugt):

```json
{
  "feeds": [
    { "name": "SZ Muenchen", "url": "https://...", "priority": 100, "type": "rss" }
  ]
}
```

### `config/keywords.json`

```json
{
  "required": ["Muenchner Kammerspiele", "Kammerspiele"],
  "productions": ["Hamlet", "Dantons Tod"],
  "people": ["Barbara Mundel"],
  "exclude": ["Stellenanzeige", "Hamburger Kammerspiele"],
  "scoring_weights": { "title_exact_match": 80 },
  "thresholds": { "very_relevant": 80, "relevant": 50, "maybe_relevant": 30 }
}
```

- Mindestens 1 `required`-Begriff muss vorkommen
- `exclude` filtert sofort
- Umlaute werden automatisch normalisiert (`ae`/`oe`/`ue`/`ss`)

### `config/settings.json`

Steuert Datenbank-Pfad, Scraping-Verhalten, Schwellwerte fuer Dedup,
Cron-Zeiten und Logging.

### `config/sentiment.json`

Theater-spezifisches Wortbuch mit Positiv- und Negativ-Begriffen,
Negationen und Verstaerkern.

### `.env`

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=changeme
SMTP_FROM=pressespiegel@kammerspiele.de
REPORT_RECIPIENTS=intendanz@kammerspiele.de
ALERT_RECIPIENTS=presse@kammerspiele.de
```

## Wie funktioniert die Duplikat-Erkennung?

Pro Artikel werden drei Pruefungen durchgefuehrt:

1. **URL-Match** (nach Tracking-Param-Entfernung): exakte Gleichheit
2. **Titel-Aehnlichkeit** (Levenshtein > 85 %): erkennt minimale Tippfehler
3. **Text-Cosine-Similarity** (erster Absatz > 80 %): erkennt dpa-Meldungen,
   die auf mehreren Portalen gleich starten

Wenn Duplikat: behalte Version mit hoechster Quellen-Prioritaet, merke alle
zusaetzlichen URLs als `also_on`.

## Relevanz-Scoring

| Faktor | Punkte |
|---|---|
| Required-Keyword im Titel | +80 |
| Required-Keyword im Text (max. 5x) | +10 pro Match |
| Produktion erwaehnt | +15 |
| Person erwaehnt | +20 |
| Venue erwaehnt | +10 |
| Typ: Kritik | +30 |
| Typ: Interview | +25 |
| Typ: Ankuendigung | +20 |
| Kurzer Artikel (< 100 Worte) | -20 |
| Sehr kurz (< 50 Worte) | -50 |
| Hochprioritaere Quelle | +15 |

Schwellwerte:

- `sehr_relevant`: Score >= 80
- `relevant`: Score >= 50
- `moeglich_relevant`: Score >= 30
- darunter: wird verworfen

## Tests

```bash
npm test
```

Tests laufen mit Node built-in `--test` (keine extra Dependency).
Abgedeckt: Utils, Analyzer, Deduplicator, Scraper-Datums-Extraktion.

## Edge Cases

- **Artikel hinter Paywall**: wird als `paywall=1` markiert, Snippet bleibt erhalten
- **Kein Datum gefunden**: Warnung im Log, aktuelles Datum + `date_warning` Flag
- **RSS-Feed down**: Fehler wird in `source_health` festgehalten,
  andere Feeds laufen weiter
- **Tracking-Parameter in URL**: werden vor URL-Vergleich entfernt
- **Sehr aehnliche Schwester-Theater** (Hamburger Kammerspiele): per `exclude` raus
- **Artikel ohne Volltext**: Fallback auf RSS-`contentSnippet`

## Logging

- Console: farbig, ab Level `info`
- Datei: JSON-Format in `logs/pressespiegel.log` (rotierend, max 10 MB)
- Errors zusaetzlich in `logs/error.log`
- Level via `LOG_LEVEL` in `.env` steuerbar (`debug`, `info`, `warn`, `error`)

## Automatisierung (Production)

Empfohlene Cron-Setup via systemd-Service oder pm2:

```bash
pm2 start bin/cli.js --name pressespiegel -- schedule
pm2 save
pm2 startup
```

Vorkonfigurierte Cron-Zeiten (in `settings.json`):

- **Daily Scan**: 06:00 Uhr (letzte 24 h)
- **Alerts**: 07:00, 12:00, 17:00 (hochrelevante Artikel)
- **Wochenbericht**: Montag 08:00 Uhr (per Mail)
- **Monatsbericht**: 1. des Monats 08:00 Uhr

## Lizenz

MIT
