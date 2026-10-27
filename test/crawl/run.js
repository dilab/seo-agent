// Offline test for scripts/crawl.js: a local HTTP server with planted faults. Run: node test/crawl/run.js
const assert = require('assert');
const http = require('http');
const { crawl, follow, diffFindings } = require('../../scripts/crawl.js');

const words = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');
const page = ({ title, desc, canonical, robots, h1s = ['One'], body = '', imgs = '' }) => `<!doctype html><html><head><title>${title}</title>${desc !== null ? `<meta name="description" content="${desc}">` : ''}${canonical ? `<link rel="canonical" href="${canonical}">` : ''}${robots ? `<meta name="robots" content="${robots}">` : ''}</head><body><main>${h1s.map(h => `<h1>${h}</h1>`).join('')}${imgs}<p>${body}</p></main></body></html>`;

const routes = (port) => ({
  '/': page({ title: 'Home', desc: 'A description that is long enough to pass the seventy character floor set in the crawler.', canonical: '/', body: `${words(250)} <a href="/a">a</a> <a href="/b">b</a> <a href="/missing">m</a> <a href="/redir">r</a> <a href="/chain">c</a> <a href="/n">n</a> <a href="/oauth">o</a> <a href="/gated">g</a> <a href="http://127.0.0.1:${port}/ext-404">ext</a>` }),
  '/a': page({ title: 'Dup', desc: null, canonical: '/a', h1s: ['One', 'Two'], imgs: '<img src="/x.png">', body: words(50) }),
  '/b': page({ title: 'Dup', desc: 'Another description that is long enough to pass the seventy character floor here too.', canonical: '/other', body: `${words(250)} <a href="/d">d</a>` }),
  '/c': page({ title: 'Orphan', desc: 'Orphan page description that is long enough to pass the seventy character floor too.', canonical: '/c', body: words(250) }),
  '/d': page({ title: 'D page', desc: 'D description that is long enough to pass the seventy character floor set here yes.', canonical: '/d', body: words(250) }),
  '/n': page({ title: 'Noindex', desc: 'Noindex description that is long enough to pass the seventy character floor set too.', canonical: '/n', robots: 'noindex', body: words(250) }),
  '/sitemap.xml': `<?xml version="1.0"?><urlset><url><loc>http://localhost:${port}/</loc></url><url><loc>http://localhost:${port}/a</loc></url><url><loc>http://localhost:${port}/b</loc></url><url><loc>http://localhost:${port}/c</loc></url><url><loc>http://localhost:${port}/n</loc></url><url><loc>http://localhost:${port}/gone-in-sitemap</loc></url></urlset>`,
});

const server = http.createServer((req, res) => {
  const port = server.address().port; const r = routes(port);
  if (req.url === '/redir') { res.writeHead(301, { location: '/b' }); return res.end(); }
  if (req.url === '/chain') { res.writeHead(301, { location: '/chain2' }); return res.end(); }
  if (req.url === '/chain2') { res.writeHead(302, { location: '/b' }); return res.end(); }
  if (req.url === '/oauth') { res.writeHead(302, { location: `http://127.0.0.1:${port}/ext-404` }); return res.end(); }
  if (req.url === '/gated') { res.writeHead(302, { location: '/login' }); return res.end(); }
  if (req.url === '/login') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page({ title: 'Login', desc: 'Login page description that is long enough to pass the seventy character floor set.', canonical: '/login', body: words(220) })); }
  if (r[req.url]) { res.writeHead(200, { 'content-type': req.url.endsWith('.xml') ? 'application/xml' : 'text/html; charset=utf-8' }); return res.end(req.method === 'HEAD' ? '' : r[req.url]); }
  res.writeHead(404, { 'content-type': 'text/html' }); res.end('<html><title>404</title></html>');
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const origin = `http://localhost:${port}`;
  const inv = { pages: [{ path: '/', file: 'home.md', kind: 'home' }, { path: '/a', file: 'a.md', kind: 'guide' }, { path: '/b', file: 'b.md', kind: 'guide' }, { path: '/d', file: 'd.md', kind: 'guide' }] };
  const strategy = '## Clusters\n- x (priority 1) — hub: /a — things\n\n## Caps\nword_range: 200–2200\n';
  try {
    const out = await crawl({ origin, inv, strategy, max: 50, external: 10, concurrency: 2, delay: 0, cwv: false, quiet: true });
    const has = (code, p, to) => out.findings.some(f => f.code === code && f.path === p && (to === undefined || f.to === to));
    const sev = (code, p) => (out.findings.find(f => f.code === code && f.path === p) || {}).severity;
    assert(out.pages.length >= 8, 'crawled pages');
    assert(has('description', '/a') && sev('description', '/a') === 'fix', 'missing description on a guide is fixable');
    assert(has('alt', '/a') && sev('alt', '/a') === 'fix', 'alt');
    assert(has('h1', '/a'), 'two h1s');
    assert(has('thin', '/a'), 'thin guide');
    assert(has('duplicate-title', '/a') && has('duplicate-title', '/b'), 'duplicate titles');
    assert(has('canonical', '/b'), 'canonical mismatch');
    assert(has('link', '/', '/missing') && sev('link', '/') === 'report', 'broken internal link from home is report-only');
    assert(has('link', '/', '/redir'), 'redirecting internal link');
    assert(has('redirect-chain', '/chain'), 'redirect chain');
    assert(has('sitemap', '/d'), 'guide missing from sitemap');
    assert(has('orphan', '/c'), 'orphan');
    assert(has('noindex-in-sitemap', '/n'), 'noindex in sitemap');
    assert(has('sitemap-404', '/gone-in-sitemap'), 'sitemap 404');
    assert(has('broken-external', '/'), 'broken external');
    assert(has('external-redirect', '/oauth') && !has('link', '/', '/oauth'), 'off-site redirect is not a link fix');
    assert(has('auth-redirect', '/gated') && !has('link', '/', '/gated'), 'login-gated redirect is not a link fix');
    assert(!has('orphan', '/n') && !has('orphan', '/a'), 'linked pages are not orphans');
    assert(!out.findings.some(f => f.code === 'description' && f.path === '/'), 'home description ok');
    assert.equal(out.summary.findings_by_code.orphan, 1);
    assert(out.sitemap.missing.includes('/gone-in-sitemap'), 'sitemap.missing');
    const chk = await follow(`${origin}/chain`);
    assert.equal(chk.hops, 2); assert.equal(chk.status, 200); assert(chk.final.endsWith('/b'));
    const d = diffFindings({ findings: [{ code: 'orphan', path: '/c' }, { code: 'alt', path: '/zzz' }] }, out, 'prev.json');
    assert(d.resolved.some(f => f.path === '/zzz') && !d.new.some(f => f.path === '/c') && d.new.some(f => f.code === 'thin'), 'diff');
    console.log(`crawl.js: ok — ${out.pages.length} pages, ${out.findings.length} findings:`, JSON.stringify(out.summary.findings_by_code));
  } catch (e) { console.error('crawl.js: FAIL', e.message); process.exitCode = 1; }
  server.close();
});
