/*
 * ตรวจสอบยา · AI Pill — main application
 * Vanilla JS, no build step. Screens are rendered into <main id="app">
 * with a small hash router so the browser back button always works.
 */
(function () {
  'use strict';

  const { DRUGS, INTERACTIONS } = window.DRUG_DB;
  const I18N = window.I18N;

  // ------------------------------------------------------------------
  // Configuration
  // ------------------------------------------------------------------
  const CONFIG = {
    defaultModel: 'gemini-3.8-flash',
    apiBase: 'https://generativelanguage.googleapis.com/v1beta/models/',
    fdaUrl: 'https://www.fda.moph.go.th/',
    fdaHost: 'fda.moph.go.th',
    emergencyTel: '1669',
    poisonTel: '1367',
    // Link to a real telepharmacy / LINE Official Account chat, if you have one.
    pharmacistChatUrl: '',
    zxingUrl: 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
    maxImageSide: 1600,
    lowConfidence: 60
  };
  const FONT_SIZES = [18, 21, 24, 28];

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
    fontIdx: Math.min(FONT_SIZES.length - 1, Math.max(0, store.get('fontIdx', 0))),
    contrast: store.get('contrast', prefersHighContrast() ? 'high' : 'normal'),
    apiKey: store.get('apiKey', ''),
    model: store.get('model', CONFIG.defaultModel),
    recent: store.get('recent', []),
    ixList: store.get('ixList', []),
    ixResult: null,
    ixAi: null,
    analysis: null,       // last AI analysis {ai, demo, photo, mode, dbId}
    fallback: null,       // {reason, mode}
    comparePhoto: {},     // drugId -> user photo (session only)
    scanResult: null,
    identify: { shape: null, color: null, imprint: '' },
    pendingPhoto: null
  };
  if (!I18N[state.lang]) state.lang = 'th';

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
  function showOverlay(title, sub) {
    $('#overlay-title').textContent = title;
    $('#overlay-sub').textContent = sub || '';
    $('#overlay').hidden = false;
  }
  function hideOverlay() { $('#overlay').hidden = true; }

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
    external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'
  };
  function icon(name, size = 24) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ''}</svg>`;
  }

  // ------------------------------------------------------------------
  // Pill illustration (SVG) — used for the identifier and "reference" image
  // ------------------------------------------------------------------
  const COLOR_HEX = {
    white: '#f7f7f2', yellow: '#f4cf3a', orange: '#f29a4a', pink: '#f3a3bf', red: '#d43d3d',
    purple: '#9466c9', blue: '#4f8fd6', green: '#5fb36a', brown: '#b08560', black: '#2b2b2b'
  };
  const SHAPES = ['round', 'oval', 'oblong', 'capsule', 'other'];
  const COLORS = Object.keys(COLOR_HEX);

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
    return String(q || '').replace(/\d+(?:[.,]\d+)?\s*(?:mg|มก\.?|มิลลิกรัม|毫克|g|กรัม|tab|tabs|เม็ด)?/gi, ' ');
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

  const INDEX = DRUGS.map((d) => {
    const raw = [d.id, d.generic.th, d.generic.en, d.generic.zh, ...(d.brands || []), ...(d.aliases || [])];
    const parts = [];
    raw.forEach((term) => {
      parts.push(term);
      String(term).split(/[()（）]/).forEach((p) => { if (p.trim()) parts.push(p.trim()); });
    });
    const terms = Array.from(new Set(parts)).map((term) => ({ term, n: norm(term) })).filter((x) => x.n);
    return { drug: d, terms };
  });

  function searchDrugs(query) {
    const nq = norm(stripStrength(query));
    if (!nq) return { matches: [], suggestions: [] };
    const scored = INDEX.map(({ drug, terms }) => {
      let best = 0, bestTerm = '', fuzzy = 0, fuzzyTerm = '';
      for (const { term, n } of terms) {
        let s = 0;
        if (n === nq) s = 100;
        else if (n.startsWith(nq) && nq.length >= 2) s = 90;
        else if (nq.length >= 3 && n.includes(nq)) s = 80;
        else if (n.length >= 4 && nq.includes(n)) s = 72;
        if (s > best) { best = s; bestTerm = term; }
        if (nq.length >= 3) {
          let f = similarity(nq, n);
          if (nq.length >= 4 && n.length > nq.length) f = Math.max(f, similarity(nq, n.slice(0, nq.length)) - 0.05);
          if (f > fuzzy) { fuzzy = f; fuzzyTerm = term; }
        }
      }
      return { drug, score: best, term: bestTerm, fuzzy, fuzzyTerm };
    });
    const matches = scored.filter((x) => x.score >= 70).sort((a, b) => b.score - a.score);
    const suggestions = matches.length ? [] : scored
      .filter((x) => x.fuzzy >= 0.55)
      .sort((a, b) => b.fuzzy - a.fuzzy)
      .slice(0, 3);
    return { matches, suggestions };
  }

  // find a drug name inside free text (QR content, AI output)
  function findDrugInText(text) {
    const nt = norm(text);
    let best = null, bestLen = 0;
    for (const { drug, terms } of INDEX) {
      for (const { n } of terms) {
        if (n.length >= 4 && nt.includes(n) && n.length > bestLen) { best = drug; bestLen = n.length; }
      }
    }
    return best;
  }

  // ------------------------------------------------------------------
  // Pill identifier (shape / colour / imprint)
  // ------------------------------------------------------------------
  const NEAR_SHAPES = { oval: ['oblong'], oblong: ['oval', 'capsule'], capsule: ['oblong'], round: ['other'], other: ['round'] };

  function identifyMatches({ shape, color, imprint }) {
    const imp = norm(imprint || '');
    const impDigits = (imprint || '').replace(/\D/g, '');
    if (!shape && !color && !imp) return [];
    const out = [];
    for (const { drug, terms } of INDEX) {
      let best = null;
      for (const look of drug.looks || []) {
        let score = 0, max = 0;
        if (shape) {
          max += 3;
          if (look.shape === shape) score += 3;
          else if ((NEAR_SHAPES[shape] || []).includes(look.shape)) score += 1;
        }
        if (color) {
          max += 3;
          if ((look.colors || []).includes(color)) score += 3;
        }
        if (imp) {
          max += 3;
          const imprints = (look.imprint || []).map(norm);
          if (imprints.some((x) => x === imp)) score += 3;
          else if (imp.length >= 3 && terms.some(({ n }) => n.includes(imp) || (n.length >= 4 && imp.includes(n)))) score += 3;
          else if (impDigits && String(drug.strength).replace(/\D/g, ' ').split(' ').includes(impDigits)) score += 2;
        }
        const ratio = max ? score / max : 0;
        if (!best || ratio > best.ratio) best = { ratio, look };
      }
      if (best && best.ratio >= 0.66) out.push({ drug, look: best.look, ratio: best.ratio });
    }
    return out.sort((a, b) => b.ratio - a.ratio).slice(0, 8);
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
    return { results, unknown: list.filter((x) => !x.id) };
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
    return `<div class="banner banner-${map[0]}" role="${st === 'expired' ? 'alert' : 'status'}"><span class="ico">${icon(map[1], 26)}</span><div>${esc(map[2])}<small>${esc(t('expiryLbl'))}: ${esc(formatExpiry(exp))}</small></div></div>`;
  }

  // ------------------------------------------------------------------
  // Images
  // ------------------------------------------------------------------
  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  function loadImg(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image'));
      img.src = src;
    });
  }
  async function prepareImage(file) {
    const url = await readAsDataURL(file);
    const img = await loadImg(url);
    const scale = Math.min(1, CONFIG.maxImageSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { dataUrl, base64: dataUrl.split(',')[1], mime: 'image/jpeg', canvas };
  }

  // ------------------------------------------------------------------
  // Gemini API
  // ------------------------------------------------------------------
  function aiLanguageName() { return t('aiLanguage'); }

  function catalogForPrompt() {
    return DRUGS.map((d) => `- ${d.id}: ${d.generic.en} ${d.strength} (brands: ${(d.brands || []).filter(isLatin).join(', ') || '-'})`).join('\n');
  }

  const AI_JSON_SHAPE = `{
  "is_medicine": boolean,
  "image_problem": "none" | "blurry" | "too_dark" | "glare" | "too_far" | "not_medicine",
  "db_id": string or null,
  "generic_name": string,
  "brand_name": string,
  "strength": string,
  "appearance": string,
  "label_text": string,
  "indications": string,
  "usage": string,
  "cautions": string[],
  "dangers": string[],
  "side_effects": string[],
  "pill_count": integer or null,
  "expiry_date": "YYYY-MM-DD" or "YYYY-MM" or null,
  "confidence": integer from 0 to 100
}`;

  function imagePrompt(mode) {
    const focus = mode === 'package'
      ? 'The user says this is a package, bottle, box or label: read every printed word, the dosing directions and the expiry date.'
      : 'The user says this is a pill: look closely at the shape, colour, score line, imprint/markings and any packaging text.';
    return `You are a careful clinical pharmacist assistant helping people in Thailand (many are elderly) identify a medicine from a photo.
The photo may show loose pills, a blister pack, a bottle, a box, or a hospital/clinic medicine bag (often a clear zip-lock bag with a printed label). ${focus}

Tasks:
1. Read ALL visible text (label, bag, blister foil, imprint), including text seen through clear plastic. Put it in "label_text".
2. Describe the physical appearance in "appearance".
3. Count the pills or capsules that are clearly visible. Use null if counting is not possible.
4. Find the expiry date (EXP / วันหมดอายุ / ใช้ก่อน). Thai labels may use Buddhist Era years (2570 = 2027): convert to Gregorian. Use null if not visible.
5. Identify the medicine. Never claim high confidence from colour or shape alone – different medicines can look identical. Lower "confidence" whenever the identity is uncertain.
6. If it is one of these database entries, put its id in "db_id", otherwise null:
${catalogForPrompt()}
7. If the photo is unusable, set "image_problem" accordingly. If there is no medicine, set "is_medicine" to false.

Write every human-readable value in ${aiLanguageName()}, in short simple sentences suitable for elderly readers.
"usage" must follow the label or bag directions when they are visible; otherwise give the standard adult dose.
"dangers" = contraindications and serious risks. "cautions" = things to be careful about (food, milk, alcohol, drowsiness, timing). Use "" or [] when unknown.
Respond with ONLY a JSON object with exactly these keys:
${AI_JSON_SHAPE}`;
  }

  function namePrompt(q) {
    return `A user in Thailand searched a medicine database for ${JSON.stringify(String(q).slice(0, 200))} and it was not found.
If this is a real medicine (or an obvious misspelling of one) available in Thailand, describe it. If you are not sure which medicine it is, set "is_medicine" to false and leave the other fields empty.
If it is one of these database entries, put its id in "db_id", otherwise null:
${catalogForPrompt()}
Use "image_problem": "none", "label_text": "", "pill_count": null, "expiry_date": null.
Write every human-readable value in ${aiLanguageName()}, in short simple sentences suitable for elderly readers.
Respond with ONLY a JSON object with exactly these keys:
${AI_JSON_SHAPE}`;
  }

  function interactionPrompt(names) {
    return `Check drug–drug interactions among these medicines taken by one patient in Thailand: ${JSON.stringify(names.map((n) => String(n).slice(0, 120)))}.
Report only clinically meaningful interactions you are confident about, including duplicated active ingredients. Do not invent interactions.
Write explanations in ${aiLanguageName()}, short and simple, and advise asking a doctor or pharmacist rather than stopping medicines.
Respond with ONLY a JSON object:
{"interactions": [{"drugs": [string, string], "level": "major" | "moderate" | "minor", "explanation": string}], "note": string}`;
  }

  function parseJsonLoose(text) {
    try { return JSON.parse(text); } catch (e) {
      const cleaned = text.replace(/```json|```/g, '').trim();
      const s = cleaned.indexOf('{'), en = cleaned.lastIndexOf('}');
      if (s >= 0 && en > s) return JSON.parse(cleaned.slice(s, en + 1));
      throw new Error('Invalid AI response');
    }
  }

  async function geminiCall(parts) {
    const model = (state.model || CONFIG.defaultModel).trim();
    const url = CONFIG.apiBase + encodeURIComponent(model) + ':generateContent';
    const makeBody = (withThinking) => JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: Object.assign(
        { responseMimeType: 'application/json' },
        withThinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}
      )
    });
    const send = (body) => fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': state.apiKey },
      body
    });
    let res = await send(makeBody(true));
    if (res.status === 400) {
      const txt = await res.clone().text();
      if (/thinking/i.test(txt)) res = await send(makeBody(false)); // model without thinking levels
    }
    if (!res.ok) {
      let msg = '';
      try { const j = await res.json(); msg = (j.error && j.error.message) || ''; } catch (e) { /* ignore */ }
      const err = new Error(msg || 'HTTP ' + res.status);
      err.status = res.status; err.apiMessage = msg;
      throw err;
    }
    const data = await res.json();
    if (data.promptFeedback && data.promptFeedback.blockReason) { const e = new Error('blocked'); e.blocked = true; throw e; }
    const cand = data.candidates && data.candidates[0];
    const text = ((cand && cand.content && cand.content.parts) || [])
      .filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
    if (!text) { const e = new Error('empty'); e.blocked = true; throw e; }
    return parseJsonLoose(text);
  }

  // make AI output safe and predictable
  function cleanAi(raw) {
    const s = (v) => (v === null || v === undefined ? '' : String(v)).trim();
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(s).filter(Boolean).slice(0, 8);
    let conf = parseInt(String(raw.confidence === undefined ? raw.confidence_score : raw.confidence).replace(/[^\d]/g, ''), 10);
    if (isNaN(conf)) conf = null; else conf = Math.max(0, Math.min(100, conf));
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
      confidence: conf
    };
  }

  function aiErrorMessage(err) {
    if (err && err.blocked) return t('errBlocked');
    if (err && err.name === 'TypeError') return t('errNetwork');
    if (err && (err.status === 401 || err.status === 403 || err.status === 429)) return t('errKey');
    if (err && err.status === 400 && /api.?key/i.test(err.apiMessage || '')) return t('errKey');
    return t('errGeneric', { msg: (err && err.message) || '?' });
  }

  function demoAnalysis(mode) {
    const exp = new Date();
    exp.setFullYear(exp.getFullYear() + 1);
    return cleanAi({
      is_medicine: true, image_problem: 'none', db_id: 'paracetamol',
      generic_name: 'Paracetamol', brand_name: 'Sara', strength: '500 mg',
      label_text: mode === 'package' ? t('demoLabel') : '',
      pill_count: 10, expiry_date: `${exp.getFullYear()}-${pad2(exp.getMonth() + 1)}`,
      confidence: 95
    });
  }

  // decide what to show after an analysis
  function resolveAnalysis(ai) {
    let dbId = ai.db_id;
    if (!dbId) {
      for (const name of [ai.generic_name, ai.brand_name]) {
        if (!name) continue;
        const { matches } = searchDrugs(name);
        if (matches.length && matches[0].score >= 90) { dbId = matches[0].drug.id; break; }
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

  async function analyzePhoto(img, mode) {
    showOverlay(t('analyzing'), t('analyzingSub'));
    try {
      let ai, demo = false;
      if (!state.apiKey) {
        await sleep(1200);
        ai = demoAnalysis(mode);
        demo = true;
      } else {
        ai = cleanAi(await geminiCall([
          { text: imagePrompt(mode) },
          { inlineData: { mimeType: img.mime, data: img.base64 } }
        ]));
      }
      const outcome = resolveAnalysis(ai);
      state.analysis = { ai, demo, photo: img.dataUrl, mode, dbId: outcome.dbId };
      hideOverlay();
      if (outcome.fail) {
        state.fallback = { reason: outcome.fail, mode, guess: !!outcome.guess };
        go('#/notfound');
      } else {
        go('#/result');
      }
    } catch (err) {
      hideOverlay();
      console.error(err);
      toast(aiErrorMessage(err));
    }
  }

  async function askAiByName(q) {
    if (!state.apiKey) { openSettings(); return; }
    showOverlay(t('searchingAi'), t('analyzingSub'));
    try {
      const ai = cleanAi(await geminiCall([{ text: namePrompt(q) }]));
      const outcome = resolveAnalysis(ai);
      state.analysis = { ai, demo: false, photo: null, mode: 'name', dbId: outcome.dbId };
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
      hideOverlay();
      console.error(err);
      toast(aiErrorMessage(err));
    }
  }

  // ------------------------------------------------------------------
  // Photos
  // ------------------------------------------------------------------
  function requestPhoto(mode, opts = {}) {
    state.pendingPhoto = { mode, compareId: opts.compareId || null };
    const input = opts.gallery ? $('#file-gallery') : $('#file-camera');
    input.value = '';
    input.click();
  }
  async function handlePhotoFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || '')) { toast(t('errNotImage')); return; }
    const p = state.pendingPhoto || { mode: 'pill' };
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
    if (p.mode === 'barcode') {
      await decodeImageBarcode(img.canvas);
      return;
    }
    await analyzePhoto(img, p.mode);
  }

  // ------------------------------------------------------------------
  // Barcode / QR scanning
  // ------------------------------------------------------------------
  const scanner = { stream: null, timer: null, decode: null, canvas: null, busy: false };

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ($(`script[src="${src}"]`)) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('load ' + src));
      document.head.appendChild(s);
    });
  }

  async function getDecoder() {
    if (scanner.decode) return scanner.decode;
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats && formats.length) {
          const det = new window.BarcodeDetector({ formats });
          scanner.decode = async (canvas) => {
            const r = await det.detect(canvas);
            return r && r[0] ? r[0].rawValue : null;
          };
          return scanner.decode;
        }
      } catch (e) { /* fall through to ZXing */ }
    }
    await loadScript(CONFIG.zxingUrl);
    const Z = window.ZXing;
    if (!Z || !Z.MultiFormatReader) throw new Error('scanner');
    const hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    scanner.decode = async (canvas) => {
      try {
        const src = new Z.HTMLCanvasElementLuminanceSource(canvas);
        const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(src));
        return reader.decode(bmp, hints).getText();
      } catch (e) { return null; }
    };
    return scanner.decode;
  }

  async function startCamera() {
    const video = $('#scan-video');
    const wrap = $('#scanner-wrap');
    if (!video || !wrap) return;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast(t('cameraDenied')); return; }
    let decode;
    try {
      announce(t('scannerLoading'));
      decode = await getDecoder();
    } catch (e) { toast(t('scannerUnavailable')); return; }
    try {
      scanner.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch (e) { toast(t('cameraDenied')); return; }
    video.srcObject = scanner.stream;
    video.setAttribute('playsinline', '');
    await video.play().catch(() => {});
    wrap.hidden = false;
    $('#btn-start-camera').hidden = true;
    announce(t('scanHint'));
    scanner.canvas = scanner.canvas || document.createElement('canvas');
    scanner.timer = setInterval(async () => {
      if (scanner.busy || !video.videoWidth) return;
      scanner.busy = true;
      try {
        const c = scanner.canvas;
        const scale = Math.min(1, 960 / video.videoWidth);
        c.width = Math.round(video.videoWidth * scale);
        c.height = Math.round(video.videoHeight * scale);
        c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
        const code = await decode(c);
        if (code) {
          stopCamera();
          if (navigator.vibrate) navigator.vibrate(120);
          handleCode(code);
        }
      } finally { scanner.busy = false; }
    }, 350);
  }

  function stopCamera() {
    clearInterval(scanner.timer);
    scanner.timer = null;
    if (scanner.stream) scanner.stream.getTracks().forEach((tr) => tr.stop());
    scanner.stream = null;
    const wrap = $('#scanner-wrap');
    if (wrap) wrap.hidden = true;
    const btn = $('#btn-start-camera');
    if (btn) btn.hidden = false;
  }

  async function decodeImageBarcode(canvas) {
    let decode;
    try { decode = await getDecoder(); } catch (e) { toast(t('scannerUnavailable')); return; }
    const code = await decode(canvas);
    if (code) handleCode(code);
    else {
      state.scanResult = { code: null };
      renderScanResult();
    }
  }

  function handleCode(raw) {
    const code = String(raw).trim().slice(0, 2000);
    const byBarcode = DRUGS.find((d) => (d.barcodes || []).includes(code));
    if (byBarcode) { go('#/drug/' + byBarcode.id); return; }
    const drug = findDrugInText(code);
    const regMatch = code.match(/\b\d{1,2}\s?[A-Z]\s?\d{1,5}\/\d{2,4}(?:\s?\([A-Z]{1,3}\))?/i);
    let url = null;
    try { const u = new URL(code); if (/^https?:$/.test(u.protocol)) url = u; } catch (e) { /* not a URL */ }
    state.scanResult = { code, drugId: drug ? drug.id : null, reg: regMatch ? regMatch[0] : null, url: url ? url.href : null, host: url ? url.hostname : null };
    renderScanResult();
  }

  // ------------------------------------------------------------------
  // Voice search & read-aloud
  // ------------------------------------------------------------------
  let recog = null;
  function startVoice(btn, onText) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast(t('voiceUnsupported')); return; }
    if (recog) { recog.stop(); return; }
    recog = new SR();
    recog.lang = t('speechLang');
    recog.interimResults = false;
    recog.maxAlternatives = 4;
    btn.setAttribute('aria-pressed', 'true');
    const label = btn.querySelector('.btn-label');
    if (label) label.textContent = t('voiceStop');
    announce(t('listening'));
    toast(t('listening'));
    recog.onresult = (e) => {
      const alts = Array.from(e.results[0] || []).map((a) => a.transcript.trim()).filter(Boolean);
      // prefer the alternative that matches a medicine in the database
      const best = alts.find((a) => searchDrugs(a).matches.length) || alts[0];
      if (best) { announce(t('heard', { q: best })); onText(best); }
    };
    recog.onerror = (e) => {
      toast(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? t('voiceDenied') : t('voiceError'));
    };
    recog.onend = () => {
      recog = null;
      btn.setAttribute('aria-pressed', 'false');
      if (label) label.textContent = t('voiceBtn');
    };
    try { recog.start(); } catch (e) { recog = null; btn.setAttribute('aria-pressed', 'false'); toast(t('voiceError')); }
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
    return { name: parts[0] || 'home', arg: parts[1] ? decodeURIComponent(parts[1]) : null, params: new URLSearchParams(qs || '') };
  }
  window.addEventListener('hashchange', () => {
    const h = currentHash();
    if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop();
    else if (navStack[navStack.length - 1] !== h) navStack.push(h);
    render(true);
  });

  function screenHead(title) {
    return `<div class="screen-head">
      <button type="button" class="btn btn-back" data-action="back">${icon('arrowLeft')}<span>${esc(t('back'))}</span></button>
      <h1 tabindex="-1">${esc(title)}</h1>
    </div>`;
  }

  function render(moveFocus) {
    stopCamera();
    stopSpeaking();
    const r = parseRoute();
    let title = t('appName');
    switch (r.name) {
      case 'search': title = renderSearch(r.params.get('q') || ''); break;
      case 'identify': title = renderIdentify(); break;
      case 'scan': title = renderScan(); break;
      case 'interactions': title = renderInteractions(); break;
      case 'drug': title = renderDrugRoute(r.arg); break;
      case 'result': title = renderResult(); break;
      case 'notfound': title = renderNotFound(); break;
      default: title = renderHome();
    }
    document.title = title === t('appName') ? `${title} · AI Pill` : `${title} · ${t('appName')}`;
    if (moveFocus) {
      window.scrollTo(0, 0);
      const target = $('[data-autofocus]', app) || $('h1', app);
      if (target) target.focus({ preventScroll: true });
    }
  }

  // ------------------------------------------------------------------
  // Screens
  // ------------------------------------------------------------------
  function emergencyBanner() {
    return `<section class="emergency" aria-labelledby="em-title">
      <div class="emergency-head">${icon('danger', 30)}<div>
        <strong id="em-title">${esc(t('emergencyTitle'))}</strong>
        <p>${esc(t('emergencyText'))}</p>
      </div></div>
      <div class="btn-row">
        <a class="btn btn-call" href="tel:${CONFIG.emergencyTel}">${icon('phone')}<span>${esc(t('call1669'))}</span></a>
        <a class="btn btn-call-outline" href="tel:${CONFIG.poisonTel}">${icon('phone')}<span>${esc(t('call1367'))}</span></a>
      </div>
    </section>`;
  }
  function demoNotice() {
    if (state.apiKey) return '';
    return `<div class="notice" role="note">${icon('info')}<div><p style="margin:0 0 .4rem">${esc(t('demoNotice'))}</p>
      <button type="button" class="btn btn-secondary" data-action="settings">${esc(t('demoSetup'))}</button></div></div>`;
  }

  function renderHome() {
    const recent = state.recent.map(drugById).filter(Boolean);
    const ixCount = state.ixList.length;
    app.innerHTML = `
      <div class="hero">
        <h1 tabindex="-1">${esc(t('appName'))}</h1>
        <p class="lead">${esc(t('appTagline'))}</p>
      </div>
      ${emergencyBanner()}
      <h2 id="how">${esc(t('homeQuestion'))}</h2>
      <nav class="cta-grid" aria-labelledby="how">
        <a class="cta cta-primary" href="#/identify">
          <span class="cta-icon">${icon('pill', 32)}</span>
          <span><span class="cta-title">${esc(t('ctaPillTitle'))}</span><span class="cta-sub">${esc(t('ctaPillSub'))}</span></span>
          <span class="cta-arrow" aria-hidden="true">›</span>
        </a>
        <a class="cta cta-primary" href="#/scan">
          <span class="cta-icon">${icon('barcode', 32)}</span>
          <span><span class="cta-title">${esc(t('ctaScanTitle'))}</span><span class="cta-sub">${esc(t('ctaScanSub'))}</span></span>
          <span class="cta-arrow" aria-hidden="true">›</span>
        </a>
        <a class="cta cta-primary" href="#/search">
          <span class="cta-icon">${icon('search', 32)}</span>
          <span><span class="cta-title">${esc(t('ctaSearchTitle'))}</span><span class="cta-sub">${esc(t('ctaSearchSub'))}</span></span>
          <span class="cta-arrow" aria-hidden="true">›</span>
        </a>
        <a class="cta cta-secondary" href="#/interactions">
          <span class="cta-icon">${icon('layers', 30)}</span>
          <span><span class="cta-title">${esc(t('ctaIxTitle'))}</span><span class="cta-sub">${esc(t('ctaIxSub'))}${ixCount ? ` · <strong>${esc(t('ixBadgeCount', { n: ixCount }))}</strong>` : ''}</span></span>
          <span class="cta-arrow" aria-hidden="true">›</span>
        </a>
      </nav>
      ${recent.length ? `<section class="card" style="margin-top:1.25rem" aria-labelledby="recent-h">
        <h2 id="recent-h">${esc(t('recentTitle'))}</h2>
        <div class="chips">${recent.map((d) => `<a class="chip" href="#/drug/${d.id}">${icon('pill', 18)}${esc(tr(d.generic))}</a>`).join('')}</div>
      </section>` : ''}
      <p class="trust-line">${icon('shield', 20)}<span>${esc(t('noLogin'))}</span></p>`;
    return t('appName');
  }

  // ----- search -----
  function drugResultItem(d, sub) {
    const look = (d.looks || [])[0];
    return `<a class="result-item" href="#/drug/${d.id}">
      <span class="ri-pill">${look ? pillSvg(look) : ''}</span>
      <span class="ri-main"><span class="ri-title">${esc(tr(d.generic))} ${esc(d.strength)}</span>
      <span class="ri-sub">${esc(sub || (d.brands || []).filter(isLatin).join(', '))}</span></span>
      <span class="cta-arrow" aria-hidden="true">›</span>
    </a>`;
  }

  function renderSearch(q) {
    app.innerHTML = `
      ${screenHead(t('searchTitle'))}
      <form class="card" id="search-form" role="search" autocomplete="off">
        <label class="field-label" for="search-input">${esc(t('searchLabel'))}</label>
        <div class="search-row">
          <input id="search-input" class="input" type="search" enterkeyhint="search" placeholder="${esc(t('searchPlaceholder'))}" value="${esc(q)}" data-autofocus>
          <button type="submit" class="btn btn-primary">${icon('search')}<span>${esc(t('searchBtn'))}</span></button>
          <button type="button" class="btn btn-secondary btn-mic" data-action="voice" data-target="search-input" aria-pressed="false">${icon('mic')}<span class="btn-label">${esc(t('voiceBtn'))}</span></button>
        </div>
      </form>
      <div id="search-results" aria-live="polite"></div>`;
    const input = $('#search-input');
    let timer = null;
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => updateSearchResults(input.value, false), 150);
    });
    $('#search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      updateSearchResults(input.value, true);
    });
    updateSearchResults(q, false);
    return t('searchTitle');
  }

  function updateSearchResults(q, submitted) {
    const box = $('#search-results');
    if (!box) return;
    try { history.replaceState(null, '', '#/search' + (q ? '?q=' + encodeURIComponent(q) : '')); } catch (e) { /* ignore */ }
    if (navStack.length) navStack[navStack.length - 1] = currentHash();
    const query = q.trim();
    if (!query) {
      box.innerHTML = `<section class="card"><h2>${esc(t('browseAll'))}</h2><ul class="suggest-list">${DRUGS.map((d) => `<li>${drugResultItem(d)}</li>`).join('')}</ul></section>`;
      return;
    }
    const { matches, suggestions } = searchDrugs(query);
    if (submitted && matches.length && (matches.length === 1 || matches[0].score >= 100 && matches[1].score < 100)) {
      go('#/drug/' + matches[0].drug.id);
      return;
    }
    if (matches.length) {
      box.innerHTML = `<section class="card"><h2>${esc(t('resultsCount', { n: matches.length }))}</h2>
        <ul class="suggest-list">${matches.map((m) => `<li>${drugResultItem(m.drug, isLatin(m.term) || m.term === tr(m.drug.generic) ? '' : m.term)}</li>`).join('')}</ul></section>`;
      return;
    }
    let html = `<div class="banner banner-warn" role="status"><span class="ico">${icon('warn', 26)}</span><div>${esc(t('noResult', { q: query }))}</div></div>`;
    if (suggestions.length) {
      html += `<section class="card"><h2>${esc(t('didYouMean'))}</h2><ul class="suggest-list">${suggestions.map((s) => `<li>${drugResultItem(s.drug, s.fuzzyTerm)}</li>`).join('')}</ul></section>`;
    }
    html += `<section class="card"><ul class="tips">${t('noResultTips').map((x, i) => `<li><span class="ico" aria-hidden="true">${['🔤', '💊', '📷'][i] || '•'}</span><span>${esc(x)}</span></li>`).join('')}</ul>
      <div class="stack">
        ${state.apiKey
          ? `<button type="button" class="btn btn-primary btn-block" data-action="ask-ai" data-q="${esc(query)}">${icon('sparkle')}<span>${esc(t('askAi', { q: query }))}</span></button>`
          : `<p class="help">${esc(t('askAiNeedKey'))}</p>`}
        <a class="btn btn-secondary btn-block" href="#/scan">${icon('camera')}<span>${esc(t('photoInstead'))}</span></a>
        <button type="button" class="btn btn-secondary btn-block" data-action="pharmacist">${icon('chat')}<span>${esc(t('askPharmacist'))}</span></button>
      </div></section>`;
    box.innerHTML = html;
  }

  // ----- identify -----
  function renderIdentify() {
    const sel = state.identify;
    const shapes = t('shapes'), colors = t('colors');
    app.innerHTML = `
      ${screenHead(t('identifyTitle'))}
      ${demoNotice()}
      <section class="card stack">
        <button type="button" class="btn btn-primary btn-block" data-action="photo" data-mode="pill" style="min-height:4.5rem;font-size:1.25rem">${icon('camera', 30)}<span>${esc(t('photoPill'))}</span></button>
        <p class="help" style="text-align:center;margin:0">${esc(t('photoPillSub'))}</p>
        <button type="button" class="btn btn-ghost btn-block" data-action="photo" data-mode="pill" data-gallery="1">${icon('image')}<span>${esc(t('fromGallery'))}</span></button>
      </section>
      <div class="divider">${esc(t('orManual'))}</div>
      <section class="card">
        <fieldset>
          <legend>${esc(t('shape'))}</legend>
          <div class="option-grid">${SHAPES.map((s) => `<button type="button" class="opt" data-action="opt-shape" data-value="${s}" aria-pressed="${sel.shape === s}">${pillSvg({ shape: s, colors: [] }, null, '#e6e9ec')}<span>${esc(shapes[s])}</span></button>`).join('')}</div>
        </fieldset>
        <fieldset>
          <legend>${esc(t('color'))}</legend>
          <div class="option-grid">${COLORS.map((c) => `<button type="button" class="opt" data-action="opt-color" data-value="${c}" aria-pressed="${sel.color === c}"><span class="swatch" style="background:${COLOR_HEX[c]}" aria-hidden="true"></span><span>${esc(colors[c])}</span></button>`).join('')}</div>
        </fieldset>
        <div class="field">
          <label for="imprint-input">${esc(t('imprint'))}</label>
          <input id="imprint-input" class="input" type="text" autocomplete="off" autocapitalize="characters" placeholder="${esc(t('imprintPh'))}" value="${esc(sel.imprint)}">
        </div>
        <button type="button" class="btn btn-ghost" data-action="clear-identify">${esc(t('clearChoices'))}</button>
      </section>
      <div id="identify-results" aria-live="polite"></div>`;
    $('#imprint-input').addEventListener('input', (e) => { state.identify.imprint = e.target.value; updateIdentifyResults(); });
    updateIdentifyResults();
    return t('identifyTitle');
  }

  function updateIdentifyResults() {
    const box = $('#identify-results');
    if (!box) return;
    const sel = state.identify;
    $$('[data-action="opt-shape"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === sel.shape)));
    $$('[data-action="opt-color"]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === sel.color)));
    if (!sel.shape && !sel.color && !sel.imprint.trim()) {
      box.innerHTML = `<p class="muted" style="text-align:center">${esc(t('pickSomething'))}</p>`;
      return;
    }
    const list = identifyMatches(sel);
    if (!list.length) {
      box.innerHTML = `<section class="card"><div class="banner banner-warn"><span class="ico">${icon('warn', 26)}</span><div>${esc(t('noCandidates'))}</div></div>
        <div class="stack"><button type="button" class="btn btn-primary btn-block" data-action="photo" data-mode="pill">${icon('camera')}<span>${esc(t('photoPill'))}</span></button>
        <a class="btn btn-secondary btn-block" href="#/search">${icon('search')}<span>${esc(t('typeInstead'))}</span></a>
        <button type="button" class="btn btn-secondary btn-block" data-action="pharmacist">${icon('chat')}<span>${esc(t('askPharmacist'))}</span></button></div></section>`;
      return;
    }
    box.innerHTML = `<section class="card">
      <h2>${esc(t('candidates'))} (${list.length})</h2>
      <div class="banner banner-warn"><span class="ico">${icon('warn', 26)}</span><div>${esc(t('candidateWarn'))}</div></div>
      <ul class="suggest-list">${list.map(({ drug, look }) => `<li><a class="result-item" href="#/drug/${drug.id}">
        <span class="ri-pill">${pillSvg(look, lookLabel(look))}</span>
        <span class="ri-main"><span class="ri-title">${esc(t('possibleMatch'))}: ${esc(tr(drug.generic))} ${esc(drug.strength)}</span>
        <span class="ri-sub">${esc(lookLabel(look))} · ${esc((drug.brands || []).filter(isLatin).join(', '))}</span></span>
        <span class="cta-arrow" aria-hidden="true">›</span></a></li>`).join('')}</ul>
    </section>`;
  }

  // ----- scan -----
  function renderScan() {
    app.innerHTML = `
      ${screenHead(t('scanTitle'))}
      ${demoNotice()}
      <section class="card stack">
        <button type="button" class="btn btn-primary btn-block" id="btn-start-camera" data-action="start-camera" style="min-height:4.5rem;font-size:1.2rem">${icon('barcode', 30)}<span>${esc(t('startCamera'))}</span></button>
        <div id="scanner-wrap" hidden>
          <div class="scanner"><video id="scan-video" muted playsinline aria-label="${esc(t('scanHint'))}"></video><div class="reticle" aria-hidden="true"></div></div>
          <p class="help" style="text-align:center">${esc(t('scanHint'))}</p>
          <button type="button" class="btn btn-secondary btn-block" data-action="stop-camera">${icon('stop')}<span>${esc(t('stopCamera'))}</span></button>
        </div>
        <button type="button" class="btn btn-ghost btn-block" data-action="photo" data-mode="barcode" data-gallery="1">${icon('image')}<span>${esc(t('uploadBarcode'))}</span></button>
      </section>
      <div id="scan-result" aria-live="polite"></div>
      <section class="card stack">
        <button type="button" class="btn btn-primary btn-block" data-action="photo" data-mode="package" style="min-height:4.5rem;font-size:1.2rem">${icon('camera', 30)}<span>${esc(t('photoPackage'))}</span></button>
        <p class="help" style="text-align:center;margin:0">${esc(t('photoPackageSub'))}</p>
        <button type="button" class="btn btn-ghost btn-block" data-action="photo" data-mode="package" data-gallery="1">${icon('image')}<span>${esc(t('fromGallery'))}</span></button>
      </section>`;
    renderScanResult();
    return t('scanTitle');
  }

  function renderScanResult() {
    const box = $('#scan-result');
    if (!box) return;
    const r = state.scanResult;
    if (!r) { box.innerHTML = ''; return; }
    if (!r.code) {
      box.innerHTML = `<section class="card"><div class="banner banner-warn" role="alert"><span class="ico">${icon('warn', 26)}</span><div>${esc(t('barcodeNoDecode'))}</div></div>
        <button type="button" class="btn btn-secondary btn-block" data-action="photo" data-mode="package">${icon('camera')}<span>${esc(t('photoPackage'))}</span></button></section>`;
      return;
    }
    const drug = r.drugId ? drugById(r.drugId) : null;
    let html = `<section class="card stack"><h2>${esc(t('codeFound'))}</h2><div class="code-box">${esc(r.code)}</div>`;
    if (drug) {
      html += `<div class="banner banner-safe"><span class="ico">${icon('check', 26)}</span><div>${esc(t('codeMatchedText'))}</div></div>${drugResultItem(drug)}`;
    } else {
      html += `<div class="banner banner-warn"><span class="ico">${icon('warn', 26)}</span><div>${esc(t('codeNotInDb'))}</div></div>`;
    }
    if (r.reg) {
      html += `<div class="banner banner-info"><span class="ico">${icon('shield', 26)}</span><div>${esc(t('fdaRegFound', { reg: r.reg }))}</div></div>
        <a class="btn btn-secondary btn-block" href="${CONFIG.fdaUrl}" target="_blank" rel="noopener noreferrer">${icon('external')}<span>${esc(t('verifyFda'))}</span></a>`;
    }
    if (r.url) {
      const official = r.host === CONFIG.fdaHost || r.host.endsWith('.' + CONFIG.fdaHost);
      if (!official) html += `<div class="banner banner-warn"><span class="ico">${icon('warn', 26)}</span><div>${esc(t('linkWarn', { host: r.host }))}</div></div>`;
      html += `<a class="btn btn-secondary btn-block" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer nofollow">${icon('external')}<span>${esc(t('openLink'))}</span></a>`;
    }
    if (!drug) {
      html += `<button type="button" class="btn btn-primary btn-block" data-action="photo" data-mode="package">${icon('camera')}<span>${esc(t('photoPackage'))}</span></button>
        <a class="btn btn-secondary btn-block" href="#/search">${icon('search')}<span>${esc(t('typeInstead'))}</span></a>
        <button type="button" class="btn btn-secondary btn-block" data-action="pharmacist">${icon('chat')}<span>${esc(t('askPharmacist'))}</span></button>`;
    }
    box.innerHTML = html + '</section>';
    box.scrollIntoView({ block: 'nearest' });
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
    return renderDrugView({ kind: drug ? 'db' : 'ai', drug, ai: a.ai, demo: a.demo, photo: a.photo, compareId: '__result', fromAi: true });
  }

  function listItems(items) {
    return `<ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }
  function section(kind, iconName, title, body, badgeText) {
    return `<section class="section section-${kind}">
      <h2>${icon(iconName, 26)}<span>${esc(title)}</span>${badgeText ? `<span class="badge badge-${kind}">${esc(badgeText)}</span>` : ''}</h2>
      ${body}
    </section>`;
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
    if (vm.ai && vm.ai.expiry_date) {
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
    const exp = ai && ai.expiry_date ? parseExpiry(ai.expiry_date) : null;
    const inList = state.ixList.some((x) => (vm.kind === 'db' ? x.id === vm.drug.id : x.name === v.generic));

    // trust banner
    let trust = '';
    if (vm.demo) {
      trust += `<div class="banner banner-info" role="note"><span class="ico">${icon('info', 26)}</span><div>${esc(t('demoBadge'))}</div></div>`;
    }
    if (vm.kind === 'ai') {
      trust += `<div class="banner banner-warn" role="note"><span class="ico">${icon('sparkle', 26)}</span><div>${esc(t('aiUnverified'))}<small>${esc(t('aiUnverifiedSub'))}</small></div></div>`;
    } else if (vm.fromAi) {
      trust += `<div class="banner banner-safe" role="note"><span class="ico">${icon('shield', 26)}</span><div>${esc(t('aiMatchedDb'))}${ai && ai.confidence !== null ? `<small>${esc(t('confidence', { n: ai.confidence }))}</small>` : ''}</div></div>`;
    }

    // reference image: real photo when available, otherwise an illustration
    const refFigure = v.photoRef
      ? `<img src="${esc(v.photoRef)}" alt="${esc(v.generic)}">`
      : v.looks.length ? pillSvg(v.looks[0], lookLabel(v.looks[0])) : `<span class="muted">${esc(t('noPhotoYet'))}</span>`;
    const userFigure = vm.photo
      ? `<img src="${vm.photo}" alt="${esc(t('yourPhoto'))}">`
      : `<span class="muted" style="padding:.5rem;text-align:center">${esc(t('noPhotoYet'))}</span>`;

    const badges = [
      vm.kind === 'db' ? `<span class="badge badge-safe">${icon('shield', 18)}${esc(t('verified'))}</span>` : `<span class="badge badge-warn">${icon('sparkle', 18)}AI</span>`,
      v.strength ? `<span class="badge badge-info">${esc(t('strengthLabel'))}: ${esc(v.strength)}</span>` : '',
      v.form ? `<span class="badge badge-info">${esc(v.form)}</span>` : ''
    ].join('');

    const aiFacts = ai && vm.fromAi && (ai.label_text || ai.pill_count !== null || ai.expiry_date || vm.photo) ? `
      <section class="section section-info">
        <h2>${icon('sparkle', 26)}<span>${esc(t('aiReadTitle'))}</span></h2>
        <div class="ai-facts">
          <div class="fact"><div class="fact-label">${esc(t('pillCountLbl'))}</div><div class="fact-value fact-big">${esc(ai.pill_count !== null ? t('pillCountUnit', { n: ai.pill_count }) : t('cannotCount'))}</div></div>
          ${exp ? `<div class="fact"><div class="fact-label">${esc(t('expiryLbl'))}</div><div class="fact-value">${esc(formatExpiry(exp))}</div></div>` : ''}
          ${ai.confidence !== null ? `<div class="fact"><div class="fact-label">AI</div><div class="fact-value">${esc(t('confidence', { n: ai.confidence }))}</div></div>` : ''}
        </div>
        ${ai.label_text ? `<div class="fact" style="margin-top:.75rem"><div class="fact-label">${esc(t('labelTextLbl'))}</div><div class="fact-value label-text">${esc(ai.label_text)}</div></div>` : ''}
      </section>` : '';

    const now = new Date();
    const years = [];
    for (let y = now.getFullYear() - 3; y <= now.getFullYear() + 8; y++) years.push(y);

    app.innerHTML = `
      <div class="screen-head">
        <button type="button" class="btn btn-back" data-action="back">${icon('arrowLeft')}<span>${esc(t('back'))}</span></button>
      </div>
      ${exp && expiryStatus(exp) !== 'ok' ? expiryBanner(exp) : ''}
      ${v.highAlert ? `<div class="banner banner-danger" role="alert"><span class="ico">${icon('danger', 26)}</span><div>${esc(t('highAlert'))}</div></div>` : ''}
      ${trust}
      <header class="card drug-head">
        <div class="eyebrow">${esc(t('genericLabel'))}</div>
        <h1 class="drug-generic" tabindex="-1">${esc(v.generic)}</h1>
        ${v.genericEn && v.genericEn !== v.generic ? `<p class="muted" style="margin:0 0 .4rem;font-weight:600">${esc(v.genericEn)}</p>` : ''}
        ${v.brands ? `<div class="eyebrow">${esc(t('brandLabel'))}</div><p class="drug-brand">${esc(v.brands)}</p>` : ''}
        <div class="drug-meta">${badges}</div>
        <div class="btn-row" style="margin-top:1rem">
          <button type="button" class="btn btn-primary" data-action="read-aloud" aria-pressed="false">${icon('volume')}<span class="btn-label">${esc(t('readAloud'))}</span></button>
          <button type="button" class="btn btn-secondary" data-action="add-ix" ${inList ? 'disabled' : ''}>${icon('plus')}<span>${esc(inList ? t('addedToCheck') : t('addToCheck'))}</span></button>
        </div>
      </header>

      <section class="card" id="compare" aria-labelledby="cmp-h">
        <h2 id="cmp-h">${esc(t('photoTitle'))}</h2>
        <div class="compare">
          <figure><div class="frame">${userFigure}</div><figcaption>${esc(t('yourPhoto'))}</figcaption></figure>
          <figure><div class="frame">${refFigure}</div><figcaption>${esc(t('referenceImg'))}</figcaption></figure>
        </div>
        ${v.looks.length > 1 ? `<div class="looks-row" style="margin-top:.6rem">${v.looks.map((l) => pillSvg(l, lookLabel(l))).join('')}</div>` : ''}
        ${v.appearance ? `<p style="margin:.75rem 0 0"><strong>${esc(t('appearanceLabel'))}:</strong> ${esc(v.appearance)}</p>` : ''}
        ${!v.photoRef && v.looks.length ? `<p class="compare-note">${esc(t('illustrationNote'))}</p>` : ''}
        <button type="button" class="btn btn-secondary btn-block" style="margin-top:.75rem" data-action="compare-photo" data-id="${esc(vm.compareId)}">${icon('camera')}<span>${esc(t('comparePhoto'))}</span></button>
      </section>

      ${v.indications ? section('safe', 'check', t('indicationsTitle'), `<p>${esc(v.indications)}</p>`, t('levelSafe')) : ''}
      ${v.usage ? section('safe', 'clipboard', t('usageTitle'), `<p>${esc(v.usage)}</p>`, t('levelSafe')) : ''}
      ${aiFacts}
      ${v.cautions.length ? section('warn', 'warn', t('cautionTitle'), listItems(v.cautions), t('levelCaution')) : ''}
      ${v.sideEffects.length ? section('warn', 'info', t('sideTitle'), listItems(v.sideEffects), t('levelCaution')) : ''}
      ${v.dangers.length ? section('danger', 'danger', t('dangerTitle'), listItems(v.dangers), t('levelDanger')) : ''}
      ${section('danger', 'phone', t('urgentTitle'), listItems([...v.urgent, t('allergyUrgent')]) +
        `<div class="btn-row" style="margin-top:.75rem"><a class="btn btn-call" href="tel:${CONFIG.emergencyTel}">${icon('phone')}<span>${esc(t('call1669'))}</span></a><a class="btn btn-call-outline" href="tel:${CONFIG.poisonTel}">${icon('phone')}<span>${esc(t('call1367'))}</span></a></div>`, t('levelDanger'))}

      <section class="card" aria-labelledby="exp-h">
        <h2 id="exp-h">${icon('calendar', 24)} ${esc(t('checkExpiry'))}</h2>
        <p class="help">${esc(t('checkExpirySub'))}</p>
        <div class="expiry-row">
          <div class="field"><label for="exp-month">${esc(t('month'))}</label>
            <select id="exp-month" class="input"><option value="">—</option>${t('months').map((m, i) => `<option value="${i + 1}" ${exp && exp.m === i + 1 ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select></div>
          <div class="field"><label for="exp-year">${esc(t('year'))}</label>
            <select id="exp-year" class="input"><option value="">—</option>${years.map((y) => `<option value="${y}" ${exp && exp.y === y ? 'selected' : ''}>${y}${state.lang === 'th' ? ` / ${t('beSuffix')} ${y + 543}` : ''}</option>`).join('')}</select></div>
        </div>
        <div id="exp-result" aria-live="polite" style="margin-top:.75rem">${exp ? expiryBanner(exp) : ''}</div>
      </section>

      <section class="card sources" aria-labelledby="src-h">
        <h2 id="src-h">${icon('shield', 24)} ${esc(t('sourcesTitle'))}</h2>
        ${vm.kind === 'db'
          ? `<ul>${(vm.drug.sources || []).map((s) => `<li>${esc(tr(s))}</li>`).join('')}</ul><p class="muted">${esc(t('reviewed', { d: vm.drug.reviewed || '-' }))}</p>`
          : `<p>${esc(t('sourceAi'))}</p>`}
        <a href="${CONFIG.fdaUrl}" target="_blank" rel="noopener noreferrer">${esc(t('openFda'))} ↗</a>
      </section>

      <div class="action-bar">
        <button type="button" class="btn btn-primary" data-action="pharmacist">${icon('chat')}<span>${esc(t('askPharmacist'))}</span></button>
        <a class="btn btn-secondary" href="#/interactions">${icon('layers')}<span>${esc(t('ctaIxTitle'))}</span></a>
      </div>`;

    // wire up the screen
    const readBtn = $('[data-action="read-aloud"]', app);
    readBtn.addEventListener('click', () => readAloud(speechText(v, vm), readBtn));
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
    const f = state.fallback || { reason: 'not_found', mode: 'pill' };
    const issues = t('issues');
    const guess = f.guess && state.analysis && (state.analysis.ai.generic_name || state.analysis.ai.brand_name);
    const retakeMode = f.mode === 'package' ? 'package' : 'pill';
    app.innerHTML = `
      ${screenHead(t('nfTitle'))}
      <div class="banner banner-warn" role="alert"><span class="ico">${icon('warn', 26)}</span><div>${esc(t('nfReason', { r: issues[f.reason] || issues.not_found }))}</div></div>
      ${guess ? `<section class="card"><p><strong>${esc(t('aiGuess', { name: guess }))}</strong></p>
        <a class="btn btn-secondary btn-block" href="#/result">${icon('sparkle')}<span>${esc(t('viewAnyway'))}</span></a></section>` : ''}
      <section class="card">
        <h2>${esc(t('nfSub'))}</h2>
        <ul class="tips">${t('tips').map((x, i) => `<li><span class="ico" aria-hidden="true">${['💡', '📄', '🔍', '✋'][i] || '•'}</span><span>${esc(x)}</span></li>`).join('')}</ul>
        <div class="stack">
          ${f.mode !== 'name' ? `<button type="button" class="btn btn-primary btn-block" data-action="photo" data-mode="${retakeMode}">${icon('camera')}<span>${esc(t('retake'))}</span></button>` : ''}
          <a class="btn btn-secondary btn-block" href="#/search">${icon('search')}<span>${esc(t('typeInstead'))}</span></a>
          <a class="btn btn-secondary btn-block" href="#/identify">${icon('pill')}<span>${esc(t('byShape'))}</span></a>
          <button type="button" class="btn btn-secondary btn-block" data-action="pharmacist">${icon('chat')}<span>${esc(t('askPharmacist'))}</span></button>
        </div>
      </section>`;
    return t('nfTitle');
  }

  // ----- interaction checker -----
  function saveIx() { store.set('ixList', state.ixList); }
  function addToIxList(item) {
    const name = String(item.name || '').trim().slice(0, 120);
    if (!name) return false;
    const dupName = state.ixList.some((x) => norm(x.name) === norm(name));
    const dupId = item.id && state.ixList.some((x) => x.id === item.id && norm(x.name) === norm(name));
    if (dupName || dupId) { toast(t('ixAlready')); return false; }
    state.ixList.push({ name, id: item.id || null });
    saveIx();
    state.ixResult = null; state.ixAi = null;
    toast(t('addedToCheck'));
    return true;
  }

  function renderInteractions() {
    app.innerHTML = `
      ${screenHead(t('ixTitle'))}
      <p class="lead">${esc(t('ixSub'))}</p>
      <section class="card">
        <form id="ix-form" autocomplete="off">
          <label class="field-label" for="ix-input">${esc(t('ixLabel'))}</label>
          <div class="search-row">
            <input id="ix-input" class="input" type="text" enterkeyhint="done" placeholder="${esc(t('ixPlaceholder'))}" data-autofocus>
            <button type="submit" class="btn btn-primary">${icon('plus')}<span>${esc(t('ixAdd'))}</span></button>
            <button type="button" class="btn btn-secondary btn-mic" data-action="voice" data-target="ix-input" aria-pressed="false">${icon('mic')}<span class="btn-label">${esc(t('voiceBtn'))}</span></button>
          </div>
          <div id="ix-suggest" aria-live="polite"></div>
        </form>
        <h2 style="margin-top:1.25rem" id="ix-list-h"></h2>
        <div id="ix-list"></div>
        <div class="btn-row" style="margin-top:1rem">
          <button type="button" class="btn btn-primary" data-action="ix-check">${icon('layers')}<span>${esc(t('ixCheck'))}</span></button>
          <button type="button" class="btn btn-ghost" data-action="ix-clear">${esc(t('ixClear'))}</button>
        </div>
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
    const { matches } = searchDrugs(q);
    if (matches.length && matches[0].score >= 80) {
      if (addToIxList({ name: q, id: matches[0].drug.id })) clearIxInput();
      return;
    }
    renderIxSuggest(q, true);
  }
  function clearIxInput() {
    const input = $('#ix-input');
    if (input) { input.value = ''; input.focus(); }
    $('#ix-suggest').innerHTML = '';
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
      html += `<p class="field-label" style="margin:.75rem 0 .4rem">${esc(matches.length ? t('resultsCount', { n: list.length }) : t('didYouMean'))}</p>
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
      return `<li><span class="ri-pill" style="width:2.6rem;height:2.6rem;flex:none">${d && d.looks[0] ? pillSvg(d.looks[0]) : icon('pill', 30)}</span>
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
    if (r.results.length) {
      html += r.results.map((x) => {
        const li = levelInfo(x.level);
        const body = x.dup
          ? t('ixDuplicate', { a: x.a.name, b: x.b.name, g: tr(x.ingredient.generic) })
          : tr(x.text);
        return `<div class="ix-result ${li.cls}"><h3>${icon(li.icon, 24)}<span>${esc(li.label)}</span></h3>
          <p style="font-weight:700;margin-bottom:.25rem">${esc(x.a.name)} + ${esc(x.b.name)}</p><p>${esc(body)}</p></div>`;
      }).join('');
    } else if (!r.unknown.length) {
      html += `<div class="ix-result ix-none"><h3>${icon('check', 24)}<span>${esc(t('ixNone'))}</span></h3><p>${esc(t('ixNoneSub'))}</p></div>`;
    }
    if (r.unknown.length) {
      html += `<div class="banner banner-warn"><span class="ico">${icon('warn', 26)}</span><div>${esc(t('ixUnknownNote', { list: r.unknown.map((x) => x.name).join(', ') }))}</div></div>`;
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
    html += `<div class="banner banner-info" style="margin-top:1rem"><span class="ico">${icon('info', 26)}</span><div>${esc(t('ixDontStop'))}</div></div>
      <button type="button" class="btn btn-secondary btn-block" data-action="pharmacist">${icon('chat')}<span>${esc(t('askPharmacist'))}</span></button></section>`;
    box.innerHTML = html;
  }

  async function runIxAi() {
    if (!state.apiKey) { openSettings(); return; }
    showOverlay(t('searchingAi'), t('analyzingSub'));
    try {
      const raw = await geminiCall([{ text: interactionPrompt(state.ixList.map((x) => x.name)) }]);
      const list = Array.isArray(raw.interactions) ? raw.interactions : [];
      state.ixAi = {
        interactions: list.slice(0, 20).map((x) => ({
          drugs: (Array.isArray(x.drugs) ? x.drugs : []).map((d) => String(d).slice(0, 120)).slice(0, 4),
          level: ['major', 'moderate', 'minor'].includes(x.level) ? x.level : 'moderate',
          explanation: String(x.explanation || '').slice(0, 800)
        })).filter((x) => x.drugs.length),
        note: String(raw.note || '').slice(0, 600)
      };
      hideOverlay();
      renderIxResults();
      $('#ix-results').scrollIntoView({ block: 'start' });
    } catch (err) {
      hideOverlay();
      console.error(err);
      toast(aiErrorMessage(err));
    }
  }

  // ------------------------------------------------------------------
  // Dialogs
  // ------------------------------------------------------------------
  function openDialog(dlg) {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
  function openSettings() {
    $('#api-key').value = state.apiKey;
    $('#api-model').value = state.model || CONFIG.defaultModel;
    openDialog($('#dlg-settings'));
  }
  function openPharmacist() {
    const opts = [];
    if (CONFIG.pharmacistChatUrl) {
      opts.push(`<a class="btn btn-primary btn-block" href="${esc(CONFIG.pharmacistChatUrl)}" target="_blank" rel="noopener noreferrer">${icon('chat')}<span>${esc(t('pharmChat'))}</span></a>`);
    }
    opts.push(`<a class="btn ${CONFIG.pharmacistChatUrl ? 'btn-secondary' : 'btn-primary'} btn-block" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t('pharmacyQuery'))}" target="_blank" rel="noopener noreferrer">${icon('pin')}<span>${esc(t('pharmNearby'))}</span></a>`);
    opts.push(`<a class="btn btn-secondary btn-block" href="tel:${CONFIG.poisonTel}">${icon('phone')}<span>${esc(t('pharmPoison'))}</span></a>`);
    opts.push(`<a class="btn btn-call btn-block" href="tel:${CONFIG.emergencyTel}">${icon('phone')}<span>${esc(t('pharmEmergency'))}</span></a>`);
    $('#pharm-options').innerHTML = opts.join('');
    openDialog($('#dlg-pharmacist'));
  }

  // ------------------------------------------------------------------
  // Global preferences (language, text size, contrast)
  // ------------------------------------------------------------------
  function applyPrefs() {
    const root = document.documentElement;
    root.lang = t('htmlLang');
    root.style.fontSize = FONT_SIZES[state.fontIdx] + 'px';
    root.dataset.contrast = state.contrast === 'high' ? 'high' : 'normal';
    $('meta[name="theme-color"]').setAttribute('content', state.contrast === 'high' ? '#000000' : '#3d5a1e');
    $$('[data-i18n]').forEach((el) => { const v = t(el.dataset.i18n); if (typeof v === 'string') el.textContent = v; });
    $$('[data-i18n-aria]').forEach((el) => { const v = t(el.dataset.i18nAria); if (typeof v === 'string') el.setAttribute('aria-label', v); });
    $('#lang-select').value = state.lang;
    $('#btn-font-down').disabled = state.fontIdx <= 0;
    $('#btn-font-up').disabled = state.fontIdx >= FONT_SIZES.length - 1;
    $('#btn-contrast').setAttribute('aria-pressed', String(state.contrast === 'high'));
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------
  $('#lang-select').addEventListener('change', (e) => {
    state.lang = I18N[e.target.value] ? e.target.value : 'th';
    store.set('lang', state.lang);
    applyPrefs();
    render(false);
  });
  $('#btn-font-down').addEventListener('click', () => {
    state.fontIdx = Math.max(0, state.fontIdx - 1); store.set('fontIdx', state.fontIdx); applyPrefs();
  });
  $('#btn-font-up').addEventListener('click', () => {
    state.fontIdx = Math.min(FONT_SIZES.length - 1, state.fontIdx + 1); store.set('fontIdx', state.fontIdx); applyPrefs();
  });
  $('#btn-contrast').addEventListener('click', () => {
    state.contrast = state.contrast === 'high' ? 'normal' : 'high'; store.set('contrast', state.contrast); applyPrefs();
  });
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-save-settings').addEventListener('click', () => {
    state.apiKey = $('#api-key').value.trim();
    state.model = $('#api-model').value.trim() || CONFIG.defaultModel;
    if (state.apiKey) store.set('apiKey', state.apiKey); else store.del('apiKey');
    store.set('model', state.model);
    $('#dlg-settings').close();
    toast(t('saved'));
    render(false);
  });
  $('#btn-clear-key').addEventListener('click', () => {
    state.apiKey = ''; $('#api-key').value = ''; store.del('apiKey');
    toast(t('keyCleared'));
    render(false);
  });
  $('#file-camera').addEventListener('change', (e) => handlePhotoFile(e.target.files && e.target.files[0]));
  $('#file-gallery').addEventListener('change', (e) => handlePhotoFile(e.target.files && e.target.files[0]));

  // delegated actions inside the screen
  app.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !app.contains(el)) return;
    const a = el.dataset.action;
    switch (a) {
      case 'back': goBack(); break;
      case 'settings': openSettings(); break;
      case 'pharmacist': openPharmacist(); break;
      case 'photo': requestPhoto(el.dataset.mode, { gallery: !!el.dataset.gallery }); break;
      case 'compare-photo': requestPhoto('compare', { compareId: el.dataset.id }); break;
      case 'start-camera': startCamera(); break;
      case 'stop-camera': stopCamera(); break;
      case 'ask-ai': askAiByName(el.dataset.q); break;
      case 'voice': {
        const input = document.getElementById(el.dataset.target);
        startVoice(el, (text) => {
          input.value = text;
          if (el.dataset.target === 'search-input') updateSearchResults(text, true);
          else submitIx(text);
        });
        break;
      }
      case 'opt-shape':
        state.identify.shape = state.identify.shape === el.dataset.value ? null : el.dataset.value;
        updateIdentifyResults(); break;
      case 'opt-color':
        state.identify.color = state.identify.color === el.dataset.value ? null : el.dataset.value;
        updateIdentifyResults(); break;
      case 'clear-identify':
        state.identify = { shape: null, color: null, imprint: '' };
        $('#imprint-input').value = '';
        updateIdentifyResults(); break;
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
      default: break;
    }
  });

  // drag & drop a photo onto the identify / scan screens (desktop)
  document.addEventListener('dragover', (e) => {
    const r = parseRoute().name;
    if (r === 'identify' || r === 'scan') e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    const r = parseRoute().name;
    if (r !== 'identify' && r !== 'scan') return;
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    state.pendingPhoto = { mode: r === 'scan' ? 'package' : 'pill' };
    handlePhotoFile(file);
  });

  window.addEventListener('pagehide', () => { stopCamera(); stopSpeaking(); });

  // ------------------------------------------------------------------
  // Start
  // ------------------------------------------------------------------
  navStack.push(currentHash());
  applyPrefs();
  render(false);

  // exposed for tests / debugging
  window.AIPill = { searchDrugs, identifyMatches, checkInteractions, parseExpiry, handleCode, state, CONFIG };
})();
