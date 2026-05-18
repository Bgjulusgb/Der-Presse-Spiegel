'use strict';

const cron = require('node-cron');
const { subDays, subWeeks, subMonths, startOfDay, endOfDay } = require('date-fns');

const logger = require('./logger');
const { settings } = require('./config');
const { runScan } = require('./pipeline');
const database = require('./database');
const { generateReport } = require('./reporter');
const { sendReportMail, sendAlertMail } = require('./mailer');

function parseRecipients(envName) {
  const raw = process.env[envName];
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

async function dailyScan() {
  const to = endOfDay(new Date());
  const lookbackHours = settings.schedule.daily_scan_lookback_hours || 24;
  const from = new Date(to.getTime() - lookbackHours * 3600 * 1000);
  logger.info('[Cron] Taeglicher Scan startet');
  try {
    await runScan({ from, to });
  } catch (err) {
    logger.error('[Cron] Taeglicher Scan fehlgeschlagen', { error: err.message });
  }
}

async function alertScan() {
  const threshold = settings.alerts.high_relevance_threshold || 80;
  const since = subDays(new Date(), 1);
  const articles = database.getHighRelevanceSince(threshold, since);
  if (articles.length === 0) {
    logger.debug('[Cron] Keine hochrelevanten Artikel fuer Alert');
    return;
  }
  const recipients = parseRecipients('ALERT_RECIPIENTS');
  if (recipients.length === 0) {
    logger.warn('[Cron] Keine ALERT_RECIPIENTS in .env konfiguriert');
    return;
  }
  await sendAlertMail({ recipients, articles });
}

async function weeklyReport() {
  const to = endOfDay(new Date());
  const from = startOfDay(subWeeks(to, 1));
  logger.info('[Cron] Wochenbericht');
  try {
    await runScan({ from, to });
    const articles = database.getArticlesByRange(from, to);
    const result = await generateReport({ from, to, articles, format: 'both', title: 'Wochenbericht Muenchner Kammerspiele' });
    const recipients = parseRecipients('REPORT_RECIPIENTS');
    if (recipients.length > 0) {
      const veryRelevant = articles.filter(a => a.category === 'sehr_relevant').length;
      const positive = articles.filter(a => a.sentiment === 'positiv').length;
      const negative = articles.filter(a => a.sentiment === 'negativ').length;
      await sendReportMail({
        recipients,
        subject: 'Wochenbericht: Pressespiegel Kammerspiele',
        htmlReportPath: result.html,
        pdfReportPath: result.pdf,
        summary: { total: articles.length, veryRelevant, positive, negative }
      });
    }
  } catch (err) {
    logger.error('[Cron] Wochenbericht fehlgeschlagen', { error: err.message });
  }
}

async function monthlyReport() {
  const to = endOfDay(new Date());
  const from = startOfDay(subMonths(to, 1));
  logger.info('[Cron] Monatsbericht');
  try {
    const articles = database.getArticlesByRange(from, to);
    const result = await generateReport({ from, to, articles, format: 'both', title: 'Monatsbericht Muenchner Kammerspiele' });
    const recipients = parseRecipients('REPORT_RECIPIENTS');
    if (recipients.length > 0) {
      const veryRelevant = articles.filter(a => a.category === 'sehr_relevant').length;
      const positive = articles.filter(a => a.sentiment === 'positiv').length;
      const negative = articles.filter(a => a.sentiment === 'negativ').length;
      await sendReportMail({
        recipients,
        subject: 'Monatsbericht: Pressespiegel Kammerspiele',
        htmlReportPath: result.html,
        pdfReportPath: result.pdf,
        summary: { total: articles.length, veryRelevant, positive, negative }
      });
    }
  } catch (err) {
    logger.error('[Cron] Monatsbericht fehlgeschlagen', { error: err.message });
  }
}

function start() {
  const tz = settings.schedule.timezone || 'Europe/Berlin';

  cron.schedule(settings.schedule.daily_scan_cron, dailyScan, { timezone: tz });
  logger.info(`Cron aktiv: Daily Scan (${settings.schedule.daily_scan_cron} ${tz})`);

  cron.schedule(settings.alerts.alert_cron, alertScan, { timezone: tz });
  logger.info(`Cron aktiv: Alerts (${settings.alerts.alert_cron} ${tz})`);

  cron.schedule(settings.schedule.weekly_report_cron, weeklyReport, { timezone: tz });
  logger.info(`Cron aktiv: Wochenbericht (${settings.schedule.weekly_report_cron} ${tz})`);

  cron.schedule(settings.schedule.monthly_report_cron, monthlyReport, { timezone: tz });
  logger.info(`Cron aktiv: Monatsbericht (${settings.schedule.monthly_report_cron} ${tz})`);

  logger.info('Scheduler gestartet. Prozess laeuft im Vordergrund. Stoppen mit Ctrl+C.');
}

module.exports = { start, dailyScan, weeklyReport, monthlyReport, alertScan };
