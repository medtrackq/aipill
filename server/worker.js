/**
 * AI Pill – Claude proxy (Cloudflare Worker)
 * ------------------------------------------------------------
 * Lets the web app use Claude without any API key in the browser.
 * The key lives only here, as the Worker secret ANTHROPIC_API_KEY.
 *
 * What it allows
 *   - POST /v1/messages from the app's own web address (ALLOWED_ORIGINS)
 *   - only the request shape the app sends: one model from MODELS, text and
 *     base64 images, structured JSON output, effort low/medium, no tools,
 *     no streaming, max_tokens ≤ 16000, body ≤ 8 MB
 *   - only the beta header the app uses (server-side refusal fallback)
 * Spending limits (needs the KV namespace bound as USAGE)
 *   - DAILY_LIMIT_PER_DEVICE requests per device per day (UTC)
 *   - DAILY_LIMIT_TOTAL requests per day for everybody together
 *   When a limit is reached the reply is a 429 that the SDK does not retry.
 * Privacy: nothing about the request content is stored or logged. The
 * device counter key is a salted hash, never the raw device id or IP.
 *
 * Usage statistics (needs the D1 database bound as DB)
 *   - POST /e    anonymous events sent by the app (opened, photo outcome,
 *                search found / not found, drug page, ...): a hashed device
 *                id, language, app or browser, country – never photos,
 *                allergies, IP addresses or anything typed except the words
 *                of a search that found nothing (to know which medicines to add)
 *   - GET /stats summary for the dashboard (stats.html), only with
 *                "Authorization: Bearer <STATS_KEY>"
 *   Every AI request is also counted here (status only). Kept 400 days.
 *
 * Variables (Settings → Variables and Secrets)
 *   ANTHROPIC_API_KEY       secret, required
 *   STATS_KEY               secret, the dashboard password
 *   ALLOWED_ORIGINS         e.g. "https://app.medtrackq.com" (comma separated)
 *   MODELS                  default "claude-opus-5-5"
 *   DAILY_LIMIT_PER_DEVICE  default 20
 *   DAILY_LIMIT_TOTAL       default 100
 */

const UPSTREAM = 'https://api.anthropic.com';
const MAX_BODY = 8 * 1024 * 1024;
const MAX_TOKENS = 16000;
const TOP_KEYS = new Set(['model', 'max_tokens', 'system', 'messages', 'output_config', 'fallbacks']);
const BETAS = new Set(['server-side-fallback-2026-07-01']);
const EFFORTS = new Set(['low', 'medium']);
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const DAY_SECONDS = 86400;
const EVENT_TYPES = new Set(['open', 'photo', 'search', 'drug', 'voice', 'ix', 'allergy', 'camera', 'compare', 'ai_name']);
const KEEP_DAYS = 400;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowed = list(env.ALLOWED_ORIGINS, 'https://app.medtrackq.com');
    const okOrigin = allowed.includes(origin);
    const cors = corsHeaders(okOrigin ? origin : '');

    if (request.method === 'OPTIONS') {
      if (!okOrigin) return new Response(null, { status: 403 });
      cors.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      cors.set('Access-Control-Allow-Headers', request.headers.get('Access-Control-Request-Headers') || 'content-type');
      cors.set('Access-Control-Max-Age', String(DAY_SECONDS));
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === 'GET' && url.pathname === '/') return json({ ok: true, service: 'aipill-proxy' }, 200, cors);
    if (request.method === 'POST' && url.pathname === '/e') return collectEvent(request, env, ctx, okOrigin, cors);
    if (request.method === 'GET' && url.pathname === '/stats') return stats(request, env, ctx, url, cors);
    if (request.method !== 'POST' || url.pathname !== '/v1/messages') return apiError(404, 'not_found_error', 'not found', cors);
    if (url.search && url.search !== '?beta=true') return apiError(400, 'invalid_request_error', 'unsupported query', cors);
    if (!okOrigin) return apiError(403, 'permission_error', 'origin not allowed', cors);
    if (!env.ANTHROPIC_API_KEY) return apiError(500, 'api_error', 'proxy not configured', cors);

    // the request must look exactly like what the app sends
    if (Number(request.headers.get('Content-Length') || 0) > MAX_BODY) return apiError(413, 'request_too_large', 'request too large', cors);
    const raw = await request.text();
    if (raw.length > MAX_BODY) return apiError(413, 'request_too_large', 'request too large', cors);
    let body;
    try { body = JSON.parse(raw); } catch (e) { return apiError(400, 'invalid_request_error', 'invalid JSON', cors); }
    const problem = checkBody(body, list(env.MODELS, 'claude-opus-5-5'));
    if (problem) return apiError(400, 'invalid_request_error', problem, cors);
    const betas = list(request.headers.get('anthropic-beta'), '');
    if (betas.some((b) => !BETAS.has(b))) return apiError(400, 'invalid_request_error', 'beta not allowed', cors);
    const version = request.headers.get('anthropic-version') || '2023-06-01';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) return apiError(400, 'invalid_request_error', 'bad anthropic-version', cors);

    // daily limits
    const over = await takeQuota(env, request);
    if (over) {
      later(ctx, logEvent(env, { type: 'ai', k: `quota_${over}`, d: request.headers.get('x-aipill-device'), country: country(request) }));
      cors.set('x-should-retry', 'false');
      return apiError(429, 'rate_limit_error', `aipill_quota_${over}`, cors);
    }

    const headers = { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': version };
    if (betas.length) headers['anthropic-beta'] = betas.join(',');
    let upstream;
    try {
      upstream = await fetch(`${UPSTREAM}/v1/messages${url.search}`, { method: 'POST', headers, body: raw });
    } catch (e) {
      later(ctx, logEvent(env, { type: 'ai', k: 'unreachable', d: request.headers.get('x-aipill-device'), country: country(request) }));
      return apiError(502, 'api_error', 'upstream unreachable', cors);
    }
    later(ctx, logEvent(env, { type: 'ai', k: String(upstream.status), d: request.headers.get('x-aipill-device'), country: country(request) }));
    const out = new Headers(cors);
    out.set('content-type', upstream.headers.get('content-type') || 'application/json');
    for (const h of ['request-id', 'retry-after', 'x-should-retry']) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
};

function checkBody(b, models) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return 'body must be an object';
  for (const k of Object.keys(b)) if (!TOP_KEYS.has(k)) return `field not allowed: ${k}`;
  if (!models.includes(b.model)) return 'model not allowed';
  if (!Number.isInteger(b.max_tokens) || b.max_tokens < 1 || b.max_tokens > MAX_TOKENS) return 'max_tokens out of range';
  if (b.system !== undefined && typeof b.system !== 'string') return 'system must be text';
  if ('fallbacks' in b && b.fallbacks !== 'default') return 'fallbacks not allowed';
  const oc = b.output_config;
  if (oc !== undefined) {
    if (!oc || typeof oc !== 'object') return 'bad output_config';
    for (const k of Object.keys(oc)) if (k !== 'effort' && k !== 'format') return `output_config field not allowed: ${k}`;
    if (oc.effort !== undefined && !EFFORTS.has(oc.effort)) return 'effort not allowed';
    if (oc.format !== undefined && (!oc.format || oc.format.type !== 'json_schema')) return 'format not allowed';
  }
  if (!Array.isArray(b.messages) || b.messages.length < 1 || b.messages.length > 2) return 'bad messages';
  let images = 0;
  for (const m of b.messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return 'bad message role';
    const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content;
    if (!Array.isArray(parts) || !parts.length) return 'bad message content';
    for (const p of parts) {
      if (p && p.type === 'text' && typeof p.text === 'string') continue;
      if (p && p.type === 'image' && p.source && p.source.type === 'base64' && IMAGE_TYPES.has(p.source.media_type) && typeof p.source.data === 'string') {
        images++;
        continue;
      }
      return 'content type not allowed';
    }
  }
  if (images > 2) return 'too many images';
  return '';
}

// Counts one request against the device and the overall daily limits.
// Returns "device" or "total" when a limit is reached, "" otherwise.
// KV is eventually consistent, so the limits are approximate.
async function takeQuota(env, request) {
  if (!env.USAGE) return '';
  const day = new Date().toISOString().slice(0, 10);
  const perDevice = num(env.DAILY_LIMIT_PER_DEVICE, 20);
  const total = num(env.DAILY_LIMIT_TOTAL, 100);
  const who = request.headers.get('x-aipill-device') || request.headers.get('CF-Connecting-IP') || 'unknown';
  const kAll = `all:${day}`;
  const kDev = `dev:${day}:${await hash(`${who}|aipill`)}`;
  const [a, d] = await Promise.all([env.USAGE.get(kAll), env.USAGE.get(kDev)]);
  const nAll = Number(a) || 0, nDev = Number(d) || 0;
  if (nAll >= total) return 'total';
  if (nDev >= perDevice) return 'device';
  const ttl = { expirationTtl: 2 * DAY_SECONDS };
  await Promise.all([env.USAGE.put(kAll, String(nAll + 1), ttl), env.USAGE.put(kDev, String(nDev + 1), ttl)]);
  return '';
}

// ---------------- usage statistics ----------------
// Thai calendar day (UTC+7), so "today" matches the dashboard reader's day
function dayOf(ms) { return new Date(ms + 7 * 3600 * 1000).toISOString().slice(0, 10); }
function country(request) { return (request.cf && request.cf.country) || ''; }
function later(ctx, promise) {
  const p = Promise.resolve(promise).catch(() => {});
  if (ctx && ctx.waitUntil) ctx.waitUntil(p);
  return p;
}
let schemaReady = null;
function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.batch([
      db.prepare('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, ts INTEGER, day TEXT, type TEXT, dev TEXT, lang TEXT, mode TEXT, country TEXT, k TEXT, v TEXT)'),
      db.prepare('CREATE INDEX IF NOT EXISTS events_day ON events (day, type)')
    ]).catch((e) => { schemaReady = null; throw e; });
  }
  return schemaReady;
}
const clip = (x, n) => String(x == null ? '' : x).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
async function logEvent(env, e) {
  if (!env.DB) return;
  await ensureSchema(env.DB);
  const now = Date.now();
  const dev = e.d ? await hash(`${clip(e.d, 80)}|aipill`) : '';
  await env.DB.prepare('INSERT INTO events (ts, day, type, dev, lang, mode, country, k, v) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(now, dayOf(now), e.type, dev, clip(e.lang, 5), clip(e.mode, 5), clip(e.country, 4), clip(e.k, 40), clip(e.v, 60)).run();
}
async function collectEvent(request, env, ctx, okOrigin, cors) {
  const done = new Response(null, { status: 204, headers: cors });
  if (!okOrigin || !env.DB) return done;
  const raw = await request.text();
  if (raw.length > 2048) return done;
  let e;
  try { e = JSON.parse(raw); } catch (err) { return done; }
  if (!e || !EVENT_TYPES.has(e.t)) return done;
  later(ctx, logEvent(env, {
    type: e.t, k: e.k, v: e.v, d: e.d, country: country(request),
    lang: ['th', 'en', 'zh'].includes(e.l) ? e.l : '', mode: e.m === 'app' ? 'app' : 'web'
  }));
  return done;
}
async function stats(request, env, ctx, url, cors) {
  const key = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.STATS_KEY) return apiError(503, 'api_error', 'stats not configured: add the STATS_KEY secret', cors);
  if (!key || key !== env.STATS_KEY) return apiError(401, 'authentication_error', 'wrong password', cors);
  if (!env.DB) return apiError(503, 'api_error', 'stats not configured: bind the D1 database as DB', cors);
  await ensureSchema(env.DB);
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 30, 1), 365);
  const now = Date.now();
  const since = dayOf(now - (days - 1) * DAY_SECONDS * 1000);
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results || []);
  const [daily, newByDay, range, allTime, returning, features, photo, drugs, missed, modes, langs, countries, referrers, ai] = await Promise.all([
    q(`SELECT day, COUNT(DISTINCT CASE WHEN type != 'ai' THEN dev END) AS people, SUM(type = 'open') AS opens, SUM(type = 'photo') AS photos,
       SUM(type = 'search') AS searches, SUM(type = 'drug') AS drugs, SUM(type = 'ai' AND k = '200') AS ai
       FROM events WHERE day >= ? GROUP BY day ORDER BY day`, since),
    q(`SELECT first AS day, COUNT(*) AS n FROM (SELECT dev, MIN(day) AS first FROM events WHERE dev != '' AND type != 'ai' GROUP BY dev)
       WHERE first >= ? GROUP BY first ORDER BY first`, since),
    q(`SELECT COUNT(DISTINCT dev) AS people FROM events WHERE day >= ? AND dev != '' AND type != 'ai'`, since),
    q(`SELECT COUNT(DISTINCT dev) AS people, MIN(day) AS since FROM events WHERE dev != '' AND type != 'ai'`),
    q(`SELECT COUNT(*) AS n FROM (SELECT dev FROM events WHERE day >= ? AND dev != '' AND type != 'ai' GROUP BY dev HAVING COUNT(DISTINCT day) > 1)`, since),
    q(`SELECT type AS k, COUNT(*) AS n, COUNT(DISTINCT dev) AS people FROM events WHERE day >= ? AND type != 'ai' GROUP BY type ORDER BY n DESC`, since),
    q(`SELECT k, COUNT(*) AS n FROM events WHERE type = 'photo' AND day >= ? GROUP BY k ORDER BY n DESC`, since),
    q(`SELECT k, COUNT(*) AS n FROM events WHERE type = 'drug' AND day >= ? GROUP BY k ORDER BY n DESC LIMIT 12`, since),
    q(`SELECT v AS k, COUNT(*) AS n FROM events WHERE type = 'search' AND k = 'miss' AND v != '' AND day >= ? GROUP BY v ORDER BY n DESC LIMIT 20`, since),
    q(`SELECT mode AS k, COUNT(DISTINCT dev) AS n FROM events WHERE type = 'open' AND day >= ? GROUP BY mode ORDER BY n DESC`, since),
    q(`SELECT lang AS k, COUNT(DISTINCT dev) AS n FROM events WHERE type = 'open' AND day >= ? GROUP BY lang ORDER BY n DESC`, since),
    q(`SELECT country AS k, COUNT(DISTINCT dev) AS n FROM events WHERE type = 'open' AND day >= ? GROUP BY country ORDER BY n DESC LIMIT 10`, since),
    q(`SELECT k, COUNT(DISTINCT dev) AS n FROM events WHERE type = 'open' AND k != '' AND day >= ? GROUP BY k ORDER BY n DESC LIMIT 10`, since),
    q(`SELECT k, COUNT(*) AS n FROM events WHERE type = 'ai' AND day >= ? GROUP BY k ORDER BY n DESC`, since)
  ]);
  later(ctx, env.DB.prepare('DELETE FROM events WHERE ts < ?').bind(now - KEEP_DAYS * DAY_SECONDS * 1000).run());
  const out = new Headers(cors);
  out.set('Cache-Control', 'no-store');
  return json({
    generated: new Date(now).toISOString(), today: dayOf(now), since, days,
    people: (range[0] || {}).people || 0, returning: (returning[0] || {}).n || 0,
    allTime: { people: (allTime[0] || {}).people || 0, since: (allTime[0] || {}).since || null },
    daily, newByDay, features, photo, drugs, missed, modes, langs, countries, referrers, ai
  }, 200, out);
}

async function hash(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].slice(0, 12).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function list(value, fallback) {
  return String(value || fallback).split(',').map((s) => s.trim()).filter(Boolean);
}
function num(value, fallback) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}
function corsHeaders(origin) {
  const h = new Headers({ Vary: 'Origin' });
  if (origin) {
    h.set('Access-Control-Allow-Origin', origin);
    h.set('Access-Control-Expose-Headers', 'request-id, retry-after, x-should-retry');
  }
  return h;
}
function json(data, status, cors) {
  const h = new Headers(cors);
  h.set('content-type', 'application/json');
  return new Response(JSON.stringify(data), { status, headers: h });
}
// errors in the Anthropic API's own shape, so the SDK raises its usual classes
function apiError(status, type, message, cors) {
  return json({ type: 'error', error: { type, message } }, status, cors);
}
