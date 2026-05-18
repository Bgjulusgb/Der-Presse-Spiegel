#!/usr/bin/env node
'use strict';

const { program } = require('commander');
const chalk = require('chalk');
const { format } = require('date-fns');

const logger = require('../src/logger');
const { parseDateRange } = require('../src/utils');
const { runScan } = require('../src/pipeline');
const database = require('../src/database');
const { generateReport } = require('../src/reporter');
const scheduler = require('../src/scheduler');
const { loadJson, saveJson } = require('../src/config');
const { findDuplicate } = require('../src/deduplicator');

program
  .name('pressespiegel')
  .description('Pressespiegel-Tool fuer die Muenchner Kammerspiele')
  .version('1.0.0');

program
  .command('scan')
  .description('Scannt RSS-Feeds und Webseiten nach Artikeln')
  .option('--from <date>', 'Startdatum YYYY-MM-DD')
  .option('--to <date>', 'Enddatum YYYY-MM-DD')
  .option('--last <range>', 'Zeitraum z.B. 7d, 30d, 3m')
  .action(async (opts) => {
    try {
      const { from, to } = parseDateRange(opts);
      console.log(chalk.cyan(`\n► Scan-Zeitraum: ${format(from, 'yyyy-MM-dd')} bis ${format(to, 'yyyy-MM-dd')}\n`));
      const summary = await runScan({ from, to });
      console.log(chalk.green('\n✓ Scan abgeschlossen'));
      console.log(`  Gefunden:      ${summary.articlesFound}`);
      console.log(`  Neu in DB:     ${chalk.bold(summary.articlesAdded)}`);
      console.log(`  Duplikate:     ${summary.duplicatesFound}`);
      console.log(`  Fehler:        ${summary.errors > 0 ? chalk.red(summary.errors) : summary.errors}`);
    } catch (err) {
      logger.error('Scan fehlgeschlagen', { error: err.message, stack: err.stack });
      console.error(chalk.red(`✗ Fehler: ${err.message}`));
      process.exit(1);
    } finally {
      database.close();
    }
  });

program
  .command('report')
  .description('Generiert HTML- und/oder PDF-Report')
  .option('--from <date>', 'Startdatum YYYY-MM-DD')
  .option('--to <date>', 'Enddatum YYYY-MM-DD')
  .option('--last <range>', 'Zeitraum z.B. 7d, 30d')
  .option('--period <p>', 'Schnellauswahl: daily | weekly | monthly')
  .option('--format <f>', 'Format: html | pdf | both', 'html')
  .option('--title <t>', 'Titel des Reports')
  .action(async (opts) => {
    try {
      if (opts.period) {
        if (opts.period === 'daily') opts.last = '1d';
        else if (opts.period === 'weekly') opts.last = '7d';
        else if (opts.period === 'monthly') opts.last = '1m';
      }
      const { from, to } = parseDateRange(opts);
      console.log(chalk.cyan(`\n► Report: ${format(from, 'yyyy-MM-dd')} bis ${format(to, 'yyyy-MM-dd')}\n`));
      const articles = database.getArticlesByRange(from, to);
      console.log(`  ${articles.length} Artikel gefunden`);
      const result = await generateReport({ from, to, articles, format: opts.format, title: opts.title });
      if (result.html) console.log(chalk.green(`✓ HTML: ${result.html}`));
      if (result.pdf) console.log(chalk.green(`✓ PDF:  ${result.pdf}`));
    } catch (err) {
      logger.error('Report fehlgeschlagen', { error: err.message });
      console.error(chalk.red(`✗ Fehler: ${err.message}`));
      process.exit(1);
    } finally {
      database.close();
    }
  });

program
  .command('search <query>')
  .description('Sucht Artikel in der lokalen Datenbank')
  .option('--limit <n>', 'Max. Treffer', '20')
  .action(async (query, opts) => {
    try {
      const stmt = database.db.prepare(`
        SELECT id, title, source, published_date, relevance_score, sentiment, url
        FROM articles
        WHERE (title LIKE @q OR full_text LIKE @q) AND deleted_at IS NULL
        ORDER BY relevance_score DESC, published_date DESC
        LIMIT @limit
      `);
      const rows = stmt.all({ q: `%${query}%`, limit: parseInt(opts.limit, 10) });
      if (!rows.length) {
        console.log(chalk.yellow('Keine Treffer.'));
        return;
      }
      console.log(chalk.cyan(`\n${rows.length} Treffer fuer "${query}":\n`));
      for (const r of rows) {
        console.log(chalk.bold(r.title));
        console.log(`  ${r.source || ''} · ${r.published_date || ''} · Score ${r.relevance_score} · ${r.sentiment || 'neutral'}`);
        console.log(`  ${chalk.gray(r.url)}\n`);
      }
    } finally {
      database.close();
    }
  });

const configCmd = program.command('config').description('Konfiguration anpassen');

configCmd
  .command('add-keyword <kw>')
  .option('--type <t>', 'Typ: required | productions | people | venues | exclude', 'productions')
  .action((kw, opts) => {
    const data = loadJson('keywords.json');
    if (!data[opts.type]) {
      console.error(chalk.red(`Unbekannter Typ: ${opts.type}`));
      process.exit(1);
    }
    if (data[opts.type].includes(kw)) {
      console.log(chalk.yellow(`Bereits vorhanden: ${kw}`));
      return;
    }
    data[opts.type].push(kw);
    saveJson('keywords.json', data);
    console.log(chalk.green(`✓ Hinzugefuegt zu ${opts.type}: ${kw}`));
  });

configCmd
  .command('add-source <url>')
  .option('--name <name>', 'Name der Quelle')
  .option('--priority <n>', 'Prioritaet', '50')
  .action((url, opts) => {
    const data = loadJson('sources.json');
    if (data.feeds.some(f => f.url === url)) {
      console.log(chalk.yellow(`Bereits vorhanden: ${url}`));
      return;
    }
    data.feeds.push({
      name: opts.name || new URL(url).hostname,
      url,
      priority: parseInt(opts.priority, 10),
      type: 'rss'
    });
    saveJson('sources.json', data);
    console.log(chalk.green(`✓ Hinzugefuegt: ${url}`));
  });

configCmd
  .command('list')
  .description('Zeigt aktuelle Konfiguration')
  .action(() => {
    console.log(chalk.cyan('\n► Feeds:'));
    const sources = loadJson('sources.json');
    for (const f of sources.feeds) {
      console.log(`  [${f.priority}] ${f.name} ← ${f.url}`);
    }
    console.log(chalk.cyan('\n► Required keywords:'));
    const kw = loadJson('keywords.json');
    console.log(`  ${kw.required.join(', ')}`);
    console.log(chalk.cyan('\n► Exclude:'));
    console.log(`  ${kw.exclude.join(', ')}`);
  });

program
  .command('stats')
  .description('Zeigt Statistiken')
  .option('--from <date>', 'Startdatum YYYY-MM-DD')
  .option('--to <date>', 'Enddatum YYYY-MM-DD')
  .option('--last <range>', 'Zeitraum z.B. 30d')
  .action(async (opts) => {
    try {
      const { from, to } = parseDateRange(opts);
      const stats = database.getStats(from, to);
      console.log(chalk.cyan(`\n► Statistiken ${format(from, 'yyyy-MM-dd')} bis ${format(to, 'yyyy-MM-dd')}\n`));
      console.log(`  Gesamt:        ${stats.overview.total}`);
      console.log(`  Unique:        ${stats.overview.unique_articles}`);
      console.log(`  Duplikate:     ${stats.overview.duplicates}`);
      console.log(`  Paywall:       ${stats.overview.paywalled}`);
      console.log(`  ${chalk.green('Positiv:')}      ${stats.overview.positive}`);
      console.log(`  ${chalk.gray('Neutral:')}      ${stats.overview.neutral}`);
      console.log(`  ${chalk.red('Negativ:')}      ${stats.overview.negative}`);
      console.log(chalk.cyan('\n► Top Quellen:'));
      for (const row of stats.bySource.slice(0, 10)) {
        console.log(`  ${row.count.toString().padStart(4)} · ${row.source}`);
      }
      console.log(chalk.cyan('\n► Feed-Gesundheit:'));
      const health = database.getSourceHealth();
      for (const h of health) {
        const status = h.consecutive_failures > 0
          ? chalk.red(`✗ ${h.consecutive_failures} Fehler in Folge`)
          : chalk.green('✓ OK');
        console.log(`  ${status}  ${h.source}`);
      }
    } finally {
      database.close();
    }
  });

program
  .command('dedupe')
  .description('Sucht Duplikate in der Datenbank')
  .option('--dry-run', 'Nur anzeigen, nicht markieren', false)
  .option('--since <date>', 'Pruefe seit Datum YYYY-MM-DD')
  .action(async (opts) => {
    try {
      const since = opts.since ? new Date(opts.since) : new Date(Date.now() - 90 * 24 * 3600 * 1000);
      const candidates = database.getRecentForDedup(since);
      console.log(chalk.cyan(`\n► Pruefe ${candidates.length} Artikel auf Duplikate\n`));
      let dupCount = 0;
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const others = candidates.slice(0, i);
        const hit = findDuplicate(
          {
            id: c.id, title: c.title, url: c.url_normalized,
            first_paragraph: c.first_paragraph, source: c.source
          },
          others
        );
        if (hit) {
          dupCount++;
          console.log(chalk.yellow(`  Duplikat: "${c.title}"`));
          console.log(chalk.gray(`    → Bestehend (${hit.reason}): "${hit.duplicate.title}"`));
          if (!opts.dryRun) {
            database.markAsDuplicate(c.id, hit.duplicate.id, null);
          }
        }
      }
      console.log(chalk.green(`\n✓ ${dupCount} Duplikate ${opts.dryRun ? 'gefunden (dry-run)' : 'markiert'}`));
    } finally {
      database.close();
    }
  });

program
  .command('schedule')
  .description('Startet Scheduler im Vordergrund (cron jobs)')
  .action(() => {
    console.log(chalk.cyan('► Starte Scheduler...'));
    scheduler.start();
  });

program
  .command('health')
  .description('Prueft Feed-Gesundheit')
  .action(async () => {
    try {
      const health = database.getSourceHealth();
      if (!health.length) {
        console.log(chalk.yellow('Noch keine Health-Daten. Fuehre erst einen Scan aus.'));
        return;
      }
      for (const h of health) {
        const status = h.consecutive_failures > 0 ? chalk.red('FEHLER') : chalk.green('OK');
        console.log(`[${status}] ${h.source}`);
        console.log(`  Letzter Erfolg:  ${h.last_success || 'nie'}`);
        console.log(`  Letzter Fehler:  ${h.last_failure || 'nie'}`);
        if (h.last_error) console.log(`  ${chalk.gray(h.last_error)}`);
      }
    } finally {
      database.close();
    }
  });

program.parseAsync(process.argv).catch((err) => {
  logger.error('CLI fataler Fehler', { error: err.message, stack: err.stack });
  console.error(chalk.red(`✗ ${err.message}`));
  process.exit(1);
});
