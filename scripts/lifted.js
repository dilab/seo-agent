#!/usr/bin/env node
// lifted.js — did the article lift sentences or headings from the pages in its SERP context?
//
//   node lifted.js --article <file> --serp <seo/data/serp/<date>/<slug>.json> [--n 8] [--min-run 2] [--json]
//
// Compares the article's prose against the `shingles` fingerprints that `dfs.js parse` stores for each top page
// (hashes of every run of `n` words; no competitor text is kept). A run of ≥ --min-run consecutive matching
// shingles (= n + min-run − 1 identical words in a row, 9 by default) is a lifted passage. H2s identical to a
// heading on a top page are reported too. Exit 0 when clean, 1 when anything matches, 2 on usage errors.
// Output: { ok, article, pages_checked, pages_without_fingerprints, matches: [{url, words, excerpt}],
//           heading_matches: [{heading, url}], warning? }

const fs = require('fs');
const path = require('path');
const { shingleHashes } = require('./dfs.js');

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a.article || !a.serp) { process.stdout.write(JSON.stringify({ error: 'usage: lifted.js --article <file> --serp <json>' }) + '\n'); process.exit(2); }
  const article = fs.readFileSync(path.resolve(a.article), 'utf8');
  const serp = JSON.parse(fs.readFileSync(path.resolve(a.serp), 'utf8'));
  const res = lifted(article, serp, { file: a.article, n: Number(a.n) || 8, minRun: Number(a['min-run']) || 2 });
  process.stdout.write(JSON.stringify(res) + '\n');
  process.exit(res.ok ? 0 : 1);
}

function lifted(articleText, serp, { file = '', n = 8, minRun = 2 } = {}) {
  const isMd = /\.mdx?$/.test(file) || /^---\n/.test(articleText);
  const prose = extractProse(articleText, isMd);
  const h2s = extractH2s(articleText, isMd).map(norm).filter(Boolean);
  const words = prose.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const mine = []; // [{i, hash}]
  for (let i = 0; i + n <= words.length; i++) mine.push({ i, hash: hashOf(words.slice(i, i + n).join(' ')) });

  const pages = Array.isArray(serp.pages) ? serp.pages : Array.isArray(serp.top) ? serp.top : [];
  const matches = [], heading_matches = [];
  let checked = 0, without = 0;
  for (const p of pages) {
    const url = p.url || '?';
    for (const h of p.headings || []) { const t = norm(h.text || h); if (t && h2s.includes(t)) heading_matches.push({ heading: h.text || h, url }); }
    if (!Array.isArray(p.shingles) || !p.shingles.length) { without++; continue; }
    checked++;
    const set = new Set(p.shingles);
    let run = 0, start = -1;
    const flush = (end) => { if (run >= minRun) { const from = mine[start].i, to = mine[end].i + n; matches.push({ url, words: to - from, excerpt: words.slice(from, to).join(' ') }); } run = 0; start = -1; };
    for (let k = 0; k < mine.length; k++) {
      if (set.has(mine[k].hash)) { if (run === 0) start = k; run++; }
      else if (run) flush(k - 1);
    }
    if (run) flush(mine.length - 1);
  }
  const out = { ok: matches.length === 0 && heading_matches.length === 0, article: file, pages_checked: checked, pages_without_fingerprints: without, matches, heading_matches };
  if (!checked) out.warning = 'no fingerprints in serp_context (analysis ran before shingles existed): heading check only';
  return out;
}

function extractProse(text, isMd) {
  let t = text;
  if (isMd) {
    t = t.replace(/^---\n[\s\S]*?\n---\s*/, '').replace(/```[\s\S]*?```/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^#{1,6}\s+.*$/gm, ' ').replace(/[*_>`|]+/g, ' ');
  } else {
    t = t.replace(/\{\{--[\s\S]*?--\}\}/g, ' ').replace(/@php[\s\S]*?@endphp/g, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/\{!!.*?!!\}/g, ' ').replace(/\{\{.*?\}\}/g, ' ').replace(/^\s*@\w+(\s*\([^\n]*\))?\s*$/gm, ' ')
      .replace(/<h[1-6]\b[^>]*>[\s\S]*?<\/h[1-6]>/gi, ' ').replace(/<[^>]+>/g, ' ');
  }
  return t.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function extractH2s(text, isMd) {
  if (isMd) return (text.match(/^##\s+(.+)$/gm) || []).map(l => l.replace(/^##\s+/, ''));
  return [...text.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map(m => m[1].replace(/\{\{.*?\}\}/g, ' ').replace(/<[^>]+>/g, ' '));
}
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function hashOf(s) { return require('crypto').createHash('sha1').update(s).digest('hex').slice(0, 10); }
function parseArgs(argv) { const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) continue; const name = k.slice(2), next = argv[i + 1]; if (next === undefined || next.startsWith('--')) a[name] = true; else { a[name] = next; i++; } } return a; }

module.exports = { lifted, extractProse, extractH2s, shingleHashes };
if (require.main === module) main();
