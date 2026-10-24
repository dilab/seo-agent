#!/usr/bin/env node
// validate-article.js — check one article before it goes into a PR. Prints a JSON report; exit 0 pass, 1 fail, 2 usage.
//
//   node validate-article.js --file resources/views/guides/x.blade.php [--root .] [--slug my-slug] [--words-warn]
//
// Reads from the product repo: CLAUDE.md `## SEO agent` block (images dir), routes/web.php (slug + route names),
// seo/inventory.json (internal link targets), seo/strategy.md Caps word_range, seo/voice.md banned words,
// public/sitemap.xml (warn only). Blade views and Markdown both work; the checks that need a Blade feature
// (route(), asset(), the marketing-head include) are skipped for Markdown and vice versa. No network.
//
// FAIL: no title/description · title > 70 or description > 165 chars · slug not routed (Blade) · canonical ≠ slug ·
//       internal link target unknown · anchor link to no id · asset/image file missing · <img> without alt attribute ·
//       not exactly one <h1> · fewer than 3 <h2> · words outside word_range (unless --words-warn) · banned word/phrase ·
//       placeholder text (TODO, lorem, TKTK, [bracket placeholders]) · unbalanced {{ }} / @if-@endif (Blade)
// WARN: slug not in sitemap · no JSON-LD · og image missing · description < 70 chars · >1 external link per 150 words ·
//       no link to the cluster hub (when strategy names one for this page's cluster)

const fs = require('fs');
const path = require('path');

const args = parseArgs(process.argv.slice(2));
if (!args.file) { process.stderr.write('usage: validate-article.js --file <path> [--root .] [--slug s] [--words-warn]\n'); process.exit(2); }
const ROOT = path.resolve(args.root || '.');
const FILE = path.resolve(ROOT, args.file);
if (!fs.existsSync(FILE)) { process.stderr.write(`no such file: ${FILE}\n`); process.exit(2); }

const fails = [], warns = [];
const fail = (code, msg) => { if (!fails.some(f => f.msg === msg)) fails.push({ code, msg }); };
const warn = (code, msg) => { if (!warns.some(w => w.msg === msg)) warns.push({ code, msg }); };

const text = fs.readFileSync(FILE, 'utf8');
const isMd = /\.mdx?$/.test(FILE);
const claude = readIf(path.join(ROOT, 'CLAUDE.md')) || '';
const routes = readIf(path.join(ROOT, 'routes/web.php')) || '';
const strategy = readIf(path.join(ROOT, 'seo/strategy.md')) || '';
const voice = readIf(path.join(ROOT, 'seo/voice.md')) || '';
const inventory = (() => { try { return JSON.parse(readIf(path.join(ROOT, 'seo/inventory.json')) || '{}'); } catch { return {}; } })();
const sitemap = readIf(path.join(ROOT, 'public/sitemap.xml')) || readIf(path.join(ROOT, 'static/sitemap.xml')) || '';

// ---------- identity: slug, title, description ----------

const viewName = isMd ? null : path.relative(path.join(ROOT, 'resources/views'), FILE).replace(/\.blade\.php$/, '').split(path.sep).join('.');
const routeEntries = [...routes.matchAll(/Route::view\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]+)['"]\s*\)(?:\s*->name\(\s*['"]([^'"]+)['"]\s*\))?/g)]
  .map(m => ({ slug: m[1].replace(/^\//, ''), view: m[2], name: m[3] || null }));
const allRoutes = fs.existsSync(path.join(ROOT, 'routes')) ? fs.readdirSync(path.join(ROOT, 'routes')).filter(f => f.endsWith('.php')).map(f => readIf(path.join(ROOT, 'routes', f)) || '').join('\n') : routes;
const routeNames = new Set([...allRoutes.matchAll(/->name\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]));
for (const g of allRoutes.matchAll(/->name\(\s*['"]([^'"]+)['"]\s*\)\s*->group|Route::name\(\s*['"]([^'"]+)['"]\s*\)/g)) routeNames.add((g[1] || g[2]) + '*');
const routeKnown = n => routeNames.has(n) || [...routeNames].some(p => p.endsWith('*') && n.startsWith(p.slice(0, -1)));
const fm = isMd ? frontmatter(text) : {};
const routed = isMd ? null : routeEntries.find(r => r.view === viewName);
const slug = args.slug || (isMd ? (fm.slug || fm.permalink || path.basename(FILE).replace(/\.mdx?$/, '')).replace(/^\/|\/$/g, '') : routed ? routed.slug : null);
if (!isMd && !routed) fail('route', `no Route::view(...) in routes/web.php points at view '${viewName}' — the article has no URL`);

const title = isMd ? fm.title : bladeArg('title');
const description = isMd ? fm.description : bladeArg('description');
if (!title) fail('title', isMd ? 'frontmatter has no title' : "no 'title' arg in the head include and no <title>");
else if (title.length > 70) fail('title', `title is ${title.length} chars (max 70): ${title}`);
if (!description) fail('description', isMd ? 'frontmatter has no description' : "no 'description' arg in the head include and no <meta name=description>");
else if (description.length > 165) fail('description', `description is ${description.length} chars (max 165)`);
else if (description.length < 70) warn('description', `description is only ${description.length} chars`);

if (!isMd) {
  const canon = /['"]canonical['"]\s*=>\s*url\(\s*['"]([^'"]*)['"]\s*\)/.exec(text);
  if (canon && slug && canon[1].replace(/^\//, '') !== slug) fail('canonical', `canonical url('${canon[1]}') ≠ route slug '${slug}'`);
  if (!canon) warn('canonical', 'no canonical arg in the head include');
  const og = /['"]ogImage['"]\s*=>\s*asset\(\s*['"]([^'"]+)['"]\s*\)/.exec(text);
  if (!og) warn('og-image', 'no ogImage arg');
  else if (!fs.existsSync(path.join(ROOT, 'public', og[1]))) fail('og-image', `ogImage file missing: public/${og[1]}`);
  if (!/application\/ld\+json/.test(text)) warn('schema', 'no JSON-LD block');
  // balance
  const open = (text.match(/\{\{/g) || []).length, close = (text.match(/\}\}/g) || []).length;
  if (open !== close) fail('blade', `unbalanced {{ }}: ${open} open, ${close} close`);
  for (const [a, b] of [['@if', '@endif'], ['@foreach', '@endforeach'], ['@php', '@endphp'], ['@section', '@endsection']]) {
    const na = (text.match(new RegExp(`${a}\\b(?!\\w)`, 'g')) || []).length - (a === '@if' ? (text.match(/@elseif\b/g) || []).length * 0 : 0);
    const nb = (text.match(new RegExp(`${b}\\b`, 'g')) || []).length;
    if (a === '@section') { const inline = (text.match(/@section\([^)]*,\s*['"]/g) || []).length; if (na - inline !== nb) fail('blade', `${a}/${b} mismatch: ${na - inline} vs ${nb}`); }
    else if (na !== nb) fail('blade', `${a}/${b} mismatch: ${na} vs ${nb}`);
  }
}

// ---------- body: headings, words, placeholders ----------

const body = isMd ? text.replace(/^---[\s\S]*?---\s*/, '') : stripBlade(text);
const h1s = isMd ? (body.match(/^#\s+.+$/gm) || []) : [...text.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => clean(m[1]));
const h2s = isMd ? (body.match(/^##\s+.+$/gm) || []) : [...text.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => clean(m[1]));
if (h1s.length !== 1) fail('h1', `${h1s.length} <h1> elements (need exactly 1)`);
if (h2s.length < 3) fail('h2', `${h2s.length} <h2> sections (need ≥ 3)`);

const words = wordCount(isMd ? body.replace(/^#+\s.*$/gm, ' ') : body);
const range = /^word_range:\s*(\d+)\s*[–-]\s*(\d+)/m.exec(strategy);
const [minW, maxW] = range ? [Number(range[1]), Number(range[2])] : [1200, 2200];
if (words < minW || words > maxW) (args['words-warn'] ? warn : fail)('words', `${words} words, strategy word_range is ${minW}–${maxW}`);

for (const re of [/\bTODO\b/, /\bTKTK\b/, /lorem ipsum/i, /\[(?:insert|add|placeholder|screenshot|image|link|number|date)[^\]]*\]/i, /\bXXX\b/]) {
  const m = re.exec(body); if (m) fail('placeholder', `placeholder text: "${m[0]}"`);
}

// ---------- links ----------

const inventoryPaths = new Set((inventory.pages || []).map(p => p.path));
const routeSlugs = new Set(routeEntries.map(r => '/' + r.slug));
const knownPath = p => { const k = '/' + String(p).replace(/^\/|\/$/g, ''); return k === '/' || inventoryPaths.has(k) || routeSlugs.has(k); };
const ids = new Set([...text.matchAll(/<[a-z][^>]*>/gi)].map(m => attr(m[0], 'id')).filter(Boolean));
let externals = 0;
const hrefs = isMd
  ? [...body.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1])
  : [...text.matchAll(/<a\b[^>]*>/gi)].map(m => attr(m[0], 'href')).filter(h => h !== null);
for (const h of hrefs) {
  if (/^https?:\/\//.test(h)) { externals++; continue; }
  if (/^mailto:|^tel:/.test(h)) continue;
  if (h.startsWith('#')) { if (!ids.has(h.slice(1))) fail('anchor', `anchor ${h} has no matching id in the file`); continue; }
  const rm = /^\{\{\s*route\(\s*['"]([^'"]+)['"]/.exec(h);
  if (rm) { if (!routeKnown(rm[1])) fail('link', `route('${rm[1]}') is not a named route`); continue; }
  const um = /^\{\{\s*url\(\s*['"]([^'"]+)['"]/.exec(h);
  if (um) { if (!knownPath(um[1])) fail('link', `url('${um[1]}') is not a known page`); continue; }
  if (h.startsWith('{{')) continue; // other blade expressions: can't resolve statically
  if (h.startsWith('/')) { if (!knownPath(h.split(/[?#]/)[0])) fail('link', `internal link ${h} is not a known page (inventory + routes)`); continue; }
}
if (externals > Math.ceil(words / 150) + 2) warn('external-links', `${externals} external links for ${words} words`);

// hub link
const cluster = clusterOf(slug);
if (cluster && cluster.hub && cluster.hub !== '/' + slug) {
  const hubSlug = cluster.hub.replace(/^\//, '');
  const hubRoute = routeEntries.find(r => r.slug === hubSlug);
  const linksHub = hrefs.some(h => h.replace(/[?#].*$/, '') === cluster.hub || /^\{\{\s*url\(/.test(h) && h.includes(`'${cluster.hub.replace(/^\//, '')}'`)) || (hubRoute && hubRoute.name && hrefs.some(h => h.includes(`route('${hubRoute.name}')`) || h.includes(`route("${hubRoute.name}")`)));
  if (!linksHub) warn('hub-link', `no link to the cluster hub ${cluster.hub} (${cluster.name})`);
}

// ---------- images ----------

const imgTags = isMd ? [...body.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)].map(m => ({ alt: m[1], src: m[2], tag: m[0] })) : [...text.matchAll(/<img\b[^>]*>/gi)].map(m => ({ tag: m[0], src: attr(m[0], 'src'), alt: attr(m[0], 'alt') }));
const imagesLine = /^-\s*Images:\s*([^\n]+)/m.exec(claude);
const fileBase = path.basename(FILE).replace(/\.(blade\.php|mdx?)$/, '');
const imagesDir = imagesLine && slug ? imagesLine[1].trim().replace(/\s*\(.*$/, '').replace(/<slug>/g, slug).replace(/<file>/g, fileBase) : null;
let articleImages = 0;
for (const im of imgTags) {
  if (im.alt === null) fail('alt', `<img> without alt attribute: ${im.tag.slice(0, 80)}`);
  const am = im.src && /^\{\{\s*asset\(\s*['"]([^'"]+)['"]/.exec(im.src);
  const rel = am ? path.join('public', am[1]) : im.src && !/^https?:|^\{\{|^data:/.test(im.src) ? (im.src.startsWith('/') ? path.join('public', im.src) : path.join(path.dirname(path.relative(ROOT, FILE)), im.src)) : null;
  if (rel) {
    if (!fs.existsSync(path.join(ROOT, rel))) fail('image', `image file missing: ${rel}`);
    if (imagesDir && rel.replace(/^public\//, '').startsWith(imagesDir.replace(/^public\//, '').replace(/\/$/, ''))) {
      articleImages++;
      if (im.alt !== null && !im.alt.trim()) fail('alt', `article image with empty alt: ${rel}`);
    }
  }
}
for (const am of text.matchAll(/asset\(\s*['"]([^'"]+)['"]\s*\)/g)) {
  if (!/\.(png|jpe?g|webp|svg|gif|avif)$/i.test(am[1])) continue;
  if (!fs.existsSync(path.join(ROOT, 'public', am[1]))) { const msg = `asset missing: public/${am[1]}`; if (!fails.some(f => f.msg.includes(am[1]))) fail('image', msg); }
}

// sitemap (warn)
if (sitemap && slug && !new RegExp(`<loc>[^<]*/${escapeRe(slug)}/?\\s*</loc>`).test(sitemap)) warn('sitemap', `/${slug} is not in the sitemap (run the sitemap generator)`);

// ---------- banned words from voice.md ----------

const banned = bannedTerms(voice);
const prose = (isMd ? body : body).toLowerCase();
for (const term of banned) {
  const re = new RegExp(`(^|[^a-z])${term.re}(?![a-z])`, 'i');
  const m = re.exec(prose);
  if (m) (term.contextual ? warn : fail)('banned', `${term.contextual ? 'check context of' : 'banned'} "${term.label}"${term.contextual ? ` (${term.context})` : ''}: …${prose.slice(Math.max(0, m.index - 30), m.index + term.label.length + 30).replace(/\s+/g, ' ')}…`);
}

// ---------- report ----------

const ok = fails.length === 0;
process.stdout.write(JSON.stringify({
  file: path.relative(ROOT, FILE), slug: slug ? '/' + slug : null, ok,
  stats: { words, word_range: `${minW}–${maxW}`, h1: h1s.length, h2: h2s.length, links: hrefs.length, external_links: externals, article_images: articleImages, images_dir: imagesDir, title_len: title ? title.length : 0, description_len: description ? description.length : 0, banned_terms_checked: banned.length },
  fails, warns,
}, null, 2) + '\n');
process.exit(ok ? 0 : 1);

// ---------- helpers ----------

function bladeArg(k) {
  const m = new RegExp(`['"]${k}['"]\\s*=>\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`).exec(text);
  if (m) return clean(m[1] !== undefined ? m[1] : m[2]).replace(/\{\$[^}]*\}/g, '2026');
  if (k === 'title') { const t = /<title>([\s\S]*?)<\/title>/i.exec(text); return t ? clean(t[1]) : null; }
  const d = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(text); return d ? clean(d[1]) : null;
}
function stripBlade(t) {
  const b = (t.split(/<body[^>]*>/i)[1] || t);
  return b.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/\{\{--[\s\S]*?--\}\}/g, ' ').replace(/@php[\s\S]*?@endphp/g, ' ')
    .replace(/\{!!?[\s\S]*?!?\}\}/g, ' ').replace(/@\w+(\([^)]*\))?/g, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;|&\w+;/g, ' ');
}
function clusterOf(s) {
  if (!s) return null;
  const inv = (inventory.pages || []).find(p => p.path === '/' + s);
  const lines = [...strategy.matchAll(/^-\s*([a-z0-9-]+)\s*\(priority\s*(\d)\)\s*—\s*hub:\s*(\/\S+|none)\s*(?:—\s*([^\n]*))?/gm)].map(m => ({ name: m[1], priority: Number(m[2]), hub: m[3] === 'none' ? null : m[3], desc: m[4] || '' }));
  // the article's own cluster: a tracked keyword or backlog item naming this page, else the hub whose words overlap most
  const backlog = readIf(path.join(ROOT, 'seo/backlog.md')) || '';
  const item = backlog.split(/^### /m).map(block => /- cluster: ([a-z0-9-]+)/.exec(block) && new RegExp(`^- target: /${escapeRe(s)}\\s*$`, 'm').test(block) ? /- cluster: ([a-z0-9-]+)/.exec(block)[1] : null).find(Boolean);
  if (item) return lines.find(l => l.name === item) || null;
  const byHub = lines.find(l => l.hub === '/' + s); if (byHub) return byHub;
  // distinctive stems of the page's title + slug against each cluster's hub, name and description
  const GENERIC = new Set(['zoom', 'record', 'meet', 'cloud', 'video', 'your', 'with', 'from', 'that', 'this', 'what', 'when', 'into', 'guide', 'here']);
  const stems = str => new Set(String(str).toLowerCase().split(/[^a-z0-9]+/).map(stem).filter(x => x.length > 3 && !GENERIC.has(x)));
  const w = stems(((inv && inv.title) || '') + ' ' + s);
  let best = null, bs = 0;
  for (const l of lines) { const sc = [...stems((l.hub || '') + ' ' + l.name + ' ' + l.desc)].filter(x => w.has(x)).length; if (sc > bs) { bs = sc; best = l; } }
  return bs >= 1 ? best : null;
}
function bannedTerms(v) {
  const sec = /## Banned words and patterns\s*([\s\S]*?)(?=\n## |$)/.exec(v); if (!sec) return [];
  const out = [];
  for (const line of sec[1].split('\n')) {
    if (!/^\s*-\s/.test(line)) continue;
    if (/\bNote:|not banned|never appear|none appear|strategy\.md/i.test(line) && !/"/.test(line)) continue;
    // a quoted term followed by a qualifier ("simply" before a multi-step task, "X" stated as fact) is contextual: warn, don't fail
    const quoted = [...line.matchAll(/"([^"]+)"(\s*(?:before|when|as|stated|unless|without|in|for|after)\b[^,;]*)?/g)]
      .filter(m => !/…|\.\.\./.test(m[1]) && m[1].split(' ').length <= 6)
      .map(m => ({ q: m[1], context: m[2] ? m[2].trim() : null }));
    const bare = line.replace(/"[^"]*"/g, '').replace(/^\s*-\s*/, '').replace(/\([^)]*\)$/, '').split(/,|;/).map(s => s.trim()).filter(s => /^[a-z#0-9][a-z0-9'’()\- ]*$/i.test(s) && s.split(' ').length <= 2 && !/^(and|or|the|note)$/i.test(s));
    for (const item of [...quoted, ...bare.map(q => ({ q, context: null }))]) {
      const q = item.q;
      if (/^(em-dash|triple|rhetorical|exclamation|more than|counts of|competitor|any mention|stated)/i.test(q)) continue;
      const label = q.replace(/\s+/g, ' ').trim(); if (!label) continue;
      const re = escapeRe(label.toLowerCase()).replace(/\\\(ly\\\)/g, '(ly)?').replace(/\\\(s\\\)/g, 's?').replace(/\\\(ies\\\)/g, '(ies)?').replace(/ /g, '\\s+').replace(/[’']/g, "['’]");
      out.push({ label, re, contextual: !!item.context, context: item.context });
    }
  }
  const seen = new Set(); return out.filter(t => { const k = t.re; if (seen.has(k)) return false; seen.add(k); return true; });
}
function frontmatter(t) { const m = /^---\n([\s\S]*?)\n---/.exec(t); if (!m) return {}; const o = {}; for (const l of m[1].split('\n')) { const kv = /^(\w+):\s*(.*)$/.exec(l); if (kv) o[kv[1]] = kv[2].replace(/^["']|["']$/g, ''); } return o; }
function stem(x) { return x.replace(/(ings?|ies|es|s|ed|ly)$/, m => (m === 'ies' ? 'y' : m === 'ings' || m === 'ing' ? '' : m === 'es' || m === 's' || m === 'ed' || m === 'ly' ? '' : m)); }
// attribute value, tolerant of blade expressions with the other quote type inside: href="{{ route('x') }}"
function attr(tag, name) { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag); if (m) return m[1] !== undefined ? m[1] : m[2]; return new RegExp(`\\s${name}(\\s|>|$)`, 'i').test(tag) ? '' : null; }
function clean(s) { return String(s || '').replace(/\\(['"])/g, '$1').replace(/\s+/g, ' ').trim(); }
function wordCount(s) { return s.split(/\s+/).filter(w => /[a-z0-9]/i.test(w)).length; }
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&'); }
function readIf(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } }
function parseArgs(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const k = argv[i].slice(2), n = argv[i + 1]; if (n === undefined || n.startsWith('--')) a[k] = true; else { a[k] = n; i++; } } return a; }
