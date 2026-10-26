Fixtures for `scripts/gsc.js` aggregators (no credentials needed):

    node scripts/gsc.js extract --kind page --input test/gsc/page.json
    node scripts/gsc.js extract --kind site --input test/gsc/site.json

Expected: page → clicks +38%, position −2.2, 2 top queries; site → 2 decaying pages, 2 striking queries, 4 top queries.
