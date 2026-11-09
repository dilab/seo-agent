// Tests for the serp extractor's google.com/goto handling in scripts/dfs.js. Run: node test/dfs/run.js
// Fixture: a trimmed real DataForSEO response (2026-11-09) where organic links arrive as google.com/goto tokens.
const assert = require('assert');
const { EXTRACT, resolveRedirects, isGoto, domainHint } = require('../../scripts/dfs.js');
const raw = require('./serp-goto.json');

assert(isGoto('https://google.com/goto?url=CAES'));
assert(isGoto('https://www.google.co.uk/goto?url=CAES'));
assert(!isGoto('https://support.google.com/zoom'));
assert.equal(domainHint({ breadcrumb: 'https://www.facebook.com › fb-answers › x' }), 'facebook.com');
assert.equal(domainHint({ breadcrumb: '92.7K+ views  ·  2 years ago', website_name: 'YouTube · Zoom' }), 'youtube.com');
assert.equal(domainHint({ breadcrumb: '1 comment', website_name: 'Unknown Blog' }), null);

// 1. offline extract: no google.com domains left, breadcrumb hints in place, token kept
const r = EXTRACT.serp(raw, { domain: 'recordmover.com' });
const gotos = r.top.filter(o => o.redirect);
assert(gotos.length >= 4, 'fixture has goto links');
assert(!r.top.some(o => o.domain === 'google.com'), 'no google.com domains: ' + r.top.map(o => o.domain));
assert.equal(r.top[0].domain, 'support.zoom.com');
assert(gotos.every(o => o.unresolved && isGoto(o.url)));
assert.deepEqual(r.ours, [{ rank: 6, url: 'https://recordmover.com/zoom-recording-storage-limits' }]);
const hintBig = r.big_brands_in_top10;

// 2. resolve with a fake fetch: google → www.google → target; never requests the target
const requested = [];
const targets = {};
gotos.forEach((o, i) => { targets[o.redirect] = `https://example${i}.com/page?x=1`; });
const fakeFetch = async (u, opts) => {
  requested.push(u);
  assert.equal(opts.redirect, 'manual');
  if (/^https:\/\/google\.com/.test(u)) return { headers: new Map([['location', u.replace('https://google.com', 'https://www.google.com')]]) };
  const orig = u.replace('https://www.google.com', 'https://google.com');
  if (orig === gotos[1].redirect) throw new Error('timeout'); // one failure keeps its hint
  if (orig === gotos[2].redirect) { // throttled: 200 + meta refresh to a fresh token, then the target
    return { status: 200, headers: new Map(), text: async () => `<html><head><title>Google</title><meta content="3;url=/goto?url=FRESH&amp;x=1" http-equiv="refresh"></head></html>` };
  }
  if (u === 'https://www.google.com/goto?url=FRESH&x=1') return { headers: new Map([['location', targets[gotos[2].redirect]]]) };
  if (orig === gotos[3].redirect) { // throttled with a wait longer than the budget left
    return { status: 200, headers: new Map(), text: async () => `<meta http-equiv="refresh" content="99;url=/goto?url=LATER">` };
  }
  return { headers: new Map([['location', targets[orig]]]) };
};
const slept = [];
(async () => {
  await resolveRedirects(r, { domain: 'recordmover.com', 'resolve-budget': 60 }, fakeFetch, async ms => slept.push(ms));
  assert(!requested.some(u => /example\d\.com/.test(u)), 'target site never fetched');
  assert.equal(r.top[0].url, 'https://example0.com/page?x=1');
  assert.equal(r.top[0].domain, 'example0.com');
  assert(!r.top[0].unresolved);
  assert.equal(gotos[1].domain, domainHint(raw.tasks[0].result[0].items[1]) || null);
  assert(gotos[1].unresolved);
  assert.equal(gotos[2].url, targets[gotos[2].redirect], 'meta refresh followed');
  assert.deepEqual(slept, [3000], 'waited the refresh delay, skipped the over-budget one');
  assert(gotos[3].unresolved, 'over-budget refresh left unresolved');
  assert.equal(r.unresolved_redirects, 2);
  assert(r.big_brands_in_top10 <= hintBig, 'brands recomputed from resolved domains');
  assert.equal(r.ours.length, 1);
  console.log('dfs: ok');
})().catch(e => { console.error(e); process.exit(1); });
