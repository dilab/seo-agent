# crawl.js test

`node test/crawl/run.js` starts a local HTTP server on an ephemeral port with planted faults (missing description, two h1s, image without alt, thin page, duplicate titles, canonical mismatch, broken and redirecting internal links, a two-hop chain, a guide missing from the sitemap, an orphan, a noindex page in the sitemap, a sitemap URL that 404s, a broken external link) and asserts every finding code, the fix/report severity split, `follow()` hop counting and `diffFindings()`. No network.
