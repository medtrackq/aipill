/*
 * ตรวจสอบยา · AI Pill — main application
 * Vanilla JS, no build step. Screens are rendered into <main id="app">
 * with a small hash router so the browser back button always works.
 */
(function () {
  'use strict';

  const { DRUGS, INTERACTIONS, ALLERGY_GROUPS } = window.DRUG_DB;
  const SCRIPT_URL = (document.currentScript && document.currentScript.src) || location.href;
  const I18N = window.I18N;

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------
  const CONFIG = {
    // Claude model and effort. Opus 5.5 reads labels most accurately; "low"
    // effort keeps answers fast (raise to "medium" for harder photos).
    defaultModel: 'claude-opus-5-5',
    effort: 'low',
    // vendored official SDK, resolved relative to this script
    sdkUrl: new URL('../vendor/anthropic-sdk-1.3.0.min.mjs', SCRIPT_URL).href,
    fdaUrl: 'https://www.fda.moph.go.th/',
    emergencyTel: '1669',
    poisonTel: '1367',
    // Link to a real telepharmacy / LINE Official Account chat, if you have one.
    pharmacistChatUrl: '',
    maxImageSide: 1600,
    lowConfidence: 60,
    aiTimeoutMs: 60000
  };
  // Text sizes as a multiple of the browser's own default font size, so a user
  // who already enlarged text in their browser keeps that enlargement
  // (at the common 16px default: 18 / 21 / 24 / 28px).
  const FONT_SCALES = [112.5, 131.25, 150, 175];

  // ------------------------------------------------------------------
  // Storage (wrapped: private mode / blocked storage must not break the app)
  // ------------------------------------------------------------------
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem('aipill.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set(k, v) { try { localStorage.setItem('aipill.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { localStorage.removeItem('aipill.' + k); } catch (e) { /* ignore */ } }
  };

  function arrayOf(v, ok) { return Array.isArray(v) ? v.filter(ok) : []; }

  function detectLang() {
    const n = (navigator.language || 'th').toLowerCase();
    if (n.startsWith('zh')) return 'zh';
    if (n.startsWith('en')) return 'en';
    return 'th';
  }
  function prefersHighContrast() {
    try { return window.matchMedia('(prefers-contrast: more)').matches; } catch (e) { return false; }
  }

  const state = {
    lang: store.get('lang', detectLang()),
    fontIdx: Math.min(FONT_SCALES.length - 1, Math.max(0, Math.round(Number(store.get('fontIdx', 0))) || 0)),
    contrast: store.get('contrast', prefersHighContrast() ? 'high' : 'normal'),
    apiKey: store.get('anthropicKey', ''),
    model: store.get('claudeModel', CONFIG.defaultModel),
    recent: arrayOf(store.get('recent', []), (x) => typeof x === 'string'),
    ixList: arrayOf(store.get('ixList', []), (x) => x && typeof x.name === 'string'),
    allergies: arrayOf(store.get('allergies', []), (x) => x && typeof x.name === 'string'),
    allergyNone: store.get('allergyNone', false) === true,
    ixResult: null,
    ixAi: null,
    analysis: null,       // last AI analysis {ai, demo, photo, mode, dbId}
    fallback: null,       // {reason, mode}
    comparePhoto: {},     // drugId -> user photo (session only)
    pendingPhoto: null
  };
  if (!I18N[state.lang]) state.lang = 'th';
  // keys saved by the earlier Gemini version cannot be used with Claude
  store.del('apiKey');
  store.del('model');

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');

  function t(key, vars) {
    const dict = I18N[state.lang] || I18N.th;
    let s = dict[key];
    if (s === undefined) s = I18N.th[key];
    if (s === undefined) return key;
    if (typeof s === 'string' && vars) {
      s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
    }
    return s;
  }
  // pick the current language from a {th, en, zh} object
  function tr(obj) {
    if (!obj) return '';
    if (typeof obj === 'string') return obj;
    return obj[state.lang] || obj.en || obj.th || '';
  }
  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isLatin = (s) => /^[\x20-\x7E]+$/.test(s);
  const pad2 = (n) => String(n).padStart(2, '0');
  const drugById = (id) => DRUGS.find((d) => d.id === id) || null;

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4000);
  }
  function announce(msg) {
    const el = $('#live');
    el.textContent = '';
    setTimeout(() => { el.textContent = msg; }, 50);
  }
  let overlayTimer = null;
  function showOverlay(title, sub) {
    $('#overlay-title').textContent = title;
    $('#overlay-sub').textContent = sub || '';
    $('#overlay-elapsed').textContent = '';
    $('#overlay').hidden = false;
    const started = Date.now();
    clearInterval(overlayTimer);
    // elapsed time is visual only (aria-hidden) so screen readers are not
    // interrupted every second by the live region
    overlayTimer = setInterval(() => {
      $('#overlay-elapsed').textContent = t('elapsed', { n: Math.round((Date.now() - started) / 1000) });
    }, 1000);
  }
  function hideOverlay() {
    clearInterval(overlayTimer);
    $('#overlay').hidden = true;
  }

  // ------------------------------------------------------------------
  // Icons (inline SVG, decorative)
  // ------------------------------------------------------------------
  const ICON_PATHS = {
    pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    barcode: '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M8 7v10"/><path d="M12 7v10"/><path d="M16 7v10"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    layers: '<path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    check: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    warn: '<path d="m21.7 18-8-14a2 2 0 0 0-3.5 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    danger: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9Z"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    sparkle: '<path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2Z"/>',
    arrowLeft: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
    clipboard: '<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    stop: '<rect width="14" height="14" x="5" y="5" rx="2"/>',
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    home: '<path d="m3 10.5 9-7 9 7"/><path d="M5 9.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V9.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
    lifebuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24"/><path d="m14.83 9.17 4.24-4.24"/><path d="m14.83 14.83 4.24 4.24"/><path d="m9.17 14.83-4.24 4.24"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    allergy: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/>'
  };
  function icon(name, size = 24) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ''}</svg>`;
  }

  // ------------------------------------------------------------------
  // Pill illustration (SVG) — the "reference" image on drug pages
  // ------------------------------------------------------------------
  const COLOR_HEX = {
    white: '#f7f7f2', yellow: '#f4cf3a', orange: '#f29a4a', pink: '#f3a3bf', red: '#d43d3d',
    purple: '#9466c9', blue: '#4f8fd6', green: '#5fb36a', brown: '#b08560', black: '#2b2b2b'
  };

  function pillSvg(look, label, fillOverride) {
    const c1 = fillOverride || COLOR_HEX[look.colors && look.colors[0]] || '#e3e6e8';
    const c2 = fillOverride || COLOR_HEX[look.colors && (look.colors[1] || look.colors[0])] || c1;
    const st = 'stroke="#4a4a4a" stroke-width="3"';
    const shine = '<ellipse cx="36" cy="38" rx="11" ry="5" fill="#fff" opacity=".45"/>';
    let body = '';
    switch (look.shape) {
      case 'round':
        body = `<circle cx="50" cy="50" r="38" fill="${c1}" ${st}/>` +
          (look.score ? '<line x1="50" y1="15" x2="50" y2="85" stroke="#4a4a4a" stroke-width="2.5" opacity=".5"/>' : '') + shine;
        break;
      case 'oval':
        body = `<ellipse cx="50" cy="50" rx="44" ry="28" fill="${c1}" ${st}/>` +
          (look.score ? '<line x1="50" y1="24" x2="50" y2="76" stroke="#4a4a4a" stroke-width="2.5" opacity=".5"/>' : '') + shine;
        break;
      case 'oblong':
        body = `<rect x="6" y="29" width="88" height="42" rx="21" fill="${c1}" ${st}/>` +
          (look.score ? '<line x1="50" y1="31" x2="50" y2="69" stroke="#4a4a4a" stroke-width="2.5" opacity=".5"/>' : '') +
          '<ellipse cx="30" cy="40" rx="12" ry="4" fill="#fff" opacity=".45"/>';
        break;
      case 'capsule':
        body = `<path d="M50 30H29a20 20 0 0 0 0 40h21Z" fill="${c1}"/><path d="M50 30h21a20 20 0 0 1 0 40H50Z" fill="${c2}"/>` +
          `<rect x="9" y="30" width="82" height="40" rx="20" fill="none" ${st}/>` +
          '<line x1="50" y1="30" x2="50" y2="70" stroke="#4a4a4a" stroke-width="2"/>' +
          '<ellipse cx="30" cy="40" rx="11" ry="4" fill="#fff" opacity=".45"/>';
        break;
      default: // other – octagon
        body = `<polygon points="35,12 65,12 88,35 88,65 65,88 35,88 12,65 12,35" fill="${c1}" ${st}/>` + shine;
    }
    const aria = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
    return `<svg viewBox="0 0 100 100" ${aria} focusable="false">${body}</svg>`;
  }
  function lookLabel(look) {
    const shapes = t('shapes'), colors = t('colors');
    return `${shapes[look.shape] || ''} ${(look.colors || []).map((c) => colors[c]).join(' / ')}`.trim();
  }

  // ------------------------------------------------------------------
  // Search with typo tolerance ("Did you mean…?")
  // ------------------------------------------------------------------
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFKC')
      .replace(/[็-๎]/g, '')                 // Thai tone marks – common spelling slips
      .replace(/[\s\-_.,/()（）'"’·]+/g, '');
  }
  function stripStrength(q) {
    // Latin units need a word boundary so "500 Glucophage" keeps its "G"
    return String(q || '').replace(/\d+(?:[.,]\d+)?\s*(?:(?:mg|g|tabs?)(?![a-z])|มก\.?|มิลลิกรัม|กรัม|เม็ด|毫克)?/gi, ' ');
  }
  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  const similarity = (a, b) => 1 - levenshtein(a, b) / Math.max(a.length, b.length, 1);

  // Same normalisation as norm(), but punctuation becomes spaces and letters are
  // split from digits, so whole words can be matched: "paracetamol500mg" →
  // " paracetamol 500 mg ". Padded with spaces for simple boundary checks.
  function normWords(s) {
    return ' ' + String(s || '').toLowerCase().normalize('NFKC')
      .replace(/[็-๎]/g, '')
      .replace(/(\p{L})(\p{N})/gu, '$1 $2').replace(/(\p{N})(\p{L})/gu, '$1 $2')
      .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim() + ' ';
  }
  const CJK_ONLY = /^[㐀-鿿豈-﫿]+$/;
  // true when `term` appears in `words` as a whole word (CJK has no spaces, so
  // plain containment is used for all-CJK names)
  function hasWord(words, term) {
    if (CJK_ONLY.test(term.n)) return term.n.length >= 2 && words.replace(/ /g, '').includes(term.n);
    return term.n.length >= 4 && words.includes(term.words);
  }

  // kind: 'name' = generic or brand name, 'alias' = another name for this exact
  // drug, 'category' = a broad word shared by many drugs (never identifies one)
  const INDEX = DRUGS.map((d) => {
    const entries = [];
    const add = (term, kind) => {
      [term, ...String(term).split(/[()（）]/)].forEach((p) => {
        const x = String(p).trim();
        if (x) entries.push({ term: x, kind });
      });
    };
    [d.generic.th, d.generic.en, d.generic.zh, ...(d.brands || [])].forEach((x) => add(x, 'name'));
    [d.id, ...(d.aliases || [])].forEach((x) => add(x, 'alias'));
    (d.categories || []).forEach((x) => add(x, 'category'));
    const seen = new Set();
    const terms = entries
      .map((e) => ({ term: e.term, kind: e.kind, n: norm(e.term), words: normWords(e.term) }))
      .filter((x) => x.n && !seen.has(x.n + x.kind) && seen.add(x.n + x.kind));
    return { drug: d, terms };
  });

  const SCORE = { EXACT: 100, PREFIX: 90, INFIX: 80, CATEGORY: 75, WORD: 72 };

  function searchDrugs(query) {
    const stripped = stripStrength(query);
    const nq = norm(stripped);
    if (!nq) return { matches: [], suggestions: [] };
    const words = normWords(stripped);
    const scored = INDEX.map(({ drug, terms }) => {
      let best = 0, bestTerm = '', fuzzy = 0, fuzzyTerm = '';
      for (const term of terms) {
        const n = term.n;
        let s = 0;
        if (term.kind === 'category') {
          // broad words only list the drug as a candidate
          if (n === nq) s = SCORE.CATEGORY;
          else if (nq.length >= 3 && n.startsWith(nq)) s = SCORE.WORD;
        } else if (n === nq) s = SCORE.EXACT;
        else if (n.startsWith(nq) && nq.length >= 2) s = SCORE.PREFIX;
        else if (nq.length >= 3 && n.includes(nq)) s = SCORE.INFIX;
        else if (hasWord(words, term)) s = SCORE.WORD;
        if (s > best) { best = s; bestTerm = term.term; }
        if (nq.length >= 3 && term.kind !== 'category') {
          let f = similarity(nq, n);
          if (nq.length >= 4 && n.length > nq.length) f = Math.max(f, similarity(nq, n.slice(0, nq.length)) - 0.05);
          if (f > fuzzy) { fuzzy = f; fuzzyTerm = term.term; }
        }
      }
      return { drug, score: best, term: bestTerm, fuzzy, fuzzyTerm };
    });
    const matches = scored.filter((x) => x.score >= SCORE.WORD).sort((a, b) => b.score - a.score);
    const suggestions = matches.length ? [] : scored
      .filter((x) => x.fuzzy >= 0.55)
      .sort((a, b) => b.fuzzy - a.fuzzy)
      .slice(0, 3);
    return { matches, suggestions };
  }

  // The one drug whose name or alias equals the query exactly, else null.
  // This is the only kind of match allowed to open a drug or link an AI
  // result to the database: partial and category matches are shown as choices.
  function exactDrug(matches) {
    const exact = matches.filter((m) => m.score === SCORE.EXACT);
    return exact.length === 1 ? exact[0].drug : null;
  }

  // ------------------------------------------------------------------
  // Interaction checker
  // ------------------------------------------------------------------
  function checkInteractions(list) {
    const results = [];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (!a.id || !b.id) continue;
        const da = drugById(a.id), db = drugById(b.id);
        if (!da || !db) continue;
        if (da.ingredient === db.ingredient) {
          results.push({ level: 'major', dup: true, a, b, ingredient: da });
          continue;
        }
        const hit = INTERACTIONS.find((x) => (x.pair[0] === a.id && x.pair[1] === b.id) || (x.pair[0] === b.id && x.pair[1] === a.id));
        if (hit) results.push({ level: hit.level, text: hit.text, a, b });
      }
    }
    const order = { major: 0, moderate: 1, minor: 2 };
    results.sort((x, y) => order[x.level] - order[y.level]);
    // ids that are no longer in the database are reported as unchecked too
    return { results, unknown: list.filter((x) => !x.id || !drugById(x.id)) };
  }

  // ------------------------------------------------------------------
  // Drug allergies
  // Each recorded allergy is resolved to a database drug and/or drug
  // classes (ALLERGY_GROUPS). A medicine conflicts when it is the same
  // active ingredient (exact), shares a class (group) or belongs to a class
  // with known cross-allergy (cross, shown in orange).
  // ------------------------------------------------------------------
  const termOf = (x) => ({ term: x, n: norm(x), words: normWords(x) });
  const GROUP_INDEX = ALLERGY_GROUPS.map((g) => ({
    group: g,
    terms: [...g.terms, g.name.th, g.name.en, g.name.zh].map(termOf).filter((x) => x.n)
  }));
  const groupById = (id) => ALLERGY_GROUPS.find((g) => g.id === id) || null;

  // what a typed name refers to: a database drug and/or drug classes
  function profileOfName(name) {
    const stripped = stripStrength(name);
    const n = norm(stripped);
    const words = normWords(stripped);
    const drug = n ? exactDrug(searchDrugs(name).matches) : null;
    const groups = new Set(drug ? drug.allergyGroups || [] : []);
    if (n) {
      for (const { group, terms } of GROUP_INDEX) {
        if (terms.some((x) => x.n === n || hasWord(words, x))) groups.add(group.id);
      }
    }
    return { drug, groups: [...groups], n };
  }
  function profileOfDrug(d) {
    return { drug: d, groups: d.allergyGroups || [], n: norm(d.generic.en) };
  }
  function profileOfAllergy(a) {
    const p = profileOfName(a.name);
    if (!p.drug && a.drugId && drugById(a.drugId)) {
      p.drug = drugById(a.drugId);
      (p.drug.allergyGroups || []).forEach((g) => { if (!p.groups.includes(g)) p.groups.push(g); });
    }
    if (a.groupId && groupById(a.groupId) && !p.groups.includes(a.groupId)) p.groups.push(a.groupId);
    return p;
  }
  // profile of a medicine the AI named (it may not be in the database)
  function profileOfAiNames(names) {
    const out = { drug: null, groups: [], n: '' };
    names.filter(Boolean).forEach((x) => {
      const p = profileOfName(x);
      if (!out.drug && p.drug) out.drug = p.drug;
      p.groups.forEach((g) => { if (!out.groups.includes(g)) out.groups.push(g); });
    });
    return out;
  }

  // compare one medicine with every recorded allergy, most serious first
  function allergyConflicts(target, names = []) {
    const keys = names.filter(Boolean).map((x) => norm(stripStrength(x))).filter(Boolean);
    const out = [];
    for (const a of state.allergies) {
      const p = profileOfAllergy(a);
      if (p.drug && target.drug && p.drug.ingredient === target.drug.ingredient) { out.push({ level: 'exact', allergy: a }); continue; }
      const shared = p.groups.find((g) => target.groups.includes(g));
      if (shared) { out.push({ level: 'group', allergy: a, group: groupById(shared) }); continue; }
      // an allergy that matches nothing in the database is compared by name
      if (!p.drug && !p.groups.length && p.n && keys.some((k) => k === p.n || (p.n.length >= 4 && k.includes(p.n)))) {
        out.push({ level: 'exact', allergy: a }); continue;
      }
      const cross = p.groups.flatMap((g) => (groupById(g) || {}).cross || []).find((g) => target.groups.includes(g));
      if (cross) out.push({ level: 'cross', allergy: a, group: groupById(cross) });
    }
    const rank = { exact: 0, group: 1, cross: 2 };
    return out.sort((x, y) => rank[x.level] - rank[y.level]);
  }
  const drugConflicts = (d) => allergyConflicts(profileOfDrug(d), [d.generic.en]);

  function conflictText(c) {
    const a = c.allergy.name;
    const g = c.group ? tr(c.group.name) : '';
    if (c.level === 'exact') return { title: t('conflictExact'), sub: t('conflictExactSub', { a }) };
    // when the allergy is the group itself, naming it twice adds nothing
    if (c.level === 'group') return { title: t('conflictGroup', { g }), sub: c.group && norm(a) === norm(g) ? '' : t('conflictGroupSub', { a }) };
    return { title: t('conflictCross', { a, g }), sub: '' };
  }
  // red (or orange for cross-allergy) banners shown above everything else
  function allergyBanners(conflicts, aiWarning) {
    const parts = conflicts.slice(0, 3).map((c) => {
      const x = conflictText(c);
      const kind = c.level === 'cross' ? 'warn' : 'danger';
      return `<div class="banner banner-${kind} banner-allergy" role="alert"><span class="ico">${icon('allergy')}</span><div>${esc(x.title)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</div></div>`;
    });
    if (!conflicts.length && aiWarning) {
      parts.push(`<div class="banner banner-danger banner-allergy" role="alert"><span class="ico">${icon('allergy')}</span><div>${esc(t('conflictAi', { w: aiWarning }))}</div></div>`);
    }
    if (!parts.length) return '';
    return parts.join('') + `<p style="margin:-.4rem 0 1rem"><a href="#/allergies">${esc(t('editAllergies'))}</a></p>`;
  }

  function saveAllergies() {
    store.set('allergies', state.allergies);
    store.set('allergyNone', state.allergyNone);
  }
  function addAllergy(item) {
    const name = String(item.name || '').trim().slice(0, 120);
    if (!name) return false;
    if (state.allergies.some((x) => norm(x.name) === norm(name))) { toast(t('ixAlready')); return false; }
    state.allergies.push({ name, drugId: item.drugId || null, groupId: item.groupId || null });
    state.allergyNone = false;
    saveAllergies();
    toast(t('allergyAdded'));
    return true;
  }

  // ------------------------------------------------------------------
  // Expiry dates (supports Buddhist Era years, e.g. 2570 = 2027)
  // ------------------------------------------------------------------
  function parseExpiry(s) {
    if (!s) return null;
    s = String(s).trim();
    let y, m, d = null, mt;
    if ((mt = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/))) { y = +mt[1]; m = +mt[2]; d = mt[3] ? +mt[3] : null; }
    else if ((mt = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
    else if ((mt = s.match(/^(\d{1,2})[/.\-](\d{2,4})$/))) { m = +mt[1]; y = +mt[2]; }
    else return null;
    const thisYear = new Date().getFullYear();
    if (y < 100) { y += 2000; if (y > thisYear + 20) y = y + 500 - 543; } // 2-digit BE such as "70" = 2570 = 2027
    if (y > 2400) y -= 543;
    if (m < 1 || m > 12) return null;
    return { date: d ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m, 0, 23, 59, 59), y, m, d };
  }
  function expiryStatus(exp) {
    const now = new Date();
    if (exp.date < now) return 'expired';
    if (exp.date - now < 30 * 864e5) return 'soon';
    return 'ok';
  }
  function formatExpiry(exp) {
    const months = t('months');
    const base = `${exp.d ? exp.d + ' ' : ''}${months[exp.m - 1]} ${exp.y}`;
    return state.lang === 'th' ? `${base} (${t('beSuffix')} ${exp.y + 543})` : base;
  }
  function expiryBanner(exp) {
    const st = expiryStatus(exp);
    const map = {
      expired: ['danger', 'danger', t('expired')],
      soon: ['warn', 'warn', t('expiringSoon')],
      ok: ['safe', 'check', t('notExpired')]
    }[st];
    return `<div class="banner banner-${map[0]}" role="${st === 'expired' ? 'alert' : 'status'}"><span class="ico">${icon(map[1])}</span><div>${esc(map[2])}<small>${esc(t('expiryLbl'))}: ${esc(formatExpiry(exp))}</small></div></div>`;
  }

  // ------------------------------------------------------------------
  // Images
  // ------------------------------------------------------------------
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image'));
      img.src = src;
    });
  }
  // Decode straight from the file via an object URL (no full-size base64 copy
  // of a 5–10 MB phone photo), then downscale before encoding.
  async function prepareImage(file) {
    const url = URL.createObjectURL(file);
    const canvas = document.createElement('canvas');
    try {
      const img = await loadImg(url);
      const scale = Math.min(1, CONFIG.maxImageSide / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    } finally {
      URL.revokeObjectURL(url);
    }
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { dataUrl, base64: dataUrl.split(',')[1], mime: 'image/jpeg', canvas };
  }

  // ------------------------------------------------------------------
  // Claude API (official Anthropic SDK, loaded only when AI is first used)
  // ------------------------------------------------------------------
  function aiLanguageName() { return t('aiLanguage'); }

  function catalogForPrompt() {
    return DRUGS.map((d) => `- ${d.id}: ${d.generic.en} ${d.strength} (brands: ${(d.brands || []).filter(isLatin).join(', ') || '-'})`).join('\n');
  }

  // Structured output: the API guarantees the reply matches this schema.
  const str = (description) => ({ type: 'string', description });
  const strList = (description) => ({ type: 'array', items: { type: 'string' }, description });
  const MEDICINE_FIELDS = {
    is_medicine: { type: 'boolean', description: 'false when no medicine is shown or named' },
    image_problem: { type: 'string', enum: ['none', 'blurry', 'too_dark', 'glare', 'too_far', 'not_medicine'], description: 'why the photo is unusable, or "none"' },
    db_id: { anyOf: [{ type: 'string', enum: DRUGS.map((d) => d.id) }, { type: 'null' }], description: 'matching database entry, or null' },
    generic_name: str('generic (active ingredient) name, "" if unknown'),
    brand_name: str('brand / trade name, "" if unknown'),
    strength: str('strength such as "500 mg", "" if unknown'),
    appearance: str('physical appearance'),
    label_text: str('all text read from the label, bag, foil or imprint'),
    indications: str('what it is used for'),
    usage: str('how to take it: label directions when visible, else the standard adult dose'),
    cautions: strList('things to be careful about (food, milk, alcohol, drowsiness, timing)'),
    dangers: strList('contraindications and serious risks'),
    side_effects: strList('common side effects'),
    pill_count: { anyOf: [{ type: 'integer' }, { type: 'null' }], description: 'pills or capsules clearly visible, null if not countable' },
    expiry_date: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'expiry as YYYY-MM-DD or YYYY-MM (Gregorian), null if not visible' },
    confidence: { type: 'integer', description: 'certainty of the identification, 0 to 100' },
    allergy_warning: str('warning if this medicine may trigger one of the user\'s recorded drug allergies, "" if none')
  };
  const MEDICINE_SCHEMA = {
    type: 'object',
    properties: MEDICINE_FIELDS,
    required: Object.keys(MEDICINE_FIELDS),
    additionalProperties: false
  };
  const INTERACTION_SCHEMA = {
    type: 'object',
    properties: {
      interactions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            drugs: { type: 'array', items: { type: 'string' } },
            level: { type: 'string', enum: ['major', 'moderate', 'minor'] },
            explanation: { type: 'string' }
          },
          required: ['drugs', 'level', 'explanation'],
          additionalProperties: false
        }
      },
      note: { type: 'string' }
    },
    required: ['interactions', 'note'],
    additionalProperties: false
  };

  function medicineSystemPrompt() {
    return `You are a careful clinical pharmacist assistant helping people in Thailand (many are elderly) check their medicines.
The input may be a photo of loose pills, a blister pack, a bottle, a box, or a hospital/clinic medicine bag (often a clear zip-lock bag with a printed label), or a medicine name the user typed.

For a photo:
1. Read ALL visible text (label, bag, blister foil, imprint), including text seen through clear plastic, into label_text.
2. Describe the physical appearance.
3. Count the pills or capsules that are clearly visible; null if counting is not possible.
4. Find the expiry date (EXP / วันหมดอายุ / ใช้ก่อน). Thai labels may use Buddhist Era years (2570 = 2027): convert to Gregorian. null if not visible.
5. If the photo is unusable, set image_problem. If there is no medicine, set is_medicine to false.

Identify the medicine. Never claim high confidence from colour or shape alone: different medicines can look identical. Lower confidence whenever the identity is uncertain.
Set db_id only when the medicine is exactly one of these database entries (same active ingredient), otherwise null:
${catalogForPrompt()}

The user's recorded drug allergies: ${state.allergies.length ? JSON.stringify(state.allergies.map((a) => String(a.name).slice(0, 80))) : 'none'}.
Set allergy_warning when the medicine is one of these, contains one of them, belongs to the same drug class, or belongs to a class with known cross-allergy; say which allergy and that the user must not take it before asking a doctor or pharmacist. Otherwise use "".

Write every human-readable value in ${aiLanguageName()}, in short simple sentences suitable for elderly readers. Use "" or [] when something is unknown.`;
  }
  function photoInstruction() {
    return 'This photo may show pills, a blister pack, a bottle, a box or a hospital medicine bag. Read every printed word, the dosing directions and the expiry date, and look closely at the shape, colour, score line and imprint of any pills.';
  }
  function nameInstruction(q) {
    return `I searched a medicine database for ${JSON.stringify(String(q).slice(0, 200))} and it was not found. If this is a real medicine (or an obvious misspelling of one) available in Thailand, describe it. If you are not sure which medicine it is, set is_medicine to false and leave the other fields empty. There is no photo: use image_problem "none", label_text "", pill_count null and expiry_date null.`;
  }
  function interactionSystemPrompt() {
    return `You check drug–drug interactions for a patient in Thailand. Report only clinically meaningful interactions you are confident about, including duplicated active ingredients. Do not invent interactions. Write explanations in ${aiLanguageName()}, short and simple, and advise asking a doctor or pharmacist rather than stopping medicines.`;
  }

  function parseJsonLoose(text) {
    try { return JSON.parse(text); } catch (e) {
      const cleaned = text.replace(/```json|```/g, '').trim();
      const s = cleaned.indexOf('{'), en = cleaned.lastIndexOf('}');
      if (s >= 0 && en > s) return JSON.parse(cleaned.slice(s, en + 1));
      throw invalidAiError();
    }
  }

  // One AI request at a time. It can be cancelled from the overlay, is
  // cancelled when the user navigates away, and times out after aiTimeoutMs.
  let aiJob = null;
  function beginAiJob() {
    cancelAiJob();
    const stale = $('#ai-error'); // an earlier failure no longer applies
    if (stale) stale.remove();
    const job = { controller: new AbortController(), timedOut: false };
    job.timer = setTimeout(() => { job.timedOut = true; job.controller.abort(); }, CONFIG.aiTimeoutMs);
    aiJob = job;
    return job;
  }
  function endAiJob(job) {
    clearTimeout(job.timer);
    if (aiJob === job) aiJob = null;
  }
  function cancelAiJob() {
    if (!aiJob) return;
    clearTimeout(aiJob.timer);
    aiJob.controller.abort();
    aiJob = null;
  }

  // The SDK is vendored (vendor/README.md) and imported on first use.
  let sdkLoad = null;
  async function loadSdk() {
    if (!sdkLoad) sdkLoad = import(CONFIG.sdkUrl);
    try {
      return (await sdkLoad).default;
    } catch (e) {
      sdkLoad = null; // allow a retry, e.g. after the connection comes back
      const err = new Error('could not load the AI library');
      err.network = true;
      throw err;
    }
  }

  // Map SDK errors (typed classes, most specific first) onto what the UI says.
  function classifySdkError(Anthropic, e) {
    if (e instanceof Anthropic.APIUserAbortError) { const x = new Error('aborted'); x.name = 'AbortError'; return x; }
    if (e instanceof Anthropic.APIConnectionTimeoutError) { const x = new Error('timeout'); x.name = 'AbortError'; x.timeout = true; return x; }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) { e.keyProblem = true; return e; }
    if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) { e.busy = true; return e; } // 429, 5xx, 529 overloaded
    if (e instanceof Anthropic.APIConnectionError) { e.network = true; return e; } // subclass of APIError: check first
    return e;
  }

  // Server-side refusal fallback is supported on these models
  const FALLBACK_MODELS = /^claude-(opus-5|fable-5|sonnet-5-5)/;

  // One Claude request returning JSON that matches `schema`.
  async function claudeJson({ system, content, schema }, signal) {
    const Anthropic = await loadSdk();
    const model = (state.model || CONFIG.defaultModel).trim();
    const client = new Anthropic({
      apiKey: state.apiKey,
      dangerouslyAllowBrowser: true, // the user's own key, entered on this device (README: use a backend in production)
      maxRetries: 1,
      timeout: CONFIG.aiTimeoutMs
    });
    const params = {
      model,
      max_tokens: 16000,
      system,
      output_config: { effort: CONFIG.effort, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content }]
    };
    if (FALLBACK_MODELS.test(model)) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    let response;
    try {
      response = await client.beta.messages.create(params, { signal });
    } catch (e) {
      throw classifySdkError(Anthropic, e);
    }
    if (response.stop_reason === 'refusal') { const e = new Error('refusal'); e.blocked = true; throw e; }
    if (response.stop_reason === 'max_tokens') throw invalidAiError();
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (!text) throw invalidAiError();
    return parseJsonLoose(text);
  }

  // confidence may arrive as 87, "87%", 0.87 or "0.87"
  function parseConfidence(v) {
    if (v === null || v === undefined || v === '') return null;
    const str = String(v);
    let n = parseFloat(str.replace(/[^\d.]/g, ''));
    if (!isFinite(n)) return null;
    if (!str.includes('%') && n > 0 && (n < 1 || (n === 1 && str.includes('.')))) n *= 100; // 0–1 scale
    return Math.round(Math.max(0, Math.min(100, n)));
  }

  function invalidAiError() {
    const e = new Error('invalid AI response');
    e.blocked = true;
    return e;
  }

  // make AI output safe and predictable
  function cleanAi(raw) {
    if (Array.isArray(raw)) raw = raw[0];
    if (!raw || typeof raw !== 'object') throw invalidAiError();
    const s = (v) => (v === null || v === undefined ? '' : String(v)).trim();
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(s).filter(Boolean).slice(0, 8);
    const conf = parseConfidence(raw.confidence === undefined ? raw.confidence_score : raw.confidence);
    let count = raw.pill_count;
    if (typeof count === 'string') { const n = parseInt(count.replace(/[^\d]/g, ''), 10); count = isNaN(n) ? null : n; }
    if (typeof count !== 'number' || !isFinite(count) || count < 0) count = null;
    const problem = s(raw.image_problem).toLowerCase();
    return {
      is_medicine: raw.is_medicine !== false,
      image_problem: ['blurry', 'too_dark', 'glare', 'too_far', 'not_medicine'].includes(problem) ? problem : 'none',
      db_id: drugById(s(raw.db_id)) ? s(raw.db_id) : null,
      generic_name: s(raw.generic_name).slice(0, 200),
      brand_name: s(raw.brand_name).slice(0, 200),
      strength: s(raw.strength).slice(0, 80),
      appearance: s(raw.appearance).slice(0, 400),
      label_text: s(raw.label_text).slice(0, 1500),
      indications: s(raw.indications).slice(0, 800),
      usage: s(raw.usage).slice(0, 800),
      cautions: arr(raw.cautions),
      dangers: arr(raw.dangers),
      side_effects: arr(raw.side_effects),
      pill_count: count,
      expiry_date: s(raw.expiry_date) || null,
      confidence: conf,
      allergy_warning: s(raw.allergy_warning).slice(0, 400)
    };
  }

  function aiErrorMessage(err) {
    if (err && err.blocked) return t('errBlocked');
    if (err && err.network) return t('errNetwork');
    if (err && err.keyProblem) return t('errKey');
    if (err && err.busy) return t('errBusy');
    return t('errGeneric', { msg: (err && err.message) || '?' });
  }

  function demoAnalysis(mode) {
    const exp = new Date();
    exp.setFullYear(exp.getFullYear() + 1);
    return cleanAi({
      is_medicine: true, image_problem: 'none', db_id: 'paracetamol',
      generic_name: 'Paracetamol', brand_name: 'Sara', strength: '500 mg',
      label_text: t('demoLabel'),
      pill_count: 10, expiry_date: `${exp.getFullYear()}-${pad2(exp.getMonth() + 1)}`,
      confidence: 95
    });
  }

  // decide what to show after an analysis
  function resolveAnalysis(ai) {
    let dbId = ai.db_id;
    if (dbId && ai.generic_name) {
      // the AI's db_id must agree with the name it read; otherwise (e.g. it
      // read "Esomeprazole" but picked omeprazole) show it as unverified AI data
      const agrees = searchDrugs(ai.generic_name).matches.some((m) => m.drug.id === dbId)
        || (ai.brand_name && searchDrugs(ai.brand_name).matches.some((m) => m.drug.id === dbId && m.score === SCORE.EXACT));
      if (!agrees) dbId = null;
    }
    if (!dbId) {
      for (const name of [ai.generic_name, ai.brand_name]) {
        if (!name) continue;
        const d = exactDrug(searchDrugs(name).matches);
        if (d) { dbId = d.id; break; }
      }
    }
    const hasName = !!(ai.generic_name || ai.brand_name || dbId);
    if (!ai.is_medicine) return { fail: 'not_medicine', dbId: null };
    if (!hasName) return { fail: ai.image_problem !== 'none' ? ai.image_problem : 'not_found', dbId: null };
    if (ai.confidence !== null && ai.confidence < CONFIG.lowConfidence) {
      return { fail: ai.image_problem !== 'none' ? ai.image_problem : 'low_confidence', dbId, guess: true };
    }
    return { fail: null, dbId };
  }

  // Shared error handling for AI jobs: the message stays on screen (a toast
  // vanished before elderly users could read it) with a retry button.
  function handleAiFailure(job, err, retry) {
    const timedOut = job.timedOut || (err && err.timeout);
    if (err && err.name === 'AbortError' && !timedOut) return; // cancelled by the user or by navigation
    if (!timedOut) console.error(err);
    showAiError(timedOut ? t('errTimeout') : aiErrorMessage(err), retry, { settings: !!(err && err.keyProblem) });
  }

  function showAiError(message, retry, { settings = false } = {}) {
    const old = $('#ai-error');
    if (old) old.remove();
    const box = document.createElement('div');
    box.id = 'ai-error';
    box.className = 'banner banner-danger';
    box.setAttribute('role', 'alert');
    box.tabIndex = -1;
    box.innerHTML = `<span class="ico">${icon('danger', 26)}</span><div style="flex:1">${esc(message)}
      <div class="btn-row" style="margin-top:.75rem">
        ${retry ? `<button type="button" class="btn btn-primary" data-ai-error="retry">${esc(t('retryAi'))}</button>` : ''}
        ${settings ? `<button type="button" class="btn btn-secondary" data-ai-error="settings">${esc(t('demoSetup'))}</button>` : ''}
        <button type="button" class="btn btn-ghost" data-ai-error="close">${esc(t('close'))}</button>
      </div></div>`;
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ai-error]');
      if (!b) return;
      box.remove();
      if (b.dataset.aiError === 'retry') retry();
      else if (b.dataset.aiError === 'settings') openSettings();
    });
    const head = $('.screen-head', app);
    if (head) head.after(box); else app.prepend(box);
    box.scrollIntoView({ block: 'center' });
    box.focus({ preventScroll: true });
  }

  async function analyzePhoto(img, mode) {
    const job = beginAiJob();
    showOverlay(t('analyzing'), t('analyzingSub'));
    try {
      let ai, demo = false;
      if (!state.apiKey) {
        await sleep(1200);
        if (job.controller.signal.aborted) return;
        ai = demoAnalysis(mode);
        demo = true;
      } else {
        ai = cleanAi(await claudeJson({
          system: medicineSystemPrompt(),
          content: [
            { type: 'image', source: { type: 'base64', media_type: img.mime, data: img.base64 } },
            { type: 'text', text: photoInstruction() }
          ],
          schema: MEDICINE_SCHEMA
        }, job.controller.signal));
      }
      const outcome = resolveAnalysis(ai);
      state.analysis = { ai, demo, photo: img.dataUrl, mode, dbId: outcome.dbId, guess: !!outcome.guess };
      endAiJob(job);
      hideOverlay();
      if (outcome.fail) {
        state.fallback = { reason: outcome.fail, mode, guess: !!outcome.guess };
        go('#/notfound');
      } else {
        go('#/result');
      }
    } catch (err) {
      handleAiFailure(job, err, () => analyzePhoto(img, mode));
    } finally {
      if (aiJob === job) hideOverlay();
      endAiJob(job);
    }
  }

  async function askAiByName(q) {
    if (!state.apiKey) { openSettings(); return; }
    const job = beginAiJob();
    showOverlay(t('searchingAi'), t('analyzingSub'));
    try {
      const ai = cleanAi(await claudeJson({
        system: medicineSystemPrompt(),
        content: [{ type: 'text', text: nameInstruction(q) }],
        schema: MEDICINE_SCHEMA
      }, job.controller.signal));
      const outcome = resolveAnalysis(ai);
      state.analysis = { ai, demo: false, photo: null, mode: 'name', dbId: outcome.dbId, guess: !!outcome.guess };
      endAiJob(job);
      hideOverlay();
      if (outcome.fail) {
        state.fallback = { reason: outcome.fail === 'low_confidence' ? 'low_confidence' : 'not_found', mode: 'name', guess: !!outcome.guess };
        go('#/notfound');
      } else if (outcome.dbId) {
        go('#/drug/' + outcome.dbId);
      } else {
        go('#/result');
      }
    } catch (err) {
      handleAiFailure(job, err, () => askAiByName(q));
    } finally {
      if (aiJob === job) hideOverlay();
      endAiJob(job);
    }
  }

  // ------------------------------------------------------------------
  // Photos
  // ------------------------------------------------------------------
  function requestPhoto(mode = 'photo', opts = {}) {
    state.pendingPhoto = { mode, compareId: opts.compareId || null };
    const input = opts.gallery ? $('#file-gallery') : $('#file-camera');
    input.value = '';
    input.click();
  }
  async function handlePhotoFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast(t('errNotImage')); return; }
    const p = state.pendingPhoto || { mode: 'photo' };
    let img;
    try { img = await prepareImage(file); } catch (e) { toast(t('errNotImage')); return; }
    if (p.mode === 'compare') {
      if (p.compareId === '__result' && state.analysis) state.analysis.photo = img.dataUrl;
      else state.comparePhoto[p.compareId] = img.dataUrl;
      render(false);
      const fig = $('#compare');
      if (fig) fig.scrollIntoView({ block: 'center' });
      return;
    }
    await analyzePhoto(img, p.mode);
  }

  // ------------------------------------------------------------------
  // Voice search & read-aloud
  // ------------------------------------------------------------------
  let recog = null;
  // called on every navigation: a late result must not land on another screen
  function stopVoice() {
    if (!recog) return;
    const r = recog;
    recog = null;
    r.onresult = null;
    r.onerror = null;
    try { r.abort(); } catch (e) { /* ignore */ }
  }
  function startVoice(btn, onText) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast(t('voiceUnsupported')); return; }
    if (recog) { recog.stop(); return; }
    const r = new SR();
    recog = r;
    r.lang = t('speechLang');
    r.interimResults = false;
    r.maxAlternatives = 4;
    btn.setAttribute('aria-pressed', 'true');
    const label = btn.querySelector('.btn-label');
    if (label) label.textContent = t('voiceStop');
    else btn.setAttribute('aria-label', t('voiceStop'));
    announce(t('listening'));
    toast(t('listening'));
    r.onresult = (e) => {
      if (recog !== r || !btn.isConnected) return;
      const alts = Array.from(e.results[0] || []).map((a) => a.transcript.trim()).filter(Boolean);
      // prefer the alternative that matches a medicine in the database
      const best = alts.find((a) => searchDrugs(a).matches.length) || alts[0];
      if (best) { announce(t('heard', { q: best })); onText(best); }
    };
    r.onerror = (e) => {
      toast(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? t('voiceDenied') : t('voiceError'));
    };
    r.onend = () => {
      if (recog === r) recog = null;
      btn.setAttribute('aria-pressed', 'false');
      if (label) label.textContent = t('voiceBtn');
      else btn.setAttribute('aria-label', t('voiceBtn'));
    };
    try { r.start(); } catch (e) { recog = null; btn.setAttribute('aria-pressed', 'false'); toast(t('voiceError')); }
  }

  let speaking = false;
  function stopSpeaking() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    speaking = false;
    $$('[data-action="read-aloud"]').forEach((b) => {
      b.setAttribute('aria-pressed', 'false');
      const l = b.querySelector('.btn-label'); if (l) l.textContent = t('readAloud');
    });
  }
  function readAloud(text, btn) {
    if (!('speechSynthesis' in window)) { toast(t('ttsUnsupported')); return; }
    if (speaking) { stopSpeaking(); return; }
    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = t('speechLang');
    u.rate = 0.9;
    const prefix = u.lang.slice(0, 2);
    const voice = synth.getVoices().find((v) => v.lang && v.lang.toLowerCase().startsWith(prefix));
    if (voice) u.voice = voice;
    u.onend = u.onerror = () => stopSpeaking();
    speaking = true;
    btn.setAttribute('aria-pressed', 'true');
    const l = btn.querySelector('.btn-label'); if (l) l.textContent = t('stopReading');
    synth.speak(u);
  }

  // ------------------------------------------------------------------
  // Router
  // ------------------------------------------------------------------
  const navStack = [];
  function currentHash() { return location.hash && location.hash !== '#' ? location.hash : '#/'; }
  function go(hash) {
    if (currentHash() === hash) render(true);
    else location.hash = hash;
  }
  function goBack() {
    if (navStack.length > 1) history.back();
    else go('#/');
  }
  function parseRoute() {
    const h = currentHash().replace(/^#\/?/, '');
    const [path, qs] = h.split('?');
    const parts = path.split('/').filter(Boolean);
    return { name: parts[0] || 'home', arg: parts[1] ? safeDecode(parts[1]) : null, params: new URLSearchParams(qs || '') };
  }
  function safeDecode(x) {
    try { return decodeURIComponent(x); } catch (e) { return x; } // malformed %-escape in a shared link
  }
  window.addEventListener('hashchange', () => {
    // leaving the screen abandons any running AI request
    if (aiJob) { cancelAiJob(); hideOverlay(); }
    const h = currentHash();
    if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop();
    else if (navStack[navStack.length - 1] !== h) navStack.push(h);
    render(true);
  });

  function screenHead(title) {
    return `<div class="screen-head">
      <button type="button" class="btn-back" data-action="back">${icon('arrowLeft')}<span>${esc(t('back'))}</span></button>
      <h1 tabindex="-1">${esc(title)}</h1>
    </div>`;
  }

  function render(moveFocus) {
    stopSpeaking();
    stopVoice();
    const r = parseRoute();
    let title = t('appName');
    try {
      switch (r.name) {
        case 'search': title = renderSearch(r.params.get('q') || ''); break;
        case 'interactions': title = renderInteractions(); break;
        case 'allergies': title = renderAllergies(); break;
        case 'drug': title = renderDrugRoute(r.arg); break;
        case 'result': title = renderResult(); break;
        case 'notfound': title = renderNotFound(); break;
        default:
          // unknown or retired routes (#/identify, #/scan) show the home screen
          if (r.name !== 'home') {
            try { history.replaceState(null, '', '#/'); } catch (e) { /* ignore */ }
            if (navStack.length) navStack[navStack.length - 1] = '#/';
          }
          title = renderHome();
      }
    } catch (err) {
      // never leave the user on a blank screen
      console.error(err);
      state.fallback = { reason: 'not_found', mode: 'name' };
      title = renderNotFound();
    }
    updateTabbar(parseRoute().name);
    document.title = title === t('appName') ? `${title} · AI Pill` : `${title} · ${t('appName')}`;
    if (moveFocus) {
      window.scrollTo(0, 0);
      const target = $('[data-autofocus]', app) || $('h1', app);
      if (target) target.focus({ preventScroll: true });
    }
  }

  function updateTabbar(name) {
    $$('.tabbar a[data-tab]').forEach((el) => {
      if (el.dataset.tab === name) el.setAttribute('aria-current', 'page');
      else el.removeAttribute('aria-current');
    });
  }

  // ------------------------------------------------------------------
  // Screens
  // ------------------------------------------------------------------
  function sosCard() {
    return `<section class="sos" aria-labelledby="sos-h">
      <span class="tile tile-danger">${icon('danger')}</span>
      <div style="flex:1;min-width:0">
        <strong id="sos-h">${esc(t('emergencyTitle'))}</strong>
        <p>${esc(t('emergencyText'))}</p>
        <div class="btn-row">
          <a class="btn btn-call btn-sm" href="tel:${CONFIG.emergencyTel}">${icon('phone')}<span>${esc(t('call1669'))}</span></a>
          <a class="btn btn-call-outline btn-sm" href="tel:${CONFIG.poisonTel}">${icon('phone')}<span>${esc(t('call1367'))}</span></a>
        </div>
      </div>
    </section>`;
  }
  function demoNotice() {
    if (state.apiKey) return '';
    return `<div class="pill-notice" role="note"><span>${esc(t('demoShortNotice'))}</span>
      <button type="button" class="btn btn-secondary btn-sm" data-action="settings">${esc(t('demoSetup'))}</button></div>`;
  }
  function searchBar(q, autofocus) {
    return `<form class="searchbar" id="search-form" role="search" autocomplete="off">
      ${icon('search')}
      <label class="sr-only" for="search-input">${esc(t('searchLabel'))}</label>
      <input id="search-input" type="search" enterkeyhint="search" placeholder="${esc(t('homeSearchPh'))}" value="${esc(q)}"${autofocus ? ' data-autofocus' : ''}>
      <button type="button" class="round-btn btn-mic" data-action="voice" data-target="search-input" aria-pressed="false" aria-label="${esc(t('voiceBtn'))}">${icon('mic')}</button>
    </form>`;
  }
  // On the search screen results update while typing; elsewhere Enter opens
  // the drug (exact name) or the search screen.
  function wireSearchForm(live) {
    const form = $('#search-form'), input = $('#search-input');
    if (!form || !input) return;
    if (live) {
      let timer = null;
      input.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => updateSearchResults(input.value, false), 150);
      });
    }
    form.addEventListener('submit', (e) => { e.preventDefault(); submitSearch(input.value); });
  }
  function submitSearch(q) {
    const query = String(q || '').trim();
    if ($('#search-results')) { updateSearchResults(query, true); return; }
    const exact = exactDrug(searchDrugs(query).matches);
    if (exact) go('#/drug/' + exact.id);
    else go('#/search' + (query ? '?q=' + encodeURIComponent(query) : ''));
  }

  function renderHome() {
    const recent = state.recent.map(drugById).filter(Boolean);
    const ixCount = state.ixList.length;
    app.innerHTML = `
      <div class="hello">
        <h1 tabindex="-1">${esc(t('homeTitle'))}</h1>
        <p>${esc(t('appTagline'))}</p>
      </div>
      ${searchBar('', false)}
      <section class="camera-card" aria-labelledby="cam-h">
        <span class="cam-ico" aria-hidden="true">${icon('camera')}</span>
        <h2 id="cam-h">${esc(t('takePhoto'))}</h2>
        <p>${esc(t('takePhotoSub'))}</p>
        <div class="btn-row">
          <button type="button" class="btn btn-light" data-action="photo">${icon('camera')}<span>${esc(t('openCamera'))}</span></button>
          <button type="button" class="btn btn-glass" data-action="photo" data-gallery="1">${icon('image')}<span>${esc(t('fromGallery'))}</span></button>
        </div>
      </section>
      ${allergyCard()}
      ${demoNotice()}
      <div class="quick-grid">
        <a class="quick" href="#/interactions">
          <span class="tile tile-brand">${icon('layers')}</span>
          <span class="quick-title">${esc(t('ctaIxTitle'))}</span>
          <span class="quick-sub">${esc(t('ctaIxSub'))}</span>
          ${ixCount ? `<span class="count-pill">${esc(t('ixBadgeCount', { n: ixCount }))}</span>` : ''}
        </a>
        <button type="button" class="quick" data-action="pharmacist">
          <span class="tile tile-info">${icon('chat')}</span>
          <span class="quick-title">${esc(t('askPharmacist'))}</span>
          <span class="quick-sub">${esc(t('pharmSub'))}</span>
        </button>
      </div>
      ${recent.length ? `<h2 class="section-label">${esc(t('recentTitle'))}</h2>
        <div class="chips">${recent.map((d) => `<a class="chip" href="#/drug/${d.id}"><span class="chip-pill">${d.looks && d.looks[0] ? pillSvg(d.looks[0]) : ''}</span>${esc(tr(d.generic))}</a>`).join('')}</div>` : ''}
      ${sosCard()}
      <p class="trust-line">${icon('shield')}<span>${esc(t('noLogin'))}</span></p>`;
    wireSearchForm(false);
    return t('appName');
  }

  // ----- search -----
  // One row linking to a drug. opts: sub (second line), prefix.
  function drugResultItem(d, opts = {}) {
    const look = (d.looks || [])[0];
    const title = `${opts.prefix ? opts.prefix + ': ' : ''}${tr(d.generic)} ${d.strength}`;
    const sub = opts.sub || (d.brands || []).filter(isLatin).join(', ');
    const c = drugConflicts(d)[0];
    const flag = c ? ` <span class="badge badge-${c.level === 'cross' ? 'warn' : 'danger'}">${icon('allergy', 16)}${esc(t('allergyBadge'))}</span>` : '';
    return `<a class="result-item" href="#/drug/${d.id}">
      <span class="ri-pill">${look ? pillSvg(look) : icon('pill')}</span>
      <span class="ri-main"><span class="ri-title">${esc(title)}${flag}</span>
      <span class="ri-sub">${esc(sub)}</span></span>
      <span class="chev" aria-hidden="true">${icon('chevron')}</span>
    </a>`;
  }

  // The "what to do instead" buttons shown whenever a lookup fails.
  function fallbackActions({ photo = false, photoLabel = '', typeName = true } = {}) {
    const out = [];
    if (photo) out.push(`<button type="button" class="btn btn-primary btn-block" data-action="photo">${icon('camera')}<span>${esc(photoLabel)}</span></button>`);
    if (typeName) out.push(`<a class="btn btn-secondary btn-block" href="#/search">${icon('search')}<span>${esc(t('typeInstead'))}</span></a>`);
    out.push(`<button type="button" class="btn btn-secondary btn-block" data-action="pharmacist">${icon('chat')}<span>${esc(t('askPharmacist'))}</span></button>`);
    return `<div class="stack">${out.join('')}</div>`;
  }

  function renderSearch(q) {
    app.innerHTML = `
      ${screenHead(t('searchTitle'))}
      ${searchBar(q, true)}
      <div id="search-results" aria-live="polite"></div>`;
    wireSearchForm(true);
    updateSearchResults(q, false);
    return t('searchTitle');
  }

  function updateSearchResults(q, submitted) {
    const box = $('#search-results');
    if (!box) return;
    try { history.replaceState(null, '', '#/search' + (q ? '?q=' + encodeURIComponent(q) : '')); } catch (e) { /* ignore */ }
    if (navStack.length) navStack[navStack.length - 1] = currentHash();
    const query = String(q || '').trim();
    if (!query) {
      box.innerHTML = `<h2 class="section-label">${esc(t('browseAll'))}</h2><ul class="list">${DRUGS.map((d) => `<li>${drugResultItem(d)}</li>`).join('')}</ul>`;
      return;
    }
    const { matches, suggestions } = searchDrugs(query);
    // open a drug directly only for an exact name; partial or category matches
    // (e.g. "Atorvastatin" ⊃ "statin") must be chosen by the user
    const exact = exactDrug(matches);
    if (submitted && exact) {
      go('#/drug/' + exact.id);
      return;
    }
    if (matches.length) {
      box.innerHTML = `<h2 class="section-label">${esc(t('resultsCount', { n: matches.length }))}</h2>
        <ul class="list">${matches.map((m) => `<li>${drugResultItem(m.drug, { sub: isLatin(m.term) || m.term === tr(m.drug.generic) ? '' : m.term })}</li>`).join('')}</ul>`;
      return;
    }
    let html = `<div class="banner banner-warn" role="status"><span class="ico">${icon('warn')}</span><div>${esc(t('noResult', { q: query }))}</div></div>`;
    if (suggestions.length) {
      html += `<h2 class="section-label">${esc(t('didYouMean'))}</h2><ul class="list" style="margin-bottom:1rem">${suggestions.map((x) => `<li>${drugResultItem(x.drug, { sub: x.fuzzyTerm })}</li>`).join('')}</ul>`;
    }
    html += `<section class="card"><ul class="tips">${t('noResultTips').map((x, i) => `<li><span class="ico" aria-hidden="true">${['🔤', '💊', '📷'][i] || '•'}</span><span>${esc(x)}</span></li>`).join('')}</ul>
      <div class="stack">
        ${state.apiKey
          ? `<button type="button" class="btn btn-primary btn-block" data-action="ask-ai" data-q="${esc(query)}">${icon('sparkle')}<span>${esc(t('askAi', { q: query }))}</span></button>`
          : `<p class="help">${esc(t('askAiNeedKey'))}</p>`}
        ${fallbackActions({ photo: true, photoLabel: t('photoInstead'), typeName: false })}
      </div></section>`;
    box.innerHTML = html;
  }

  // ----- allergies -----
  function allergyCard() {
    const list = state.allergies;
    const asking = !list.length && !state.allergyNone;
    let body;
    if (list.length) {
      body = `<div class="chips">${list.map((a) => `<span class="chip chip-danger">${esc(a.name)}</span>`).join('')}</div>`;
    } else if (state.allergyNone) {
      body = `<p>${esc(t('allergyNoneSet'))}</p>`;
    } else {
      body = `<p>${esc(t('allergyAsk'))}</p>`;
    }
    const actions = asking
      ? `<div class="btn-row"><a class="btn btn-primary btn-sm" href="#/allergies">${icon('plus')}<span>${esc(t('allergyAdd'))}</span></a>
          <button type="button" class="btn btn-secondary btn-sm" data-action="al-none">${esc(t('allergyNoneBtn'))}</button></div>`
      : `<a class="btn btn-secondary btn-sm" href="#/allergies">${esc(t('allergyEdit'))}</a>`;
    return `<section class="allergy-card${asking ? ' asking' : ''}" aria-labelledby="al-h">
      <div class="allergy-head"><span class="tile tile-danger">${icon('allergy')}</span><h2 id="al-h">${esc(t('allergyTitle'))}</h2></div>
      ${body}
      <div class="allergy-actions">${actions}</div>
    </section>`;
  }

  function renderAllergies() {
    app.innerHTML = `
      ${screenHead(t('allergyTitle'))}
      <p class="muted" style="margin-top:-.25rem">${esc(t('allergyIntro'))}</p>
      <form id="al-form" class="searchbar" autocomplete="off">
        ${icon('allergy')}
        <label class="sr-only" for="al-input">${esc(t('allergyPh'))}</label>
        <input id="al-input" type="text" enterkeyhint="done" placeholder="${esc(t('allergyPh'))}" data-autofocus>
        <button type="button" class="round-btn btn-mic" data-action="voice" data-target="al-input" aria-pressed="false" aria-label="${esc(t('voiceBtn'))}">${icon('mic')}</button>
        <button type="submit" class="round-btn primary" aria-label="${esc(t('allergyAdd'))}">${icon('plus')}</button>
      </form>
      <div id="al-suggest" aria-live="polite" style="margin:-.25rem 0 1rem"></div>
      <h2 class="section-label">${esc(t('allergyCommon'))}</h2>
      <div class="chips" style="margin-bottom:1.25rem">${ALLERGY_GROUPS.map((g) => `<button type="button" class="chip" data-action="al-add-group" data-id="${g.id}">${icon('plus', 18)}${esc(tr(g.name))}</button>`).join('')}</div>
      <section class="card">
        <div class="card-title"><h2 id="al-list-h"></h2></div>
        <div id="al-list" aria-live="polite"></div>
      </section>
      <p class="help" style="display:flex;gap:.4rem;align-items:flex-start">${icon('shield', 18)}<span>${esc(t('allergyPrivacy'))}</span></p>`;
    const input = $('#al-input');
    input.addEventListener('input', () => renderAllergySuggest(input.value, false));
    $('#al-form').addEventListener('submit', (e) => { e.preventDefault(); submitAllergy(input.value); });
    renderAllergyList();
    return t('allergyTitle');
  }

  // exact drug or class name → add; otherwise offer suggestions / "add as typed"
  function submitAllergy(value) {
    const q = String(value || '').trim();
    if (!q) return;
    const p = profileOfName(q);
    if (p.drug || p.groups.length) {
      if (addAllergy({ name: q, drugId: p.drug ? p.drug.id : null })) clearAllergyInput();
      return;
    }
    renderAllergySuggest(q, true);
  }
  function clearAllergyInput() {
    const input = $('#al-input');
    if (input) { input.value = ''; input.focus(); }
    const box = $('#al-suggest');
    if (box) box.innerHTML = '';
    renderAllergyList();
  }
  function renderAllergySuggest(value, submitted) {
    const box = $('#al-suggest');
    if (!box) return;
    const q = String(value || '').trim();
    if (!q) { box.innerHTML = ''; return; }
    const nq = norm(q);
    const { matches, suggestions } = searchDrugs(q);
    const drugs = (matches.length ? matches.slice(0, 4) : suggestions).map((m) => m.drug);
    const groups = GROUP_INDEX.filter(({ terms }) => nq.length >= 2 && terms.some((x) => x.n.includes(nq))).map((x) => x.group).slice(0, 3);
    let html = '';
    if (drugs.length || groups.length) {
      html += `<p class="field-label" style="margin:0 0 .4rem">${esc(matches.length || groups.length ? t('resultsCount', { n: drugs.length + groups.length }) : t('didYouMean'))}</p>
        <div class="chips">${groups.map((g) => `<button type="button" class="chip" data-action="al-add-group" data-id="${g.id}">${icon('plus', 18)}${esc(tr(g.name))}</button>`).join('')}${drugs.map((d) => `<button type="button" class="chip" data-action="al-pick" data-id="${d.id}">${icon('plus', 18)}${esc(tr(d.generic))}</button>`).join('')}</div>`;
    }
    if (submitted || (!drugs.length && !groups.length && q.length >= 3)) {
      html += `<div class="chips" style="margin-top:.5rem"><button type="button" class="chip" data-action="al-add-typed" data-q="${esc(q)}">${esc(t('ixAddAsTyped', { q }))}</button></div>`;
    }
    box.innerHTML = html;
  }
  function renderAllergyList() {
    const h = $('#al-list-h'), box = $('#al-list');
    if (!h || !box) return;
    h.textContent = t('allergyListTitle', { n: state.allergies.length });
    if (!state.allergies.length) {
      box.innerHTML = state.allergyNone
        ? `<div class="banner banner-safe" style="margin:0"><span class="ico">${icon('check')}</span><div>${esc(t('allergyNoneSet'))}</div></div>`
        : `<p class="muted">${esc(t('allergyEmpty'))}</p>
           <button type="button" class="btn btn-secondary btn-block" data-action="al-none">${esc(t('allergyNoneBtn'))}</button>`;
      return;
    }
    box.innerHTML = `<ul class="ix-list">${state.allergies.map((a, i) => {
      const p = profileOfAllergy(a);
      const sub = [p.drug ? `${tr(p.drug.generic)}` : '', ...p.groups.map((g) => t('allergyGroupLbl', { g: tr(groupById(g).name) }))].filter(Boolean).join(' · ') || t('allergyUnknownLbl');
      return `<li><span class="tile tile-danger" style="width:2.6rem;height:2.6rem">${icon('allergy')}</span>
        <span class="ix-name">${esc(a.name)}<small>${esc(sub)}</small></span>
        <button type="button" class="ix-remove" data-action="al-remove" data-index="${i}" aria-label="${esc(t('ixRemove', { name: a.name }))}">✕</button></li>`;
    }).join('')}</ul>`;
  }

  // ----- drug detail -----
  function renderDrugRoute(id) {
    const drug = drugById(id);
    if (!drug) {
      state.fallback = { reason: 'not_found', mode: 'name' };
      return renderNotFound();
    }
    state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 6);
    store.set('recent', state.recent);
    return renderDrugView({ kind: 'db', drug, ai: null, demo: false, photo: state.comparePhoto[id] || null, compareId: id });
  }

  function renderResult() {
    const a = state.analysis;
    if (!a) { go('#/'); return t('appName'); }
    const drug = a.dbId ? drugById(a.dbId) : null;
    return renderDrugView({ kind: drug ? 'db' : 'ai', drug, ai: a.ai, demo: a.demo, guess: !!a.guess, photo: a.photo, compareId: '__result', fromAi: true });
  }

  function listItems(items) {
    return `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }
  // A colour-coded block: tile icon + title + level label (never colour alone)
  function section(kind, iconName, title, body, badgeText) {
    return `<section class="section section-${kind}">
      <div class="section-head"><span class="tile tile-${kind}">${icon(iconName)}</span><h2>${esc(title)}</h2>${badgeText ? `<span class="badge badge-${kind}">${esc(badgeText)}</span>` : ''}</div>
      ${body}
    </section>`;
  }
  function cardHead(iconName, title, id) {
    return `<div class="section-head"><span class="tile tile-brand">${icon(iconName)}</span><h2${id ? ` id="${id}"` : ''}>${esc(title)}</h2></div>`;
  }

  // build a language-independent view model from DB data or AI output
  function viewData(vm) {
    if (vm.kind === 'db') {
      const d = vm.drug;
      return {
        generic: tr(d.generic),
        genericEn: d.generic.en,
        brands: (d.brands || []).filter(isLatin).join(', '),
        strength: d.strength,
        form: t('forms')[d.form] || '',
        appearance: tr(d.appearance),
        indications: tr(d.indications),
        usage: tr(d.usage),
        cautions: (d.cautions || []).map(tr),
        dangers: (d.dangers || []).map(tr),
        sideEffects: (d.sideEffects || []).map(tr),
        urgent: (d.urgent || []).map(tr),
        looks: d.looks || [],
        photoRef: d.photo || null,
        highAlert: !!d.highAlert
      };
    }
    const a = vm.ai;
    return {
      generic: a.generic_name || a.brand_name,
      genericEn: '',
      brands: a.generic_name ? a.brand_name : '',
      strength: a.strength,
      form: '',
      appearance: a.appearance,
      indications: a.indications,
      usage: a.usage,
      cautions: a.cautions,
      dangers: a.dangers,
      sideEffects: a.side_effects,
      urgent: [],
      looks: [],
      photoRef: null,
      highAlert: false
    };
  }

  function speechText(v, vm) {
    const parts = [v.generic, v.brands ? `${t('brandLabel')}: ${v.brands}` : '', v.strength];
    // spoken warnings first: a listener cannot see the orange banners
    if (vm.demo) parts.unshift(t('demoBadge'));
    else if (vm.kind === 'ai') parts.unshift(t('aiUnverified'));
    else if (vm.fromAi && vm.guess) parts.unshift(t('aiLowConfidence', { n: vm.ai && vm.ai.confidence !== null ? vm.ai.confidence : '?' }));
    if (vm.ai && vm.ai.expiry_date && !vm.demo) {
      const exp = parseExpiry(vm.ai.expiry_date);
      if (exp && expiryStatus(exp) === 'expired') parts.push(t('expired'));
    }
    if (v.highAlert) parts.push(t('highAlert'));
    if (v.indications) parts.push(`${t('indicationsTitle')}. ${v.indications}`);
    if (v.usage) parts.push(`${t('usageTitle')}. ${v.usage}`);
    if (vm.ai && vm.ai.label_text) parts.push(`${t('labelTextLbl')}. ${vm.ai.label_text}`);
    if (v.cautions.length) parts.push(`${t('cautionTitle')}. ${v.cautions.join(' ')}`);
    if (v.dangers.length) parts.push(`${t('dangerTitle')}. ${v.dangers.join(' ')}`);
    parts.push(`${t('urgentTitle')}. ${[...v.urgent, t('allergyUrgent')].join(' ')}`);
    return parts.filter(Boolean).join('. ');
  }

  function renderDrugView(vm) {
    const v = viewData(vm);
    const ai = vm.ai;
    // demo data has a made-up expiry date: never judge it as (not) expired
    const exp = ai && ai.expiry_date && !vm.demo ? parseExpiry(ai.expiry_date) : null;
    const inList = state.ixList.some((x) => (vm.kind === 'db' ? x.id === vm.drug.id : x.name === v.generic));
    const conflicts = vm.kind === 'db'
      ? drugConflicts(vm.drug)
      : allergyConflicts(profileOfAiNames([ai.generic_name, ai.brand_name]), [ai.generic_name, ai.brand_name]);
    const aiAllergy = ai && !vm.demo ? ai.allergy_warning : '';

    // Trust banner. Green is used only when a real AI analysis was confident
    // and its answer matched the database; demo data and low-confidence
    // guesses are flagged in orange so they cannot pass as an identification.
    const identityCertain = vm.kind === 'db' && !vm.demo && !vm.guess;
    let trust = '';
    if (vm.demo) {
      trust = `<div class="banner banner-warn" role="alert"><span class="ico">${icon('warn')}</span><div>${esc(t('demoBadge'))}<small>${esc(t('demoBadgeSub'))}</small>
        <button type="button" class="btn btn-secondary btn-sm" style="margin-top:.6rem" data-action="settings">${esc(t('demoSetup'))}</button></div></div>`;
    } else if (vm.kind === 'ai') {
      trust = `<div class="banner banner-warn" role="note"><span class="ico">${icon('sparkle', 26)}</span><div>${esc(t('aiUnverified'))}<small>${esc(t('aiUnverifiedSub'))}</small></div></div>`;
    } else if (vm.fromAi && vm.guess) {
      trust = `<div class="banner banner-warn" role="alert"><span class="ico">${icon('warn', 26)}</span><div>${esc(t('aiLowConfidence', { n: ai && ai.confidence !== null ? ai.confidence : '?' }))}<small>${esc(t('aiLowConfidenceSub'))}</small></div></div>`;
    } else if (vm.fromAi) {
      trust = `<div class="banner banner-safe" role="note"><span class="ico">${icon('shield', 26)}</span><div>${esc(t('aiMatchedDb'))}${ai && ai.confidence !== null ? `<small>${esc(t('confidence', { n: ai.confidence }))}</small>` : ''}</div></div>`;
    }

    // reference image: real photo when available, otherwise an illustration
    const refFigure = v.photoRef
      ? `<img src="${esc(v.photoRef)}" alt="${esc(v.generic)}">`
      : v.looks.length ? pillSvg(v.looks[0], lookLabel(v.looks[0])) : `<span class="muted">${esc(t('noPhotoYet'))}</span>`;
    const userFigure = vm.photo
      ? `<img src="${vm.photo}" alt="${esc(t('yourPhoto'))}">`
      : `<span class="muted" style="padding:.5rem;text-align:center">${esc(t('noPhotoYet'))}</span>`;

    const badges = [
      conflicts.length || aiAllergy ? `<span class="badge badge-${conflicts.length && conflicts[0].level === 'cross' ? 'warn' : 'danger'}">${icon('allergy', 18)}${esc(t('allergyBadge'))}</span>` : '',
      vm.demo ? `<span class="badge badge-warn">${icon('warn', 18)}${esc(t('demoShort'))}</span>`
        : identityCertain ? `<span class="badge badge-safe">${icon('shield', 18)}${esc(t('verified'))}</span>`
          : `<span class="badge badge-warn">${icon('sparkle', 18)}AI</span>`,
      v.strength ? `<span class="badge badge-info">${esc(t('strengthLabel'))}: ${esc(v.strength)}</span>` : '',
      v.form ? `<span class="badge badge-info">${esc(v.form)}</span>` : ''
    ].join('');

    const aiFacts = ai && vm.fromAi && (ai.label_text || ai.pill_count !== null || ai.expiry_date || vm.photo) ? `
      <section class="section section-info">
        <div class="section-head"><span class="tile tile-info">${icon('sparkle')}</span><h2>${esc(vm.demo ? t('demoFactsTitle') : t('aiReadTitle'))}</h2></div>
        <div class="ai-facts">
          <div class="fact"><div class="fact-label">${esc(t('pillCountLbl'))}</div><div class="fact-value fact-big">${esc(ai.pill_count !== null ? t('pillCountUnit', { n: ai.pill_count }) : t('cannotCount'))}</div></div>
          ${exp ? `<div class="fact"><div class="fact-label">${esc(t('expiryLbl'))}</div><div class="fact-value">${esc(formatExpiry(exp))}</div></div>` : ''}
          ${ai.confidence !== null && !vm.demo ? `<div class="fact"><div class="fact-label">AI</div><div class="fact-value">${esc(t('confidence', { n: ai.confidence }))}</div></div>` : ''}
        </div>
        ${ai.label_text ? `<div class="fact" style="margin-top:.75rem"><div class="fact-label">${esc(t('labelTextLbl'))}</div><div class="fact-value label-text">${esc(ai.label_text)}</div></div>` : ''}
      </section>` : '';

    const heroArt = v.photoRef ? `<img src="${esc(v.photoRef)}" alt="">`
      : v.looks.length ? pillSvg(v.looks[0]) : icon('pill');

    const now = new Date();
    const years = [];
    for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 8; y++) years.push(y);

    app.innerHTML = `
      <div class="screen-head">
        <button type="button" class="btn-back" data-action="back">${icon('arrowLeft')}<span>${esc(t('back'))}</span></button>
      </div>
      ${allergyBanners(conflicts, aiAllergy)}
      ${exp && expiryStatus(exp) !== 'ok' ? expiryBanner(exp) : ''}
      ${v.highAlert ? `<div class="banner banner-danger" role="alert"><span class="ico">${icon('danger')}</span><div>${esc(t('highAlert'))}</div></div>` : ''}
      ${trust}
      <header class="drug-hero">
        <div class="drug-top">
          <span class="drug-art" aria-hidden="true">${heroArt}</span>
          <div style="min-width:0">
            <div class="eyebrow">${esc(t('genericLabel'))}</div>
            <h1 class="drug-generic" tabindex="-1">${esc(v.generic)}</h1>
            ${v.genericEn && v.genericEn !== v.generic ? `<p class="drug-en">${esc(v.genericEn)}</p>` : ''}
          </div>
        </div>
        ${v.brands ? `<div class="eyebrow">${esc(t('brandLabel'))}</div><p class="drug-brand">${esc(v.brands)}</p>` : ''}
        <div class="drug-meta">${badges}</div>
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-action="read-aloud" aria-pressed="false">${icon('volume')}<span class="btn-label">${esc(t('readAloud'))}</span></button>
          <button type="button" class="btn btn-secondary" data-action="add-ix" ${inList ? 'disabled' : ''}>${icon('plus')}<span>${esc(inList ? t('addedToCheck') : t('addToCheck'))}</span></button>
        </div>
      </header>

      ${v.indications ? section('safe', 'check', t('indicationsTitle'), `<p>${esc(v.indications)}</p>`, t('levelSafe')) : ''}
      ${v.usage ? section('safe', 'clipboard', t('usageTitle'), `<p>${esc(v.usage)}</p>`, t('levelSafe')) : ''}
      ${aiFacts}
      ${v.cautions.length ? section('warn', 'warn', t('cautionTitle'), listItems(v.cautions), t('levelCaution')) : ''}
      ${v.sideEffects.length ? section('warn', 'info', t('sideTitle'), listItems(v.sideEffects), t('levelCaution')) : ''}
      ${v.dangers.length ? section('danger', 'danger', t('dangerTitle'), listItems(v.dangers), t('levelDanger')) : ''}
      ${section('danger', 'phone', t('urgentTitle'), listItems([...v.urgent, t('allergyUrgent')]) +
        `<div class="btn-row" style="margin-top:.85rem"><a class="btn btn-call btn-sm" href="tel:${CONFIG.emergencyTel}">${icon('phone')}<span>${esc(t('call1669'))}</span></a><a class="btn btn-call-outline btn-sm" href="tel:${CONFIG.poisonTel}">${icon('phone')}<span>${esc(t('call1367'))}</span></a></div>`, t('levelDanger'))}

      <section class="card" id="compare" aria-labelledby="cmp-h">
        ${cardHead('image', t('photoTitle'), 'cmp-h')}
        <div class="compare">
          <figure><div class="frame">${userFigure}</div><figcaption>${esc(t('yourPhoto'))}</figcaption></figure>
          <figure><div class="frame">${refFigure}</div><figcaption>${esc(t('referenceImg'))}</figcaption></figure>
        </div>
        ${v.looks.length > 1 ? `<div class="looks-row">${v.looks.map((l) => pillSvg(l, lookLabel(l))).join('')}</div>` : ''}
        ${v.appearance ? `<p style="margin:.75rem 0 0"><strong>${esc(t('appearanceLabel'))}:</strong> ${esc(v.appearance)}</p>` : ''}
        ${!v.photoRef && v.looks.length ? `<p class="compare-note">${esc(t('illustrationNote'))}</p>` : ''}
        <button type="button" class="btn btn-secondary btn-block" style="margin-top:.85rem" data-action="compare-photo" data-id="${esc(vm.compareId)}">${icon('camera')}<span>${esc(t('comparePhoto'))}</span></button>
      </section>

      <section class="card" aria-labelledby="exp-h">
        ${cardHead('calendar', t('checkExpiry'), 'exp-h')}
        <p class="help" style="margin-top:0">${esc(t('checkExpirySub'))}</p>
        <div class="expiry-row" style="margin-top:.75rem">
          <div class="field"><label for="exp-month">${esc(t('month'))}</label>
            <select id="exp-month" class="input"><option value="">—</option>${t('months').map((m, i) => `<option value="${i + 1}" ${exp && exp.m === i + 1 ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
          <div class="field"><label for="exp-year">${esc(t('year'))}</label>
            <select id="exp-year" class="input"><option value="">—</option>${years.map((y) => `<option value="${y}" ${exp && exp.y === y ? 'selected' : ''}>${y}${state.lang === 'th' ? ` / ${t('beSuffix')} ${y + 543}` : ''}</option>`).join('')}</select></div>
        </div>
        <div id="exp-result" aria-live="polite" style="margin-top:.75rem">${exp ? expiryBanner(exp) : ''}</div>
      </section>

      <section class="card sources" aria-labelledby="src-h">
        ${cardHead('shield', t('sourcesTitle'), 'src-h')}
        ${vm.kind === 'db'
          ? `<ul>${(vm.drug.sources || []).map((x) => `<li>${esc(tr(x))}</li>`).join('')}</ul><p class="muted">${esc(t('reviewed', { d: vm.drug.reviewed || '-' }))}</p>`
          : `<p>${esc(t('sourceAi'))}</p>`}
        <a href="${CONFIG.fdaUrl}" target="_blank" rel="noopener noreferrer">${esc(t('openFda'))} ↗</a>
      </section>

      <div class="action-bar">
        <button type="button" class="btn btn-primary" data-action="pharmacist">${icon('chat')}<span>${esc(t('askPharmacist'))}</span></button>
        <a class="btn btn-secondary" href="#/interactions">${icon('layers')}<span>${esc(t('ctaIxTitle'))}</span></a>
      </div>`;

    // wire up the screen
    const readBtn = $('[data-action="read-aloud"]', app);
    const spokenAllergy = conflicts.length ? conflicts.map((c) => conflictText(c).title).join('. ') : aiAllergy ? t('conflictAi', { w: aiAllergy }) : '';
    readBtn.addEventListener('click', () => readAloud([spokenAllergy, speechText(v, vm)].filter(Boolean).join('. '), readBtn));
    $('[data-action="add-ix"]', app).addEventListener('click', (e) => {
      addToIxList(vm.kind === 'db' ? { name: tr(vm.drug.generic), id: vm.drug.id } : { name: v.generic, id: null });
      e.currentTarget.disabled = true;
      e.currentTarget.querySelector('span').textContent = t('addedToCheck');
    });
    const onExp = () => {
      const m = $('#exp-month').value, y = $('#exp-year').value;
      const box = $('#exp-result');
      if (!m || !y) { box.innerHTML = ''; return; }
      box.innerHTML = expiryBanner(parseExpiry(`${y}-${m}`));
    };
    $('#exp-month').addEventListener('change', onExp);
    $('#exp-year').addEventListener('change', onExp);

    return v.generic || t('appName');
  }

  // ----- not found / fallback -----
  function renderNotFound() {
    const f = state.fallback || { reason: 'not_found', mode: 'photo' };
    const issues = t('issues');
    const guess = f.guess && state.analysis && (state.analysis.ai.generic_name || state.analysis.ai.brand_name);
    app.innerHTML = `
      ${screenHead(t('nfTitle'))}
      <div class="banner banner-warn" role="alert"><span class="ico">${icon('warn')}</span><div>${esc(t('nfReason', { r: issues[f.reason] || issues.not_found }))}</div></div>
      ${guess ? `<section class="card"><p><strong>${esc(t('aiGuess', { name: guess }))}</strong></p>
        <a class="btn btn-secondary btn-block" href="#/result">${icon('sparkle')}<span>${esc(t('viewAnyway'))}</span></a></section>` : ''}
      <section class="card">
        <h2>${esc(t('nfSub'))}</h2>
        <ul class="tips">${t('tips').map((x, i) => `<li><span class="ico" aria-hidden="true">${['💡', '📄', '🔍', '✋'][i] || '•'}</span><span>${esc(x)}</span></li>`).join('')}</ul>
        ${fallbackActions({ photo: f.mode !== 'name', photoLabel: t('retake') })}
      </section>`;
    return t('nfTitle');
  }

  // ----- interaction checker -----
  function saveIx() { store.set('ixList', state.ixList); }
  function addToIxList(item) {
    const name = String(item.name || '').trim().slice(0, 120);
    if (!name) return false;
    // same typed name twice is a mistake; the same drug under two different
    // names (Sara + Tylenol) is kept so the duplicate-ingredient check can warn
    if (state.ixList.some((x) => norm(x.name) === norm(name))) { toast(t('ixAlready')); return false; }
    state.ixList.push({ name, id: item.id || null });
    saveIx();
    state.ixResult = null; state.ixAi = null;
    toast(t('addedToCheck'));
    return true;
  }

  function renderInteractions() {
    app.innerHTML = `
      ${screenHead(t('ixTitle'))}
      <p class="muted" style="margin-top:-.25rem">${esc(t('ixSub'))}</p>
      <form id="ix-form" class="searchbar" autocomplete="off">
        ${icon('pill')}
        <label class="sr-only" for="ix-input">${esc(t('ixLabel'))}</label>
        <input id="ix-input" type="text" enterkeyhint="done" placeholder="${esc(t('ixPlaceholder'))}" data-autofocus>
        <button type="button" class="round-btn btn-mic" data-action="voice" data-target="ix-input" aria-pressed="false" aria-label="${esc(t('voiceBtn'))}">${icon('mic')}</button>
        <button type="submit" class="round-btn primary" aria-label="${esc(t('ixAdd'))}">${icon('plus')}</button>
      </form>
      <div id="ix-suggest" aria-live="polite" style="margin:-.25rem 0 1rem"></div>
      <section class="card">
        <div class="card-title"><h2 id="ix-list-h"></h2><button type="button" class="btn btn-ghost btn-sm" data-action="ix-clear">${esc(t('ixClear'))}</button></div>
        <div id="ix-list"></div>
        <button type="button" class="btn btn-primary btn-block" style="margin-top:1rem" data-action="ix-check">${icon('layers')}<span>${esc(t('ixCheck'))}</span></button>
      </section>
      <div id="ix-results" aria-live="polite"></div>`;
    const input = $('#ix-input');
    input.addEventListener('input', () => renderIxSuggest(input.value, false));
    $('#ix-form').addEventListener('submit', (e) => { e.preventDefault(); submitIx(input.value); });
    renderIxList();
    renderIxResults();
    return t('ixTitle');
  }

  function submitIx(value) {
    const q = String(value || '').trim();
    if (!q) return;
    const exact = exactDrug(searchDrugs(q).matches);
    if (exact) {
      if (addToIxList({ name: q, id: exact.id })) clearIxInput();
      return;
    }
    renderIxSuggest(q, true);
  }
  function clearIxInput() {
    const input = $('#ix-input');
    if (input) { input.value = ''; input.focus(); }
    const suggest = $('#ix-suggest');
    if (suggest) suggest.innerHTML = '';
    renderIxList();
    renderIxResults();
  }

  function renderIxSuggest(value, submitted) {
    const box = $('#ix-suggest');
    if (!box) return;
    const q = String(value || '').trim();
    if (!q) { box.innerHTML = ''; return; }
    const { matches, suggestions } = searchDrugs(q);
    const list = matches.length ? matches.slice(0, 5) : suggestions;
    let html = '';
    if (list.length) {
      html += `<p class="field-label" style="margin:0 0 .4rem">${esc(matches.length ? t('resultsCount', { n: list.length }) : t('didYouMean'))}</p>
        <div class="chips">${list.map((m) => `<button type="button" class="chip" data-action="ix-pick" data-id="${m.drug.id}">${icon('plus', 18)}${esc(tr(m.drug.generic))}</button>`).join('')}</div>`;
    } else if (submitted) {
      html += `<p class="help" style="margin-top:.75rem">${esc(t('noResult', { q }))}</p>`;
    }
    if (submitted || (!matches.length && q.length >= 3)) {
      html += `<div class="chips" style="margin-top:.5rem"><button type="button" class="chip" data-action="ix-add-typed" data-q="${esc(q)}">${esc(t('ixAddAsTyped', { q }))}</button></div>`;
    }
    box.innerHTML = html;
  }

  function renderIxList() {
    const h = $('#ix-list-h'), box = $('#ix-list');
    if (!h || !box) return;
    h.textContent = t('ixList', { n: state.ixList.length });
    if (!state.ixList.length) { box.innerHTML = `<p class="muted">${esc(t('ixEmpty'))}</p>`; return; }
    box.innerHTML = `<ul class="ix-list">${state.ixList.map((x, i) => {
      const d = x.id ? drugById(x.id) : null;
      const sub = d ? (norm(tr(d.generic)) !== norm(x.name) ? `${tr(d.generic)} ${d.strength}` : d.strength) : t('ixUnknown');
      return `<li><span class="ri-pill">${d && d.looks[0] ? pillSvg(d.looks[0]) : icon('pill', 30)}</span>
        <span class="ix-name">${esc(x.name)}<small>${d ? '' : '⚠ '}${esc(sub)}</small></span>
        <button type="button" class="ix-remove" data-action="ix-remove" data-index="${i}" aria-label="${esc(t('ixRemove', { name: x.name }))}">✕</button></li>`;
    }).join('')}</ul>`;
  }

  function levelInfo(level) {
    return {
      major: { cls: 'ix-major', icon: 'danger', label: t('ixMajor') },
      moderate: { cls: 'ix-moderate', icon: 'warn', label: t('ixModerate') },
      minor: { cls: 'ix-minor', icon: 'info', label: t('ixMinor') }
    }[level] || { cls: 'ix-moderate', icon: 'warn', label: t('ixModerate') };
  }

  function renderIxResults() {
    const box = $('#ix-results');
    if (!box) return;
    const r = state.ixResult;
    if (!r) { box.innerHTML = ''; return; }
    let html = `<section class="card"><h2>${esc(t('ixResultTitle'))}</h2>`;
    const allergyHits = state.ixList.map((x) => {
      const d = x.id ? drugById(x.id) : null;
      const c = (d ? allergyConflicts(profileOfDrug(d), [x.name]) : allergyConflicts(profileOfName(x.name), [x.name]))[0];
      return c ? { item: x, c } : null;
    }).filter(Boolean);
    html += allergyHits.map(({ item, c }) => {
      const li = levelInfo(c.level === 'cross' ? 'moderate' : 'major');
      return `<div class="ix-result ${li.cls}"><h3>${icon('allergy', 24)}<span>${esc(t('allergyBadge'))}</span></h3>
        <p style="font-weight:700;margin-bottom:.25rem">${esc(t('ixAllergy', { d: item.name, a: c.allergy.name }))}</p><p>${esc(conflictText(c).title)}</p></div>`;
    }).join('');
    if (r.results.length) {
      html += r.results.map((x) => {
        const li = levelInfo(x.level);
        const body = x.dup
          ? t('ixDuplicate', { a: x.a.name, b: x.b.name, g: tr(x.ingredient.generic) })
          : tr(x.text);
        return `<div class="ix-result ${li.cls}"><h3>${icon(li.icon, 24)}<span>${esc(li.label)}</span></h3>
          <p style="font-weight:700;margin-bottom:.25rem">${esc(x.a.name)} + ${esc(x.b.name)}</p><p>${esc(body)}</p></div>`;
      }).join('');
    } else if (!r.unknown.length && !allergyHits.length) {
      html += `<div class="ix-result ix-none"><h3>${icon('check', 24)}<span>${esc(t('ixNone'))}</span></h3><p>${esc(t('ixNoneSub'))}</p></div>`;
    }
    if (r.unknown.length) {
      html += `<div class="banner banner-warn"><span class="ico">${icon('warn')}</span><div>${esc(t('ixUnknownNote', { list: r.unknown.map((x) => x.name).join(', ') }))}</div></div>`;
      html += state.apiKey
        ? `<button type="button" class="btn btn-secondary btn-block" data-action="ix-ai">${icon('sparkle')}<span>${esc(t('ixAskAi'))}</span></button>`
        : `<p class="help">${esc(t('askAiNeedKey'))}</p>`;
    }
    if (state.ixAi) {
      html += `<h3 style="margin-top:1rem">${icon('sparkle', 22)} ${esc(t('ixAiTitle'))}</h3>`;
      const list = state.ixAi.interactions;
      html += list.length ? list.map((x) => {
        const li = levelInfo(x.level);
        return `<div class="ix-result ${li.cls}"><h3>${icon(li.icon, 24)}<span>${esc(li.label)}</span><span class="badge badge-warn">AI</span></h3>
          <p style="font-weight:700;margin-bottom:.25rem">${esc(x.drugs.join(' + '))}</p><p>${esc(x.explanation)}</p></div>`;
      }).join('') : `<p>${esc(t('ixAiNone'))}</p>`;
      if (state.ixAi.note) html += `<p class="help">${esc(state.ixAi.note)}</p>`;
    }
    html += `<div class="banner banner-info" style="margin-top:1rem"><span class="ico">${icon('info')}</span><div>${esc(t('ixDontStop'))}</div></div>
      <button type="button" class="btn btn-secondary btn-block" data-action="pharmacist">${icon('chat')}<span>${esc(t('askPharmacist'))}</span></button></section>`;
    box.innerHTML = html;
  }

  async function runIxAi() {
    if (!state.apiKey) { openSettings(); return; }
    const job = beginAiJob();
    showOverlay(t('searchingAi'), t('analyzingSub'));
    try {
      const names = state.ixList.map((x) => String(x.name).slice(0, 120));
      const raw = await claudeJson({
        system: interactionSystemPrompt(),
        content: [{ type: 'text', text: `Medicines taken together: ${JSON.stringify(names)}` }],
        schema: INTERACTION_SCHEMA
      }, job.controller.signal);
      const obj = Array.isArray(raw) ? { interactions: raw } : raw && typeof raw === 'object' ? raw : {};
      const list = Array.isArray(obj.interactions) ? obj.interactions.filter((x) => x && typeof x === 'object') : [];
      state.ixAi = {
        interactions: list.slice(0, 20).map((x) => ({
          drugs: (Array.isArray(x.drugs) ? x.drugs : []).map((d) => String(d).slice(0, 120)).slice(0, 4),
          level: ['major', 'moderate', 'minor'].includes(x.level) ? x.level : 'moderate',
          explanation: String(x.explanation || '').slice(0, 800)
        })).filter((x) => x.drugs.length),
        note: String(obj.note || '').slice(0, 600)
      };
      endAiJob(job);
      hideOverlay();
      renderIxResults();
      const box = $('#ix-results');
      if (box) box.scrollIntoView({ block: 'start' });
    } catch (err) {
      handleAiFailure(job, err, runIxAi);
    } finally {
      if (aiJob === job) hideOverlay();
      endAiJob(job);
    }
  }

  // ------------------------------------------------------------------
  // Dialogs (bottom sheets)
  // ------------------------------------------------------------------
  function openDialog(dlg) {
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); }
    else dlg.setAttribute('open', '');
  }
  function closeDialog(dlg) {
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }
  function openSettings() {
    $('#api-key').value = state.apiKey;
    $('#api-model').value = state.model || CONFIG.defaultModel;
    openDialog($('#dlg-settings'));
  }
  // help sheet: emergency numbers first, then pharmacist options
  function openPharmacist() {
    const opts = [`<div class="banner banner-danger" style="margin:0"><span class="ico">${icon('danger')}</span><div>${esc(t('emergencyTitle'))}<small>${esc(t('emergencyText'))}</small></div></div>`];
    opts.push(`<a class="btn btn-call btn-block" href="tel:${CONFIG.emergencyTel}">${icon('phone')}<span>${esc(t('pharmEmergency'))}</span></a>`);
    opts.push(`<a class="btn btn-call-outline btn-block" href="tel:${CONFIG.poisonTel}">${icon('phone')}<span>${esc(t('pharmPoison'))}</span></a>`);
    if (CONFIG.pharmacistChatUrl) {
      opts.push(`<a class="btn btn-primary btn-block" href="${esc(CONFIG.pharmacistChatUrl)}" target="_blank" rel="noopener noreferrer">${icon('chat')}<span>${esc(t('pharmChat'))}</span></a>`);
    }
    opts.push(`<a class="btn btn-secondary btn-block" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t('pharmacyQuery'))}" target="_blank" rel="noopener noreferrer">${icon('pin')}<span>${esc(t('pharmNearby'))}</span></a>`);
    $('#pharm-options').innerHTML = opts.join('');
    openDialog($('#dlg-pharmacist'));
  }

  // ------------------------------------------------------------------
  // Global preferences (language, text size, contrast)
  // ------------------------------------------------------------------
  function applyPrefs() {
    const root = document.documentElement;
    root.lang = t('htmlLang');
    root.style.fontSize = FONT_SCALES[state.fontIdx] + '%';
    root.dataset.contrast = state.contrast === 'high' ? 'high' : 'normal';
    $('meta[name="theme-color"]').setAttribute('content', state.contrast === 'high' ? '#000000' : '#f3f6f5');
    $$('[data-i18n]').forEach((el) => { const v = t(el.dataset.i18n); if (typeof v === 'string') el.textContent = v; });
    $$('[data-i18n-aria]').forEach((el) => { const v = t(el.dataset.i18nAria); if (typeof v === 'string') el.setAttribute('aria-label', v); });
    $$('[data-icon]').forEach((el) => { if (!el.firstElementChild) el.innerHTML = icon(el.dataset.icon); });
    // display sheet state
    const names = t('sizeNames');
    $('#size-options').innerHTML = FONT_SCALES.map((_, i) => `<button type="button" data-size="${i}" aria-pressed="${i === state.fontIdx}" aria-label="${esc(names[i])}" style="font-size:${(0.85 + i * 0.25).toFixed(2)}rem">${esc(t('sizeGlyph'))}</button>`).join('');
    $$('#lang-options [data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
    $('#btn-contrast').setAttribute('aria-checked', String(state.contrast === 'high'));
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  $('#btn-display').addEventListener('click', () => openDialog($('#dlg-display')));
  $('#size-options').addEventListener('click', (e) => {
    const b = e.target.closest('[data-size]');
    if (!b) return;
    state.fontIdx = Number(b.dataset.size);
    store.set('fontIdx', state.fontIdx);
    applyPrefs();
    const again = $(`#size-options [data-size="${state.fontIdx}"]`);
    if (again) again.focus();
  });
  $('#lang-options').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lang]');
    if (!b) return;
    state.lang = I18N[b.dataset.lang] ? b.dataset.lang : 'th';
    store.set('lang', state.lang);
    applyPrefs();
    render(false);
  });
  $('#btn-contrast').addEventListener('click', () => {
    state.contrast = state.contrast === 'high' ? 'normal' : 'high';
    store.set('contrast', state.contrast);
    applyPrefs();
  });
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-fab-camera').addEventListener('click', () => requestPhoto('photo'));
  $('#btn-tab-help').addEventListener('click', openPharmacist);
  $('#btn-cancel-ai').addEventListener('click', () => { cancelAiJob(); hideOverlay(); });
  $('#btn-save-settings').addEventListener('click', () => {
    state.apiKey = $('#api-key').value.trim();
    state.model = $('#api-model').value.trim() || CONFIG.defaultModel;
    if (state.apiKey) store.set('anthropicKey', state.apiKey); else store.del('anthropicKey');
    store.set('claudeModel', state.model);
    closeDialog($('#dlg-settings'));
    toast(t('saved'));
    render(false);
  });
  $('#btn-clear-key').addEventListener('click', () => {
    state.apiKey = ''; $('#api-key').value = ''; store.del('anthropicKey');
    toast(t('keyCleared'));
    render(false);
  });
  $('#file-camera').addEventListener('change', (e) => handlePhotoFile(e.target.files && e.target.files[0]));
  $('#file-gallery').addEventListener('change', (e) => handlePhotoFile(e.target.files && e.target.files[0]));

  // delegated actions inside the screen
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !app.contains(el)) return;
    switch (el.dataset.action) {
      case 'back': goBack(); break;
      case 'settings': openSettings(); break;
      case 'pharmacist': openPharmacist(); break;
      case 'photo': requestPhoto('photo', { gallery: !!el.dataset.gallery }); break;
      case 'compare-photo': requestPhoto('compare', { compareId: el.dataset.id }); break;
      case 'ask-ai': askAiByName(el.dataset.q); break;
      case 'voice': {
        const input = document.getElementById(el.dataset.target);
        startVoice(el, (text) => {
          if (input) input.value = text;
          if (el.dataset.target === 'search-input') submitSearch(text);
          else if (el.dataset.target === 'al-input') submitAllergy(text);
          else submitIx(text);
        });
        break;
      }
      case 'ix-pick': {
        const d = drugById(el.dataset.id);
        if (d && addToIxList({ name: tr(d.generic), id: d.id })) clearIxInput();
        break;
      }
      case 'ix-add-typed':
        if (addToIxList({ name: el.dataset.q, id: null })) clearIxInput();
        break;
      case 'ix-remove':
        state.ixList.splice(Number(el.dataset.index), 1);
        saveIx(); state.ixResult = null; state.ixAi = null;
        renderIxList(); renderIxResults();
        $('#ix-input').focus();
        break;
      case 'ix-clear':
        state.ixList = []; saveIx(); state.ixResult = null; state.ixAi = null;
        renderIxList(); renderIxResults();
        break;
      case 'ix-check':
        if (state.ixList.length < 2) { toast(t('ixNeedTwo')); break; }
        state.ixResult = checkInteractions(state.ixList);
        state.ixAi = null;
        renderIxResults();
        $('#ix-results').scrollIntoView({ block: 'start' });
        break;
      case 'ix-ai': runIxAi(); break;
      case 'al-add-group': {
        const g = groupById(el.dataset.id);
        if (g && addAllergy({ name: tr(g.name), groupId: g.id })) clearAllergyInput();
        break;
      }
      case 'al-pick': {
        const d = drugById(el.dataset.id);
        if (d && addAllergy({ name: tr(d.generic), drugId: d.id })) clearAllergyInput();
        break;
      }
      case 'al-add-typed':
        if (addAllergy({ name: el.dataset.q })) clearAllergyInput();
        break;
      case 'al-remove':
        state.allergies.splice(Number(el.dataset.index), 1);
        saveAllergies();
        renderAllergyList();
        break;
      case 'al-none':
        state.allergies = [];
        state.allergyNone = true;
        saveAllergies();
        toast(t('saved'));
        if ($('#al-list')) renderAllergyList(); else render(false);
        break;
      default: break;
    }
  });

  // drag & drop a photo anywhere (desktop) analyses it; never navigate away
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    state.pendingPhoto = { mode: 'photo' };
    handlePhotoFile(file);
  });

  window.addEventListener('pagehide', () => { stopSpeaking(); stopVoice(); });

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  navStack.push(currentHash());
  applyPrefs();
  render(false);

  // exposed for tests / debugging
  window.AIPill = { searchDrugs, checkInteractions, parseExpiry, allergyConflicts, profileOfName, profileOfDrug, state, CONFIG };
})();
