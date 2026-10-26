# seo-agent (plugin)


## Try it locally
```
npm install && npx playwright install chromium
cd ../recordmover
claude --plugin-dir ../seo-agent
/seo-agent:brand        # extracts seo/brand.json + CLAUDE.md design block
/seo-agent:frames       # installs seo/frames, renders seo/frames/contact-sheet.png
```
Without a repo: `cd test && node ../scripts/render.js --contact-sheet --brand seo/brand.json --frames seo/frames --out seo/frames/contact-sheet.png`

```
/seo-agent:init         # bootstrap a product repo: CLAUDE.md block, strategy/voice drafts, brand + frames, bookkeeping files (re-runnable, fills gaps only)
/seo-agent:keywords     # discover + rank keyword candidates per cluster (DataForSEO Labs), propose them in seo/strategy.md
/seo-agent:analysis     # seeded mode: tracked keywords in seo/strategy.md → seo/backlog.md items with briefs
/seo-agent:write        # top open write item → article in the repo's own format + frame-kit images → one PR labelled seo (--no-pr without gh)
/seo-agent:refresh      # top open refresh item → additive edit of the existing article (keep/add/change plan, 14-day human-edit guard, rewrite guard) → one PR labelled seo
/seo-agent:review       # fresh session: sweeps merged/closed SEO PRs into done.md/rejected.md, reviews the rest against brief + voice + rubric + rejected.md → label ready (auto-merge per strategy) or needs-work with file:line fixes; escalate after 2 rounds
/seo-agent:revise       # apply a needs-work review's fixes to its PR (only those), re-validate, push, reply, hand back to review; write/refresh run this first when such a PR exists
/seo-agent:feedback     # monthly: GSC snapshot to seo/data/gsc, 4-week/12-week outcomes appended to done.md, tracked-keyword positions, rejection themes → one PR proposing voice/rubric lines
```
Loop: `keywords` proposes (tagged `proposed <date>`), the owner prunes or waits 7 days, `analysis` briefs what is accepted, `write`/`refresh` execute. Every DataForSEO call is logged to `seo/data/spend.jsonl`; `node scripts/dfs.js spend --since <iso>` sums it, and both skills stop at the caps in `## Caps` (`discovery_budget_usd`, `analysis_budget_usd`).

## Env
`GSC_SA_FILE` (path to a Google service-account JSON) or `GSC_SA_JSON` (the JSON on one line), optional `GSC_SITE` (`sc-domain:example.com`) — needed by `feedback` and discovery-mode `analysis`. Share the Search Console property with the account's `client_email`, enable the Search Console API in the Cloud project, then check with `node scripts/gsc.js check`. Honours `https_proxy`.

`DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` — needed by `analysis` (REST via `scripts/dfs.js`; `.mcp.json` passes the same vars to the DataForSEO MCP server). Check with:
```
node scripts/dfs.js check
```
`analysis` first runs `scripts/inventory.js`, which writes `seo/inventory.json` (every public page: title, headings, word count, last commit) from the articles glob in CLAUDE.md, Laravel `Route::view` entries and `public/sitemap.xml`. Try it alone with `node ../seo-agent/scripts/inventory.js --root .` inside the product repo.

`node scripts/validate-article.js --file <article>` checks one article before a PR (title/description lengths, route and canonical, internal links and anchors, images and alt text, headings, word range from `## Caps`, banned words from `seo/voice.md`, placeholders; sitemap and hub link as warnings). Exit 0/1 with a JSON report; `--words-warn` downgrades the word-range check for legacy pages.

`analysis` needs `seo/strategy.md` with `## Clusters`, `## Never write about`, `## Caps` and `## Tracked keywords` (contract in `skills/analysis/SKILL.md`). Each analysis keyword costs about one to two cents of DataForSEO credit (SERP, Labs overview, five page parses); a keywords run over five clusters is roughly $0.50–1.00.

Setup, weekly cadence, stop messages: see [RUNBOOK.md](RUNBOOK.md).
