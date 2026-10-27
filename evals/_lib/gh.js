#!/usr/bin/env node
// Stand-in `gh` for evals: serves PR state from .gh/prs.json in the workspace, logs every call
// to .gh/calls.log, stores comments in .gh/comments/<n>.md. No network. Unsupported → exit 1.
const fs = require('fs');
const path = require('path');

const root = process.env.FAKE_GH_ROOT || process.cwd();
const dir = path.join(root, '.gh');
const prsFile = path.join(dir, 'prs.json');
const args = process.argv.slice(2);
fs.mkdirSync(path.join(dir, 'comments'), { recursive: true });

const logLine = args.map(a => (/\n/.test(a) || a.length > 120 ? '<body>' : /\s/.test(a) ? JSON.stringify(a) : a)).join(' ');
fs.appendFileSync(path.join(dir, 'calls.log'), logLine + '\n');

const load = () => (fs.existsSync(prsFile) ? JSON.parse(fs.readFileSync(prsFile, 'utf8')) : []);
const save = prs => fs.writeFileSync(prsFile, JSON.stringify(prs, null, 2));
const out = x => process.stdout.write(typeof x === 'string' ? x : JSON.stringify(x));
const fail = m => { process.stderr.write(`fake gh: ${m}\n`); process.exit(1); };
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const flags = name => args.map((a, i) => (a === name ? args[i + 1] : null)).filter(Boolean);
const has = name => args.includes(name);
const bodyArg = () => (has('--body-file') ? fs.readFileSync(flag('--body-file'), 'utf8') : has('--body') ? flag('--body') : has('-b') ? flag('-b') : '');
const project = (pr, fields) => { if (!fields) return pr; const o = {}; for (const f of fields.split(',')) o[f] = pr[f] === undefined ? null : pr[f]; return o; };
const num = () => { const n = args.find((a, i) => i > 1 && /^\d+$/.test(a)); return n ? Number(n) : null; };
const now = () => new Date().toISOString();

const [cmd, sub] = args;
if (cmd === 'auth' && sub === 'status') { out('github.com\n  ✓ Logged in to github.com account eval-owner (fake)\n'); process.exit(0); }
if (cmd === 'auth' && sub === 'login') process.exit(0);
if (cmd === 'label') { out(`✓ Label "${args[2]}" ready\n`); process.exit(0); }
if (cmd === 'repo' && sub === 'view') { out(has('--json') ? { name: 'product', owner: { login: 'eval-owner' }, defaultBranchRef: { name: 'main' }, url: 'https://github.com/eval-owner/product' } : 'eval-owner/product\n'); process.exit(0); }
if (cmd === 'api') { out('{}'); process.exit(0); }

if (cmd === 'pr') {
  const prs = load();
  if (sub === 'list') {
    const labels = flags('--label');
    const state = flag('--state', 'open').toUpperCase();
    let rows = prs.filter(p => labels.every(l => (p.labels || []).some(x => x.name === l)));
    if (state !== 'ALL') rows = rows.filter(p => p.state === state);
    const limit = Number(flag('--limit', 30));
    rows = rows.slice(0, limit);
    if (has('--json')) out(rows.map(p => project(p, flag('--json'))));
    else out(rows.map(p => `${p.number}\t${p.title}\t${p.headRefName}\t${p.state}`).join('\n') + (rows.length ? '\n' : ''));
    process.exit(0);
  }
  if (sub === 'view') {
    const n = num(); const pr = prs.find(p => p.number === n); if (!pr) fail(`no PR #${n}`);
    out(has('--json') ? project(pr, flag('--json')) : `${pr.title} #${pr.number}\n${pr.state}\n\n${pr.body}\n`);
    process.exit(0);
  }
  if (sub === 'edit') {
    const n = num(); const pr = prs.find(p => p.number === n); if (!pr) fail(`no PR #${n}`);
    for (const l of flags('--add-label')) for (const name of l.split(',')) if (!pr.labels.some(x => x.name === name)) pr.labels.push({ name });
    for (const l of flags('--remove-label')) for (const name of l.split(',')) pr.labels = pr.labels.filter(x => x.name !== name);
    if (has('--body') || has('--body-file')) pr.body = bodyArg();
    if (has('--title')) pr.title = flag('--title');
    save(prs); out(`https://github.com/eval-owner/product/pull/${n}\n`); process.exit(0);
  }
  if (sub === 'comment') {
    const n = num(); const pr = prs.find(p => p.number === n); if (!pr) fail(`no PR #${n}`);
    const body = bodyArg();
    pr.comments = pr.comments || []; pr.comments.push({ author: { login: 'eval-owner' }, body, createdAt: now() });
    fs.appendFileSync(path.join(dir, 'comments', `${n}.md`), body + '\n\n<!-- end of comment -->\n\n');
    save(prs); out(`https://github.com/eval-owner/product/pull/${n}#issuecomment-${pr.comments.length}\n`); process.exit(0);
  }
  if (sub === 'merge') {
    const n = num(); const pr = prs.find(p => p.number === n); if (!pr) fail(`no PR #${n}`);
    pr.state = 'MERGED'; pr.mergedAt = now(); save(prs); out(`✓ Merged pull request #${n}\n`); process.exit(0);
  }
  if (sub === 'close') {
    const n = num(); const pr = prs.find(p => p.number === n); if (!pr) fail(`no PR #${n}`);
    pr.state = 'CLOSED'; pr.closedAt = now(); save(prs); out(`✓ Closed pull request #${n}\n`); process.exit(0);
  }
  if (sub === 'create') {
    const number = prs.reduce((m, p) => Math.max(m, p.number), 0) + 1;
    let head = flag('--head', null);
    if (!head) { try { head = require('child_process').execSync('git branch --show-current', { cwd: root }).toString().trim(); } catch (e) { head = 'unknown'; } }
    prs.push({ number, state: 'OPEN', title: flag('--title', ''), body: bodyArg(), headRefName: head, baseRefName: flag('--base', 'main'), labels: flags('--label').flatMap(l => l.split(',')).map(name => ({ name })), comments: [], reviews: [], files: [], commits: [], mergedAt: null, closedAt: null, url: `https://github.com/eval-owner/product/pull/${number}`, createdAt: now() });
    save(prs); out(`https://github.com/eval-owner/product/pull/${number}\n`); process.exit(0);
  }
  if (sub === 'checkout') { const n = num(); const pr = prs.find(p => p.number === n); if (!pr) fail(`no PR #${n}`); require('child_process').execSync(`git checkout -q ${pr.headRefName}`, { cwd: root, stdio: 'inherit' }); process.exit(0); }
  if (sub === 'status') { out('fake gh: use pr list\n'); process.exit(0); }
}
fail(`unsupported: ${args.join(' ')}`);
