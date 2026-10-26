#!/usr/bin/env node
// discover.js — turn a Search Console snapshot (gsc.js site --save) into refresh candidates for analysis discovery mode.
// No network. Reads the snapshot, seo/inventory.json, seo/strategy.md, seo/backlog.md, seo/done.md, seo/rejected.md.
//
//   node discover.js [--root .] [--snapshot seo/data/gsc/<date>.json] [--max 3] [--pos 8-20]
//                    [--done-days 56] [--rejected-days 90] [--guard-days 14]
//
// Prints JSON: { snapshot, window, floor, candidates: [...], skipped: [...], tools: [...] }
//   candidate.reasons ⊂ { decaying, striking, ctr-gap }; candidate.action = new | annotate (an open backlog item already targets the page)
//   candidate.keyword = the page's top query by impressions (keyword_source: gsc) or its h1 (keyword_source: h1)
// Exit 0 always on valid input; 2 on a missing file.

const fs = require('fs');
const path = require('path');

const STOP = new Set('a an the of to for in on at by with and or vs your you my our how what when where why is are do does can it its this that from into'.split(' '));

function main() {
  const a = parseArgs(process.argv.slice(2));
  const root = path.resolve(a.root || '.');
  const snapFile = a.snapshot ? path.resolve(a.snapshot) : newest(path.join(root, 'seo/data/gsc'));
  if (!snapFile) return fail('no snapshot: run `gsc.js site --save seo/data/gsc` first', 2);
  const snap = readJson(snapFile);
  const inv = readJson(path.join(root, 'seo/inventory.json'));
  const strategy = readText(path.join(root, 'seo/strategy.md'));
  const backlog = readText(path.join(root, 'seo/backlog.md'), '');
  const done = readText(path.join(root, 'seo/done.md'), '');
  const rejected = readText(path.join(root, 'seo/rejected.md'), '');

  const opt = {
    max: Number(a.max || 3), pos: parseRange(a.pos || '8-20'),
    doneDays: Number(a['done-days'] || 56), rejectedDays: Number(a['rejected-days'] || 90), guardDays: Number(a['guard-days'] || 14),
    today: a.today ? new Date(a.today) : new Date(),
  };
  const out = discover(snap, inv, parseStrategy(strategy), parseBacklog(backlog), parseDone(done), parseDone(rejected), opt);
  out.snapshot = path.relative(root, snapFile);
  process.stdout.write(JSON.stringify(out) + '\n');
}

function discover(snap, inv, strat, items, doneLines, rejectedLines, opt) {
  const floor = snap.min_impressions || 10;
  const byPath = new Map((inv.pages || []).map(p => [p.path, p]));
  const queriesByPage = new Map();
  for (const q of snap.top_queries || []) { if (!queriesByPage.has(q.page)) queriesByPage.set(q.page, []); queriesByPage.get(q.page).push(q); }
  const trackedKeywords = new Set(strat.tracked.map(k => k.keyword.toLowerCase()));
  const candidates = [], skipped = [], tools = [];
  const daysAgo = (d) => (opt.today - new Date(d)) / 86400000;

  for (const pg of snap.pages || []) {
    const cur = { clicks: pg.clicks, impressions: pg.impressions, ctr: pg.ctr, position: pg.position };
    const prior = pg.prior || { clicks: 0, impressions: 0, ctr: 0, position: null };
    const reasons = [];
    if (pg.decaying) reasons.push('decaying');
    if (cur.position != null && cur.position >= opt.pos[0] && cur.position <= opt.pos[1] && cur.impressions >= floor) reasons.push('striking');
    if (cur.impressions >= floor * 4 && cur.position != null && cur.position <= 12 && cur.ctr < 0.01) reasons.push('ctr-gap');
    if (!reasons.length) continue;

    const page = byPath.get(pg.path);
    if (!page) { skipped.push({ path: pg.path, reason: 'not in inventory', reasons }); continue; }
    if (page.kind === 'tool') { tools.push({ path: pg.path, reasons, impressions: cur.impressions, position: cur.position }); continue; }
    if (!['guide', 'article'].includes(page.kind)) { skipped.push({ path: pg.path, reason: `kind ${page.kind} is never a refresh target`, reasons }); continue; }

    const qs = (queriesByPage.get(pg.path) || []).sort((x, y) => y.impressions - x.impressions);
    const keyword = qs.length ? qs[0].query.toLowerCase() : cleanH1(page.h1 || page.title || '');
    const keyword_source = qs.length ? 'gsc' : 'h1';
    if (strat.never.some(n => keyword.includes(n.toLowerCase()))) { skipped.push({ path: pg.path, reason: `never-write: ${keyword}`, reasons }); continue; }

    const recentDone = doneLines.find(l => l.path === pg.path && daysAgo(l.date) < opt.doneDays);
    if (recentDone) { skipped.push({ path: pg.path, reason: `done ${recentDone.date} (${recentDone.id}), outcome not yet measured`, reasons }); continue; }
    const recentRej = rejectedLines.find(l => l.path === pg.path && daysAgo(l.date) < opt.rejectedDays);
    if (recentRej) { skipped.push({ path: pg.path, reason: `rejected ${recentRej.date} (${recentRej.id})`, reasons }); continue; }

    const existing = items.find(i => i.target === pg.path && !/^(dropped|done|rejected)/.test(i.status));
    let action = 'new', existing_item = null;
    if (existing) {
      existing_item = existing.id;
      if (/^open/.test(existing.status)) action = 'annotate';
      else { skipped.push({ path: pg.path, reason: `${existing.id} is ${existing.status}`, reasons }); continue; }
    }
    const lc = page.last_commit;
    const human_edited = !!(lc && lc.by_agent === false && daysAgo(lc.date) < opt.guardDays) ? lc.date : null;
    const atStake = Math.max(cur.impressions, prior.impressions);
    candidates.push({
      path: pg.path, file: page.file, keyword, keyword_source, tracked: trackedKeywords.has(keyword), reasons, cluster: clusterFor(pg.path, page, keyword, strat.clusters),
      clicks: cur.clicks, impressions: cur.impressions, ctr: cur.ctr, position: cur.position,
      prior: { clicks: prior.clicks, impressions: prior.impressions, position: prior.position }, impressions_pct: pg.delta ? pg.delta.impressions_pct : null,
      gsc_potential: tier(atStake), top_queries: qs.slice(0, 5).map(q => ({ query: q.query, impressions: q.impressions, position: q.position, clicks: q.clicks })),
      action, existing_item, human_edited,
    });
  }
  candidates.sort((x, y) => y.gsc_potential - x.gsc_potential || y.impressions - x.impressions);
  const fresh = candidates.filter(c => c.action === 'new');
  for (const c of fresh.slice(opt.max)) { c.action = 'deferred'; }
  return { window: snap.window, baseline: snap.baseline, floor, max: opt.max, candidates, skipped, tools };
}

function tier(imps) { return imps < 50 ? 1 : imps < 150 ? 3 : imps < 400 ? 5 : imps < 1000 ? 7 : imps < 5000 ? 9 : 10; }

function clusterFor(p, page, keyword, clusters) {
  const hub = clusters.find(c => c.hub === p); if (hub) return hub.name;
  const words = new Set(tokens(p + " " + (page.h1 || "") + " " + keyword));
  let best = null, bestN = 0;
  for (const c of clusters) { const n = tokens(c.name + ' ' + c.spokes).filter(w => words.has(w)).length; if (n > bestN) { best = c.name; bestN = n; } }
  return bestN >= 2 ? best : 'unclustered';
}
function tokens(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !STOP.has(w) && w !== 'zoom'); }
function cleanH1(h) { return h.replace(/\{\{.*?\}\}/g, '').replace(/\(.*?\)/g, '').replace(/[?:!"'—–-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(); }

function parseStrategy(md) {
  const sec = (name) => { const m = md.match(new RegExp(`^## ${name}[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm')); return m ? m[1] : ''; };
  const clusters = [...sec('Clusters').matchAll(/^- ([\w-]+) \(priority (\d)\) — hub: (\S+) — (.*)$/gm)].map(m => ({ name: m[1], priority: Number(m[2]), hub: m[3] === 'none' ? null : m[3], spokes: m[4] }));
  const never = [...sec('Never write about').matchAll(/^- (.+?)(?:;.*)?$/gm)].map(m => m[1].trim());
  const tracked = [...sec('Tracked keywords').matchAll(/^- (.+?)(?: \((.*)\))?$/gm)].map(m => ({ keyword: m[1].trim(), tags: m[2] || '' }));
  return { clusters, never, tracked };
}
function parseBacklog(md) {
  const items = [];
  for (const block of md.split(/^### /m).slice(1)) {
    const head = block.match(/^\[(B-\d+)\] (\w+): (.*)$/m); if (!head) continue;
    const f = (k) => { const m = block.match(new RegExp(`^- ${k}: (.*)$`, 'm')); return m ? m[1].trim() : ''; };
    items.push({ id: head[1], type: head[2], keyword: head[3].trim(), target: f('target'), status: f('status') || 'open', score: f('score') });
  }
  return items;
}
function parseDone(md) {
  return [...md.matchAll(/^- (\d{4}-\d{2}-\d{2}) (B-\d+) (\w+) (\S+)/gm)].map(m => ({ date: m[1], id: m[2], type: m[3], path: m[4] }));
}

function newest(dir) { if (!fs.existsSync(dir)) return null; const f = fs.readdirSync(dir).filter(x => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort().pop(); return f ? path.join(dir, f) : null; }
function readJson(f) { if (!fs.existsSync(f)) fail(`missing ${f}`, 2); return JSON.parse(fs.readFileSync(f, 'utf8')); }
function readText(f, dflt) { if (!fs.existsSync(f)) { if (dflt !== undefined) return dflt; fail(`missing ${f}`, 2); } return fs.readFileSync(f, 'utf8'); }
function parseRange(s) { const [a, b] = String(s).split('-').map(Number); return [a, b ?? a]; }
function parseArgs(argv) { const o = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (k.startsWith('--')) { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) o[k.slice(2)] = true; else { o[k.slice(2)] = v; i++; } } } return o; }
function fail(msg, code) { process.stdout.write(JSON.stringify({ error: msg }) + '\n'); process.exit(code); }

module.exports = { discover, parseStrategy, parseBacklog, parseDone };
if (require.main === module) main();
