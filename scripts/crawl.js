#!/usr/bin/env node
// crawl.js — live-site audit crawler for the `audit` skill. No dependencies.
//
//   node crawl.js --origin https://example.com [--root .] [--max 500] [--external 200] [--concurrency 4]
//                 [--delay 150] [--cwv] [--save seo/data/crawl] [--diff <previous.json>] [--quiet]
//   node crawl.js --check <url> [<url>…]            one request per URL: status, final URL, redirect hops
//
// Crawls same-origin HTML pages from / + the live sitemap + seo/inventory.json paths (breadth-first, ≤ --max),
// checks every external link once (≤ --external), optionally asks PageSpeed Insights for Core Web Vitals on the
// home page and cluster hubs (--cwv; PAGESPEED_API_KEY optional), and prints one JSON document:
//   { generated, origin, pages: [{path, status, final, hops, title, description, canonical, noindex, h1s, words,
//                                 links_in, links_out, images_no_alt, ms, in_sitemap, kind, file}],
//     findings: [{code, severity: fix|report, path, file?, msg, to?}], external: [{url, status, from: [paths]}],
//     cwv: [{path, lcp_ms, cls, inp_ms, perf, source}], sitemap: {url, count, missing: [paths]},
//     summary: {pages, findings_by_code}, diff?: {new: [...], resolved: [...], previous} }
// Finding codes — fixable on an article page (file known): title, description, canonical, alt, link (broken or
// redirecting internal link), sitemap. Report-only: broken-external, redirect-chain, duplicate-title,
// duplicate-description, noindex-in-sitemap, sitemap-404, orphan, thin, h1, mixed-content, slow, server-error,
// external-redirect (a path that hands off to another site, e.g. OAuth), auth-redirect (a login-gated route).
// Honours https_proxy / HTTPS_PROXY (CONNECT tunnel) like gsc.js. Polite: one UA, --delay ms between requests per worker.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const tls = require('tls');

const UA = 'seo-agent-audit/0.1 (+https://github.com/staticmaker/seo-agent)';
const IGNORE_PATH = /^\/cdn-cgi\//;
const AUTH_RE = /^\/(login|log-in|signin|sign-in|auth|oauth|register|sign-up|signup)(\/|\?|$)/i;
const HTML_RE = /text\/html|application\/xhtml/i;

async function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.check) {
    const urls = [a.check, ...a._].filter(Boolean);
    const out = [];
    for (const u of urls) out.push(await follow(u));
    return print(out);
  }
  const root = path.resolve(a.root || '.');
  const origin = (a.origin || originFromRepo(root) || '').replace(/\/$/, '');
  if (!origin) return fail('no origin: pass --origin https://… or put "domain" in seo/brand.json', 2);
  const inv = readJson(path.join(root, 'seo/inventory.json')) || { pages: [] };
  const strategy = readIf(path.join(root, 'seo/strategy.md')) || '';
  const result = await crawl({ origin, inv, strategy, max: num(a.max, 500), external: num(a.external, 200), concurrency: num(a.concurrency, 4), delay: num(a.delay, 150), cwv: !!a.cwv, quiet: !!a.quiet });
  if (a.diff) {
    const prev = readJson(path.resolve(a.diff));
    if (prev) result.diff = diffFindings(prev, result, path.basename(a.diff));
  }
  if (a.save) {
    const dir = path.resolve(root, String(a.save)); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${result.generated.slice(0, 10)}.json`);
    fs.writeFileSync(file, JSON.stringify(result, null, 1) + '\n');
    result.saved = path.relative(root, file);
  }
  print(result);
}

// ---------------------------------------------------------------- crawl

async function crawl({ origin, inv, strategy, max, external, concurrency, delay, cwv, quiet }) {
  const o = new URL(origin);
  const invByPath = new Map((inv.pages || []).map(p => [norm(p.path), p]));
  const floor = wordFloor(strategy);
  const hubs = clusterHubs(strategy);
  const log = quiet ? () => {} : (m) => process.stderr.write(m + '\n');

  // sitemap
  const sitemap = { url: `${origin}/sitemap.xml`, count: 0, paths: [], missing: [] };
  try {
    const r = await follow(sitemap.url);
    if (r.status === 200) {
      const locs = [...r.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
      const nested = locs.filter(l => /\.xml(\?|$)/.test(l));
      let all = locs.filter(l => !/\.xml(\?|$)/.test(l));
      for (const n of nested.slice(0, 20)) { try { const rr = await follow(n); all.push(...[...rr.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1])); } catch {} }
      sitemap.paths = [...new Set(all.map(l => { try { const u = new URL(l); return u.host === o.host ? norm(u.pathname) : null; } catch { return null; } }).filter(Boolean))];
      sitemap.count = sitemap.paths.length;
    } else sitemap.error = `status ${r.status}`;
  } catch (e) { sitemap.error = e.message; }

  const queue = [];
  const seen = new Set();
  const enqueue = (p, from) => { const k = norm(p); if (!k || seen.has(k)) return; seen.add(k); queue.push({ path: k, from }); };
  enqueue('/', null);
  for (const p of sitemap.paths) enqueue(p, 'sitemap');
  for (const p of invByPath.keys()) enqueue(p, 'inventory');

  const pages = new Map();     // path → page record
  const inbound = new Map();   // path → Set(from paths)
  const externals = new Map(); // url → {status, from:Set}
  let active = 0, idx = 0;

  const worker = async () => {
    while (idx < queue.length && pages.size + active < max) {
      const item = queue[idx++]; active++;
      try {
        const rec = await fetchPage(origin, item.path, delay);
        rec.in_sitemap = sitemap.paths.includes(item.path);
        const ip = invByPath.get(item.path); if (ip) { rec.kind = ip.kind; rec.file = ip.file; }
        pages.set(item.path, rec);
        log(`${rec.status} ${item.path}${rec.hops ? ` → ${rec.final}` : ''} (${rec.ms}ms)`);
        for (const l of rec.links_out) {
          if (l.internal) { enqueue(l.path, item.path); if (!inbound.has(l.path)) inbound.set(l.path, new Set()); if (l.path !== item.path) inbound.get(l.path).add(item.path); }
          else { if (!externals.has(l.url)) externals.set(l.url, { url: l.url, status: null, from: new Set() }); externals.get(l.url).from.add(item.path); }
        }
      } catch (e) { pages.set(item.path, { path: item.path, status: 0, error: e.message, links_out: [], h1s: [], images_no_alt: 0, words: 0, ms: 0 }); log(`ERR ${item.path}: ${e.message}`); }
      active--;
    }
  };
  // breadth-first-ish: workers pull from a shared queue that grows as pages are parsed
  let rounds = 0;
  while (idx < queue.length && pages.size < max && rounds++ < 10000) await Promise.all(Array.from({ length: concurrency }, worker));

  // external links (HEAD then GET fallback), capped
  const extList = [...externals.values()].slice(0, external);
  for (let i = 0; i < extList.length; i += concurrency) {
    await Promise.all(extList.slice(i, i + concurrency).map(async (x) => { try { const r = await follow(x.url, { method: 'HEAD', maxHops: 5 }); x.status = r.status; x.final = r.final; if (r.status === 405 || r.status === 403 || r.status === 0) { const g = await follow(x.url, { method: 'GET', maxHops: 5, bodyLimit: 1024 }); x.status = g.status; x.final = g.final; } } catch (e) { x.status = 0; x.error = e.message; } await sleep(delay); }));
  }

  // ---------------------------------------------------------------- findings
  const findings = [];
  const add = (code, page, msg, extra = {}) => findings.push({ code, severity: FIXABLE.has(code) && page.file && ARTICLE_KINDS.has(page.kind) ? 'fix' : 'report', path: page.path, ...(page.file ? { file: page.file } : {}), msg, ...extra });
  const html = [...pages.values()].filter(p => p.status === 200 && p.html);
  const byTitle = group(html, p => (p.title || '').trim().toLowerCase());
  const byDesc = group(html, p => (p.description || '').trim().toLowerCase());

  for (const p of pages.values()) {
    if (p.status === 0) { add('server-error', p, `no response: ${p.error}`); continue; }
    if (p.status >= 500) { add('server-error', p, `status ${p.status}`); continue; }
    if (p.hops && p.final_internal === false) { add('external-redirect', p, `redirects off-site to ${p.final} (${p.hops} hop${p.hops > 1 ? 's' : ''}, ends ${p.status}) — an OAuth or hand-off link, not a fix`); continue; }
    if (p.status === 404 || p.status === 410) {
      for (const from of inbound.get(p.path) || []) { const fp = pages.get(from) || { path: from }; add('link', fp, `internal link ${p.path} returns ${p.status}: repoint or remove`, { to: p.path }); }
      if (p.in_sitemap) add('sitemap-404', p, `sitemap lists ${p.path} but it returns ${p.status}`);
      continue;
    }
    if (p.hops) {
      if (AUTH_RE.test(p.final || '')) { add('auth-redirect', p, `redirects to ${p.final}: a login-gated route, linked on purpose`); continue; }
      if (p.hops >= 2) add('redirect-chain', p, `${p.hops} redirects before ${p.final}`);
      for (const from of inbound.get(p.path) || []) { const fp = pages.get(from) || { path: from }; add('link', fp, `internal link ${p.path} redirects to ${p.final}: link the final URL`, { to: p.path }); }
      continue; // the final URL is crawled as its own page
    }
    if (!p.html) continue;
    if (!p.title) add('title', p, 'no <title>');
    else if (p.title.length > 70) add('title', p, `title is ${p.title.length} chars (max 70)`);
    if (!p.description) add('description', p, 'no meta description');
    else if (p.description.length > 165) add('description', p, `description is ${p.description.length} chars (max 165)`);
    else if (p.description.length < 70) add('description', p, `description is only ${p.description.length} chars`);
    if (p.title && byTitle.get(p.title.trim().toLowerCase()).length > 1) add('duplicate-title', p, `title shared with ${byTitle.get(p.title.trim().toLowerCase()).filter(q => q !== p).map(q => q.path).join(', ')}`);
    if (p.description && byDesc.get(p.description.trim().toLowerCase()).length > 1) add('duplicate-description', p, `description shared with ${byDesc.get(p.description.trim().toLowerCase()).filter(q => q !== p).map(q => q.path).join(', ')}`);
    if (!p.canonical) add('canonical', p, 'no canonical link');
    else { const c = canonPath(p.canonical, o); if (c && c !== p.path) add('canonical', p, `canonical ${p.canonical} ≠ ${p.path}`); }
    if (p.noindex && p.in_sitemap) add('noindex-in-sitemap', p, 'noindex page listed in the sitemap');
    if (p.h1s.length === 0) add('h1', p, 'no h1'); else if (p.h1s.length > 1) add('h1', p, `${p.h1s.length} h1s`);
    if (p.images_no_alt > 0) add('alt', p, `${p.images_no_alt} image(s) without alt`);
    if (p.mixed > 0) add('mixed-content', p, `${p.mixed} http:// resource(s) on an https page`);
    if (p.ms > 4000) add('slow', p, `${p.ms} ms to fetch (measured from the crawler, proxy included)`);
    if (ARTICLE_KINDS.has(p.kind) && floor && p.words < floor) add('thin', p, `${p.words} words, floor ${floor}`);
    if (!p.in_sitemap && !p.noindex && sitemap.count > 0 && (ARTICLE_KINDS.has(p.kind) || p.kind === 'tool')) add('sitemap', p, `${p.path} is not in the sitemap`);
    const inb = inbound.get(p.path) || new Set();
    if (inb.size === 0 && p.path !== '/' && !p.noindex) add('orphan', p, 'no internal link points here' + (p.in_sitemap ? ' (reached via sitemap only)' : ''));
  }
  for (const x of extList) {
    if (x.status === 0 || x.status >= 400) for (const from of x.from) { const fp = pages.get(from) || { path: from }; add('broken-external', fp, `external link ${x.url} → ${x.status || x.error}`, { to: x.url }); }
  }
  sitemap.missing = sitemap.paths.filter(p => !pages.has(p) || pages.get(p).status !== 200);

  // ---------------------------------------------------------------- CWV
  const cwvRows = [];
  if (cwv) {
    const targets = ['/', ...hubs.filter(h => pages.has(h))].slice(0, 5);
    for (const t of targets) { try { cwvRows.push(await pagespeed(`${origin}${t}`)); } catch (e) { cwvRows.push({ path: t, error: e.message }); } }
  }

  const findings_by_code = {}; for (const f of findings) findings_by_code[f.code] = (findings_by_code[f.code] || 0) + 1;
  const pageRows = [...pages.values()].map(p => ({ path: p.path, status: p.status, final: p.final, hops: p.hops || 0, title: p.title, description: p.description, canonical: p.canonical, noindex: !!p.noindex, h1s: p.h1s, words: p.words, links_in: (inbound.get(p.path) || new Set()).size, links_out: p.links_out.length, images_no_alt: p.images_no_alt, ms: p.ms, in_sitemap: !!p.in_sitemap, kind: p.kind || null, file: p.file || null, ...(p.error ? { error: p.error } : {}) }));
  return { generated: new Date().toISOString(), origin, pages: pageRows, findings, external: extList.map(x => ({ url: x.url, status: x.status, final: x.final, from: [...x.from] })), cwv: cwvRows, sitemap: { url: sitemap.url, count: sitemap.count, error: sitemap.error, missing: sitemap.missing }, summary: { pages: pageRows.length, html: html.length, findings: findings.length, fixable: findings.filter(f => f.severity === 'fix').length, findings_by_code, truncated: idx < queue.length } };
}

const FIXABLE = new Set(['title', 'description', 'canonical', 'alt', 'link', 'sitemap']);
const ARTICLE_KINDS = new Set(['guide', 'article', 'tool']);

async function fetchPage(origin, p, delay) {
  const t0 = Date.now();
  const r = await follow(`${origin}${p}`, { method: 'GET', maxHops: 5 });
  await sleep(delay);
  const rec = { path: p, status: r.status, final: r.final && r.final !== `${origin}${p}` ? r.final : undefined, hops: r.hops, ms: Date.now() - t0, html: HTML_RE.test(r.type || ''), links_out: [], h1s: [], images_no_alt: 0, words: 0, mixed: 0 };
  if (rec.final) { try { const fu = new URL(rec.final); rec.final_internal = fu.origin === new URL(origin).origin; rec.final = rec.final_internal ? norm(fu.pathname) + fu.search : rec.final; } catch {} }
  if (rec.status === 200 && rec.html && !rec.hops) Object.assign(rec, parseHtml(r.text, origin, p));
  return rec;
}

function parseHtml(html, origin, pagePath) {
  const o = new URL(origin);
  const head = (html.match(/<head[\s\S]*?<\/head>/i) || [html])[0];
  const title = clean((head.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  const description = clean(meta(head, 'name', 'description'));
  const canonical = attr((head.match(/<link[^>]+rel=["']canonical["'][^>]*>/i) || [])[0] || '', 'href') || null;
  const robots = (meta(head, 'name', 'robots') || '') + ' ' + (meta(head, 'name', 'googlebot') || '');
  const noindex = /noindex/i.test(robots);
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const main = (body.match(/<main[\s\S]*?<\/main>/i) || body.match(/<article[\s\S]*?<\/article>/i) || [body])[0];
  const h1s = [...body.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => clean(m[1]));
  const words = clean(main.replace(/<[^>]+>/g, ' ')).split(/\s+/).filter(w => /[a-z0-9]/i.test(w)).length;
  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const images_no_alt = imgs.filter(t => attr(t, 'alt') === null).length;
  const mixed = o.protocol === 'https:' ? [...body.matchAll(/\b(?:src|href)=["']http:\/\/[^"']+["']/gi)].filter(m => /src=/i.test(m[0])).length : 0;
  const links_out = []; const seenL = new Set();
  for (const m of body.matchAll(/<a\b[^>]*href=["']([^"'#]+)(?:#[^"']*)?["'][^>]*>/gi)) {
    const href = m[1].trim(); if (!href || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let u; try { u = new URL(href, `${origin}${pagePath}`); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    const internal = u.host === o.host;
    const key = internal ? norm(u.pathname) : u.href.replace(/#.*$/, '');
    if (internal && IGNORE_PATH.test(key)) continue; // CDN helpers (Cloudflare email protection) are not site links
    if (seenL.has(key)) continue; seenL.add(key);
    links_out.push(internal ? { internal: true, path: key } : { internal: false, url: key });
  }
  return { title, description, canonical, noindex, h1s, words, images_no_alt, mixed, links_out };
}

// ---------------------------------------------------------------- CWV (PageSpeed Insights)

async function pagespeed(url) {
  const key = process.env.PAGESPEED_API_KEY ? `&key=${process.env.PAGESPEED_API_KEY}` : '';
  const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance${key}`;
  const r = await request(api, { method: 'GET', timeout: 90000 });
  if (r.status !== 200) throw new Error(`pagespeed ${r.status}: ${r.text.slice(0, 120)}`);
  const j = JSON.parse(r.text);
  const field = j.loadingExperience && j.loadingExperience.metrics ? j.loadingExperience.metrics : null;
  const lab = j.lighthouseResult && j.lighthouseResult.audits ? j.lighthouseResult.audits : {};
  const pick = (k) => field && field[k] ? field[k].percentile : null;
  const p = new URL(url).pathname;
  return {
    path: norm(p), source: field ? 'field' : 'lab',
    lcp_ms: pick('LARGEST_CONTENTFUL_PAINT_MS') ?? (lab['largest-contentful-paint'] ? Math.round(lab['largest-contentful-paint'].numericValue) : null),
    cls: pick('CUMULATIVE_LAYOUT_SHIFT_SCORE') != null ? pick('CUMULATIVE_LAYOUT_SHIFT_SCORE') / 100 : (lab['cumulative-layout-shift'] ? round(lab['cumulative-layout-shift'].numericValue, 3) : null),
    inp_ms: pick('INTERACTION_TO_NEXT_PAINT') ?? null,
    perf: j.lighthouseResult && j.lighthouseResult.categories && j.lighthouseResult.categories.performance ? Math.round(j.lighthouseResult.categories.performance.score * 100) : null,
  };
}

// ---------------------------------------------------------------- diff

function diffFindings(prev, cur, previousName) {
  const key = f => `${f.code}|${f.path}|${f.to || ''}`;
  const a = new Set((prev.findings || []).map(key)), b = new Set(cur.findings.map(key));
  return { previous: previousName, new: cur.findings.filter(f => !a.has(key(f))), resolved: (prev.findings || []).filter(f => !b.has(key(f))) };
}

// ---------------------------------------------------------------- HTTP (proxy-aware, manual redirects)

async function follow(url, { method = 'GET', maxHops = 5, bodyLimit = 0, timeout = 30000 } = {}) {
  let cur = url, hops = 0, last;
  for (;;) {
    last = await request(cur, { method, timeout, bodyLimit });
    if ([301, 302, 303, 307, 308].includes(last.status) && last.location && hops < maxHops) { hops++; cur = new URL(last.location, cur).href; if (last.status === 303) method = 'GET'; continue; }
    return { url, final: cur, hops, status: last.status, type: last.type, text: last.text, location: last.location };
  }
}
async function request(url, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { return await requestOnce(url, opts); } catch (e) { lastErr = e; if (attempt < 1) await sleep(1000); }
  }
  throw lastErr;
}
function requestOnce(url, { method = 'GET', headers = {}, timeout = 30000, bodyLimit = 0 } = {}) {
  const u = new URL(url);
  const secure = u.protocol === 'https:';
  const proxy = secure ? proxyFor(u.hostname) : null;
  const lib = secure ? https : http;
  const opts = { method, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers, host: u.host }, timeout };
  return new Promise((resolve, reject) => {
    const send = (socket) => {
      const req = lib.request({ ...opts, host: u.hostname, port: u.port || (secure ? 443 : 80), path: u.pathname + u.search, ...(secure ? { servername: u.hostname } : {}), ...(socket ? { createConnection: () => socket } : {}) }, (res) => {
        const chunks = []; let size = 0;
        res.on('data', (c) => { if (!bodyLimit || size < bodyLimit) { chunks.push(c); size += c.length; } });
        res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', location: res.headers.location || null, text: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('timeout', () => req.destroy(new Error(`timeout after ${timeout / 1000}s: ${u.host}`)));
      req.on('error', (e) => reject(new Error(`${u.host}: ${e.message}${proxy ? ` (via proxy ${proxy.host})` : ''}`)));
      req.end();
    };
    if (!proxy) return send(null);
    const conn = http.request({ host: proxy.hostname, port: proxy.port || 80, method: 'CONNECT', path: `${u.hostname}:443`, headers: { host: `${u.hostname}:443`, ...(proxy.username ? { 'proxy-authorization': 'Basic ' + Buffer.from(decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password)).toString('base64') } : {}) }, timeout: 15000 });
    conn.on('connect', (res, socket) => { if (res.statusCode !== 200) return reject(new Error(`proxy ${proxy.host} refused CONNECT ${u.hostname}: ${res.statusCode}`)); send(tls.connect({ socket, servername: u.hostname })); });
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
  if (!/^https?:$/.test(p.protocol)) return null;
  return p;
}

// ---------------------------------------------------------------- helpers

function originFromRepo(root) {
  try { const d = JSON.parse(fs.readFileSync(path.join(root, 'seo/brand.json'), 'utf8')).domain; if (d) return `https://${d}`; } catch {}
  const c = readIf(path.join(root, 'CLAUDE.md')) || '';
  const m = /^-\s*Preview:\s*(https?:\/\/[^\s/<]+)/m.exec(c); return m ? m[1] : null;
}
function wordFloor(strategy) { const m = /^word_range:\s*(\d+)/m.exec(strategy); return m ? Number(m[1]) : null; }
function clusterHubs(strategy) { const sec = (strategy.match(/^## Clusters[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m) || [])[1] || ''; return [...sec.matchAll(/hub:\s*(\/[^\s,)]*)/g)].map(m => norm(m[1])); }
function norm(p) { if (!p) return null; let s = String(p).trim(); if (!s.startsWith('/')) s = '/' + s; s = s.replace(/\/{2,}/g, '/'); if (s.length > 1) s = s.replace(/\/$/, ''); return s; }
function canonPath(href, o) { try { const u = new URL(href, o.origin); return u.host === o.host ? norm(u.pathname) : href; } catch { return null; } }
function meta(head, k, v) { const re = new RegExp(`<meta[^>]+${k}=["']${v}["'][^>]*>`, 'i'); const t = (head.match(re) || [])[0]; return t ? attr(t, 'content') : null; }
function attr(tag, name) { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null; }
function clean(s) { return String(s || '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); }
function group(arr, keyFn) { const m = new Map(); for (const x of arr) { const k = keyFn(x); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; }
function round(n, p) { const f = 10 ** p; return Math.round(n * f) / f; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function num(v, d) { const n = Number(v); return Number.isFinite(n) && v !== undefined && v !== true ? n : d; }
function readIf(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } }
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function print(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
function fail(msg, code) { print({ error: msg }); process.exit(code); }
function parseArgs(argv) { const a = { _: [] }; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) { a._.push(k); continue; } const name = k.slice(2), next = argv[i + 1]; if (next === undefined || next.startsWith('--')) a[name] = true; else { a[name] = next; i++; } } return a; }

module.exports = { crawl, parseHtml, diffFindings, follow, norm };
if (require.main === module) main().catch(e => { print({ error: String(e.message || e) }); process.exit(1); });
