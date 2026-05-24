# Kritischer Fix: Artikel-Import Bug (0 neue Artikel)

## Problem

Der Scanner meldete:
- ✓ 161 Feeds gefunden, 93 OK
- ✓ 1500 Artikel angereichert
- ✗ **0 neue Artikel importiert**
- ✓ 80 Duplikate erkannt

**Root Cause**: Die Duplikat-Verarbeitungslogik war fehlerhaft und verursachte UNIQUE-Constraint-Fehler beim Datenbankinsert.

## Die Bughafte Logik (vorher)

In `src/pipeline.js` `processArticle()`:

```javascript
if (dupHit) {  // Duplikat gefunden
  const winner = chooseWinner(existing, new);
  
  if (winner === dupHit.duplicate) {  // Bestehendes ist besser
    const inserted = database.insertArticle(article);  // ❌ BUG!
    database.markAsDuplicate(inserted.id, dupHit.duplicate.id);
    // ↑ Versuch, einen Artikel einzufügen, dessen URL bereits in der DB ist
    //   → UNIQUE-Constraint-Fehler
    //   → inserted.inserted = false
    //   → articlesAdded wird NICHT erhöht
  }
}
```

## Das Problem im Detail

1. **Duplikat-Erkennung**: System findet zwei Artikel mit ähnlichem/gleichem Inhalt
2. **Comparison**: `chooseWinner()` entscheidet, welcher besser ist (basierend auf Quelle, Datum, ID)
3. **Logic Error**: Selbst wenn das bestehende Artikel besser ist → versuchte trotzdem neue einzufügen
4. **UNIQUE Constraint**: Da beide die gleiche `url_normalized` haben → Insert schlägt fehl
5. **Zähler nicht erhöht**: `articlesAdded` bleibt 0, obwohl Duplikate erkannt wurden

## Die Lösung (nachher)

```javascript
if (dupHit) {
  const winner = chooseWinner(existing, new);
  
  if (winner === dupHit.duplicate) {  // Bestehendes ist besser
    // ✓ Nicht einfügen, nur zählen
    summary.duplicatesFound++;
    logger.info(`Duplikat erkannt -> bestehend behalten`);
  } else {  // Neuer ist besser
    const inserted = database.insertArticle(article);  // ✓ Einfügen
    if (inserted.inserted) {
      summary.articlesAdded++;
      applyTags(inserted.id, article, analysis);
      applyAnalytics(inserted.id, article);
    }
    database.markAsDuplicate(dupHit.duplicate.id, inserted.id);  // Alten als Dup markieren
    summary.duplicatesFound++;
  }
}
```

**Logik**:
- **Bestehendes gewinnt**: Nicht einfügen (verhindert UNIQUE-Fehler), nur zählen
- **Neues gewinnt**: Einfügen, alten als Duplikat markieren

## Auswirkungen

### Vorher
- Artikel mit Duplikaten: `inserted.inserted = false` → nicht gezählt
- Ergebnis: `articlesAdded = 0` trotz gefundener Artikel

### Nachher  
- Artikel ohne Duplikate: Normal einfügen und zählen ✓
- Duplikate mit neuer Gewinner: Einfügen und zählen ✓
- Duplikate mit bestehendem Gewinner: Nicht einfügen, aber zählen ✓

## Erwartete Verbesserungen

Nach dem Fix sollten Sie sehen:
```
✓ neue_artikel: > 0 (statt 0)
✓ duplicates_removed: korrekt gezählt
✓ Pressespiegel wächst mit echten neuen Artikeln
```

## Was nicht geändert wurde

- **Dedup-Logik**: Schwellenwerte (85% Titel-Ähnlichkeit, 80% Text) sind unverändert
- **Pflicht-Filter**: Artikel müssen immer noch "Kammerspiele" enthalten
- **Enrichment**: Artikel-Anreicherung und Analyse sind unverändert

## Fehlerbehebung bei Problemen

Falls immer noch 0 Artikel importiert werden:

1. **Check 1: Sind Feeds aktiv?**
   ```bash
   # Logs prüfen
   tail logs/*.log | grep "Feeds"
   ```

2. **Check 2: Kommen Artikel in den Enrichment?**
   ```bash
   # Logs prüfen auf "Angereichert: X Artikel"
   ```

3. **Check 3: Passen Artikel den Filter?**
   ```bash
   # Articles mit "Kammerspiele" sollten passen
   # Articles ohne sollten verworfen werden (normal)
   ```

4. **Check 4: Datenbankzustand?**
   ```bash
   node -e "const db = require('./src/database');
   const now = new Date();
   const from = new Date(now);
   from.setDate(from.getDate() - 7);
   console.log(db.getStats(from, now));"
   ```

## Commit

```
Fix: Vermeide UNIQUE-Constraint Fehler bei Duplikat-Verarbeitung
```

Das ist ein **kritischer Bugfix** für das Artikel-Import-System.
