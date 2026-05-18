'use strict';

const fs = require('fs');
const path = require('path');
const { format } = require('date-fns');
const { de } = require('date-fns/locale');

const logger = require('./logger');
const { settings } = require('./config');
const { escapeHtml, truncate } = require('./utils');

const REPORTS_DIR = path.resolve(settings.reports.path);
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

const CATEGORY_LABELS = {
  sehr_relevant: { label: 'Sehr relevant', stars: '★★★', color: '#16a34a' },
  relevant: { label: 'Relevant', stars: '★★', color: '#2563eb' },
  moeglich_relevant: { label: 'Moeglicherweise relevant', stars: '★', color: '#a16207' },
  irrelevant: { label: 'Niedrige Relevanz', stars: '·', color: '#64748b' }
};

const SENTIMENT_BADGE = {
  positiv: { label: 'positiv', color: '#16a34a' },
  negativ: { label: 'negativ', color: '#dc2626' },
  neutral: { label: 'neutral', color: '#475569' }
};

function fmtDate(date, withTime = false) {
  if (!date) return '–';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '–';
  return format(d, withTime ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy', { locale: de });
}

function fmtRange(from, to) {
  return `${fmtDate(from)} – ${fmtDate(to)}`;
}

function groupByCategory(articles) {
  const groups = { sehr_relevant: [], relevant: [], moeglich_relevant: [], irrelevant: [] };
  for (const a of articles) {
    const cat = a.category || 'irrelevant';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(a);
  }
  return groups;
}

function sentimentSummary(articles) {
  const counts = { positiv: 0, negativ: 0, neutral: 0 };
  for (const a of articles) {
    const s = a.sentiment || 'neutral';
    counts[s] = (counts[s] || 0) + 1;
  }
  const total = articles.length || 1;
  return {
    counts,
    total: articles.length,
    percentages: {
      positiv: Math.round((counts.positiv / total) * 100),
      negativ: Math.round((counts.negativ / total) * 100),
      neutral: Math.round((counts.neutral / total) * 100)
    }
  };
}

function timeSeries(articles, from, to) {
  const days = new Map();
  const start = new Date(from);
  start.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days.set(format(d, 'yyyy-MM-dd'), 0);
  }
  for (const a of articles) {
    if (!a.published_date) continue;
    const key = format(new Date(a.published_date), 'yyyy-MM-dd');
    if (days.has(key)) days.set(key, days.get(key) + 1);
  }
  return Array.from(days.entries()).map(([date, count]) => ({ date, count }));
}

function bySourceCounts(articles) {
  const counts = new Map();
  for (const a of articles) {
    const key = a.source || 'Unbekannt';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
}

function renderArticleCard(article) {
  const cat = CATEGORY_LABELS[article.category] || CATEGORY_LABELS.irrelevant;
  const sentiment = SENTIMENT_BADGE[article.sentiment] || SENTIMENT_BADGE.neutral;
  const alsoOn = Array.isArray(article.also_on) ? article.also_on : [];
  const summary = article.summary
    ? escapeHtml(truncate(article.summary, settings.reports.max_summary_length || 280))
    : '';
  return `
    <article class="article-card" data-category="${escapeHtml(article.category || '')}">
      <div class="article-meta">
        <span class="badge" style="background:${cat.color}" title="Relevanz-Score: ${article.relevance_score}">
          ${cat.stars} ${escapeHtml(cat.label)}
        </span>
        <span class="badge" style="background:${sentiment.color}">${escapeHtml(sentiment.label)}</span>
        ${article.paywall ? '<span class="badge paywall">Paywall</span>' : ''}
        ${article.article_type ? `<span class="badge type">${escapeHtml(article.article_type)}</span>` : ''}
      </div>
      <h3 class="article-title">
        <a href="${escapeHtml(article.url)}" target="_blank" rel="noopener">${escapeHtml(article.title)}</a>
      </h3>
      <div class="article-source">
        <strong>${escapeHtml(article.source || 'Unbekannt')}</strong>
        ${article.author ? ' · ' + escapeHtml(article.author) : ''}
        · ${fmtDate(article.published_date)}
        · Score ${article.relevance_score}
      </div>
      ${summary ? `<p class="article-summary">${summary}</p>` : ''}
      ${alsoOn.length > 0 ? `
        <details class="article-also">
          <summary>Auch erschienen in ${alsoOn.length} weiteren Quellen</summary>
          <ul>${alsoOn.map(u => `<li><a href="${escapeHtml(u)}" target="_blank" rel="noopener">${escapeHtml(u)}</a></li>`).join('')}</ul>
        </details>
      ` : ''}
    </article>
  `;
}

function renderCategorySection(catKey, articles) {
  if (!articles.length) return '';
  const cat = CATEGORY_LABELS[catKey];
  const limit = settings.reports.max_articles_per_section || 50;
  const visible = articles.slice(0, limit);
  const more = articles.length - visible.length;
  return `
    <section class="category" id="cat-${catKey}">
      <h2 style="border-bottom:3px solid ${cat.color}">
        ${cat.stars} ${escapeHtml(cat.label)}
        <small>(${articles.length})</small>
      </h2>
      <div class="article-list">
        ${visible.map(renderArticleCard).join('')}
      </div>
      ${more > 0 ? `<p class="more">+ ${more} weitere Artikel in dieser Kategorie</p>` : ''}
    </section>
  `;
}

function renderSentimentChart(sentiment) {
  if (sentiment.total === 0) return '<p>Keine Daten verfuegbar.</p>';
  const segments = [
    { label: 'Positiv', value: sentiment.counts.positiv, percent: sentiment.percentages.positiv, color: '#16a34a' },
    { label: 'Neutral', value: sentiment.counts.neutral, percent: sentiment.percentages.neutral, color: '#475569' },
    { label: 'Negativ', value: sentiment.counts.negativ, percent: sentiment.percentages.negativ, color: '#dc2626' }
  ];
  let cumulative = 0;
  const gradientStops = segments.map(s => {
    const start = cumulative;
    cumulative += s.percent;
    return `${s.color} ${start}% ${cumulative}%`;
  }).join(', ');
  return `
    <div class="chart-row">
      <div class="pie" style="background: conic-gradient(${gradientStops})"></div>
      <ul class="legend">
        ${segments.map(s => `
          <li>
            <span class="dot" style="background:${s.color}"></span>
            <strong>${s.label}</strong>: ${s.value} (${s.percent}%)
          </li>
        `).join('')}
      </ul>
    </div>
  `;
}

function renderTimeSeries(series) {
  if (!series.length) return '<p>Keine Daten verfuegbar.</p>';
  const max = Math.max(...series.map(s => s.count), 1);
  return `
    <div class="bar-chart">
      ${series.map(s => {
        const heightPct = (s.count / max) * 100;
        return `
          <div class="bar-col" title="${s.date}: ${s.count} Artikel">
            <div class="bar" style="height:${heightPct}%"></div>
            <div class="bar-label">${s.date.slice(5)}</div>
            <div class="bar-value">${s.count}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderSourcesTable(rows) {
  if (!rows.length) return '<p>Keine Daten verfuegbar.</p>';
  return `
    <table class="sources-table">
      <thead><tr><th>Quelle</th><th>Artikel</th></tr></thead>
      <tbody>
        ${rows.map(r => `<tr><td>${escapeHtml(r.source)}</td><td>${r.count}</td></tr>`).join('')}
      </tbody>
    </table>
  `;
}

function buildHtmlReport({ from, to, articles, title }) {
  const groups = groupByCategory(articles);
  const sentiment = sentimentSummary(articles);
  const series = timeSeries(articles, from, to);
  const sources = bySourceCounts(articles);
  const top5 = [...articles].sort((a, b) => b.relevance_score - a.relevance_score).slice(0, 5);
  const reportTitle = title || `Pressespiegel Muenchner Kammerspiele`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(reportTitle)} – ${fmtRange(from, to)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; color: #0f172a; margin: 0; padding: 32px; background: #f8fafc; line-height: 1.5; }
  .container { max-width: 1080px; margin: 0 auto; }
  header.report-header { border-bottom: 4px solid #0f172a; padding-bottom: 16px; margin-bottom: 24px; }
  header.report-header h1 { margin: 0 0 4px 0; font-size: 28px; }
  header.report-header .subtitle { color: #475569; font-size: 14px; }
  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin: 24px 0; }
  .summary-card { background: white; padding: 16px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .summary-card .value { font-size: 32px; font-weight: bold; color: #0f172a; }
  .summary-card .label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; }
  section { background: white; padding: 24px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); margin-bottom: 24px; page-break-inside: avoid; }
  section h2 { margin: 0 0 16px 0; font-size: 20px; padding-bottom: 8px; }
  section h2 small { font-weight: normal; color: #64748b; }
  .article-card { padding: 16px; border-left: 4px solid #cbd5e1; margin-bottom: 16px; background: #f8fafc; border-radius: 0 6px 6px 0; page-break-inside: avoid; }
  .article-card[data-category="sehr_relevant"] { border-left-color: #16a34a; }
  .article-card[data-category="relevant"] { border-left-color: #2563eb; }
  .article-card[data-category="moeglich_relevant"] { border-left-color: #a16207; }
  .article-title { margin: 8px 0; font-size: 17px; line-height: 1.3; }
  .article-title a { color: #0f172a; text-decoration: none; }
  .article-title a:hover { text-decoration: underline; }
  .article-source { font-size: 12px; color: #475569; margin-bottom: 8px; }
  .article-summary { margin: 8px 0 0 0; color: #1e293b; font-size: 14px; }
  .article-meta { display: flex; gap: 6px; flex-wrap: wrap; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; color: white; font-size: 11px; font-weight: 600; }
  .badge.paywall { background: #be185d; }
  .badge.type { background: #475569; }
  .article-also { margin-top: 8px; font-size: 12px; }
  .article-also summary { cursor: pointer; color: #64748b; }
  .article-also ul { margin: 4px 0 0 0; padding-left: 16px; }
  .chart-row { display: grid; grid-template-columns: 160px 1fr; gap: 24px; align-items: center; }
  .pie { width: 140px; height: 140px; border-radius: 50%; }
  .legend { list-style: none; padding: 0; margin: 0; }
  .legend li { margin-bottom: 6px; font-size: 14px; }
  .legend .dot { display: inline-block; width: 12px; height: 12px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }
  .bar-chart { display: flex; gap: 4px; height: 160px; align-items: flex-end; padding: 8px 0; overflow-x: auto; }
  .bar-col { display: flex; flex-direction: column; align-items: center; gap: 4px; min-width: 30px; height: 100%; }
  .bar { background: #2563eb; width: 100%; min-height: 2px; border-radius: 2px 2px 0 0; }
  .bar-label { font-size: 10px; color: #64748b; }
  .bar-value { font-size: 11px; font-weight: 600; }
  .sources-table { width: 100%; border-collapse: collapse; }
  .sources-table th, .sources-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
  .sources-table th { background: #f1f5f9; }
  .more { color: #64748b; font-style: italic; margin-top: 8px; }
  footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; }
  @media print {
    body { background: white; padding: 0; }
    section { box-shadow: none; border: 1px solid #e2e8f0; }
  }
</style>
</head>
<body>
<div class="container">
  <header class="report-header">
    <h1>${escapeHtml(reportTitle)}</h1>
    <div class="subtitle">Zeitraum: ${fmtRange(from, to)} · Erstellt am ${fmtDate(new Date(), true)}</div>
  </header>

  <div class="summary-grid">
    <div class="summary-card"><div class="value">${articles.length}</div><div class="label">Artikel gesamt</div></div>
    <div class="summary-card"><div class="value" style="color:#16a34a">${groups.sehr_relevant.length}</div><div class="label">Sehr relevant</div></div>
    <div class="summary-card"><div class="value" style="color:#16a34a">${sentiment.counts.positiv}</div><div class="label">Positive Stimmen</div></div>
    <div class="summary-card"><div class="value" style="color:#dc2626">${sentiment.counts.negativ}</div><div class="label">Negative Stimmen</div></div>
  </div>

  <section>
    <h2>Top 5 Artikel</h2>
    <ol class="top5">
      ${top5.length === 0 ? '<li>Keine Artikel im Zeitraum.</li>' : top5.map(a => `
        <li>
          <a href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><strong>${escapeHtml(a.title)}</strong></a>
          <div class="article-source">${escapeHtml(a.source || '')} · ${fmtDate(a.published_date)} · Score ${a.relevance_score}</div>
        </li>
      `).join('')}
    </ol>
  </section>

  <section>
    <h2>Sentiment-Uebersicht</h2>
    ${renderSentimentChart(sentiment)}
  </section>

  <section>
    <h2>Zeitverlauf</h2>
    ${renderTimeSeries(series)}
  </section>

  <section>
    <h2>Quellen</h2>
    ${renderSourcesTable(sources)}
  </section>

  ${renderCategorySection('sehr_relevant', groups.sehr_relevant)}
  ${renderCategorySection('relevant', groups.relevant)}
  ${renderCategorySection('moeglich_relevant', groups.moeglich_relevant)}

  <footer>
    Pressespiegel-Tool · Generiert mit Node.js · ${fmtDate(new Date(), true)}
  </footer>
</div>
</body>
</html>`;
}

async function writeHtml(reportHtml, filename) {
  const filepath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filepath, reportHtml, 'utf8');
  logger.info(`HTML-Report geschrieben: ${filepath}`);
  return filepath;
}

async function writePdf(reportHtml, filename) {
  let browser;
  try {
    const puppeteer = require('puppeteer');
    browser = await puppeteer.launch({
      headless: settings.scraping.puppeteer.headless,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(reportHtml, { waitUntil: 'networkidle0' });
    const filepath = path.join(REPORTS_DIR, filename);
    await page.pdf({
      path: filepath,
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', right: '15mm', bottom: '20mm', left: '15mm' }
    });
    logger.info(`PDF-Report geschrieben: ${filepath}`);
    return filepath;
  } catch (err) {
    logger.error('PDF-Erzeugung fehlgeschlagen', { error: err.message });
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function generateReport({ from, to, articles, format: outFormat = 'html', title }) {
  const html = buildHtmlReport({ from, to, articles, title });
  const stamp = `${format(from, 'yyyy-MM-dd')}_${format(to, 'yyyy-MM-dd')}`;
  const result = { html: null, pdf: null };
  if (outFormat === 'html' || outFormat === 'both') {
    result.html = await writeHtml(html, `pressespiegel_${stamp}.html`);
  }
  if (outFormat === 'pdf' || outFormat === 'both') {
    result.pdf = await writePdf(html, `pressespiegel_${stamp}.pdf`);
  }
  if (outFormat === 'html' && !result.html) {
    result.html = await writeHtml(html, `pressespiegel_${stamp}.html`);
  }
  return result;
}

module.exports = {
  buildHtmlReport,
  generateReport,
  writeHtml,
  writePdf
};
