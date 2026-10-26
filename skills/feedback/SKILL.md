---
name: feedback
description: Monthly learning pass. Pulls Search Console through gsc.js — a 28-day site snapshot, a 4-week (then 12-week) outcome for every merged item in done.md, tracked-keyword positions — and turns recurring rejection and review findings into proposed voice.md / review-rubric.md lines via one PR. Read-only on GSC, never edits the rules directly, never touches the backlog.
---

# feedback — did it work, and what should change

Everything upstream guesses: volume from DataForSEO, intent from the SERP, quality from a rubric. This is the skill that checks the guesses against Search Console and against what the owner actually rejected. It writes outcomes into `done.md`, saves a snapshot that `analysis` discovery mode will read, and proposes rule changes as a PR the owner can read in a minute.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/gsc.js`. Set `P=${CLAUDE_PLUGIN_ROOT}`.

Arguments: `--days 28` (window), `--no-pr` (print proposed rule lines instead of opening a PR), `--outcomes-only` (skip themes).

## 0. Preconditions — stop on the first failure, print why

1. Product repo root; `git status --porcelain` empty; on the default branch.
2. `/seo/done.md`, `/seo/rejected.md`, `/seo/backlog.md`, `/seo/strategy.md`, `/seo/voice.md`, `/seo/review-rubric.md` exist.
3. `node $P/scripts/gsc.js check` prints `ok: true`. Otherwise stop with the setup the owner has to do, verbatim from the error:
   - enable the Google Search Console API in the Cloud project, create a service account, download its JSON key;
   - in Search Console › Settings › Users and permissions, add the account's `client_email` (Restricted is enough);
   - `export GSC_SA_FILE=/path/to/key.json` (or `GSC_SA_JSON` with the JSON on one line); `GSC_SITE=sc-domain:<domain>` if the property is not derivable from `seo/brand.json`.
   Print `GSC: not wired` and stop; nothing else in this skill works without it.
4. `END` = the `to` date `gsc.js` reports (today − 3, the data lag). `TODAY` = today's date.

## 1. Site snapshot

`node $P/scripts/gsc.js site --days <days> --save seo/data/gsc` → `seo/data/gsc/<END>.json` with totals (now vs prior window), every page with its delta and `decaying` flag, `striking` queries (positions 8–20, impressions ≥ the `min_impressions` floor the script derives from site size, 10–100) and `top_queries`. Keep for the summary: totals delta, the decaying pages (path, impressions now vs prior), striking count. Do not act on them here; `analysis` reads this file.

**Tracked keywords.** For each line under `strategy.md › ## Tracked keywords` (ignore `proposed` ones), find the exact query in `top_queries` (case-insensitive) → position and impressions now; and in the previous snapshot in `seo/data/gsc/` (the newest file older than 21 days, if any) → position then. Table for the summary: keyword, pos now, pos before, impressions. Not in the data → `—`.

## 2. Outcomes in done.md

`done.md` lines look like `- <merge date> <id> <type> <path> pr#<n>[ | outcome <date>: …][ | 12w <date>: …]`. Never rewrite any other text on a line.

For each line **without** `| outcome` whose merge date + 28 + 3 ≤ `TODAY`:
- `node $P/scripts/gsc.js page --path <path> --days 28 --baseline-end <merge date − 1 day>` → current = the 28 days ending `END`; baseline = the 28 days before the merge.
- `type: write` (no baseline by definition): append ` | outcome <TODAY>: new page — pos <b>, <m> clicks, <n> imps` ; with zero impressions: ` | outcome <TODAY>: no impressions yet`.
- `type: refresh`: append ` | outcome <TODAY>: pos <a>→<b>, clicks <sign><x>% (<n>→<m>), imps <n>→<m>`; the position arrow uses the weighted positions from the two windows; a `note` from the script (no baseline, no impressions) replaces the numbers.

For each line **with** `| outcome` and **without** `| 12w` whose merge date + 84 + 3 ≤ `TODAY`: same call, append ` | 12w <TODAY>: …` in the same shape.

Count: outcomes written, 12w written, lines not yet due (with the first due date).

## 3. Rejection and review themes (skip with `--outcomes-only`)

Sources, newest 90 days:
- `rejected.md` lines: the owner's reason in quotes.
- Review findings: `gh pr list --label <PR label> --state all --search "label:seo" --json number,comments` → in each comment headed `<!-- seo-review round k: needs-work -->` the **Blocking** items; keep the rule each one cites (`voice.md › …`, `review-rubric.md › …`, a skill invariant) and the one-line problem.

Group by theme: the same rule cited, or the same owner phrase (plain-language match, not exact string). For each theme count occurrences across both sources.

- **≥ 3** → draft one rule line: a tone/structure/wording theme → a line for `voice.md` (under the matching section; a banned pattern goes under `## Banned words and patterns`); a checkable theme → a line for `review-rubric.md › Product-specific checks` (or `Automatic fails` when the owner's words were "never"). Quote the three occurrences under it as an HTML comment so the owner sees the evidence. A theme that already has a rule (the findings cite it) means the rule exists and is being caught — note it as `enforced n×`, do not add a duplicate; if the same rule is hit ≥ 3 times by **write/refresh output**, propose instead a `voice.md` good/bad paragraph pair showing the fix, because the rule is not teaching.
- **1–2** → watch list in the summary only.

With proposals and not `--no-pr`: branch `seo/feedback-<TODAY>` from the default branch, apply the lines, commit `seo: feedback <TODAY> — <n> rule lines`, push, `gh pr create --label <PR label> --title "seo: feedback <TODAY> — <n> proposed rule lines"` with a body listing each line, its file and section, and the occurrences. Return to the default branch. With `--no-pr`: print the lines. No proposals → say so.

## 4. Commit and report

On the default branch: `git add seo/done.md seo/data/gsc/` → commit `seo: feedback <TODAY> — <n> outcomes, <m> themes`, push. Nothing changed → no commit.

Summary ≤ 14 lines:
- window and totals: clicks and impressions now vs prior, average position
- outcomes written (one line each: id, path, the appended text), 12w written, not yet due (count, next due date)
- tracked keywords table (≤ 10 rows)
- decaying pages (≤ 5) and striking count — "for analysis, not acted on here"
- themes: proposed (PR URL), enforced, watch list
- anything unmeasurable (page missing from GSC, property mismatch)

## Hard rules

- GSC is read-only; no DataForSEO calls; no other network except `git` and `gh`
- `done.md`: append outcome segments only; never rewrite, reorder or delete a line
- `voice.md` and `review-rubric.md` change only through the feedback PR; never on the default branch
- Never touches `backlog.md`, `strategy.md`, articles, or any open PR
- One PR per run at most; re-run the same day → outcomes already written are not rewritten, a feedback branch that exists → no second PR
