---
name: analysis
description: Turn the tracked keywords in /seo/strategy.md into scored backlog items, each with a content brief that write/refresh can execute without guessing. Seeded mode (tracked keywords via DataForSEO) always runs; discovery mode (Search Console via gsc.js + discover.js) runs when GSC is wired and adds refresh items for decaying, striking-distance and low-CTR pages, and rescores open items with real impressions. Honours the `proposed` gate from the keywords skill, scores potential on topic volume, spend-capped. Run weekly or on demand; idempotent within a day.
---

# analysis — seeded mode, plus discovery when GSC is wired

Input: `## Tracked keywords` in `/seo/strategy.md`, and — in discovery mode — the Search Console snapshot. Output: `/seo/inventory.json` (every public page of the site), items appended to `/seo/backlog.md`, one compact SERP context file per keyword under `/seo/data/serp/<date>/`, a rank snapshot in `/seo/data/ranks/<date>.json`, one commit. You never write articles and never ask the owner anything mid-run; decide, log, move on.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/inventory.js` scans the repo for public pages (no network, no cost). `${CLAUDE_PLUGIN_ROOT}/scripts/gsc.js` pulls Search Console (free, read-only) and `${CLAUDE_PLUGIN_ROOT}/scripts/discover.js` turns its snapshot into refresh candidates (no network). `${CLAUDE_PLUGIN_ROOT}/scripts/sitecheck.js` runs the validator over every article and checks hub↔spoke links (no network) for `fix` and `link` items. `${CLAUDE_PLUGIN_ROOT}/scripts/dfs.js` is a DataForSEO REST client that prints compact JSON (`check`, `serp`, `volume`, `difficulty`, `parse`). Credentials come from `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` in the environment. If the `dataforseo` MCP server is connected you may use its `api_request` tool with the same endpoint paths instead, but prefer the script: it strips a 200 KB SERP response to the twenty fields you need. Spend per keyword is ≈ $0.01–0.02; the summary reports the total.

## 0. Preconditions — stop on the first failure, print why

1. `/seo/strategy.md` exists, else `Run /seo-agent:init first` (or hand-write it; the contract is below).
2. `/seo/brand.json` exists (for `domain`), else `Run /seo-agent:brand first`.
3. `node ${CLAUDE_PLUGIN_ROOT}/scripts/dfs.js check` prints `{"ok":true,…}`. Exit 2 = credentials missing; exit 1 = API refused. Print the message and stop; never fall back to web search for SERP data.
4. Read `/seo/backlog.md` (create with a `# Backlog — <product>` heading if missing), `/seo/done.md`, `/seo/rejected.md` (treat missing as empty).
5. Read the `## SEO agent` block in `CLAUDE.md`: articles path, how a title and URL slug are found. Blade views without frontmatter are fine; the block says where the title lives.
6. **Search Console** — `node ${CLAUDE_PLUGIN_ROOT}/scripts/gsc.js check`. `ok: true` → discovery mode is on: `gsc.js site --days 28 --save seo/data/gsc` writes `/seo/data/gsc/<end>.json` (the window ends at today − 3; same day → overwrite). Anything else → print `GSC: not wired — seeded mode only` with the script's message and carry on; nothing below that mentions discovery runs.
7. **Inventory** — `node ${CLAUDE_PLUGIN_ROOT}/scripts/inventory.js --root .` writes `/seo/inventory.json`: one row per public page (path, file, kind, title, description, h1, h2s, word_count, images_dir, last_commit) merged from the articles glob in `CLAUDE.md`, `Route::view` entries, and the sitemap (`public/sitemap.xml`, or pass `--sitemap <file|url>`). Read the file. Its stdout lists `added`/`removed` since the previous inventory and pages with no source file; keep those for the summary. Pages of kind `legal`, `home`, `pricing` and `page` are never refresh targets, but they are link targets.

### `strategy.md` contract (what this skill reads)

```
## Clusters
- <cluster-name> (priority 1|2|3) — hub: </path or none> — <one line describing the spoke topics>
## Never write about
- <phrase or topic>; an item whose keyword or angle matches is dropped
## Caps
analysis_max_keywords: 5     analysis_budget_usd: 0.50     proposed_auto_accept_days: 7     discovery_max_items: 2
word_range: 1200–2200     location_code: 2840     language_code: en
## Tracked keywords
- <keyword> (cluster: <c>[, proposed <date>|gsc <date>, vol <n>, kd <n>, write|refresh:/path[, striking][, decaying]])   ← only the keyword is required
```

A keyword without a cluster tag is assigned the cluster whose name, hub or spoke line shares the most words with it; no overlap → `unclustered` (fit 4, reported).

## 1. Select keywords

A keyword is **pending** when no `backlog.md` item (any status except `dropped`) and no `done.md` line names it as `<type>: <keyword>` or in `target_keyword`. A keyword tagged `proposed <date>` is **waiting** until the owner removes the tag or `<date>` + `proposed_auto_accept_days` has passed; report waiting ones, never process them. Walk `## Tracked keywords` in order, skip non-pending and waiting ones, skip never-write matches (report them), stop after `analysis_max_keywords`. Nothing pending and no discovery candidates → print `backlog is current` (and `run /seo-agent:keywords` if nothing is waiting either) and stop. Before stopping, leave the tree clean: if `seo/inventory.json` or `seo/data/gsc/` changed in §0, commit them alone as `seo: inventory <date>` — a dirty tree blocks every other skill.

**One page, one item.** Two keywords can resolve to the same existing page (the strategy line's `refresh:/path`, or the coverage check in §2). If a pending keyword's refresh target already has an open backlog item, or an earlier keyword in this run already targets it, do not create a second item: fold the keyword into that item as `also_targets: <keyword> (vol <n>, kd <n>)`, add its PAA questions to `must answer`, and add its volume to that item's `topic_vol` (rescore the new item; never rescore an existing one, just append the `also_targets` line and note it in the summary). Folded keywords count toward `analysis_max_keywords` and still spend their SERP call, because their questions improve the brief.

Spend: note the run start `START=$(date -u +%FT%TZ)` (UTC, like the ledger); before each keyword, `dfs.js spend --since START`; if `total` ≥ `analysis_budget_usd`, stop taking new keywords and report the rest as `skipped: budget`.

### 1b. Discovery candidates (only when §0.6 said GSC is wired)

`node $P/scripts/discover.js --root . --max <discovery_max_items>` reads the snapshot just saved plus the inventory, strategy, backlog, done and rejected files and prints `candidates`, `skipped` and `tools`. It is deterministic and makes no network calls; do not second-guess its exclusions (recently done, rejected within 90 days, item in progress, never-write, non-article kinds) — report them. Each candidate names a page of ours, its `reasons` (`decaying`: impressions −30% vs the prior 28 days; `striking`: weighted position 8–20 above the impressions floor; `ctr-gap`: position ≤ 12, CTR < 1%, impressions ≥ 4× the floor), its top GSC query as `keyword`, the cluster, and `gsc_potential` (1–10 from impressions at stake).

The **gsc line** every discovery item carries, written at item level after `evidence`:
`- gsc: <END>: <reasons> — imps <prior>→<now> (<pct>%), pos <a>→<b>, ctr <x>%, top query "<q>" (<n> imps)`
A `ctr-gap` reason adds `; title/description rewrite in scope` — `refresh` reads that and may change them.

- **`annotate`** (an open item already targets the page): add the gsc line (replace an older one), then rescore: `potential = max(current potential, gsc_potential)`, `ease + 1` when `striking` (clamp 10), fit unchanged; rewrite the `- score:` line. No SERP call, no spend. Same date already on the line → no change. Report `rescored B-nnn 1.4 → 3.5`.
- **`new`**: a refresh keyword. If a tracked keyword or a strategy line `refresh:<path>` already names this page, that keyword is the item's keyword and the candidate's top query goes in `also_targets`; otherwise the candidate's `keyword` is the item's keyword (`keyword_source: h1` means GSC had no query rows for the page — say so in `evidence`). Then the keyword runs through §2–§5 exactly like a tracked one: it counts toward `analysis_max_keywords`, spends its SERP call, gets a full brief, `type: refresh`, `target: <path>`, plus the gsc line, and is scored with `potential = max(topic potential, gsc_potential)` and `ease + 1` when `striking`. Append its keyword to `## Tracked keywords` as `- <keyword> (cluster: <c>, gsc <END>, refresh:<path>[, striking][, decaying])` so `feedback` tracks its position — no `proposed` gate, because the evidence is our own traffic, not a guess. `human_edited` → the item is `status: open (human-edited <date>)` as in the hard rules.
- **`deferred`** (over `discovery_max_items`) and **`tools`** (a tool page with a signal; not a refresh target): summary only.

Order of spend: tracked pending keywords first (the owner chose them), then `new` discovery candidates in the order the script prints them, until `analysis_max_keywords` or the budget stops the run.

### 1c. Hygiene items — `fix` and `link` (always, no network, no spend)

`node $P/scripts/sitecheck.js --root .` prints `fixes` (validator findings the `fix` skill can apply mechanically: title/description length, canonical, ogImage, alt, broken internal link or anchor, sitemap), `report_only` (content problems: word count, h1/h2, placeholders, banned words, blade errors), `links` (missing `spoke→hub`, `hub→spoke`, `orphan` pairs per cluster) and `orphans`.

- One **`fix` item per page** with ≥ 1 entry in `fixes`, unless the page already has a `fix` item that is not `dropped`/`rejected` and not `done` more than 56 days ago, or the page is the target of an open/claimed/in-review `refresh` item (the refresh's validator pass fixes the head as part of that work; report `owned by B-nnn`). Item: `### [B-nnn] fix: <path>`, `- type: fix`, `- target: <path>`, `- fixes:` followed by one indented `<code>: <msg>` line per finding.
- One **`link` item per cluster** with ≥ 1 pair, unless an open/claimed/in-review `link` item for that cluster exists (then append the new pairs to it if it is `open`). Item: `### [B-nnn] link: <cluster>`, `- type: link`, `- links:` followed by one indented `/from → /to (<reason>)` line per pair.
- Score: `potential` = the page's `gsc_potential` from the snapshot when discovery ran (a `link` item: the highest among its `to` pages), else 3; `ease` 10; `fit` from the cluster priority. `evidence: sitecheck <date>: <n> findings` / `<n> missing links, <k> orphans`. No brief, no `serp_context`: these items carry their own work list.
- `report_only` goes in the summary only (word counts under the floor are refresh work, not fixes).

## 2. Gather, per keyword

Run from the product repo root. `<date>` is today, `<slug>` the keyword lowercased and hyphenated.

1. **SERP** — `node $P/scripts/dfs.js serp --keyword "<kw>" --location <code> --language <lang> --domain <domain>` → `top` (rank, url, domain, title), `paa`, `features`, `big_brands_in_top10`, `ours`.
2. **Overview** — one Labs call for the keyword *and* its PAA questions (punctuation stripped), pipe-separated: `dfs.js overview --keywords "kw|paa1|paa2"` → per row `volume`, `kd`, `intent` (informational | navigational | commercial | transactional), `cpc`. A keyword absent from the rows has no Labs data: fall back to `dfs.js volume` for it and treat KD as 50. Also read the latest `/seo/data/keywords/*.json`: if the keyword appears there, take its `variants` and `topic_volume`.
3. **Top pages** — for the first 5 `top` entries that are not forums, video, or our own domain (`reddit.com`, `quora.com`, `youtube.com`, `community.zoom.com`): `dfs.js parse --url <url>` → `headings`, `word_count`, `tables`, `date_hints`, `years`, `format_hints`. A failed parse (`error` or `status_code` ≥ 400) is skipped and noted; retry once with `--js` only if the page returned fewer than 100 words. If it still returns under 100 words (support.zoom.com does this), fetch the URL with WebFetch, take the headings and an approximate word count from the returned text, and mark the source `(fetched)`; only if that fails too is it `(unparsed)`.
4. **Our coverage** — match the keyword and each PAA question against `/seo/inventory.json`: a page **covers** a query when its title, h1 or path shares most of the query's content words (ignore stop words and "zoom"); a match only in the description or an h2 makes the page **related**, not covering, because descriptions name every sibling topic. Only `guide`, `article` and `tool` pages can cover. Also use `ours` from the SERP. Record the best covering page as `existing: </url-path>` (file from the inventory) and every other related page, tools included, as `related: [paths]` for the internal-links line. A query covered only by a `tool` page is not a write candidate: it becomes a `refresh` of that tool page's copy only if the tool page is of kind `tool` and the keyword is informational; otherwise skip it and report `covered by tool`.

Save the four results merged into `/seo/data/serp/<date>/<slug>.json` (`{keyword, serp, volume, difficulty, pages: [...], existing}`); `write` reads it later as `serp_context`; keep each page's `shingles` (the fingerprint `parse` returns — `lifted.js` needs it for the lifted-sentence check, and no competitor text is stored). Never parse more than 5 pages per keyword; never fetch anything except through `dfs.js`.

## 3. Decide, per keyword

- **Intent**: start from the Labs `intent` of the keyword, then refine by SERP format: informational pages that are step lists → `how-to`; commercial with "vs"/"best"/"alternative" or comparison tables in the top 5 → `comparison`; calculators/converters in the top 5 → `tool`. Record as `<labs intent> → <brief intent>`, plus one line on who searches it (role, moment, what they already tried).
- **Type**: `refresh` when `existing` is set and that page targets the keyword or a PAA question directly; else `write`. A refresh item's `target` is the existing URL path.
- **Must cover**: the 3–6 H2-level topics that appear (by meaning, not exact words) in at least 3 of the parsed pages. Fewer than 3 pages parsed → use what you have and say so in `evidence`.
- **Must answer**: the PAA questions verbatim, max 6, most relevant first.
- **Angle**: what none of the top pages do well, what is stale (`date_hints`/`years` older than last year, plan limits or prices that changed), and where the product has a legitimate take — stated so a reader would notice the difference. "More comprehensive" is not an angle.
- **Format**: the majority among parsed pages (`guide | how-to | listicle | comparison`); word range = median parsed `word_count` ± 20%, clamped to `word_range` from strategy.
- **Images**: 3–5 frame types from `hero stat compare steps quote` chosen from the expected structure (a number → `stat`, a table → `compare`, ordered steps → `steps`, one takeaway → `quote`); `hero` always. Nothing else: the frame kit is the only image source.
- **Internal links**: the cluster hub, plus up to 3 pages from `related` in step 2.4 or the same cluster, as URL paths. Prefer a tool page when the brief's must-cover includes a number the tool computes (storage, file size, audit).
- **Avoid**: definition intros, topics the `existing`/sibling guides already own, never-write items, competitor brand names as headings.
- **Sources**: the parsed URLs.

## 4. Score

```
topic_vol = keyword volume + Σ PAA volumes (overview rows) + Σ variant volumes (keywords pool), each keyword counted once
potential: topic_vol <20 → 1 · <100 → 3 · <300 → 5 · <1000 → 7 · <5000 → 9 · else 10
           −1 if ai_overview present · −1 if big_brands_in_top10 ≥ 3            (floor 1)
ease:      KD ≤10 → 10 · ≤25 → 8 · ≤40 → 6 · ≤60 → 4 · else 2
           −1 if featured snippet is held by a big brand · −1 if ≥3 parsed pages exceed 2500 words
           +2 if type is refresh                                                  (clamp 1–10)
fit:       cluster priority 1 → 9 · 2 → 7 · 3 → 5 · unclustered → 4 · never-write match → dropped
score = round(potential × ease × fit / 100, 1)        (max 9.0)
```

Write all three components into the item so the owner can argue with them.

## 5. Write the backlog

Append new items to `/seo/backlog.md`, highest score first among the new ones. Never reorder, edit or delete existing items. IDs continue from the highest `B-nnn` across `backlog.md` and `done.md`.

```
### [B-<id>] <write|refresh>: <keyword>
- type: write | refresh
- cluster: <name>
- target: </existing/path>            ← refresh only
- also_targets: <keyword> (vol <n>, kd <n>)   ← only when a second keyword folded into this item (§1)
- score: <n> (potential <p> × ease <e> × fit <f>)
- evidence: vol <n>/mo (topic <n>: kw + <n> PAA + <n> variants), KD <n>, intent <labs>, top5 median <n> words, features: <list>, ours: <rank or none>, pages parsed <n>/5
- status: open
- brief:
  intent: <type>, <who>
  must cover: <topic; topic; topic>
  must answer: <PAA verbatim> | <PAA verbatim>
  angle: <one or two sentences>
  format: <format>, <min>–<max> words
  images: <hero, stat, …>
  internal links: </hub>, </sibling>
  avoid: <list>
  sources: <url>, <url>
  serp_context: seo/data/serp/<date>/<slug>.json
```

## 6. Snapshot and commit

1. `/seo/data/ranks/<date>.json`: `{ date, location_code, keywords: { "<kw>": { ours: <rank|null>, our_url, volume, kd, top10: [{rank, domain, url}], features: {...} } } }`. Overwrite on the same date.
2. `git add seo/backlog.md seo/inventory.json seo/data/` (includes `seo/data/spend.jsonl` and `seo/data/gsc/`), plus `seo/strategy.md` when §1b appended a keyword line, and commit on the current branch: `seo: analysis <date> — <n> items, <m> skipped[, <k> rescored]`. No branch, no PR: planning files commit directly.
3. A cluster hub that is `none` or missing is not invented; the item links to siblings only and the summary says which cluster needs a hub.

## 7. Summary (≤ 12 lines, printed last)

- keywords processed / waiting (proposed, with the date they auto-accept) / skipped, each skip with its reason (already in backlog, never-write, budget, API error)
- new items: `B-id score type keyword` one per line, top first; discovery items carry their reasons (`decaying`, `striking`, `ctr-gap`)
- hygiene: fix/link items created (id, path or cluster, count), pages skipped because a refresh owns them, `report_only` findings (≤ 5 lines, grouped by code)
- discovery: window and floor; `rescored B-nnn old → new (reasons)`; deferred candidates and tool-page signals (path, reasons); the script's `skipped` list with reasons; or `GSC: not wired`
- inventory: page count, pages added/removed since last run, pages without a source file
- misses: failed parses, keywords with no volume data, unclustered keywords, clusters without a hub
- DataForSEO spend this run from `dfs.js spend --since START`, against `analysis_budget_usd`
- `node ${CLAUDE_PLUGIN_ROOT}/scripts/dashboard.js --product <name> --event analysis` with that summary as JSON if the script exists; otherwise skip silently

## Hard rules

- No article writing; no edits outside `/seo/`
- `fix` and `link` items come only from `sitecheck.js` output, never from judgement; one per page / per cluster
- GSC is read-only and free; discovery never creates `write` items (gaps are `keywords`' job), never rescores a claimed, in-review or blocked item, never adds a second item for a page, and never bypasses the done/rejected cool-downs `discover.js` applies
- SERP, volume and difficulty data only from DataForSEO through `dfs.js` (or the MCP `api_request` tool); WebFetch is allowed only as the fallback for a competitor page the parser returned empty. If DataForSEO fails mid-run, finish the keywords already gathered and report the rest as skipped
- Never process a `proposed` keyword before its gate opens; never exceed `analysis_budget_usd`
- ≤ 5 parsed pages per keyword, ≤ `analysis_max_keywords` keywords per run
- Never a second item for a keyword that already has one; never score a never-write item
- Every brief carries a `serp_context` path; `write` refuses items without one
- A refresh target whose `last_commit` in the inventory is a non-agent commit within 14 days is still briefed, but the item is marked `status: open (human-edited <date>)` so `refresh` waits
