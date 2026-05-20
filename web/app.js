'use strict';

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

const state = {
  articles: [],
  total: 0,
  search: '',
  filters: { category: '', sentiment: '', source: '', tag: '', bookmark: '', period: '30d', from: '', to: '', sort: 'score-desc' },
  keywords: null,
  sources: null,
  settings: null,
  ws: null,
  wsReconnect: null
};

const CAT_LABEL = {
  sehr_relevant: 'Sehr relevant',
  relevant: 'Relevant',
  moeglich_relevant: 'Moeglich',
  irrelevant: 'Niedrig'
};
const SENT_LABEL = { positiv: 'positiv', negativ: 'negativ', neutral: 'neutral' };

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function toast(msg, type = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 3000);
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeNum(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function safePct(n, max, fallback = 0) {
  const num = safeNum(n, fallback);
  const m = safeNum(max, 0);
  if (m <= 0) return fallback;
  const pct = (num / m) * 100;
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : fallback;
}

function fmtDate(d, withTime = false) {
  if (!d) return '–';
  const date = new Date(d);
  if (isNaN(date.getTime())) return '–';
  const pad = (n) => String(n).padStart(2, '0');
  const s = `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
  if (!withTime) return s;
  return `${s} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function highlight(text, query) {
  if (!text || !query) return escapeHtml(text || '');
  const esc = escapeHtml(text);
  const terms = query.split(/\s+/).filter(t => t.length >= 3);
  if (!terms.length) return esc;
  const re = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return esc.replace(re, '<mark>$1</mark>');
}

const themeKey = 'pressespiegel-theme';
function initTheme() {
  const saved = localStorage.getItem(themeKey);
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
  $('#theme-toggle').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    if (next === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    localStorage.setItem(themeKey, next);
  });
}

function initTabs() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      $$('.tab').forEach(t => t.classList.remove('active'));
      $(`#tab-${tab}`).classList.add('active');
      onTabActivate(tab);
    });
  });
}

function onTabActivate(tab) {
  switch (tab) {
    case 'dashboard': loadDashboard(); break;
    case 'articles': loadArticles(); loadTagFilter(); break;
    case 'scan': loadScan(); break;
    case 'reports': loadReports(); break;
    case 'tags': loadTagsTab(); break;
    case 'keywords': loadKeywords(); break;
    case 'sources': loadSources(); break;
    case 'bookmarks': loadBookmarks(); break;
    case 'trends': loadTrends(); break;
    case 'settings': loadSettingsTab(); break;
    case 'logs': loadLogs(); break;
  }
}

async function loadTagFilter() {
  try {
    const data = await api('/api/tags');
    const sel = document.getElementById('filter-tag');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = '<option value="">Alle Tags</option>' +
      (data.tags || []).slice(0, 100).map(t =>
        `<option value="${escapeHtml(t.tag)}"${t.tag === cur ? ' selected' : ''}>${escapeHtml(t.tag)} (${t.count})</option>`
      ).join('');
  } catch { /* ignore */ }
}

async function loadTagsTab() {
  try {
    const data = await api('/api/tags');
    const tags = data.tags || [];
    const byCat = new Map();
    for (const { tag, count } of tags) {
      const cat = tag.includes(':') ? tag.split(':')[0] : 'ohne-kategorie';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push({ tag, count });
    }
    const container = document.getElementById('tags-by-category');
    if (!container) return;
    if (byCat.size === 0) {
      container.innerHTML = '<div class="card"><p class="muted">Noch keine Tags. Tags werden beim Scan automatisch vergeben.</p></div>';
      return;
    }
    const sorted = [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    container.innerHTML = sorted.map(([cat, list]) => {
      list.sort((a, b) => b.count - a.count);
      const max = Math.max(1, ...list.map(t => safeNum(t.count)));
      return `
        <div class="card">
          <h2>${escapeHtml(cat)} <small>${list.length} Tags, gesamt ${list.reduce((a, b) => a + safeNum(b.count), 0)}</small></h2>
          <div class="word-cloud">
            ${list.map(t => {
              const size = 11 + Math.round(safePct(t.count, max) * 0.14);
              const display = t.tag.includes(':') ? t.tag.split(':').slice(1).join(':') : t.tag;
              return `<span class="word tag" style="font-size:${size}px" data-tag="${escapeHtml(t.tag)}" title="${safeNum(t.count)} Artikel: ${escapeHtml(t.tag)}">${escapeHtml(display)} <small>(${safeNum(t.count)})</small></span>`;
            }).join(' ')}
          </div>
        </div>
      `;
    }).join('');
    document.querySelectorAll('#tags-by-category .word.tag').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('article-search').value = `tag:${el.dataset.tag}`;
        state.search = `tag:${el.dataset.tag}`;
        document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'articles'));
        document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-articles'));
        loadArticles();
      });
    });
  } catch (err) { toast(err.message, 'error'); }
}

function initWebSocket() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  state.ws = ws;
  ws.onopen = () => {
    $('#ws-status').innerHTML = '<span class="dot online"></span><span>verbunden</span>';
  };
  ws.onclose = () => {
    $('#ws-status').innerHTML = '<span class="dot offline"></span><span>getrennt</span>';
    state.wsReconnect = setTimeout(initWebSocket, 3000);
  };
  ws.onmessage = (ev) => {
    try {
      const { type, payload } = JSON.parse(ev.data);
      handleWsMessage(type, payload);
    } catch (e) { /* ignore */ }
  };
}

function handleWsMessage(type, payload) {
  switch (type) {
    case 'log':
      appendScanLog(payload);
      break;
    case 'scan-start':
      $('#scan-status').textContent = `Scan ${payload.scanId} läuft …`;
      $('#start-scan').disabled = true;
      $('#scan-log').innerHTML = '';
      break;
    case 'scan-complete':
      $('#scan-status').textContent = `Fertig: ${payload.summary.articlesAdded} neue Artikel, ${payload.summary.duplicatesFound} Duplikate, ${payload.summary.errors} Fehler`;
      $('#start-scan').disabled = false;
      toast(`Scan beendet: ${payload.summary.articlesAdded} neue Artikel`, 'success');
      if ($('#tab-dashboard').classList.contains('active')) loadDashboard();
      break;
    case 'scan-error':
      $('#scan-status').textContent = `Fehler: ${payload.error}`;
      $('#start-scan').disabled = false;
      toast(`Scan-Fehler: ${payload.error}`, 'error');
      break;
    case 'scan_summary':
      showScanSummary(payload);
      break;
  }
}

function showScanSummary(s) {
  const dur = s.duration_ms ? `${Math.round(s.duration_ms / 1000)}s` : '?';
  const html = `
    <div class="scan-summary-box">
      <h3>Scan-Zusammenfassung</h3>
      <div class="scan-summary-grid">
        <div><strong>${safeNum(s.total_feeds)}</strong><small>Feeds gesamt</small></div>
        <div class="ok"><strong>${safeNum(s.ok)}</strong><small>OK</small></div>
        <div class="warn"><strong>${safeNum(s.blocked_403)}</strong><small>geblockt</small></div>
        <div class="error"><strong>${safeNum(s.dead)}</strong><small>tot</small></div>
        <div><strong>${safeNum(s.new_articles)}</strong><small>neue Artikel</small></div>
        <div><strong>${safeNum(s.duplicates_removed)}</strong><small>Duplikate</small></div>
        <div><strong>${dur}</strong><small>Dauer</small></div>
      </div>
    </div>`;
  const target = document.getElementById('dashboard-scan-summary') || document.getElementById('scan-status');
  if (target) {
    const box = document.createElement('div');
    box.innerHTML = html;
    if (target.id === 'dashboard-scan-summary') {
      target.innerHTML = html;
    } else {
      target.insertAdjacentHTML('afterend', html);
    }
  }
}

function appendScanLog(payload) {
  const el = $('#scan-log');
  if (!el) return;
  const line = document.createElement('div');
  line.className = `log-line ${payload.level || 'info'}`;
  const ts = new Date().toLocaleTimeString();
  line.innerHTML = `<span class="ts">${ts}</span>${escapeHtml(payload.message)}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 200) el.removeChild(el.firstChild);
}

async function loadDashboard() {
  try {
    const stats = await api('/api/stats?last=30d');
    const html = `
      <div class="metric"><div class="v">${stats.overview.unique_articles || 0}</div><div class="l">Unique Artikel</div></div>
      <div class="metric acc"><div class="v">${(stats.overview.total || 0)}</div><div class="l">Total inkl. Dup.</div></div>
      <div class="metric pos"><div class="v">${stats.overview.positive || 0}</div><div class="l">Positiv</div></div>
      <div class="metric neg"><div class="v">${stats.overview.negative || 0}</div><div class="l">Negativ</div></div>
      <div class="metric"><div class="v">${stats.overview.duplicates || 0}</div><div class="l">Duplikate</div></div>
      <div class="metric"><div class="v">${stats.overview.paywalled || 0}</div><div class="l">Paywall</div></div>
    `;
    $('#dashboard-metrics').innerHTML = html;
    renderSentimentChart(stats.overview);
    renderSourceBars(stats.bySource);
    loadTopArticles();
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderSentimentChart(o) {
  const pos = safeNum(o.positive);
  const neu = safeNum(o.neutral);
  const neg = safeNum(o.negative);
  const total = pos + neu + neg;
  if (total === 0) {
    $('#sentiment-chart').innerHTML = '<p class="muted">Noch keine Daten.</p>';
    return;
  }
  const segs = [
    { l: 'Positiv', v: pos, c: 'var(--c-pos)' },
    { l: 'Neutral', v: neu, c: 'var(--c-neu)' },
    { l: 'Negativ', v: neg, c: 'var(--c-neg)' }
  ];
  let acc = 0;
  const stops = segs.map(s => {
    const start = safePct(acc, total);
    acc += s.v;
    const end = safePct(acc, total);
    return `${s.c} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  }).join(', ');
  $('#sentiment-chart').innerHTML = `
    <div style="display:flex;align-items:center;gap:24px;justify-content:center;flex-wrap:wrap;">
      <div class="pie" style="background: conic-gradient(${stops})">
        <div class="pie-center"><span>${total}</span><small>Artikel</small></div>
      </div>
      <ul class="legend" style="margin:0">
        ${segs.map(s => `
          <li><span class="dot" style="background:${s.c}"></span><strong>${s.l}</strong>
              <span class="legend-value">${s.v} (${Math.round(safePct(s.v, total))}%)</span></li>
        `).join('')}
      </ul>
    </div>
  `;
}

function renderSourceBars(rows) {
  if (!rows || !rows.length) {
    $('#sources-chart').innerHTML = '<p class="muted">Noch keine Daten.</p>';
    return;
  }
  const max = Math.max(1, ...rows.map(r => safeNum(r.count)));
  $('#sources-chart').innerHTML = `
    <div class="source-bars">
      ${rows.slice(0, 10).map(r => `
        <div class="source-row">
          <span class="src-name">${escapeHtml(r.source)}</span>
          <span class="src-count">${safeNum(r.count)}</span>
          <div class="src-bar"><span style="width:${safePct(r.count, max).toFixed(2)}%"></span></div>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadTopArticles() {
  try {
    const data = await api('/api/articles?last=30d&limit=10');
    const sorted = data.articles.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0)).slice(0, 10);
    $('#top-articles').innerHTML = sorted.length === 0
      ? '<p class="muted">Noch keine Artikel.</p>'
      : sorted.map((a, i) => `
        <div class="top-article" data-id="${a.id}">
          <div class="rank">${i + 1}</div>
          <div>
            <div class="t-title">${escapeHtml(a.title)}</div>
            <div class="t-meta">${escapeHtml(a.source || '')} · ${fmtDate(a.published_date)}</div>
          </div>
          <span class="t-score">${a.relevance_score || 0}</span>
        </div>
      `).join('');
    $$('.top-article').forEach(el => el.addEventListener('click', () => showArticleDetail(el.dataset.id)));
  } catch (err) {
    toast(err.message, 'error');
  }
}

function buildArticleQuery() {
  const params = new URLSearchParams();
  if (state.filters.period === 'custom') {
    if (state.filters.from) params.set('from', state.filters.from);
    if (state.filters.to) params.set('to', state.filters.to);
  } else {
    params.set('last', state.filters.period);
  }
  if (state.filters.category) params.set('category', state.filters.category);
  if (state.filters.sentiment) params.set('sentiment', state.filters.sentiment);
  if (state.filters.source) params.set('source', state.filters.source);
  if (state.filters.tag) params.set('tag', state.filters.tag);
  if (state.filters.bookmark) params.set('bookmark', state.filters.bookmark);
  if (state.search) params.set('q', state.search);
  params.set('limit', '500');
  return params.toString();
}

async function loadArticles() {
  try {
    $('#articles-subtitle').textContent = 'Lade …';
    showSkeletonArticles(5);
    renderActiveFilterChips();
    loadSavedSearches();
    const data = await api(`/api/articles?${buildArticleQuery()}`);
    state.articles = data.articles;
    state.total = data.total;

    const sources = [...new Set(data.articles.map(a => a.source).filter(Boolean))].sort();
    const cur = state.filters.source;
    $('#filter-source').innerHTML = `<option value="">Alle Quellen</option>` +
      sources.map(s => `<option value="${escapeHtml(s)}"${s === cur ? ' selected' : ''}>${escapeHtml(s)} (${data.articles.filter(a => a.source === s).length})</option>`).join('');

    renderArticleList(data.articles);
    renderActiveFilterChips();
    $('#articles-subtitle').textContent = `${data.returned} von ${data.total} Artikeln · Zeitraum ${fmtDate(data.from)} – ${fmtDate(data.to)}`;
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderArticleList(articles) {
  const sorted = [...articles];
  const sort = state.filters.sort;
  if (sort === 'score-desc') sorted.sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0));
  else if (sort === 'score-asc') sorted.sort((a, b) => (a.relevance_score || 0) - (b.relevance_score || 0));
  else if (sort === 'date-desc') sorted.sort((a, b) => (b.published_date || '').localeCompare(a.published_date || ''));
  else if (sort === 'date-asc') sorted.sort((a, b) => (a.published_date || '').localeCompare(b.published_date || ''));
  else if (sort === 'relevance') sorted.sort((a, b) => (b._searchScore || 0) - (a._searchScore || 0));

  const empty = $('#article-empty');
  const list = $('#article-list');
  $('#results-count').innerHTML = `<strong>${sorted.length}</strong> Artikel${state.search ? ` für „${escapeHtml(state.search)}“` : ''}`;
  if (!sorted.length) {
    list.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  list.innerHTML = sorted.map(a => renderArticleItem(a, state.search)).join('');
  $$('.article-item').forEach(el => {
    el.addEventListener('click', (ev) => {
      if (ev.target.tagName === 'A') return;
      showArticleDetail(el.dataset.id);
    });
  });
}

function renderArticleItem(a, query) {
  const catLabel = CAT_LABEL[a.category] || 'Niedrig';
  const sentLabel = SENT_LABEL[a.sentiment] || 'neutral';
  return `
    <article class="article-item" data-id="${a.id}" data-category="${a.category}">
      <div class="article-meta-row">
        <span class="badge badge-cat-${a.category}">${catLabel}</span>
        <span class="badge badge-sent-${a.sentiment}">${sentLabel}</span>
        <span class="badge outline">${escapeHtml(a.article_type || 'news')}</span>
        <span class="badge outline">Score ${a.relevance_score || 0}</span>
        ${a.paywall ? '<span class="badge paywall">Paywall</span>' : ''}
        ${a._searchScore ? `<span class="badge outline">Match ${(a._searchScore * 100 | 0)}%</span>` : ''}
      </div>
      <h3 class="article-title">${highlight(a.title, query)}</h3>
      <div class="article-meta">
        <strong>${escapeHtml(a.source || 'Unbekannt')}</strong>
        ${a.author ? `<span class="sep">·</span>${escapeHtml(a.author)}` : ''}
        <span class="sep">·</span>${fmtDate(a.published_date)}
        ${a.word_count ? `<span class="sep">·</span>${a.word_count} Worte` : ''}
      </div>
      ${a.summary ? `<p class="article-summary">${highlight(a.summary, query)}</p>` : ''}
    </article>
  `;
}

async function showArticleDetail(id) {
  try {
    const [a, tagsData] = await Promise.all([
      api(`/api/article/${id}`),
      api(`/api/article/${id}/tags`)
    ]);
    const tags = tagsData.tags || [];
    const dlg = $('#article-detail');
    const meta = a.meta ? (typeof a.meta === 'string' ? JSON.parse(a.meta) : a.meta) : {};
    const alsoOn = a.also_on ? (typeof a.also_on === 'string' ? JSON.parse(a.also_on) : a.also_on) : [];
    const reasons = (meta && meta.reasons) || [];
    const bookmarksData = await api('/api/bookmarks');
    const isBookmarked = bookmarksData.bookmarks.some(b => b.id === a.id);
    dlg.innerHTML = `
      <div class="modal-head">
        <strong>${escapeHtml(a.title)}</strong>
        <div style="display:flex;gap:6px;">
          <button class="btn ${isBookmarked ? 'btn-primary' : ''}" id="md-bookmark">${isBookmarked ? 'Lesezeichen entfernen' : 'Lesezeichen hinzufuegen'}</button>
          <button class="modal-close" id="md-close">×</button>
        </div>
      </div>
      <div class="modal-body">
        <div class="article-meta-row" style="margin-bottom:10px;">
          <span class="badge badge-cat-${a.category}">${CAT_LABEL[a.category] || 'Niedrig'}</span>
          <span class="badge badge-sent-${a.sentiment}">${a.sentiment || 'neutral'}</span>
          <span class="badge outline">${escapeHtml(a.article_type || 'news')}</span>
          <span class="badge outline">Score ${a.relevance_score || 0}</span>
        </div>
        <p class="muted" style="margin:0 0 12px 0;">
          <strong>${escapeHtml(a.source || '')}</strong>
          ${a.author ? ` · ${escapeHtml(a.author)}` : ''}
          · ${fmtDate(a.published_date, true)}
        </p>
        <p><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.url.length > 100 ? a.url.slice(0, 100) + '…' : a.url)}</a></p>
        <h3>Tags</h3>
        <div class="keyword-chips" id="md-tags">
          ${tags.map(t => `<span class="chip">${escapeHtml(t)}<span class="x" data-tag="${escapeHtml(t)}">×</span></span>`).join('')}
          <input class="chip-input" id="md-tag-input" placeholder="+ Tag, Enter">
        </div>
        ${a.summary ? `<h3>Zusammenfassung</h3><p>${escapeHtml(a.summary)}</p>` : ''}
        ${reasons.length ? `<h3>Trefferbegründungen</h3><div class="reason-list">${reasons.map(r => `<code>${escapeHtml(r)}</code>`).join('')}</div>` : ''}
        ${alsoOn.length ? `<h3>Auch erschienen in</h3><ul>${alsoOn.map(u => `<li><a href="${escapeHtml(u)}" target="_blank">${escapeHtml(u)}</a></li>`).join('')}</ul>` : ''}
        ${a.full_text ? `<h3>Volltext</h3><pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;">${escapeHtml(a.full_text.slice(0, 5000))}</pre>` : ''}
      </div>
    `;
    dlg.showModal();
    $('#md-close').addEventListener('click', () => dlg.close());
    $('#md-bookmark').addEventListener('click', async () => {
      await toggleBookmark(a.id, isBookmarked);
      dlg.close();
      showArticleDetail(id);
    });
    $('#md-tag-input').addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        await addTagToArticle(a.id, e.target.value.trim());
        dlg.close();
        showArticleDetail(id);
      }
    });
    $$('#md-tags .x').forEach(x => x.addEventListener('click', async () => {
      try {
        await api(`/api/article/${a.id}/tags/${encodeURIComponent(x.dataset.tag)}`, { method: 'DELETE' });
        dlg.close();
        showArticleDetail(id);
      } catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderActiveFilterChips() {
  const box = $('#active-filters');
  if (!box) return;
  const chips = [];
  const labels = {
    category: 'Kategorie',
    sentiment: 'Stimmung',
    source: 'Quelle',
    tag: 'Tag',
    bookmark: 'Lesezeichen'
  };
  const valueLabels = {
    sehr_relevant: 'Sehr relevant',
    moeglich_relevant: 'Moeglich',
    irrelevant: 'Niedrig',
    yes: 'Ja',
    no: 'Nein'
  };
  for (const key of Object.keys(labels)) {
    const v = state.filters[key];
    if (v) chips.push({ key, label: labels[key], value: valueLabels[v] || v });
  }
  if (state.search) chips.push({ key: 'search', label: 'Suche', value: state.search });
  if (state.filters.period && state.filters.period !== '30d') {
    chips.push({ key: 'period', label: 'Zeitraum', value: state.filters.period });
  }
  box.innerHTML = chips.map(c => `
    <span class="active-filter-chip" data-key="${escapeHtml(c.key)}">
      <strong>${escapeHtml(c.label)}:</strong> ${escapeHtml(c.value)}
      <span class="x" data-clear="${escapeHtml(c.key)}" title="Filter entfernen">×</span>
    </span>
  `).join('');
  $$('.active-filter-chip .x', box).forEach(x => {
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = x.dataset.clear;
      if (key === 'search') {
        state.search = '';
        $('#article-search').value = '';
      } else if (key === 'period') {
        state.filters.period = '30d';
        $('#filter-period').value = '30d';
      } else {
        state.filters[key] = '';
        const sel = $(`#filter-${key}`);
        if (sel) sel.value = '';
      }
      loadArticles();
    });
  });
}

async function loadSavedSearches() {
  const box = $('#saved-searches');
  if (!box) return;
  try {
    const data = await api('/api/saved-searches');
    box.innerHTML = (data.searches || []).map(s => `
      <span class="saved-search-chip" data-name="${escapeHtml(s.name)}">
        ${escapeHtml(s.name)}
        <span class="x" data-delete="${escapeHtml(s.name)}" title="Loeschen">×</span>
      </span>
    `).join('');
    $$('.saved-search-chip', box).forEach(chip => {
      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('x')) return;
        const name = chip.dataset.name;
        const found = (data.searches || []).find(s => s.name === name);
        if (!found) return;
        if (found.query) {
          state.search = found.query;
          $('#article-search').value = found.query;
        }
        if (found.filters) {
          state.filters = { ...state.filters, ...found.filters };
          for (const key of ['category', 'sentiment', 'source', 'tag', 'bookmark', 'period', 'sort']) {
            const sel = $(`#filter-${key}`);
            if (sel && state.filters[key] != null) sel.value = state.filters[key];
          }
        }
        loadArticles();
      });
    });
    $$('.saved-search-chip .x', box).forEach(x => {
      x.addEventListener('click', async (e) => {
        e.stopPropagation();
        const name = x.dataset.delete;
        if (!confirm(`Suche "${name}" loeschen?`)) return;
        try {
          await api(`/api/saved-searches/${encodeURIComponent(name)}`, { method: 'DELETE' });
          loadSavedSearches();
        } catch (err) { toast(err.message, 'error'); }
      });
    });
  } catch { /* silent */ }
}

const QUICK_PRESETS = {
  all: { category: '', sentiment: '', bookmark: '', period: '30d' },
  top: { category: 'sehr_relevant', sentiment: '', bookmark: '', period: '30d' },
  reviews: { category: '', sentiment: '', bookmark: '', period: '30d', search: 'type:review' },
  interviews: { category: '', sentiment: '', bookmark: '', period: '30d', search: 'type:interview' },
  positive: { category: '', sentiment: 'positiv', bookmark: '', period: '30d' },
  negative: { category: '', sentiment: 'negativ', bookmark: '', period: '30d' },
  today: { category: '', sentiment: '', bookmark: '', period: '7d' },
  bookmarked: { category: '', sentiment: '', bookmark: 'yes', period: '90d' }
};

function applyQuickPreset(name) {
  const preset = QUICK_PRESETS[name];
  if (!preset) return;
  state.filters = { ...state.filters, ...preset };
  if (preset.search !== undefined) {
    state.search = preset.search;
    $('#article-search').value = preset.search;
  }
  for (const k of ['category', 'sentiment', 'source', 'tag', 'bookmark', 'period']) {
    const sel = $(`#filter-${k}`);
    if (sel && state.filters[k] != null) sel.value = state.filters[k];
  }
  $$('.quick-filter').forEach(b => b.classList.toggle('active', b.dataset.quick === name));
  loadArticles();
}

function initQuickFilters() {
  $$('.quick-filter').forEach(btn => {
    btn.addEventListener('click', () => applyQuickPreset(btn.dataset.quick));
  });
}

function showSkeletonArticles(count = 5) {
  const list = $('#article-list');
  if (!list) return;
  list.innerHTML = Array(count).fill(0).map(() => `
    <div class="article-item">
      <div class="skeleton lg" style="width:40%"></div>
      <div class="skeleton" style="width:80%"></div>
      <div class="skeleton" style="width:60%"></div>
    </div>
  `).join('');
}

function initHelpOverlay() {
  if ($('#help-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'help-overlay';
  overlay.id = 'help-overlay';
  overlay.innerHTML = `
    <div class="help-overlay-card">
      <h2>Tastenkuerzel & Such-Syntax</h2>
      <table>
        <tr><td><span class="kbd">/</span></td><td>Suche fokussieren</td></tr>
        <tr><td><span class="kbd">?</span></td><td>Diese Hilfe ein/ausblenden</td></tr>
        <tr><td><span class="kbd">Esc</span></td><td>Suche/Modal schliessen</td></tr>
        <tr><td><span class="kbd">g</span> <span class="kbd">d</span></td><td>Dashboard</td></tr>
        <tr><td><span class="kbd">g</span> <span class="kbd">a</span></td><td>Artikel</td></tr>
        <tr><td><span class="kbd">g</span> <span class="kbd">s</span></td><td>Scan</td></tr>
        <tr><td><span class="kbd">t</span></td><td>Theme umschalten</td></tr>
      </table>
      <h2 style="margin-top:18px">Such-Operatoren</h2>
      <table>
        <tr><td><code>"Phrase"</code></td><td>Exakte Phrase</td></tr>
        <tr><td><code>Wort -Nicht</code></td><td>Ausschluss</td></tr>
        <tr><td><code>A OR B</code></td><td>Oder</td></tr>
        <tr><td><code>title:X</code></td><td>Feldsuche</td></tr>
        <tr><td><code>tag:X</code></td><td>Tag-Filter</td></tr>
        <tr><td><code>after:2024-01-01</code></td><td>Datum-Filter</td></tr>
        <tr><td><code>score:&gt;=50</code></td><td>Score-Filter</td></tr>
      </table>
      <p style="text-align:right;margin-top:14px;">
        <button class="btn" id="help-close">Schliessen</button>
      </p>
    </div>
  `;
  document.body.appendChild(overlay);
  $('#help-close').addEventListener('click', () => overlay.classList.remove('open'));
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
}

function toggleHelp() {
  initHelpOverlay();
  $('#help-overlay').classList.toggle('open');
}

let lastKeyG = 0;
function initGlobalKeys() {
  document.addEventListener('keydown', (e) => {
    const isInput = document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA');
    if (e.key === 'Escape') {
      const overlay = $('#help-overlay');
      if (overlay && overlay.classList.contains('open')) { overlay.classList.remove('open'); return; }
      if (isInput && document.activeElement.id === 'article-search') {
        document.activeElement.blur();
      }
    }
    if (isInput) return;
    if (e.key === '?') { e.preventDefault(); toggleHelp(); return; }
    if (e.key === 't' || e.key === 'T') {
      const tg = $('#theme-toggle');
      if (tg) tg.click();
      return;
    }
    if (e.key === 'g' || e.key === 'G') { lastKeyG = Date.now(); return; }
    if (Date.now() - lastKeyG < 800) {
      const map = { d: 'dashboard', a: 'articles', s: 'scan', r: 'reports', k: 'keywords', q: 'sources', b: 'bookmarks', l: 'logs', T: 'tags' };
      const tab = map[e.key] || map[e.key.toLowerCase()];
      if (tab) {
        const btn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
        if (btn) btn.click();
        lastKeyG = 0;
      }
    }
  });
}

function initArticleFilters() {
  const debounced = debounce(() => loadArticles(), 250);
  $('#article-search').addEventListener('input', (e) => {
    state.search = e.target.value;
    const relOpt = $('#relevance-opt');
    if (state.search) { relOpt.disabled = false; $('#filter-sort').value = 'relevance'; state.filters.sort = 'relevance'; }
    else { state.filters.sort = 'score-desc'; $('#filter-sort').value = 'score-desc'; }
    handleSuggestInput(e.target.value);
    loadDidYouMean(e.target.value);
    debounced();
  });
  $('#filter-period').addEventListener('change', (e) => {
    state.filters.period = e.target.value;
    const custom = e.target.value === 'custom';
    $('#filter-from').style.display = custom ? '' : 'none';
    $('#filter-to').style.display = custom ? '' : 'none';
    if (!custom) loadArticles();
  });
  $('#filter-from').addEventListener('change', (e) => { state.filters.from = e.target.value; loadArticles(); });
  $('#filter-to').addEventListener('change', (e) => { state.filters.to = e.target.value; loadArticles(); });
  $('#filter-category').addEventListener('change', (e) => { state.filters.category = e.target.value; loadArticles(); });
  $('#filter-sentiment').addEventListener('change', (e) => { state.filters.sentiment = e.target.value; loadArticles(); });
  $('#filter-source').addEventListener('change', (e) => { state.filters.source = e.target.value; loadArticles(); });
  $('#filter-tag').addEventListener('change', (e) => { state.filters.tag = e.target.value; loadArticles(); });
  $('#filter-bookmark').addEventListener('change', (e) => { state.filters.bookmark = e.target.value; loadArticles(); });
  $('#filter-sort').addEventListener('change', (e) => { state.filters.sort = e.target.value; renderArticleList(state.articles); });
  $('#filter-reset').addEventListener('click', () => {
    state.filters = { category: '', sentiment: '', source: '', tag: '', bookmark: '', period: '30d', from: '', to: '', sort: 'score-desc' };
    state.search = '';
    $('#article-search').value = '';
    $('#filter-period').value = '30d';
    $('#filter-category').value = '';
    $('#filter-sentiment').value = '';
    $('#filter-source').value = '';
    $('#filter-tag').value = '';
    $('#filter-bookmark').value = '';
    $('#filter-sort').value = 'score-desc';
    loadArticles();
  });
  $('#export-articles').addEventListener('click', exportCurrentArticles);
  $('#export-csv').addEventListener('click', () => downloadExport('csv'));
  $('#export-json').addEventListener('click', () => downloadExport('json'));

  const saveBtn = $('#filter-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const name = prompt('Name fuer die Suche:');
      if (!name || !name.trim()) return;
      try {
        await api('/api/saved-searches', {
          method: 'POST',
          body: JSON.stringify({
            name: name.trim(),
            query: state.search,
            filters: { ...state.filters }
          })
        });
        toast(`Suche "${name}" gespeichert`, 'success');
        loadSavedSearches();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      $('#article-search').focus();
    }
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

async function handleSuggestInput(q) {
  const box = $('#suggest');
  if (!q || q.length < 2) { box.classList.remove('open'); return; }
  try {
    const data = await api(`/api/suggest?q=${encodeURIComponent(q)}`);
    if (!data.suggestions.length) { box.classList.remove('open'); return; }
    box.innerHTML = data.suggestions.map(s => `<div class="suggest-item">${escapeHtml(s)}</div>`).join('');
    box.classList.add('open');
    $$('.suggest-item', box).forEach(item => {
      item.addEventListener('click', () => {
        $('#article-search').value = item.textContent;
        state.search = item.textContent;
        box.classList.remove('open');
        loadArticles();
      });
    });
  } catch { /* ignore */ }
}

function downloadExport(format) {
  const params = new URLSearchParams();
  if (state.filters.period === 'custom') {
    if (state.filters.from) params.set('from', state.filters.from);
    if (state.filters.to) params.set('to', state.filters.to);
  } else {
    params.set('last', state.filters.period);
  }
  params.set('format', format);
  window.open(`/api/export?${params.toString()}`, '_blank');
}

async function loadDidYouMean(query) {
  const dym = $('#did-you-mean');
  if (!query || query.length < 4) { dym.style.display = 'none'; return; }
  try {
    const data = await api(`/api/did-you-mean?q=${encodeURIComponent(query)}`);
    if (data.suggestion) {
      dym.style.display = '';
      dym.innerHTML = `Meinten Sie: <a href="#" id="dym-link">${escapeHtml(data.suggestion)}</a>?`;
      $('#dym-link').addEventListener('click', (e) => {
        e.preventDefault();
        $('#article-search').value = data.suggestion;
        state.search = data.suggestion;
        loadArticles();
        dym.style.display = 'none';
      });
    } else {
      dym.style.display = 'none';
    }
  } catch { dym.style.display = 'none'; }
}

async function loadBookmarks() {
  try {
    const data = await api('/api/bookmarks');
    const list = $('#bookmarks-list');
    const empty = $('#bookmarks-empty');
    if (!data.bookmarks.length) {
      list.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    list.innerHTML = data.bookmarks.map(a => renderArticleItem({
      ...a,
      summary: a.summary || a.bookmark_note || ''
    }, '')).join('');
    $$('.article-item', list).forEach(el => {
      el.addEventListener('click', (ev) => {
        if (ev.target.tagName === 'A') return;
        showArticleDetail(el.dataset.id);
      });
    });
  } catch (err) { toast(err.message, 'error'); }
}

async function loadTrends() {
  try {
    const period = $('#trends-period').value;
    const [mentionsData, trendsData, tagsData] = await Promise.all([
      api(`/api/mentions?last=${period}`),
      api(`/api/trends?period=${period}`),
      api('/api/tags')
    ]);
    const maxM = Math.max(1, ...mentionsData.mentions.map(m => safeNum(m.count)));
    $('#top-mentions').innerHTML = mentionsData.mentions.length === 0
      ? '<p class="muted">Keine Daten.</p>'
      : mentionsData.mentions.map(m => {
          const size = 11 + Math.round(safePct(m.count, maxM) * 0.18);
          return `<span class="word" style="font-size:${size}px" title="${safeNum(m.count)}x">${escapeHtml(m.term)}</span>`;
        }).join(' ');

    const upTrends = trendsData.trends.filter(t => t.change > 0).slice(0, 15);
    $('#trends-up').innerHTML = upTrends.length === 0
      ? '<p class="muted">Keine Trends.</p>'
      : upTrends.map(t => `
          <div class="trend-row">
            <span class="trend-term">${escapeHtml(t.term)}</span>
            <span class="trend-change">${t.change > 0 ? '+' : ''}${t.change}</span>
            <span class="trend-count">${t.count}</span>
          </div>
        `).join('');

    const maxTag = Math.max(1, ...tagsData.tags.map(t => safeNum(t.count)));
    $('#all-tags').innerHTML = tagsData.tags.length === 0
      ? '<p class="muted">Noch keine Tags. Markiere Artikel im Detail-View.</p>'
      : tagsData.tags.map(t => {
          const size = 11 + Math.round(safePct(t.count, maxTag) * 0.12);
          return `<span class="word tag" style="font-size:${size}px" data-tag="${escapeHtml(t.tag)}" title="${safeNum(t.count)}x">${escapeHtml(t.tag)}</span>`;
        }).join(' ');
    $$('.word.tag').forEach(el => el.addEventListener('click', () => {
      $('#article-search').value = `tag:${el.dataset.tag}`;
      state.search = `tag:${el.dataset.tag}`;
      $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'articles'));
      $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-articles'));
      loadArticles();
    }));
  } catch (err) { toast(err.message, 'error'); }
}

async function toggleBookmark(articleId, isBookmarked) {
  try {
    if (isBookmarked) {
      await api(`/api/article/${articleId}/bookmark`, { method: 'DELETE' });
      toast('Lesezeichen entfernt', 'success');
    } else {
      await api(`/api/article/${articleId}/bookmark`, { method: 'POST', body: JSON.stringify({}) });
      toast('Lesezeichen hinzugefügt', 'success');
    }
  } catch (err) { toast(err.message, 'error'); }
}

async function addTagToArticle(articleId, tag) {
  if (!tag || !tag.trim()) return;
  try {
    await api(`/api/article/${articleId}/tags`, { method: 'POST', body: JSON.stringify({ tag: tag.trim() }) });
    toast(`Tag "${tag}" hinzugefügt`, 'success');
  } catch (err) { toast(err.message, 'error'); }
}

async function exportCurrentArticles() {
  try {
    const opts = {
      format: 'html',
      title: state.search ? `Suche: "${state.search}"` : 'Export'
    };
    if (state.filters.period === 'custom') {
      opts.from = state.filters.from;
      opts.to = state.filters.to;
    } else {
      opts.last = state.filters.period;
    }
    const result = await api('/api/report', { method: 'POST', body: JSON.stringify(opts) });
    if (result.html) {
      toast(`Report erstellt: ${result.html}`, 'success');
      window.open(`/api/reports/${result.html}`, '_blank');
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function loadScan() {
  try {
    const stats = await api('/api/stats?last=30d');
    const health = stats.health || [];
    if (!health.length) {
      $('#feed-health').innerHTML = '<p class="muted">Noch keine Health-Daten. Führe einen Scan aus.</p>';
    } else {
      const sorted = [...health].sort((a, b) => safeNum(b.consecutive_failures) - safeNum(a.consecutive_failures) || (a.source || '').localeCompare(b.source || ''));
      $('#feed-health').innerHTML = `
        <div class="feed-health-list">
          ${sorted.map(h => `
            <div class="feed-row">
              <span class="h-status ${safeNum(h.consecutive_failures) > 0 ? 'err' : 'ok'}">${safeNum(h.consecutive_failures) > 0 ? '✕' : '✓'}</span>
              <div>
                <div>${escapeHtml(h.source)}</div>
                <div class="h-meta">Erfolg: ${h.last_success ? fmtDate(h.last_success, true) : 'nie'} · Fehler: ${h.last_failure ? fmtDate(h.last_failure, true) : 'nie'}${h.last_response_ms ? ' · ' + h.last_response_ms + 'ms' : ''}</div>
              </div>
              <span class="h-meta">${safeNum(h.consecutive_failures) > 0 ? safeNum(h.consecutive_failures) + 'x Fehler' : 'OK'}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  } catch (err) {
    toast(err.message, 'error');
  }
}

function initScanTab() {
  $('#scan-period').addEventListener('change', (e) => {
    $('#scan-custom').style.display = e.target.value === 'custom' ? '' : 'none';
  });
  $('#start-scan').addEventListener('click', async () => {
    const period = $('#scan-period').value;
    const body = period === 'custom'
      ? { from: $('#scan-from').value, to: $('#scan-to').value }
      : { last: period };
    try {
      await api('/api/scan', { method: 'POST', body: JSON.stringify(body) });
      toast('Scan gestartet', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
  $('#quick-scan').addEventListener('click', async () => {
    try {
      await api('/api/scan', { method: 'POST', body: JSON.stringify({ last: '1d' }) });
      toast('Schnell-Scan gestartet', 'success');
      $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === 'scan'));
      $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-scan'));
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadReports() {
  try {
    const data = await api('/api/reports');
    $('#reports-list').innerHTML = data.reports.length === 0
      ? '<p class="muted">Noch keine Reports erstellt.</p>'
      : data.reports.map(r => `
        <div class="report-card">
          <div class="r-name">${escapeHtml(r.name)}</div>
          <div class="r-meta">${fmtDate(r.mtime, true)} · ${(r.size / 1024 | 0)} KB · ${r.type.toUpperCase()}</div>
          <div class="r-actions">
            <button class="btn" data-action="open" data-name="${escapeHtml(r.name)}">Oeffnen</button>
            <button class="btn btn-danger" data-action="delete" data-name="${escapeHtml(r.name)}">✕</button>
          </div>
        </div>
      `).join('');
    $$('[data-action="open"]').forEach(b => b.addEventListener('click', () => window.open(`/api/reports/${b.dataset.name}`, '_blank')));
    $$('[data-action="delete"]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm(`Report "${b.dataset.name}" löschen?`)) return;
      try {
        await api(`/api/reports/${b.dataset.name}`, { method: 'DELETE' });
        toast('Gelöscht', 'success');
        loadReports();
      } catch (err) { toast(err.message, 'error'); }
    }));
  } catch (err) {
    toast(err.message, 'error');
  }
}

function initReportsTab() {
  $('#generate-report').addEventListener('click', () => {
    $('#report-generator').style.display = '';
  });
  $('#cancel-report').addEventListener('click', () => {
    $('#report-generator').style.display = 'none';
  });
  $('#report-period').addEventListener('change', (e) => {
    $('#report-custom').style.display = e.target.value === 'custom' ? '' : 'none';
  });
  $('#run-report').addEventListener('click', async () => {
    const period = $('#report-period').value;
    const body = {
      format: $('#report-format').value,
      title: $('#report-title').value || undefined
    };
    if (period === 'custom') {
      body.from = $('#report-from').value;
      body.to = $('#report-to').value;
    } else {
      body.last = period;
    }
    try {
      $('#run-report').disabled = true;
      const result = await api('/api/report', { method: 'POST', body: JSON.stringify(body) });
      toast(`Report mit ${result.articleCount} Artikeln erstellt`, 'success');
      $('#report-generator').style.display = 'none';
      loadReports();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      $('#run-report').disabled = false;
    }
  });
}

async function loadKeywords() {
  try {
    state.keywords = await api('/api/keywords');
    const panels = ['required', 'productions', 'people', 'venues', 'theater_context', 'exclude'];
    const labels = {
      required: ['Pflicht-Begriffe (mindestens einer muss vorkommen)', 'Mindestens einer dieser Begriffe muss im Titel oder Text auftauchen'],
      productions: ['Produktionen / Stück-Titel', 'Aktueller Spielplan, gibt extra Score'],
      people: ['Personen (Ensemble, Regie, Leitung)', 'Ensemble + Regie + Dramaturgie + Intendanz'],
      venues: ['Spielstätten', 'Schauspielhaus, Werkraum, Therese-Giehse-Halle, Habibi Kiosk'],
      theater_context: ['Theater-Kontext', 'Worte die auf Theater-Berichterstattung hinweisen'],
      exclude: ['Ausschluss', 'Ist eines dieser Worte enthalten, wird der Artikel verworfen']
    };
    $('#keywords-panels').innerHTML = `
      <div class="card">
        ${panels.map(key => {
          const items = state.keywords[key] || [];
          return `
            <div class="keyword-section">
              <h3>${labels[key][0]} <small>${items.length} · ${labels[key][1]}</small></h3>
              <div class="keyword-chips" data-section="${key}">
                ${items.map(k => `<span class="chip">${escapeHtml(k)}<span class="x" data-section="${key}" data-kw="${escapeHtml(k)}">×</span></span>`).join('')}
                <input class="chip-input" data-section="${key}" placeholder="+ hinzufügen, Enter">
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
    $$('.chip .x').forEach(x => x.addEventListener('click', () => {
      const sec = x.dataset.section;
      const kw = x.dataset.kw;
      state.keywords[sec] = state.keywords[sec].filter(k => k !== kw);
      loadKeywords();
    }));
    $$('.chip-input').forEach(inp => {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && inp.value.trim()) {
          const sec = inp.dataset.section;
          const kw = inp.value.trim();
          if (!state.keywords[sec].includes(kw)) {
            state.keywords[sec].push(kw);
            loadKeywords();
          }
        }
      });
    });
  } catch (err) {
    toast(err.message, 'error');
  }
}

function initKeywordsTab() {
  $('#save-keywords').addEventListener('click', async () => {
    try {
      await api('/api/keywords', { method: 'PUT', body: JSON.stringify(state.keywords) });
      toast('Suchbegriffe gespeichert', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadSources() {
  try {
    state.sources = await api('/api/sources');
    state.sourcesFilter = state.sourcesFilter || null;
    renderHealthStats();
    renderSourcesList();
  } catch (err) {
    toast(err.message, 'error');
  }
}

const HEALTH_LABELS = {
  ok: { label: 'OK', icon: '✓', cls: 'badge-sent-positiv' },
  degraded: { label: 'degraded', icon: '◐', cls: 'badge-warn' },
  blocked: { label: 'geblockt', icon: '⊘', cls: 'badge-blocked' },
  dead: { label: 'tot', icon: '✕', cls: 'badge-sent-negativ' },
  unknown: { label: 'neu', icon: 'ø', cls: 'badge-outline' }
};

function renderHealthStats() {
  const stats = (state.sources && state.sources.stats) || { ok: 0, degraded: 0, blocked: 0, dead: 0, unknown: 0, total: 0 };
  const el = $('#health-stats');
  if (!el) return;
  const order = ['ok', 'degraded', 'blocked', 'dead', 'unknown'];
  const pills = order.map(k => {
    const conf = HEALTH_LABELS[k];
    const isActive = state.sourcesFilter === k;
    const count = stats[k] || 0;
    return `<button type="button" class="health-pill ${conf.cls}${isActive ? ' active' : ''}" data-filter="${k}" title="Klick zum Filtern">
      <span class="health-icon">${conf.icon}</span>
      <strong>${count}</strong>
      <span class="health-label">${conf.label}</span>
    </button>`;
  }).join('');
  el.innerHTML = pills + `<button type="button" class="health-pill total${!state.sourcesFilter ? ' active' : ''}" data-filter="">
    <strong>${stats.total || 0}</strong> <span class="health-label">gesamt</span>
  </button>`;
  el.querySelectorAll('.health-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.filter;
      state.sourcesFilter = f || null;
      renderHealthStats();
      renderSourcesList();
    });
  });
}

function renderSourcesList() {
  const allFeeds = (state.sources && state.sources.feeds) || [];
  const filter = state.sourcesFilter;
  const feeds = filter ? allFeeds.filter(f => f.healthStatus === filter) : allFeeds;
  const list = $('#sources-list');
  if (allFeeds.length === 0) {
    list.innerHTML = '<p class="muted">Keine Quellen konfiguriert.</p>';
    return;
  }
  if (feeds.length === 0) {
    list.innerHTML = `<p class="muted">Keine Quellen mit Status "${filter}".</p>`;
    return;
  }
  list.innerHTML = feeds.map((f) => {
    const idx = allFeeds.indexOf(f);
    const h = f.health || {};
    const enabled = h.enabled !== 0;
    const status = f.healthStatus || 'unknown';
    const conf = HEALTH_LABELS[status];
    const statusBadge = `<span class="badge ${conf.cls}" title="${conf.label}">${conf.icon} ${conf.label}${h.consecutive_failures ? ' ' + h.consecutive_failures + 'x' : ''}</span>`;
    const meta = [
      h.last_item_count != null ? `${h.last_item_count} Eintr.` : null,
      h.last_response_ms ? `${h.last_response_ms}ms` : null,
      h.feed_type ? h.feed_type : null,
      h.last_via_browser ? '[Browser]' : null,
      h.last_status_code ? `HTTP ${h.last_status_code}` : null,
      h.last_error ? `Fehler: ${h.last_error.slice(0, 80)}` : null
    ].filter(Boolean).join(' · ');

    return `
      <div class="source-row-edit" data-idx="${idx}" data-name="${escapeHtml(f.name || '')}">
        <div class="source-row-top">
          <input type="checkbox" class="src-enabled" ${enabled ? 'checked' : ''} title="Aktiv">
          <input type="text" value="${escapeHtml(f.name || '')}" data-field="name" placeholder="Name">
          <input type="number" value="${f.priority || 50}" data-field="priority" min="1" max="100" title="Prioritaet">
          ${statusBadge}
          <button class="btn btn-secondary src-test" title="Testen">Testen</button>
          <button class="btn btn-danger src-remove" title="Entfernen">✕</button>
        </div>
        <div class="source-row-mid">
          <input type="url" value="${escapeHtml(f.url || '')}" data-field="url" placeholder="https://...rss" style="flex:1">
        </div>
        ${meta ? `<div class="source-row-meta">${escapeHtml(meta)}</div>` : ''}
        <div class="source-test-result" style="display:none"></div>
      </div>
    `;
  }).join('');

  $$('.source-row-edit').forEach(row => {
    const idx = parseInt(row.dataset.idx, 10);
    const feed = state.sources.feeds[idx];

    $$('input[data-field]', row).forEach(inp => {
      inp.addEventListener('input', () => {
        const field = inp.dataset.field;
        let val = inp.value;
        if (field === 'priority') val = parseInt(val, 10) || 50;
        feed[field] = val;
      });
    });

    $('.src-enabled', row).addEventListener('change', async (ev) => {
      try {
        await api('/api/sources/toggle', {
          method: 'POST',
          body: JSON.stringify({ name: feed.name, enabled: ev.target.checked })
        });
        toast(`${feed.name}: ${ev.target.checked ? 'aktiv' : 'deaktiviert'}`, 'success');
      } catch (err) {
        toast(err.message, 'error');
      }
    });

    $('.src-test', row).addEventListener('click', async () => {
      const btn = $('.src-test', row);
      const resBox = $('.source-test-result', row);
      btn.disabled = true; btn.textContent = '…';
      resBox.style.display = 'block';
      resBox.innerHTML = '<span class="muted">Teste …</span>';
      try {
        const r = await api('/api/sources/test', {
          method: 'POST',
          body: JSON.stringify({ url: feed.url, name: feed.name })
        });
        if (r.ok) {
          const latest = r.latestItemDate ? fmtDate(r.latestItemDate, true) : null;
          const httpBadge = r.statusCode ? `<span class="badge badge-outline">HTTP ${r.statusCode}</span>` : '';
          const browserBadge = r.viaBrowser ? '<span class="badge badge-blocked">via Browser</span>' : '';
          const parts = [
            `<strong>${r.itemCount}</strong> Eintraege`,
            `${r.responseTimeMs}ms`,
            r.title ? escapeHtml(r.title) : null,
            latest ? `letzter Eintrag: ${escapeHtml(latest)}` : null
          ].filter(Boolean).join(' · ');
          resBox.innerHTML = `
            <span class="badge badge-sent-positiv">${escapeHtml((r.type || 'feed').toUpperCase())}</span>
            ${httpBadge}
            ${browserBadge}
            ${parts}
            ${r.sample && r.sample.length ? `<ul style="margin:8px 0 0 16px;font-size:12px;">${r.sample.map(s => `<li>${escapeHtml(s.title || '(ohne Titel)')}</li>`).join('')}</ul>` : ''}
          `;
        } else {
          const httpBadge = r.statusCode ? `<span class="badge badge-outline">HTTP ${r.statusCode}</span>` : '';
          const clsBadge = r.errorClass ? `<span class="badge badge-warn">${escapeHtml(r.errorClass)}</span>` : '';
          resBox.innerHTML = `<span class="badge badge-sent-negativ">Fehler</span> ${httpBadge} ${clsBadge} ${escapeHtml(r.error || 'unbekannt')}${r.puppeteerError ? ` · Browser: ${escapeHtml(r.puppeteerError)}` : ''}`;
        }
      } catch (err) {
        resBox.innerHTML = `<span class="badge badge-sent-negativ">Fehler</span> ${escapeHtml(err.message)}`;
      } finally {
        btn.disabled = false; btn.textContent = 'Testen';
      }
    });

    $('.src-remove', row).addEventListener('click', () => {
      if (!confirm(`Quelle "${feed.name}" entfernen?`)) return;
      state.sources.feeds.splice(idx, 1);
      renderSourcesList();
    });
  });
}

function initSourcesTab() {
  $('#add-source').addEventListener('click', () => {
    const name = $('#new-source-name').value.trim();
    const url = $('#new-source-url').value.trim();
    const priority = parseInt($('#new-source-priority').value, 10) || 50;
    if (!url) return toast('URL erforderlich', 'error');
    state.sources.feeds.push({ name: name || new URL(url).hostname, url, priority, type: 'rss' });
    $('#new-source-name').value = '';
    $('#new-source-url').value = '';
    $('#new-source-priority').value = '50';
    renderSourcesList();
  });
  $('#save-sources').addEventListener('click', async () => {
    try {
      await api('/api/sources', { method: 'PUT', body: JSON.stringify(state.sources) });
      toast('Quellen gespeichert', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const bulkDisable = document.getElementById('bulk-disable-dead');
  if (bulkDisable) {
    bulkDisable.addEventListener('click', async () => {
      if (!confirm('Alle Feeds mit Status "tot" wirklich deaktivieren?')) return;
      try {
        const r = await api('/api/sources/bulk-disable-dead', { method: 'POST' });
        toast(`${r.disabled} Feeds deaktiviert`, 'success');
        await loadSources();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  const bulkBrowser = document.getElementById('bulk-mark-blocked-browser');
  if (bulkBrowser) {
    bulkBrowser.addEventListener('click', async () => {
      if (!confirm('Alle "geblockt"-Feeds auf Browser-Modus (Puppeteer) umstellen?')) return;
      try {
        const r = await api('/api/sources/bulk-mark-blocked-browser', { method: 'POST' });
        toast(`${r.updated} Feeds auf Browser-Modus umgestellt`, 'success');
        await loadSources();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  const opmlPreviewBtn = document.getElementById('opml-preview-btn');
  const opmlImportBtn = document.getElementById('opml-import-btn');
  const opmlInput = document.getElementById('opml-input');
  const opmlPreview = document.getElementById('opml-preview');

  if (opmlPreviewBtn) {
    opmlPreviewBtn.addEventListener('click', async () => {
      const opml = opmlInput.value.trim();
      if (!opml) return toast('OPML-Inhalt einfügen', 'error');
      opmlPreviewBtn.disabled = true;
      opmlPreview.innerHTML = '<p class="muted">Prüfe Feeds …</p>';
      try {
        const r = await api('/api/sources/opml-preview', { method: 'POST', body: JSON.stringify({ opml }) });
        const rows = (r.previews || []).map(p => {
          const cls = p.level === 'ok' ? 'opml-row-ok' : p.level === 'warn' ? 'opml-row-warn' : 'opml-row-error';
          const status = p.status ? `HTTP ${p.status}` : (p.errorClass || 'Fehler');
          const dup = p.duplicate ? ' <span class="badge outline">bereits vorhanden</span>' : '';
          return `<div class="opml-row ${cls}">
            <span class="opml-status">${escapeHtml(status)}</span>
            <strong>${escapeHtml(p.name)}</strong>${dup}
            <code class="opml-url">${escapeHtml(p.url)}</code>
            ${p.responseTimeMs ? `<small>${p.responseTimeMs}ms</small>` : ''}
            ${p.error ? `<small class="muted">${escapeHtml(p.error.slice(0, 80))}</small>` : ''}
          </div>`;
        }).join('');
        const okCount = (r.previews || []).filter(p => p.level === 'ok').length;
        const warnCount = (r.previews || []).filter(p => p.level === 'warn').length;
        const errCount = (r.previews || []).filter(p => p.level === 'error').length;
        opmlPreview.innerHTML = `<div class="opml-summary">${r.count} Feeds: <span class="opml-ok">${okCount} erreichbar</span>, <span class="opml-warn">${warnCount} 403</span>, <span class="opml-err">${errCount} unerreichbar</span></div>${rows}`;
        opmlImportBtn.disabled = false;
      } catch (err) {
        opmlPreview.innerHTML = `<p class="error">${escapeHtml(err.message)}</p>`;
      } finally {
        opmlPreviewBtn.disabled = false;
      }
    });
  }

  if (opmlImportBtn) {
    opmlImportBtn.addEventListener('click', async () => {
      const opml = opmlInput.value.trim();
      if (!opml) return toast('OPML-Inhalt einfügen', 'error');
      try {
        const r = await api('/api/sources/opml-import', { method: 'POST', body: JSON.stringify({ opml }) });
        toast(`${r.added} neue Feeds importiert (gesamt ${r.total})`, 'success');
        opmlInput.value = '';
        opmlPreview.innerHTML = '';
        opmlImportBtn.disabled = true;
        await loadSources();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  }
}

async function loadSettingsTab() {
  try {
    state.settings = await api('/api/settings');
    const s = state.settings;
    $('#settings-panel').innerHTML = `
      <div class="card">
        <h2>Scraping</h2>
        <div class="form-row"><label>User-Agent</label><input type="text" id="set-ua" value="${escapeHtml(s.scraping.user_agent || '')}" style="flex:1"></div>
        <div class="form-row"><label>Timeout (ms)</label><input type="number" id="set-to" value="${s.scraping.request_timeout_ms}"></div>
        <div class="form-row"><label>Parallele Requests</label><input type="number" id="set-cc" value="${s.scraping.max_concurrent_requests}" min="1" max="20"></div>
        <div class="form-row"><label>Rate-Limit pro Domain (ms)</label><input type="number" id="set-rl" value="${s.scraping.rate_limit_per_domain_ms}"></div>
        <div class="form-row"><label>Retries</label><input type="number" id="set-rt" value="${s.scraping.max_retries}" min="0" max="10"></div>
      </div>
      <div class="card">
        <h2>Duplikat-Erkennung</h2>
        <div class="form-row"><label>Titel-Schwellwert</label><input type="number" id="set-ds-t" value="${s.deduplication.title_similarity_threshold}" step="0.01" min="0" max="1"></div>
        <div class="form-row"><label>Text-Schwellwert</label><input type="number" id="set-ds-x" value="${s.deduplication.text_similarity_threshold}" step="0.01" min="0" max="1"></div>
      </div>
      <div class="card">
        <h2>Schedule (Cron-Modus)</h2>
        <div class="form-row"><label>Daily Scan</label><input type="text" id="set-sc-d" value="${escapeHtml(s.schedule.daily_scan_cron)}"></div>
        <div class="form-row"><label>Wochenbericht</label><input type="text" id="set-sc-w" value="${escapeHtml(s.schedule.weekly_report_cron)}"></div>
        <div class="form-row"><label>Monatsbericht</label><input type="text" id="set-sc-m" value="${escapeHtml(s.schedule.monthly_report_cron)}"></div>
        <div class="form-row"><label>Zeitzone</label><input type="text" id="set-sc-tz" value="${escapeHtml(s.schedule.timezone)}"></div>
      </div>
      <div class="card">
        <h2>Reports</h2>
        <div class="form-row"><label>Pfad</label><input type="text" id="set-rp" value="${escapeHtml(s.reports.path)}"></div>
        <div class="form-row"><label>Max. Zusammenfassungs-Länge</label><input type="number" id="set-rmax" value="${s.reports.max_summary_length}"></div>
      </div>
    `;
  } catch (err) {
    toast(err.message, 'error');
  }
}

function initSettingsTab() {
  $('#save-settings').addEventListener('click', async () => {
    if (!state.settings) return;
    const s = state.settings;
    s.scraping.user_agent = $('#set-ua').value;
    s.scraping.request_timeout_ms = parseInt($('#set-to').value, 10);
    s.scraping.max_concurrent_requests = parseInt($('#set-cc').value, 10);
    s.scraping.rate_limit_per_domain_ms = parseInt($('#set-rl').value, 10);
    s.scraping.max_retries = parseInt($('#set-rt').value, 10);
    s.deduplication.title_similarity_threshold = parseFloat($('#set-ds-t').value);
    s.deduplication.text_similarity_threshold = parseFloat($('#set-ds-x').value);
    s.schedule.daily_scan_cron = $('#set-sc-d').value;
    s.schedule.weekly_report_cron = $('#set-sc-w').value;
    s.schedule.monthly_report_cron = $('#set-sc-m').value;
    s.schedule.timezone = $('#set-sc-tz').value;
    s.reports.path = $('#set-rp').value;
    s.reports.max_summary_length = parseInt($('#set-rmax').value, 10);
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(s) });
      toast('Gespeichert (Neustart kann nötig sein)', 'success');
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

async function loadLogs() {
  try {
    const data = await api('/api/logs?limit=200');
    $('#logs-list').innerHTML = data.logs.length === 0
      ? '<p class="muted">Noch keine Logs.</p>'
      : data.logs.map(l => `
        <div class="log-line ${l.level || 'info'}">
          <span class="ts">${l.timestamp ? new Date(l.timestamp).toLocaleString() : ''}</span>
          ${escapeHtml(l.message || '')}
        </div>
      `).join('');
    $('#logs-list').scrollTop = $('#logs-list').scrollHeight;
  } catch (err) {
    toast(err.message, 'error');
  }
}

function initLogsTab() {
  $('#refresh-logs').addEventListener('click', loadLogs);
}

function initDuplicatesTab() {
  $('#check-dupes').addEventListener('click', async () => {
    const box = $('#dupes-result');
    box.innerHTML = '<p class="muted">Prüfe …</p>';
    try {
      const data = await api('/api/duplicates/check');
      if (data.duplicates.length === 0) {
        box.innerHTML = `<p class="muted">Keine Duplikate gefunden bei ${data.checked} Artikeln.</p>`;
        return;
      }
      box.innerHTML = `
        <p class="muted" style="margin-bottom:12px;">${data.duplicates.length} Duplikate bei ${data.checked} Artikeln</p>
        ${data.duplicates.map(d => `
          <div class="dupe-card">
            <div class="dupe-title">${escapeHtml(d.title)}</div>
            <div class="dupe-orig">Original: <strong>${escapeHtml(d.duplicateOf.title)}</strong> (${escapeHtml(d.duplicateOf.source || '')})</div>
            <div class="dupe-reason">Grund: ${escapeHtml(d.reason)}</div>
          </div>
        `).join('')}
      `;
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function initTrendsTab() {
  $('#trends-period').addEventListener('change', loadTrends);
}

function initTagsTab() {
  const btn = document.getElementById('tag-retag-all');
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!confirm('Alle Artikel neu taggen? Das kann etwas dauern.')) return;
      btn.disabled = true; btn.textContent = 'Tagge ...';
      try {
        const res = await api('/api/tags/retag-all', { method: 'POST', body: JSON.stringify({}) });
        toast(`${res.tags_added} Tags fuer ${res.articles} Artikel`, 'success');
        loadTagsTab();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = 'Alle Artikel neu taggen';
      }
    });
  }
}

function init() {
  initTheme();
  initTabs();
  initWebSocket();
  initArticleFilters();
  initQuickFilters();
  initScanTab();
  initReportsTab();
  initKeywordsTab();
  initSourcesTab();
  initSettingsTab();
  initLogsTab();
  initDuplicatesTab();
  initTrendsTab();
  initTagsTab();
  initGlobalKeys();
  loadDashboard();
}

document.addEventListener('DOMContentLoaded', init);
