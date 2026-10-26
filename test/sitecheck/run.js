// Unit checks for sitecheck.js helpers. Run: node test/sitecheck/run.js
const assert = require('assert');
const { internalLinks, parseClusters, assignCluster } = require('../../scripts/sitecheck.js');

const names = new Map([['guides.hub', '/hub-page'], ['pricing', '/pricing']]);
const blade = `
<a href="{{ route('guides.hub') }}">hub</a>
<a href="{{ url('/spoke-one') }}">one</a>
<a href="/spoke-two#faq">two</a>
<a href="https://zoom.us/x">ext</a>
<a href="#top">anchor</a>
<a href="{{ $dynamic }}">dyn</a>
@foreach ($x as $y) {{ route('pricing') }} @endforeach
`;
assert.deepStrictEqual([...new Set(internalLinks(blade, names, false))].sort(), ['/hub-page', '/pricing', '/spoke-one', '/spoke-two']);
assert.deepStrictEqual(internalLinks('[a](/md-page) [b](https://x.y) [c](#h)', names, true), ['/md-page']);

const clusters = parseClusters(`## Clusters ★
- storage (priority 1) — hub: /storage-limits — plan caps, storage full
- download (priority 2) — hub: none — bulk download, recover deleted recordings
`);
assert.strictEqual(clusters.length, 2); assert.strictEqual(clusters[1].hub, null);
const backlog = `### [B-009] write: where do recordings go\n- type: write\n- cluster: download\n- status: done:2026-10-24\n`;
const done = `# Done\n- 2026-10-24 B-009 write /where-do-recordings-go pr#1\n`;
assert.strictEqual(assignCluster({ path: '/storage-limits', title: '' }, clusters, '', '').name, 'storage');            // hub match
assert.strictEqual(assignCluster({ path: '/where-do-recordings-go', title: 'Where Do Recordings Go?' }, clusters, backlog, done).name, 'download'); // merged write item
assert.strictEqual(assignCluster({ path: '/storage-full', title: 'Storage Full? Fix It' }, clusters, '', '').name, 'storage'); // stem overlap
assert.strictEqual(assignCluster({ path: '/unrelated', title: 'Something Else' }, clusters, '', ''), null);
console.log('sitecheck helpers: ok');
