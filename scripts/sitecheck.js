#!/usr/bin/env node
// sitecheck.js — site-wide hygiene from the inventory: validator findings per article, missing hub↔spoke links, orphan pages.
// No network. Feeds `fix` and `link` backlog items in analysis §1c; the `fix` skill executes them.
//
//   node sitecheck.js [--root .] [--cluster name] [--json]
//
// Prints JSON: { generated, articles, fixes: [{path, file, code, severity, msg}], report_only: [...same shape],
//                links: [{from, from_file, to, reason: spoke→hub | hub→spoke | orphan, cluster}], orphans: [path], clusters: {name: {hub, spokes}} }
// `fixes` are findings the fix skill may apply mechanically (title/description length, canonical, ogImage arg, alt, broken internal link or anchor, sitemap).
// `report_only` are content problems (h1/h2 count, placeholders, banned words, blade errors, missing route/files) for the owner or a refresh.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const FIXABLE = new Set(['title', 'description', 'canonical', 'og-image', 'alt', 'link', 'anchor', 'sitemap']);
const GENERIC = new Set(['zoom', 'record', 'recording', 'recordings', 'meet', 'meeting', 'cloud', 'video', 'your', 'with', 'from', 'that', 'this', 'what', 'when', 'into', 'guide', 'here', 'how']);

function main() {
  const a = parseArgs(process.argv.slice(2));
  const root = path.resolve(a.root || '.');
  const inv = readJson(path.join(root, 'seo/inventory.json'));
  const strategy = readIf(path.join(root, 'seo/strategy.md')) || '';
  const backlog = readIf(path.join(root, 'seo/backlog.md')) || '';
  const done = readIf(path.join(root, 'seo/done.md')) || '';
  const routes = readIf(path.join(root, 'routes/web.php')) || '';
  const out = sitecheck({ root, inv, strategy, backlog, done, routes, onlyCluster: a.cluster || null, validator: path.join(__dirname, 'validate-article.js') });
  process.stdout.write(JSON.stringify(out) + '\n');
}

function sitecheck({ root, inv, strategy, backlog, done = '', routes, onlyCluster, validator }) {
  const pages = (inv.pages || []).filter(p => p.file);
  const articles = pages.filter(p => ['guide', 'article'].includes(p.kind));
  const nameToSlug = new Map([...routes.matchAll(/Route::view\(\s*['"]([^'"]*)['"]\s*,\s*['"][^'"]+['"]\s*\)(?:\s*->name\(\s*['"]([^'"]+)['"]\s*\))?/g)].filter(m => m[2]).map(m => [m[2], '/' + m[1].replace(/^\//, '')]));
  const clusters = parseClusters(strategy);
  const clusterOf = (p) => assignCluster(p, clusters, backlog, done);

  // internal links per page (every page with a file is a link source: guides, tools, home)
  const linksFrom = new Map();
  for (const p of pages) {
    const text = readIf(path.join(root, p.file)) || '';
    linksFrom.set(p.path, new Set(internalLinks(text, nameToSlug, /\.mdx?$/.test(p.file))));
  }
  const inbound = new Map(pages.map(p => [p.path, 0]));
  for (const [from, set] of linksFrom) for (const to of set) if (to !== from && inbound.has(to)) inbound.set(to, inbound.get(to) + 1);

  // validator per article
  const fixes = [], report_only = [];
  for (const p of articles) {
    if (onlyCluster && clusterOf(p)?.name !== onlyCluster) continue;
    let rep;
    try { rep = JSON.parse(execFileSync('node', [validator, '--root', root, '--file', p.file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); }
    catch (e) { try { rep = JSON.parse(e.stdout); } catch { report_only.push({ path: p.path, file: p.file, code: 'validator', severity: 'fail', msg: 'validator did not return JSON' }); continue; } }
    for (const f of rep.fails || []) (FIXABLE.has(f.code) ? fixes : report_only).push({ path: p.path, file: p.file, code: f.code, severity: 'fail', msg: f.msg });
    for (const w of rep.warns || []) { if (w.code === 'hub-link' || w.code === 'banned' || w.code === 'external-links' || w.code === 'schema') continue; (FIXABLE.has(w.code) ? fixes : report_only).push({ path: p.path, file: p.file, code: w.code, severity: 'warn', msg: w.msg }); }
  }

  // hub ↔ spoke links and orphans
  const links = [], clusterMap = {};
  const byPath = new Map(pages.map(p => [p.path, p]));
  for (const c of clusters) {
    const spokes = articles.filter(p => p.path !== c.hub && clusterOf(p)?.name === c.name).map(p => p.path);
    clusterMap[c.name] = { hub: c.hub, spokes };
    if (onlyCluster && c.name !== onlyCluster) continue;
    if (!c.hub || !byPath.has(c.hub)) continue;
    for (const s of spokes) {
      if (!linksFrom.get(s)?.has(c.hub)) links.push({ from: s, from_file: byPath.get(s).file, to: c.hub, reason: 'spoke→hub', cluster: c.name });
      if (!linksFrom.get(c.hub)?.has(s)) links.push({ from: c.hub, from_file: byPath.get(c.hub).file, to: s, reason: 'hub→spoke', cluster: c.name });
    }
  }
  const orphans = articles.filter(p => inbound.get(p.path) === 0).map(p => p.path);
  for (const o of orphans) {
    const c = clusterOf(byPath.get(o));
    if (c?.hub && byPath.has(c.hub) && !links.some(l => l.from === c.hub && l.to === o)) links.push({ from: c.hub, from_file: byPath.get(c.hub).file, to: o, reason: 'orphan', cluster: c.name });
  }
  return { generated: new Date().toISOString().slice(0, 10), articles: articles.length, fixes, report_only, links, orphans, clusters: clusterMap };
}

function internalLinks(text, nameToSlug, isMd) {
  const hrefs = isMd ? [...text.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1])
    : [...text.matchAll(/<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)].map(m => m[1] ?? m[2]);
  const out = [];
  for (const h of hrefs) {
    if (!h || /^(https?:|mailto:|tel:|#)/.test(h)) continue;
    const rm = /^\{\{\s*route\(\s*['"]([^'"]+)['"]/.exec(h); if (rm) { const s = nameToSlug.get(rm[1]); if (s) out.push(s); continue; }
    const um = /^\{\{\s*url\(\s*['"]([^'"]+)['"]/.exec(h); if (um) { out.push('/' + um[1].replace(/^\/+|\/+$/g, '')); continue; }
    if (h.startsWith('{{')) continue;
    if (h.startsWith('/')) out.push('/' + h.split(/[?#]/)[0].replace(/^\/+|\/+$/g, ''));
  }
  // also route('name') used outside href attributes (e.g. in a list helper) counts as a link
  for (const m of text.matchAll(/route\(\s*['"]([^'"]+)['"]\s*\)/g)) { const s = nameToSlug.get(m[1]); if (s) out.push(s); }
  return out.map(p => p === '' ? '/' : p);
}

function parseClusters(md) {
  return [...md.matchAll(/^-\s*([a-z0-9-]+)\s*\(priority\s*(\d)\)\s*—\s*hub:\s*(\/\S+|none)\s*(?:—\s*([^\n]*))?/gm)].map(m => ({ name: m[1], priority: Number(m[2]), hub: m[3] === 'none' ? null : m[3], desc: m[4] || '' }));
}
function assignCluster(p, clusters, backlog, done = '') {
  const byHub = clusters.find(c => c.hub === p.path); if (byHub) return byHub;
  // a merged write item: done.md names the path and its id; the backlog block carries the cluster
  const dl = new RegExp(`^- \\d{4}-\\d{2}-\\d{2} (B-\\d+) write ${escapeRe(p.path)}\\b`, 'm').exec(done);
  if (dl) { const blk = backlog.split(/^### /m).find(b => b.startsWith(`[${dl[1]}]`)); const m = blk && /- cluster: ([a-z0-9-]+)/.exec(blk); const c = m && clusters.find(x => x.name === m[1]); if (c) return c; }
  const item = backlog.split(/^### /m).map(b => new RegExp(`^- target: ${escapeRe(p.path)}\\s*$`, 'm').test(b) && /- cluster: ([a-z0-9-]+)/.exec(b)).find(Boolean);
  if (item) { const c = clusters.find(x => x.name === item[1]); if (c) return c; }
  const stems = s => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).map(stem).filter(x => x.length > 3 && !GENERIC.has(x)));
  const w = stems((p.title || '') + ' ' + (p.h1 || '') + ' ' + p.path);
  let best = null, bs = 0;
  for (const c of clusters) { const sc = [...stems((c.hub || '') + ' ' + c.name + ' ' + c.desc)].filter(x => w.has(x)).length; if (sc > bs) { bs = sc; best = c; } }
  return bs >= 1 ? best : null;
}
function stem(x) { return x.replace(/(ings?|ies|es|s|ed|ly)$/, m => (m === 'ies' ? 'y' : '')); }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
function readIf(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } }
function readJson(f) { const t = readIf(f); if (t == null) { process.stdout.write(JSON.stringify({ error: `missing ${f}` }) + '\n'); process.exit(2); } return JSON.parse(t); }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (k.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[k.slice(2)] = true; else { o[k.slice(2)] = v; i++; } } } return o; }

module.exports = { sitecheck, internalLinks, parseClusters, assignCluster };
if (require.main === module) main();
