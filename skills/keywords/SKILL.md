---
name: keywords
description: Discover and rank keyword candidates per cluster from DataForSEO Labs (suggestions, ideas, our ranked keywords, competitor gaps), check them against the site inventory, and propose additions to the Tracked keywords list in /seo/strategy.md with a `proposed` tag. Run monthly, on demand, or whenever analysis reports the backlog is current. Spend-capped.
---

# keywords — keyword discovery

You keep `## Tracked keywords` in `/seo/strategy.md` stocked so `analysis` always has pending work, including `write` candidates the site does not cover yet. You never write briefs (that is `analysis`) and never ask the owner anything mid-run.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/inventory.js` (site pages, free) and `${CLAUDE_PLUGIN_ROOT}/scripts/dfs.js` (DataForSEO; every call is logged to `seo/data/spend.jsonl`). Set `P=${CLAUDE_PLUGIN_ROOT}`.

## 0. Preconditions — stop on the first failure, print why

1. `/seo/strategy.md` and `/seo/brand.json` exist (else `Run /seo-agent:init` / `brand first`).
2. `node $P/scripts/dfs.js check` prints `{"ok":true,…}`.
3. `node $P/scripts/inventory.js --root .` then read `/seo/inventory.json`.
4. Read `/seo/backlog.md` and `/seo/done.md` (missing = empty) for keywords already in play.
5. From `strategy.md` read `## Clusters`, `## Competitors`, `## Never write about`, `## Tracked keywords`, and from `## Caps`: `discovery_budget_usd` (default 1.00), `discovery_per_cluster` (default 5), `location_code` (2840), `language_code` (en).
6. Note the run start as `START=$(date -u +%FT%TZ)` (UTC; the ledger is UTC). Spend check used before every call:
   `node $P/scripts/dfs.js spend --since START` → if `total` ≥ budget, stop gathering and continue with what you have.

## 1. Competitors (1 call)

`dfs.js competitors --target <domain> --limit 15`. A new or small domain returns 0 rows (it is not in the intersection index yet); then fall back to `dfs.js serp-competitors --keywords "<all tracked keywords, untagged first, ≤200>" --limit 15 --exclude <our domain>`, which lists the domains ranking for our keyword set (`intersections` = how many of them). Either way: drop rows with `noise: true` (big brands, forums, `.edu`/`.gov`) and `ours: true`; drop a domain whose site is not about the product's subject (a general tech blog ranking for one keyword is not a competitor); keep the top 5 by `intersections`, ties by `avg_position`. Merge into `## Competitors`: keep every owner line as is; append new domains as `- <domain> (proposed <date>, <intersections> shared keywords)`. Never remove a line. Competitors used below = owner-listed (untagged) first, then proposed, max 5 in total. Record in the run notes which call produced them.

## 2. Candidate pool

For each cluster in priority order:

1. **Seeds** (max 3, each 2–3 words): `suggestions` returns keywords that *contain* the seed, so a seed must be a head phrase people actually type, not a page title. Build each from the cluster's hub title, name and tracked keywords by keeping the product-subject noun plus one modifier (`zoom cloud storage`, `zoom recording retention`, `download zoom recordings`); never a seed longer than 4 words. If the hub is `none`, derive from the cluster's spoke line.
2. `dfs.js suggestions --keyword "<seed>" --limit 200 --min-volume 20 --max-kd 60` per seed. Dedupe seeds across clusters (one call per distinct seed; rows go to every cluster that asked, cluster assignment is settled in §5).
3. **Broad seeds** (once per run, after the cluster seeds): if a cluster's seeds together returned fewer than 20 rows, also run `suggestions` for the 1–2 broadest subject phrases (`zoom recording`, `zoom recordings`) with `--limit 500`, and assign their rows to clusters by content words in §5. These catch the long tail the narrow seeds miss; the 200 cap on a broad seed otherwise truncates at ~50 vol.
4. `ideas` is optional: skip it when the site has fewer than ~50 pages or the strategy clusters are all one subject, because it returns category head terms (`zoom`, `zoom download`) that are off-subject at this scale and costs 3× a `suggestions` call. When used, make **one** call per run with all cluster seeds (≤200), not one per cluster.

Once per run, not per cluster:

5. `dfs.js ranked --target <our domain> --limit 500 --max-rank 30 --min-volume 20` → what we already rank for; rows with `rank` 4–30 are **striking**.
6. `dfs.js ranked --target <competitor> --limit 300 --max-rank 20 --min-volume 20` per competitor → gap candidates. Skip (and say so in the summary) when §1 found no competitor.

Check spend before each call. Keep every row with its source (`suggestions:<seed>`, `ideas:<cluster>`, `ranked:ours`, `ranked:<competitor>`).

## 3. Filter

Drop a candidate when any of these holds:
- `volume` < 20 or `kd` > 60 (server filters already apply; re-check because `ranked` rows may lack KD)
- `intent` is `navigational`, or the keyword is a product/brand name query for another company (e.g. contains "zapier", "otter", a competitor domain name) unless the cluster is a comparison cluster
- it matches `## Never write about`
- it is already in `## Tracked keywords`, or named in a `backlog.md` item or a `done.md` line
- it is not about the product's subject at all (the cluster seeds and the ICP decide; a Google Meet or Teams query is out unless the strategy has such a cluster)

## 4. Topic grouping

Fold near-duplicates into one topic: same content-word set ignoring order and stop words ("zoom storage limit" = "limit zoom storage"), one keyword is the other plus a filler word ("zoom cloud storage limit" / "zoom cloud storage limits") with the same intent, or the keywords are synonym phrasings of one question that a single page answers in full (find / locate / access / where … go / where … saved; delete / remove; "not showing up" belongs with "how long to process"). The test is: would one article with one H1 satisfy every variant? If a variant needs its own section with a different answer (mac vs windows, cloud vs local), it stays a variant; if it needs its own page, it is a separate topic. Canonical = highest volume; keep the rest as `variants` with volumes. `topic_volume` = sum over the group. A topic with more than ~30 variants is a hub-level subject; keep it, but say so in the summary so the owner can decide whether it deserves two pages.

## 5. Coverage and cluster

- Assign the cluster: the cluster whose seeds produced it; a `ranked` row goes to the cluster whose hub or spoke line shares the most content words, else `unclustered`.
- Match canonical and variants against `/seo/inventory.json` with the `analysis` rule: a page **covers** when its title, h1 or path shares most content words; description/h2 matches only make it **related**. Only `guide`, `article` and `tool` pages can cover.
- Type: covered → `refresh:/path`; else `write`. Rows from `ranked:ours` with rank 4–30 also get `striking`.

## 6. Rank and select

```
score = topic_volume × (1 − kd/100) × cluster_weight     (priority 1 → 1.0, 2 → 0.8, 3 → 0.6, unclustered → 0.5)
```
Per cluster keep the top `discovery_per_cluster`; if the cluster has any `write` candidate, at least one of the kept ones is a `write`. Unclustered candidates: keep at most 3 overall and report them so the owner can add a cluster.

## 7. Write

Append to `## Tracked keywords`, grouped by cluster, one line each:

```
- <keyword> (cluster: <c>, proposed <YYYY-MM-DD>, vol <topic_volume>, kd <n>, <write|refresh:/path>[, striking])
```

Never remove, reorder or retag existing lines. Save the whole pool to `/seo/data/keywords/<date>.json`:
`{ date, budget, spend, competitors: [...], clusters: { <name>: [ { keyword, variants: [{keyword, volume}], topic_volume, kd, intent, source, type, rank_ours, score, kept } ] }, unclustered: [...] }`.
Commit on the current branch: `git add seo/strategy.md seo/data/keywords seo/data/spend.jsonl` → `seo: keywords <date> — <n> proposed, spend $<x>`.

## 8. Summary (≤ 12 lines)

- per cluster: kept keywords as `keyword (vol, kd, type)`
- competitors found / kept, and which call found them (`competitors` or `serp-competitors` fallback)
- any topic with more than ~30 variants (hub-level subject)
- candidates gathered → after filter → after grouping
- spend vs budget, and whether the cap stopped gathering early (which calls were skipped)
- unclustered keywords, if any

## Hard rules

- Spend check before every DataForSEO call; never exceed `discovery_budget_usd`
- No SERP calls, no page parsing here; `analysis` does that per keyword
- Edits only to `## Competitors` and `## Tracked keywords` in `strategy.md`, plus `seo/data/`
- Never propose a keyword already tracked, backlogged or done; never propose a never-write match
