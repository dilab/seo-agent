#!/usr/bin/env node
// inventory.js — scan the product repo for every public page and write seo/inventory.json.
//
//   node inventory.js [--root .] [--out seo/inventory.json] [--sitemap public/sitemap.xml|URL] [--agent-prefix "seo:"]
//   node inventory.js --detect [--root .] [--domain example.com]   no files written: where articles live, title/slug sources,
//                                              sitemap, preview base — what `init` needs for the CLAUDE.md block
//
// Sources, merged by URL path: the articles glob from the `## SEO agent` block in CLAUDE.md,
// Laravel `Route::view('slug', 'view')` entries in routes/web.php, markdown/HTML files that map
// to a path, and <loc> entries in the sitemap (file or URL; host is dropped, only paths are kept).
// Per page: path, file, kind, title, description, h1, h2s, word_count, images_dir, last_commit
// {date, subject, by_agent}. Prints a JSON summary (counts by kind, added/removed vs previous
// inventory, pages with no source file) to stdout. No network except an explicit --sitemap URL.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = parseArgs(process.argv.slice(2));
const ROOT = path.resolve(args.root || '.');
const OUT = path.resolve(ROOT, args.out || 'seo/inventory.json');
const AGENT_PREFIX = args['agent-prefix'] || 'seo:';
const IGNORE_DIRS = /^(node_modules|vendor|\.git|storage|bootstrap|dist|build|\.next|\.nuxt|seo|tests?|__tests__|coverage|public\/build)$/;
const SKIP_PATHS = /^\/(login|register|password|dashboard|admin|api|webhooks?|billing|settings|transfers|subscribe|invite|preview|oauth|auth|impersonation)(\/|$)/;

main().catch(e => { process.stdout.write(JSON.stringify({ error: String(e.message || e) }) + '\n'); process.exit(1); });

async function main() {
  if (args.detect) { process.stdout.write(JSON.stringify(detect(), null, 2) + '\n'); return; }
  const pages = new Map(); // path -> page
  const add = (p, patch) => { const k = normPath(p); if (!k || SKIP_PATHS.test(k)) return; pages.set(k, Object.assign(pages.get(k) || { path: k }, patch)); };

  // 1. articles glob from CLAUDE.md
  const claude = readIf(path.join(ROOT, 'CLAUDE.md'));
  const artLine = /^-\s*Articles:\s*([^,\n]+)/m.exec(claude || '');
  const articlesGlob = artLine ? artLine[1].trim() : null;
  const articleFiles = articlesGlob ? globFiles(ROOT, articlesGlob) : [];

  // 2. Laravel routes: Route::view('slug', 'dot.view')
  const routes = readIf(path.join(ROOT, 'routes/web.php')) || '';
  const viewByPath = new Map();
  for (const m of routes.matchAll(/Route::view\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]+)['"]/g)) {
    const file = path.join(ROOT, 'resources/views', m[2].replace(/\./g, '/') + '.blade.php');
    if (fs.existsSync(file)) { viewByPath.set('/' + m[1].replace(/^\//, ''), file); add('/' + m[1], { file: rel(file), source: 'route' }); }
  }
  const homeView = /Route::get\(\s*['"]\/['"][\s\S]{0,200}?view\(\s*['"]([^'"]+)['"]/.exec(routes);
  if (homeView) { const f = path.join(ROOT, 'resources/views', homeView[1].replace(/\./g, '/') + '.blade.php'); if (fs.existsSync(f)) add('/', { file: rel(f), source: 'route' }); }

  // 3. article files not reached by a route (markdown/html with their own slug)
  for (const f of articleFiles) {
    if ([...viewByPath.values()].includes(f)) continue;
    const text = readIf(f) || '';
    const fm = frontmatter(text);
    const slug = fm.slug || path.basename(f).replace(/\.(md|mdx|html|blade\.php)$/, '');
    const p = fm.permalink || (/\.md|\.mdx/.test(f) ? guessMarkdownPath(f, slug) : null);
    if (p) add(p, { file: rel(f), source: 'articles' });
  }

  // 4. sitemap
  const sm = args.sitemap || (fs.existsSync(path.join(ROOT, 'public/sitemap.xml')) ? 'public/sitemap.xml' : null);
  let sitemapPaths = [];
  if (sm) {
    const xml = /^https?:\/\//.test(sm) ? await (await fetch(sm)).text() : readIf(path.resolve(ROOT, sm)) || '';
    sitemapPaths = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => { try { return new URL(m[1]).pathname; } catch { return m[1]; } });
    for (const p of sitemapPaths) add(p, { in_sitemap: true });
  }

  // 5. enrich from source files
  for (const page of pages.values()) {
    page.in_sitemap = !!page.in_sitemap;
    const abs = page.file ? path.join(ROOT, page.file) : null;
    if (!abs || !fs.existsSync(abs)) { page.kind = page.kind || 'unknown'; page.missing_source = true; continue; }
    const text = readIf(abs) || '';
    const isMd = /\.mdx?$/.test(abs);
    const meta = isMd ? mdMeta(text) : bladeMeta(text);
    Object.assign(page, meta);
    page.kind = kindOf(page.file, page.path);
    page.images_dir = imagesDir(claude, page.path, page.file);
    page.last_commit = lastCommit(abs);
  }

  const list = [...pages.values()].sort((a, b) => a.path.localeCompare(b.path));
  const prev = readIf(OUT) ? JSON.parse(readIf(OUT)) : null;
  const prevPaths = new Set(prev && prev.pages ? prev.pages.map(p => p.path) : []);
  const added = list.map(p => p.path).filter(p => prev && !prevPaths.has(p));
  const removed = [...prevPaths].filter(p => !pages.has(p));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generated: today(), root: path.basename(ROOT), articles_glob: articlesGlob, sitemap: sm || null, pages: list }, null, 2) + '\n');

  const byKind = {}; for (const p of list) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  process.stdout.write(JSON.stringify({
    out: rel(OUT), pages: list.length, by_kind: byKind, added, removed,
    missing_source: list.filter(p => p.missing_source).map(p => p.path),
    not_in_sitemap: sm ? list.filter(p => !p.in_sitemap && !p.missing_source).map(p => p.path) : null,
    edited_by_human_last: list.filter(p => p.last_commit && !p.last_commit.by_agent).length,
  }) + '\n');
}

// ---------- detection (for init) ----------


function detect() {
  const has = f => fs.existsSync(path.join(ROOT, f));
  const framework = has('artisan') ? 'laravel' : has('next.config.js') || has('next.config.mjs') || has('next.config.ts') ? 'next'
    : has('astro.config.mjs') || has('astro.config.ts') ? 'astro' : has('hugo.toml') || has('hugo.yaml') || (has('config.toml') && has('content')) ? 'hugo'
    : has('_config.yml') ? 'jekyll' : has('.eleventy.js') || has('eleventy.config.js') ? 'eleventy' : has('package.json') ? 'node' : 'unknown';
  const candidates = [];

  // Laravel: Route::view entries grouped by view folder
  const routes = readIf(path.join(ROOT, 'routes/web.php')) || '';
  const groups = new Map();
  for (const m of routes.matchAll(/Route::view\(\s*['"]([^'"]*)['"]\s*,\s*['"]([^'"]+)['"]/g)) {
    const parts = m[2].split('.'); const folder = parts.length > 1 ? parts.slice(0, -1).join('/') : '(root)';
    const file = path.join(ROOT, 'resources/views', m[2].replace(/\./g, '/') + '.blade.php');
    if (!fs.existsSync(file)) continue;
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder).push({ slug: m[1], file });
  }
  for (const [folder, entries] of groups) {
    const texts = entries.map(e => readIf(e.file) || '');
    const wc = texts.map(t => bladeMeta(t).word_count);
    const inc = texts.map(t => (/@include\(\s*['"]([^'"]+)['"]\s*,\s*\[[^\]]*['"]title['"]/.exec(t) || [])[1]).find(Boolean);
    candidates.push({
      glob: folder === '(root)' ? 'resources/views/*.blade.php' : `resources/views/${folder}/*.blade.php`,
      format: 'Blade view, no frontmatter', files: entries.length, avg_words: Math.round(wc.reduce((a, b) => a + b, 0) / (wc.length || 1)),
      title_source: inc ? `the 'title' and 'description' args passed to @include('${inc}') near the top of each view` : texts.some(t => /<title>/i.test(t)) ? '<title> and <meta name="description"> in the view' : 'unknown — set by hand',
      slug_source: 'the first argument of the matching Route::view(...) in routes/web.php (file name ≠ slug)',
      slug_differs: entries.some(e => path.basename(e.file, '.blade.php') !== e.slug.split('/').pop()),
      sample: entries.slice(0, 3).map(e => `/${e.slug} ← ${rel(e.file)}`),
    });
  }

  // Markdown / MDX folders (≥ 3 files) anywhere outside ignored dirs
  const mdDirs = new Map();
  (function walk(d, depth) {
    if (depth > 5) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) { if (!IGNORE_DIRS.test(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name), depth + 1); }
      else if (/\.mdx?$/.test(e.name) && !/^(README|CHANGELOG|LICENSE|CONTRIBUTING|SPEC|CLAUDE)/i.test(e.name)) mdDirs.set(d, (mdDirs.get(d) || 0) + 1);
    }
  })(ROOT, 0);
  for (const [d, n] of mdDirs) {
    if (n < 3) continue;
    const files = fs.readdirSync(d).filter(f => /\.mdx?$/.test(f)).map(f => path.join(d, f));
    const metas = files.map(f => mdMeta(readIf(f) || ''));
    const withFm = metas.filter(m => m.frontmatter && Object.keys(m.frontmatter).length).length;
    const wc = metas.map(m => m.word_count);
    candidates.push({
      glob: `${rel(d)}/*.md${files.some(f => f.endsWith('.mdx')) ? 'x' : ''}`, format: withFm ? 'Markdown with frontmatter' : 'Markdown, no frontmatter',
      files: n, avg_words: Math.round(wc.reduce((a, b) => a + b, 0) / (wc.length || 1)),
      title_source: withFm ? 'frontmatter `title` and `description`' : 'first `# ` heading; no description field',
      slug_source: metas.some(m => m.frontmatter && (m.frontmatter.slug || m.frontmatter.permalink)) ? 'frontmatter `slug`/`permalink`, else file name' : 'file name',
      sample: files.slice(0, 3).map(f => rel(f)),
    });
  }

  // Best guess: the candidate with the most long-form pages
  candidates.sort((a, b) => (b.files * Math.min(b.avg_words, 1500)) - (a.files * Math.min(a.avg_words, 1500)));
  const best = candidates.find(c => c.avg_words >= 400) || candidates[0] || null;

  // Images, sitemap, preview base, validator
  const imgRoot = ['public/images', 'public/img', 'static/images', 'public/assets/images', 'src/assets/images'].find(has) || 'public/images';
  const folderName = best ? (best.glob.match(/views\/([^/*]+)/) || best.glob.match(/^([^/*]+)/) || [])[1] || 'articles' : 'articles';
  // existing image folders named after the view file (not the URL slug) → use the <file> token
  const imgFolders = has(`${imgRoot}/${folderName}`) ? fs.readdirSync(path.join(ROOT, imgRoot, folderName)) : [];
  const bestEntries = best && groups.get(folderName) ? groups.get(folderName) : [];
  const byFile = bestEntries.filter(e => imgFolders.includes(path.basename(e.file, '.blade.php'))).length;
  const bySlug = bestEntries.filter(e => imgFolders.includes(e.slug.split('/').pop())).length;
  const imgToken = byFile > bySlug ? '<file>' : '<slug>';
  // sitemap generator (Laravel artisan command or a script) that must learn about new pages
  const sitemapGen = (() => { const dirs = ['app', 'routes', 'scripts', 'config', 'src'].filter(has); if (!dirs.length) return null; try { return execFileSync('grep', ['-rlI', '--exclude-dir=node_modules', '--exclude-dir=vendor', '-e', 'sitemap', ...dirs], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').filter(Boolean).sort((a, b) => (/Sitemap|sitemap/.test(path.basename(b)) ? 1 : 0) - (/Sitemap|sitemap/.test(path.basename(a)) ? 1 : 0))[0] || null; } catch { return null; } })();
  const artisanSig = sitemapGen ? ((readIf(path.join(ROOT, sitemapGen)) || '').match(/\$signature\s*=\s*['"]([^'"]+)['"]/) || [])[1] : null;
  const sitemap = ['public/sitemap.xml', 'static/sitemap.xml', 'sitemap.xml'].find(has) || null;
  const env = readIf(path.join(ROOT, '.env.example')) || readIf(path.join(ROOT, '.env')) || '';
  const appUrl = (/^APP_URL=(\S+)/m.exec(env) || /^(?:NEXT_PUBLIC_)?SITE_URL=(\S+)/m.exec(env) || [])[1];
  const sitemapHost = sitemap ? ((readIf(path.join(ROOT, sitemap)) || '').match(/<loc>\s*(https?:\/\/[^/<\s]+)/) || [])[1] : null;
  const brand = (() => { try { return JSON.parse(readIf(path.join(ROOT, 'seo/brand.json')) || '{}'); } catch { return {}; } })();
  const brandUrl = args.domain ? `https://${String(args.domain).replace(/^https?:\/\//, '')}` : brand.domain ? `https://${brand.domain}` : null;
  const preview_base = [brandUrl, appUrl, sitemapHost].map(u => u && !/localhost|127\.0\.0\.1/.test(u) ? u.replace(/\/$/, '') : null).find(Boolean) || null;
  const validator = path.join(__dirname, 'validate-article.js');
  const claude = readIf(path.join(ROOT, 'CLAUDE.md')) || '';

  return {
    framework, candidates, articles: best ? best.glob : null, article_format: best ? best.format : null,
    title_source: best ? best.title_source : null, slug_source: best ? best.slug_source : null,
    images_dir: `${imgRoot}/${folderName}/${imgToken}/` + (imgToken === '<file>' ? ' (file = view basename, not the URL slug)' : ''), sitemap, preview_base,
    sitemap_generator: sitemapGen ? (artisanSig ? `${sitemapGen} — hardcoded page list; add the new route, then run php artisan ${artisanSig}` : sitemapGen) : null,
    validate: fs.existsSync(validator) ? 'node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-article.js --file <path>' : null,
    existing_block: /<!-- seo-agent -->/.test(claude), existing_design_block: /<!-- seo-agent:design-system -->/.test(claude),
    seo_dir: ['strategy.md', 'voice.md', 'brand.json', 'backlog.md', 'done.md', 'rejected.md', 'review-rubric.md', 'inventory.json', 'frames', 'data'].filter(f => has('seo/' + f)),
    gh: hasBin('gh'), git_remote: gitRemote(),
  };
}

function hasBin(b) { try { execFileSync('which', [b], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); return true; } catch { return false; } }
function gitRemote() { try { return execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; } }

// ---------- metadata extraction ----------

function bladeMeta(text) {
  const arg = k => { const m = new RegExp(`['"]${k}['"]\\s*=>\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`).exec(text); return m ? clean(m[1] !== undefined ? m[1] : m[2]) : null; };
  const tag = (t, all) => { const re = new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, 'gi'); const out = []; let m; while ((m = re.exec(text))) { out.push(clean(strip(m[1]))); if (!all) break; } return all ? out.filter(Boolean) : (out[0] || null); };
  const metaDesc = /<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i.exec(text);
  const body = strip((text.split(/<body[^>]*>/i)[1] || text).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
  return {
    title: arg('title') || tag('title'),
    description: arg('description') || (metaDesc && clean(metaDesc[1])) || null,
    h1: tag('h1'),
    h2s: tag('h2', true),
    word_count: words(body),
  };
}

function mdMeta(text) {
  const fm = frontmatter(text);
  const body = text.replace(/^---[\s\S]*?---\s*/, '');
  return {
    title: fm.title || (/^#\s+(.+)$/m.exec(body) || [])[1] || null,
    description: fm.description || null,
    h1: (/^#\s+(.+)$/m.exec(body) || [])[1] || null,
    h2s: [...body.matchAll(/^##\s+(.+)$/gm)].map(m => clean(m[1])),
    word_count: words(body.replace(/^#+\s.*$/gm, ' ')),
    frontmatter: fm,
  };
}

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---/.exec(text); if (!m) return {};
  const fm = {}; for (const line of m[1].split('\n')) { const kv = /^(\w+):\s*(.*)$/.exec(line); if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, ''); }
  return fm;
}

function strip(html) {
  return html
    .replace(/\{\{--[\s\S]*?--\}\}/g, ' ').replace(/@php[\s\S]*?@endphp/g, ' ')          // blade comments / php blocks
    .replace(/\{!!?[\s\S]*?!?\}\}/g, ' ').replace(/@\w+(\([^)]*\))?/g, ' ')                // {{ }} / {!! !!} / directives
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&amp;|&#\d+;|&\w+;/g, ' ');
}
function clean(s) { return String(s || '').replace(/\{\$[^}]*\}/g, '…').replace(/\\(['"])/g, '$1').replace(/\s+/g, ' ').trim(); }
function words(s) { return s.split(/\s+/).filter(w => /[a-z0-9]/i.test(w)).length; }

function kindOf(file, p) {
  if (p === '/') return 'home';
  const seg = (file || '').split('/');
  const i = seg.indexOf('views');
  const folder = i >= 0 && seg.length > i + 2 ? seg[i + 1] : null;
  if (folder) return folder.replace(/s$/, '');            // guides → guide, tools → tool, legal → legal
  if (/pricing/.test(p)) return 'pricing';
  if (/\.mdx?$/.test(file || '')) return 'article';
  return 'page';
}

function imagesDir(claude, p, file) {
  const m = /^-\s*Images:\s*([^\n]+)/m.exec(claude || ''); if (!m) return null;
  const base = file ? path.basename(file).replace(/\.(blade\.php|mdx?|html)$/, '') : null;
  return m[1].trim().replace(/\s*\(.*$/, '').replace(/<slug>/g, p.replace(/^\//, '') || 'home').replace(/<file>/g, base || p.replace(/^\//, '') || 'home');
}

function lastCommit(abs) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%ad%x09%an%x09%s', '--date=short', '--', abs], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (!out) return null;
    const [date, author, subject] = out.split('\t');
    return { date, author, subject, by_agent: subject.startsWith(AGENT_PREFIX) };
  } catch { return null; }
}

// ---------- fs helpers ----------

function globFiles(root, pattern) {
  const [dir, pat] = splitGlob(pattern);
  const base = path.resolve(root, dir);
  if (!fs.existsSync(base)) return [];
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
  const out = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (re.test(path.relative(base, f))) out.push(f); } })(base);
  return out.sort();
}
function splitGlob(g) { const parts = g.split('/'); const i = parts.findIndex(s => /[*?]/.test(s)); return i < 0 ? [path.dirname(g), path.basename(g)] : [parts.slice(0, i).join('/') || '.', parts.slice(i).join('/')]; }
function guessMarkdownPath(f, slug) { const seg = path.relative(ROOT, f).split('/'); const i = seg.findIndex(s => /^(blog|posts|articles|guides|content)$/i.test(s)); return '/' + (i >= 0 ? seg[i] + '/' : '') + slug; }
function normPath(p) { if (!p) return null; let s = String(p).trim(); if (/^https?:\/\//.test(s)) { try { s = new URL(s).pathname; } catch { return null; } } s = '/' + s.replace(/^\/+|\/+$/g, ''); return s.includes('{') ? null : s; }
function rel(f) { return path.relative(ROOT, f); }
function readIf(f) { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } }
function today() { return new Date().toISOString().slice(0, 10); }
function parseArgs(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { if (!argv[i].startsWith('--')) continue; const k = argv[i].slice(2), n = argv[i + 1]; if (n === undefined || n.startsWith('--')) a[k] = true; else { a[k] = n; i++; } } return a; }
