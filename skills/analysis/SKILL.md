---
name: analysis
description: Turn seed keywords in /seo/strategy.md into scored backlog items with content briefs. Run weekly or on demand. Seeded mode only (no GSC yet).
---

# analysis — seeded mode

You turn each tracked keyword into a backlog item with a content brief that `write` can execute without guessing. You never write articles. You never ask the owner questions mid-run.

## 0. Preconditions

1. Read `/seo/strategy.md`. If missing, print `Run /seo-agent:init first` and stop.
2. Read `/seo/backlog.md` (create empty if missing), `/seo/done.md`, `/seo/rejected.md`.
3. Read the `## SEO agent` block in `CLAUDE.md` to learn the articles path and frontmatter.
4. Verify DataForSEO: call `serp_locations` with a trivial query. If it fails, print the error and stop.
5. Parse from `strategy.md`: `## Tracked keywords`, `## Never write about`, `## Clusters`, `## Caps`, word range.

## 1. Select keywords to process

A keyword is **pending** if no backlog item (any status except `dropped`) and no `done.md` line references it. Process pending keywords in `strategy.md` order, up to `analysis_max_keywords` from `## Caps` (default 5 per run). Keywords matching the never-write list are skipped and reported.

Idempotency: if `backlog.md` already has an item for a keyword, do not create another.

## 2. Gather, per keyword

Run these and keep the raw results in memory (you will save a snapshot in step 6):

1. **SERP** — `serp_organic_live_advanced` with `keyword`, `location_code` from `strategy.md` (default 2840 US), `language_code: en`, `depth: 10`. Extract:
   - top 10: url, domain, title, rank
   - `people_also_ask` questions, verbatim
   - presence of `featured_snippet`, `ai_overview`, `video`, `knowledge_graph`
   - which of the top 10 are our own domain (from `brand.json` or `strategy.md`)
2. **Volume** — `kw_data_google_ads_search_volume` for the keyword and its PAA questions; record monthly volume and competition.
3. **Top pages** — for the top 5 non-forum, non-video URLs: `on_page_content_parsing` → headings (H1–H3), word count, publish/updated dates if present, tables present. If parsing fails for a URL, skip it and note it.
4. **Our coverage** — grep the articles path for the keyword and its PAA questions in `title`, `target_keyword`, headings. Record any match as `existing: <path>`.

Do not read more than 5 competitor pages per keyword. Do not fetch anything except through the tools above.

## 3. Decide, per keyword

- **Intent**: one of `informational | how-to | comparison | tool | transactional`, plus one line on who is searching (role, situation).
- **Type**: `refresh` if `existing` matches the keyword or a PAA question directly; otherwise `write`.
- **Angle**: what none of the top 5 cover well, what is outdated (dates, plan limits, prices), where the product has a legitimate unique take. The angle must be something a reader would notice, not "more comprehensive".
- **Must cover**: the 3–6 H2-level topics that appear in ≥3 of the top 5.
- **Must answer**: the PAA questions, verbatim, max 6.
- **Format**: majority format among top 5 (`guide | listicle | comparison | how-to`) and word range = median top-5 word count ±20%, clamped to the range in `strategy.md`.
- **Images**: suggest 3–5 from the catalogue (`hero, illustration, stat, compare, steps, quote`) based on structure: numbers → `stat`, a table → `compare`, ordered steps → `steps`. AI `illustration` ≤ `images_per_article` (default 2).
- **Internal links**: the cluster hub from `strategy.md` plus up to 3 existing articles found in step 2.4 or in the same cluster.
- **Avoid**: generic definition intros, topics already covered by `existing` articles, anything on the never-write list, competitor brand names as headings.

## 4. Score 1–10

```
potential = log-scaled volume (0 vol → 2, 100 → 5, 1000 → 8, 5000+ → 10)
            −1 if ai_overview present, −1 if ≥3 of top 10 are DA-dominant brands (zoom.us, google.com, microsoft.com and similar)
ease      = 10 − (count of top-5 pages > 2500 words) − (featured_snippet ? 1 : 0) + (type == refresh ? 2 : 0), clamp 1–10
fit       = cluster priority 1 → 9, 2 → 7, 3 → 5; 0 if never-write list matches (item dropped, reported)
score     = round(potential × ease × fit / 100, 1)
```

Record the three components in the item so the owner can argue with them.

## 5. Write the backlog

Append items to `/seo/backlog.md` in score order among new items; never reorder or edit existing items except to leave them in place. Item format:

```
### [B-<next id>] <type>: <keyword>
- type: write | refresh
- cluster: <name>
- target: <existing path, refresh only>
- score: <n> (potential <p> × ease <e> × fit <f>)
- evidence: vol <n>/mo, top5 median <words> words, features: <list>, ours: <rank or none>
- status: open
- brief:
  intent: <type>, <who>
  must cover: <topics>
  must answer: <PAA verbatim>
  angle: <one or two sentences>
  format: <format>, <min>–<max> words
  images: <types>
  internal links: <paths>
  avoid: <list>
  sources: <top-5 URLs>
```

IDs: find the highest `B-nnn` in `backlog.md` and `done.md`, continue from there.

## 6. Save snapshot and commit

1. Write `/seo/data/ranks/<YYYY-MM-DD>.json`: per keyword → our rank, top 10 (url, domain), features, volume. Overwrite if same date.
2. `git add seo/backlog.md seo/data/ranks/` and commit on the current branch: `seo: analysis <date> — <n> items added, <m> skipped`. Do not open a PR; planning files commit directly.
3. If `strategy.md` is missing a cluster hub that the new items need, do not invent one; note it in the summary.

## 7. Summary (print, ≤12 lines)

- keywords processed / skipped (with reason)
- new items by type with score
- top 3 items in one line each
- anything missing: failed tool calls, unparsable pages, unknown hub
- call `scripts/dashboard.js --product <name> --event analysis` with the same summary as JSON, if the script exists; otherwise skip silently

## Hard rules

- No article writing, no file edits outside `/seo/`
- Never more than 5 competitor pages per keyword, never more than `analysis_max_keywords` keywords per run
- Never create a second item for a keyword that already has one
- Never score an item on the never-write list; drop and report
- If DataForSEO returns an error mid-run, finish the keywords already gathered, report the rest as skipped
