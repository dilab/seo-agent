# sitecheck.js tests

`node test/sitecheck/run.js` — unit checks for link extraction (route/url/href/markdown, dynamic and external ignored), cluster parsing, and cluster assignment (hub match → merged write item via done.md + backlog → stem overlap → null).

Integration: run `node scripts/sitecheck.js --root ../recordmover` from the plugin root. On 2026-10-26 it reported 6 fixable findings on two guides (204/216-char descriptions, no canonical, no ogImage), 7 report-only word-count failures, 3 missing links in `download-recover` and one orphan (`/where-do-zoom-recordings-go`).
