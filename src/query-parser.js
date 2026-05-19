'use strict';

const FIELD_NAMES = new Set(['title', 'source', 'author', 'text', 'category', 'sentiment', 'type']);

function tokenize(input) {
  const tokens = [];
  let i = 0;
  const s = input.trim();
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j++;
      tokens.push({ type: 'phrase', value: s.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (c === '-' && s[i + 1] && s[i + 1] !== ' ') {
      let j = i + 1;
      if (s[j] === '"') {
        let k = j + 1;
        while (k < s.length && s[k] !== '"') k++;
        tokens.push({ type: 'not', value: s.slice(j + 1, k) });
        i = k + 1;
      } else {
        while (j < s.length && s[j] !== ' ') j++;
        tokens.push({ type: 'not', value: s.slice(i + 1, j) });
        i = j;
      }
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== ' ' && s[j] !== '"') j++;
    const word = s.slice(i, j);
    const upper = word.toUpperCase();
    if (upper === 'AND' || upper === 'OR' || upper === 'NOT') {
      tokens.push({ type: 'op', value: upper });
    } else if (word.includes(':') && FIELD_NAMES.has(word.split(':')[0].toLowerCase())) {
      const [field, ...rest] = word.split(':');
      const value = rest.join(':');
      if (value.startsWith('"')) {
        let k = j;
        while (k < s.length && s[k] !== '"') k++;
        tokens.push({ type: 'field', field: field.toLowerCase(), value: value.slice(1) + ' ' + s.slice(j + 1, k) });
        i = k + 1;
        continue;
      }
      tokens.push({ type: 'field', field: field.toLowerCase(), value });
    } else {
      tokens.push({ type: 'term', value: word });
    }
    i = j;
  }
  return tokens;
}

function parseQuery(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  const must = [];
  const should = [];
  const mustNot = [];
  const fields = {};
  let nextIsOr = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'op') {
      if (t.value === 'OR') nextIsOr = true;
      else if (t.value === 'NOT') {
        i++;
        if (i < tokens.length) mustNot.push(tokens[i]);
      }
      continue;
    }
    if (t.type === 'not') { mustNot.push(t); continue; }
    if (t.type === 'field') {
      if (!fields[t.field]) fields[t.field] = [];
      fields[t.field].push(t.value);
      continue;
    }
    if (nextIsOr) { should.push(t); nextIsOr = false; }
    else must.push(t);
  }

  return {
    raw: trimmed,
    must,
    should,
    mustNot,
    fields,
    isStructured: must.length + should.length + mustNot.length + Object.keys(fields).length !== 0 &&
                  (mustNot.length > 0 || should.length > 0 || Object.keys(fields).length > 0 ||
                   tokens.some(t => t.type === 'phrase'))
  };
}

function termToSearchString(term) {
  if (term.type === 'phrase') return `"${term.value}"`;
  return term.value;
}

function queryToBM25String(parsed) {
  if (!parsed) return '';
  const parts = [];
  for (const m of parsed.must) parts.push(termToSearchString(m));
  for (const s of parsed.should) parts.push(termToSearchString(s));
  for (const [field, values] of Object.entries(parsed.fields)) {
    if (field === 'title' || field === 'text') {
      for (const v of values) parts.push(v);
    }
  }
  return parts.join(' ').trim();
}

function articleMatchesStructured(article, parsed) {
  if (!parsed) return true;
  const text = ((article.title || '') + ' ' + (article.full_text || article.fullText || '') + ' ' + (article.summary || '')).toLowerCase();

  for (const not of parsed.mustNot) {
    const v = not.value.toLowerCase();
    if (text.includes(v)) return false;
  }

  for (const must of parsed.must) {
    if (must.type === 'phrase') {
      const v = must.value.toLowerCase();
      if (!text.includes(v)) return false;
    } else {
      const v = must.value.toLowerCase();
      if (!text.includes(v)) {
        if (parsed.should.length === 0) return false;
      }
    }
  }

  if (parsed.should.length > 0) {
    const anyMatch = parsed.should.some(s => text.includes(s.value.toLowerCase()));
    if (!anyMatch && parsed.must.length === 0) return false;
  }

  for (const [field, values] of Object.entries(parsed.fields)) {
    let fieldValue;
    switch (field) {
      case 'title': fieldValue = (article.title || '').toLowerCase(); break;
      case 'source': fieldValue = (article.source || '').toLowerCase(); break;
      case 'author': fieldValue = (article.author || '').toLowerCase(); break;
      case 'text': fieldValue = (article.full_text || article.fullText || '').toLowerCase(); break;
      case 'category': fieldValue = (article.category || '').toLowerCase(); break;
      case 'sentiment': fieldValue = (article.sentiment || '').toLowerCase(); break;
      case 'type': fieldValue = (article.article_type || article.articleType || '').toLowerCase(); break;
      default: continue;
    }
    const anyMatch = values.some(v => fieldValue.includes(v.toLowerCase()));
    if (!anyMatch) return false;
  }

  return true;
}

module.exports = {
  parseQuery,
  tokenize,
  queryToBM25String,
  articleMatchesStructured,
  FIELD_NAMES
};
