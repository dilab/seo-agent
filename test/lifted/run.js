// Tests for scripts/lifted.js. Run: node test/lifted/run.js
const assert = require('assert');
const { lifted, shingleHashes } = require('../../scripts/lifted.js');

const competitor = `Zoom cloud recordings are kept until you delete them or your storage fills up. When the storage is full,
new recordings are placed in a queue and processed once you free some space. Deleting a recording moves it to the trash
for thirty days, and during those thirty days it still counts against your plan limit. Export before cancelling: once the
account closes the recordings are gone for good and support cannot bring them back.`;
const serp = { keyword: 'x', pages: [
  { url: 'https://competitor.example/guide', headings: [{ level: 2, text: 'What happens when storage is full' }, { level: 2, text: 'Export before cancelling' }], shingles: shingleHashes(competitor, 8, 3000) },
  { url: 'https://old.example/page', headings: [{ level: 2, text: 'Retention' }] }, // analysis ran before shingles existed
] };

// 1. a Markdown article with one lifted sentence and one lifted H2
const lifting = `---
title: "t"
---
# How long are recordings stored

Recordings stay until you remove them. Deleting a recording moves it to the trash for thirty days, and during those thirty days it still counts against your plan limit. That is the whole rule.

## What happens when storage is full

Your own words here, nothing copied, written from the facts file.
`;
let r = lifted(lifting, serp, { file: 'a.md' });
assert.equal(r.ok, false);
assert.equal(r.pages_checked, 1); assert.equal(r.pages_without_fingerprints, 1);
assert.equal(r.matches.length, 1); assert(r.matches[0].words >= 20, 'long run'); assert(r.matches[0].excerpt.includes('thirty days'));
assert.equal(r.heading_matches.length, 1); assert.equal(r.heading_matches[0].heading, 'What happens when storage is full');
assert(!r.warning);

// 2. the same facts in our own words: clean (shared facts, different sentences)
const clean = `---
title: "t"
---
# How long are recordings stored

Nothing is deleted on a schedule. A deleted recording sits in the trash for 30 days and keeps counting against the limit until it is gone. Once an account is cancelled the copies in the product are gone for good.

## Retention by plan

Own words.
`;
r = lifted(clean, serp, { file: 'b.md' });
assert.equal(r.ok, true, JSON.stringify(r));
assert.equal(r.matches.length, 0); assert.equal(r.heading_matches.length, 0);

// 3. Blade: lifted text inside markup, headings in <h2>, expressions and directives ignored
const blade = `@extends('layouts.marketing')
@section('content')
<article>
<h1>{{ $title }}</h1>
<p>Deleting a recording moves it to the trash for thirty days, and during those thirty days it still counts against your plan limit.</p>
<h2>Export before cancelling</h2>
<p>Own words {{ config('zoom_facts.trash_days') }} here.</p>
@include('partials.faq', ['items' => $faq])
</article>
@endsection
`;
r = lifted(blade, serp, { file: 'x.blade.php' });
assert.equal(r.ok, false); assert.equal(r.matches.length, 1); assert.equal(r.heading_matches[0].heading, 'Export before cancelling');

// 4. no fingerprints anywhere → ok with a warning, headings still checked
r = lifted(lifting, { pages: [{ url: 'u', headings: [{ level: 2, text: 'What happens when storage is full' }] }] }, { file: 'a.md' });
assert.equal(r.ok, false); assert(r.warning); assert.equal(r.matches.length, 0); assert.equal(r.heading_matches.length, 1);

// 5. a short overlap (8 words = one shingle) is not a match by default
const eight = `---\ntitle: "t"\n---\n# T\n\nWhen the storage is full, new recordings are kept.\n`;
r = lifted(eight, serp, { file: 'c.md' });
assert.equal(r.ok, true, 'one shingle is coincidence, not lifting');

console.log('lifted.js: ok (5 scenarios)');
