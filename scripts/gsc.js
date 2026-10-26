#!/usr/bin/env node
// gsc.js — Google Search Console (Search Analytics) client. Prints JSON to stdout. No dependencies.
//
//   node gsc.js check                                   token + property access; prints site, permission, data lag
//   node gsc.js sites                                   properties the service account can see
//   node gsc.js query    --from YYYY-MM-DD --to YYYY-MM-DD [--dims page,query] [--page /path] [--query-contains s] [--rows 5000]
//   node gsc.js page     --path /slug [--days 28] [--end YYYY-MM-DD] [--baseline-end YYYY-MM-DD]   window vs prior window + top queries
//   node gsc.js site     [--days 28] [--end YYYY-MM-DD] [--save seo/data/gsc]   every page: now vs prior, decaying flags, striking queries, top 500 queries
//   node gsc.js striking [--days 28] [--min-impressions N] [--pos 8-20]         queries we rank 8–20 for with real impressions
//                        (floor defaults to site impressions ÷ 50, clamped 10–100, so small sites still get rows)
//   node gsc.js decaying [--days 28] [--drop 30]                                pages whose impressions fell ≥ drop% vs the prior window
//   node gsc.js extract  --kind page|site --input fixture.json [--path /slug]   re-run an aggregator on saved responses (tests)
//
// Auth: service account. GSC_SA_JSON (the JSON, one line) or GSC_SA_FILE (path to it). Add the account's
// client_email to the property in Search Console (Settings → Users and permissions, Full or Restricted).
// Property: --site, else GSC_SITE, else sc-domain:<domain> / https://<domain>/ from seo/brand.json (first one the account can see).
// Page URLs: --origin, else GSC_ORIGIN, else https://<domain>. Data lags ~3 days: the default --end is today − 3.
// Exit codes: 0 ok · 1 API error (JSON {error} on stdout) · 2 usage/credentials.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const tls = require('tls');

const API = 'https://www.googleapis.com/webmasters/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const LAG_DAYS = 3;

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

async function main() {
  if (!cmd || args.help) usage();
  if (cmd === 'extract') return out(extract(args.kind, JSON.parse(fs.readFileSync(args.input, 'utf8'))));

  const sa = loadServiceAccount();
  const token = await accessToken(sa);
  if (cmd === 'sites') return out({ sites: await listSites(token) });
  const site = await resolveSite(token);
  const days = Number(args.days || 28);
  const end = args.end || isoDate(addDays(today(), -LAG_DAYS));

  switch (cmd) {
    case 'check': {
      const sites = await listSites(token);
      const mine = sites.find(s => s.siteUrl === site);
      if (!mine) return fail(`service account ${sa.client_email} cannot see ${site}; sites visible: ${sites.map(s => s.siteUrl).join(', ') || 'none'}`, 2);
      const probe = await query(token, site, { from: isoDate(addDays(today(), -LAG_DAYS - 7)), to: end, dims: [] });
      return out({ ok: true, site, account: sa.client_email, permission: mine.permissionLevel, lag_days: LAG_DAYS, last_7d: probe[0] ? norm(probe[0], []) : { clicks: 0, impressions: 0 } });
    }
    case 'query': {
      if (!args.from || !args.to) usage('query needs --from and --to');
      const dims = (args.dims ? String(args.dims).split(',') : ['page']).map(s => s.trim()).filter(Boolean);
      const rows = await query(token, site, { from: args.from, to: args.to, dims, page: args.page && pageUrl(site, args.page), queryContains: args['query-contains'], rows: args.rows });
      return out({ site, from: args.from, to: args.to, dims, rows: rows.map(r => norm(r, dims)) });
    }
    case 'page': {
      if (!args.path) usage('page needs --path');
      const url = pageUrl(site, args.path);
      const cur = window(end, days);
      const base = args['baseline-end'] ? window(args['baseline-end'], days) : window(isoDate(addDays(cur.from, -1)), days);
      const [current, prior, queries] = await Promise.all([
        query(token, site, { from: cur.from, to: cur.to, dims: [], page: url }),
        query(token, site, { from: base.from, to: base.to, dims: [], page: url }),
        query(token, site, { from: cur.from, to: cur.to, dims: ['query'], page: url, rows: 50 }),
      ]);
      return out({ site, path: args.path, url, ...aggregatePage({ current, prior, queries }, cur, base) });
    }
    case 'site': case 'striking': case 'decaying': {
      const cur = window(end, days);
      const base = window(isoDate(addDays(cur.from, -1)), days);
      const [current, prior, queries] = await Promise.all([
        query(token, site, { from: cur.from, to: cur.to, dims: ['page'], rows: 5000 }),
        query(token, site, { from: base.from, to: base.to, dims: ['page'], rows: 5000 }),
        query(token, site, { from: cur.from, to: cur.to, dims: ['query', 'page'], rows: 25000 }),
      ]);
      const res = aggregateSite({ current, prior, queries }, cur, base, site, {
        minImpressions: args['min-impressions'] ? Number(args['min-impressions']) : null, pos: parseRange(args.pos || '8-20'), drop: Number(args.drop || 30),
      });
      if (cmd === 'striking') return out({ site, window: res.window, striking: res.striking });
      if (cmd === 'decaying') return out({ site, window: res.window, decaying: res.pages.filter(p => p.decaying) });
      if (args.save) {
        const file = path.join(String(args.save), `${end}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(res, null, 1));
        res.saved = file;
      }
      return out(res);
    }
    default: usage(`unknown command: ${cmd}`);
  }
}

// ---------- aggregation (pure; also used by `extract`) ----------

function extract(kind, fx) {
  const cur = fx.window || window('2026-10-21', 28);
  const base = fx.baseline || window(isoDate(addDays(cur.from, -1)), 28);
  if (kind === 'page') return { path: args.path || fx.path || null, ...aggregatePage(fx, cur, base) };
  if (kind === 'site') return aggregateSite(fx, cur, base, fx.site || 'sc-domain:example.com', { minImpressions: null, pos: [8, 20], drop: 30 });
  usage('extract --kind page|site');
}

function aggregatePage({ current, prior, queries }, cur, base) {
  const c = total(current), p = total(prior);
  const top = (queries || []).map(r => norm(r, ['query'])).sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks).slice(0, 10);
  return {
    window: cur, baseline: base,
    current: c, prior: p,
    delta: delta(c, p),
    top_queries: top,
    note: c.impressions === 0 && p.impressions === 0 ? 'no impressions in either window' : c.impressions === 0 ? 'no impressions in the current window' : p.impressions === 0 ? 'no baseline (new page)' : null,
  };
}

function aggregateSite({ current, prior, queries }, cur, base, site, opt) {
  if (opt.minImpressions == null) {
    const imps = (current || []).reduce((a, r) => a + (r.impressions || 0), 0) + (prior || []).reduce((a, r) => a + (r.impressions || 0), 0);
    opt = { ...opt, minImpressions: Math.min(100, Math.max(10, Math.round(imps / 2 / 50))) };
  }
  const origin = siteOrigin(site);
  const toPath = u => { try { const x = new URL(u); return x.pathname.replace(/\/$/, '') || '/'; } catch { return u; } };
  const priorBy = new Map((prior || []).map(r => [toPath(r.keys[0]), norm(r, [])]));
  const pages = (current || []).map(r => {
    const now = norm(r, []), was = priorBy.get(toPath(r.keys[0])) || { clicks: 0, impressions: 0, ctr: 0, position: null };
    const d = delta(now, was);
    return { path: toPath(r.keys[0]), url: r.keys[0], ...now, prior: was, delta: d, decaying: was.impressions >= opt.minImpressions && d.impressions_pct !== null && d.impressions_pct <= -opt.drop };
  });
  for (const [p, was] of priorBy) if (!pages.find(x => x.path === p)) pages.push({ path: p, url: null, clicks: 0, impressions: 0, ctr: 0, position: null, prior: was, delta: delta({ clicks: 0, impressions: 0 }, was), decaying: was.impressions >= opt.minImpressions });
  pages.sort((a, b) => b.impressions - a.impressions);
  const striking = (queries || []).map(r => ({ query: r.keys[0], page: toPath(r.keys[1]), ...norm(r, []) }))
    .filter(q => q.impressions >= opt.minImpressions && q.position >= opt.pos[0] && q.position <= opt.pos[1])
    .sort((a, b) => b.impressions - a.impressions);
  const topQueries = (queries || []).map(r => ({ query: r.keys[0], page: toPath(r.keys[1]), ...norm(r, []) })).sort((a, b) => b.impressions - a.impressions).slice(0, 500);
  const totals = { current: total(current), prior: total(prior) };
  return { site, origin, window: cur, baseline: base, min_impressions: opt.minImpressions, totals: { ...totals, delta: delta(totals.current, totals.prior) }, pages, striking, top_queries: topQueries, decaying_count: pages.filter(p => p.decaying).length };
}

function norm(r, dims) {
  const o = {};
  dims.forEach((d, i) => { o[d] = r.keys ? r.keys[i] : null; });
  o.clicks = r.clicks || 0; o.impressions = r.impressions || 0;
  o.ctr = round(r.ctr || 0, 4); o.position = r.position == null ? null : round(r.position, 1);
  return o;
}
function total(rows) {
  const t = { clicks: 0, impressions: 0, ctr: 0, position: null }; let wp = 0;
  for (const r of rows || []) { t.clicks += r.clicks || 0; t.impressions += r.impressions || 0; wp += (r.position || 0) * (r.impressions || 0); }
  t.ctr = t.impressions ? round(t.clicks / t.impressions, 4) : 0;
  t.position = t.impressions ? round(wp / t.impressions, 1) : null;
  return t;
}
function delta(now, was) {
  const pct = (a, b) => (b ? round(((a - b) / b) * 100, 0) : (a ? null : 0));
  return { clicks: now.clicks - was.clicks, clicks_pct: pct(now.clicks, was.clicks), impressions: now.impressions - was.impressions, impressions_pct: pct(now.impressions, was.impressions), position: now.position != null && was.position != null ? round(now.position - was.position, 1) : null };
}

// ---------- API ----------

async function query(token, site, { from, to, dims, page, queryContains, rows }) {
  const body = { startDate: from, endDate: to, dimensions: dims, rowLimit: Math.min(Number(rows || 5000), 25000), startRow: 0, dataState: 'final' };
  const filters = [];
  if (page) filters.push({ dimension: 'page', operator: 'equals', expression: page });
  if (queryContains) filters.push({ dimension: 'query', operator: 'contains', expression: queryContains });
  if (filters.length) body.dimensionFilterGroups = [{ filters }];
  const all = [];
  for (;;) {
    const res = await call(token, `${API}/sites/${encodeURIComponent(site)}/searchAnalytics/query`, body);
    const batch = res.rows || [];
    all.push(...batch);
    if (batch.length < body.rowLimit || all.length >= 25000) break;
    body.startRow += body.rowLimit;
  }
  return all;
}
async function listSites(token) {
  const res = await call(token, `${API}/sites`);
  return (res.siteEntry || []).map(s => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel }));
}
async function call(token, url, body) {
  const res = await request(url, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = res.text;
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${res.status} ${url.replace(API, '')}: ${json.error?.message || text.slice(0, 200)}`);
  return json;
}
// HTTPS request that honours https_proxy / HTTPS_PROXY / all_proxy (CONNECT tunnel), which Node's fetch ignores.
// Returns { ok, status, text }.
function request(url, { method = 'GET', headers = {}, body } = {}) {
  const u = new URL(url);
  const proxy = proxyFor(u.hostname);
  const opts = { method, headers: { ...headers, host: u.host, 'content-length': body ? Buffer.byteLength(body) : 0 }, timeout: 30000 };
  return new Promise((resolve, reject) => {
    const send = (socket) => {
      const req = https.request({ ...opts, host: u.hostname, path: u.pathname + u.search, servername: u.hostname, ...(socket ? { createConnection: () => socket } : {}) }, (res) => {
        const chunks = []; res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error(`timeout after 30s: ${u.host}`)));
      req.on('error', (e) => reject(new Error(`${u.host}: ${e.message}${proxy ? ` (via proxy ${proxy.host})` : ''}`)));
      if (body) req.write(body);
      req.end();
    };
    if (!proxy) return send(null);
    const conn = http.request({ host: proxy.hostname, port: proxy.port || 80, method: 'CONNECT', path: `${u.hostname}:443`, headers: { host: `${u.hostname}:443`, ...(proxy.username ? { 'proxy-authorization': 'Basic ' + Buffer.from(decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password)).toString('base64') } : {}) }, timeout: 15000 });
    conn.on('connect', (res, socket) => {
      if (res.statusCode !== 200) return reject(new Error(`proxy ${proxy.host} refused CONNECT ${u.hostname}: ${res.statusCode}`));
      send(tls.connect({ socket, servername: u.hostname }));
    });
    conn.on('timeout', () => conn.destroy(new Error(`proxy ${proxy.host}: connect timeout`)));
    conn.on('error', (e) => reject(new Error(`proxy ${proxy.host}: ${e.message}`)));
    conn.end();
  });
}
function proxyFor(hostname) {
  const noProxy = (process.env.no_proxy || process.env.NO_PROXY || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (noProxy.some((n) => n === '*' || hostname === n || hostname.endsWith(n.startsWith('.') ? n : '.' + n))) return null;
  const raw = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.all_proxy || process.env.ALL_PROXY;
  if (!raw) return null;
  const p = new URL(/^\w+:\/\//.test(raw) ? raw : 'http://' + raw);
  if (!/^https?:$/.test(p.protocol)) return null; // socks proxies are not supported; set https_proxy to the http port
  return p;
}

async function resolveSite(token) {
  if (args.site) return String(args.site);
  if (process.env.GSC_SITE) return process.env.GSC_SITE;
  const domain = brandDomain();
  if (!domain) return fail('no property: pass --site, set GSC_SITE, or put "domain" in seo/brand.json', 2);
  const sites = await listSites(token);
  const cands = [`sc-domain:${domain}`, `https://${domain}/`, `https://www.${domain}/`];
  const hit = cands.find(c => sites.some(s => s.siteUrl === c));
  return hit || cands[0];
}
function siteOrigin(site) {
  if (args.origin) return String(args.origin).replace(/\/$/, '');
  if (process.env.GSC_ORIGIN) return process.env.GSC_ORIGIN.replace(/\/$/, '');
  if (site.startsWith('sc-domain:')) return `https://${site.slice(10)}`;
  return site.replace(/\/$/, '');
}
function pageUrl(site, p) { return /^https?:/.test(p) ? p : `${siteOrigin(site)}${p.startsWith('/') ? p : '/' + p}`; }
function brandDomain() {
  try { return JSON.parse(fs.readFileSync(path.join('seo', 'brand.json'), 'utf8')).domain || null; } catch { return null; }
}

// ---------- auth ----------

function loadServiceAccount() {
  let raw = process.env.GSC_SA_JSON;
  if (!raw && process.env.GSC_SA_FILE) raw = fs.readFileSync(process.env.GSC_SA_FILE, 'utf8');
  if (!raw) return fail('no credentials: set GSC_SA_JSON (service-account JSON) or GSC_SA_FILE (path)', 2);
  let sa; try { sa = JSON.parse(raw); } catch { return fail('GSC_SA_JSON is not valid JSON', 2); }
  if (!sa.client_email || !sa.private_key) return fail('service-account JSON needs client_email and private_key', 2);
  return sa;
}
async function accessToken(sa) {
  const jwt = signJwt(sa);
  const res = await request(TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }).toString() });
  let json; try { json = JSON.parse(res.text); } catch { json = {}; }
  if (!res.ok || !json.access_token) throw new Error(`token: ${json.error_description || json.error || res.status}`);
  return json.access_token;
}
function signJwt(sa, now = Math.floor(Date.now() / 1000)) {
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  return `${unsigned}.${sig}`;
}

// ---------- helpers ----------

function window(end, days) { const to = parseDate(end); return { from: isoDate(addDays(to, -(days - 1))), to: isoDate(to), days }; }
function parseRange(s) { const [a, b] = String(s).split('-').map(Number); return [a, b ?? a]; }
function today() { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
function parseDate(s) { if (s instanceof Date) return s; const [y, m, d] = String(s).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function addDays(d, n) { const x = new Date(parseDate(d)); x.setUTCDate(x.getUTCDate() + n); return x; }
function isoDate(d) { return parseDate(d).toISOString().slice(0, 10); }
function round(n, p) { const f = 10 ** p; return Math.round(n * f) / f; }
function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }
function fail(msg, code) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(code); }
function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]; if (!k.startsWith('--')) continue;
    const name = k.slice(2), next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[name] = true; else { a[name] = next; i++; }
  }
  return a;
}
function usage(msg) {
  if (msg) process.stderr.write(msg + '\n');
  process.stderr.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 18).map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
  process.exit(2);
}

module.exports = { aggregatePage, aggregateSite, signJwt, window };
if (require.main === module) main().catch(e => { const cause = e.cause && e.cause.message ? ` (${e.cause.message})` : ""; process.stdout.write(JSON.stringify({ error: String(e.message || e) + cause }) + "\n"); process.exit(1); });
