---
name: refresh
description: Take the top open `refresh` item from /seo/backlog.md, improve the existing article it targets from its brief and SERP context — add the sections the SERP rewards, answer the missing questions, fix meta, add frame images for new structure — keep everything the owner wrote that still holds, validate, and open one PR labelled `seo`. One article per run, capped by strategy.md; nothing publishes without the PR.
---

# refresh — improve one existing article, one PR

A refresh is additive surgery on a page the owner already published. The brief says what the page lacks; `voice.md` says how the site speaks; the page's own history says what you may touch. You add sections, extend thin ones, answer the questions the SERP asks, tighten the meta, and leave the URL, the route, the owner's facts and the owner's sentences in place wherever they still hold. You never create a page (that is `write`), never touch a second article, never merge.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/{inventory,validate-article,render}.js`. Skills you follow inline: `${CLAUDE_PLUGIN_ROOT}/skills/images/SKILL.md`, `${CLAUDE_PLUGIN_ROOT}/skills/revise/SKILL.md`. Set `P=${CLAUDE_PLUGIN_ROOT}`.

Arguments: `--item B-nnn` (pick this item instead of the top one), `--no-pr` (stop after pushing the branch; also the automatic mode when `gh` is missing), `--revise <pr>` (only revise that PR, then stop), `--no-revise` (skip the revision pass).

**Revision first.** Before anything new: `gh pr list --label <PR label> --label needs-work --state open`. Any such PR whose backlog item is `type: refresh` → follow `$P/skills/revise/SKILL.md` with `--type refresh` (or the `--revise <pr>` given), then **stop**: one unit of work per run, and the reviewer's fixes come before new edits. No `needs-work` PR of this type (or `--no-revise`) → continue below.

## 0. Preconditions — stop on the first failure, print why

1. Product repo root; `git status --porcelain` is empty; current branch is the default branch. A dirty tree means the owner has work in progress: print the file list and stop. Never commit, stash, or discard those changes yourself — the only commits this skill makes are the claim, the refresh, and the in-review status.
2. `/seo/strategy.md`, `/seo/voice.md`, `/seo/brand.json`, `/seo/frames/`, `/seo/backlog.md` exist; `CLAUDE.md` has the `## SEO agent` block. Missing → name the skill that creates it (`init`, `brand`, `frames`, `analysis`).
3. From `## Caps`: `refresh_per_week` (2), `open_prs_max` (3), `word_range`. From the block: `Articles` glob and format, `Title/description`, `URL slug`, `Images`, `Validate`, `Preview`, `PR label`, `Human-edited guard` (days, default 14).
4. `gh auth status` works → PR mode; else `--no-pr` mode and say so.
5. **Caps.** Open SEO PRs: `gh pr list --label <PR label> --state open --json number` (no `gh` → count backlog items with `in-review`); ≥ `open_prs_max` → stop `PR cap reached`. Refreshes this week: backlog `refresh` items with a `claimed:` date in the current week plus `done.md` refresh lines dated in the current week; ≥ `refresh_per_week` → stop `weekly refresh cap reached`. **Week** = the calendar week, Monday 00:00 to Sunday, local time (`date -v-monday` on macOS / `date -d 'last monday'` on Linux gives the start when today is not Monday; today itself when it is). Last week's merges never count against this week.
6. `node $P/scripts/inventory.js --root .` (refreshes `seo/inventory.json`).

## 1. Select, guard, claim

Top item = the `refresh` item with `status: open` and the highest score (`--item` overrides; it must be open). None → print `no open refresh items — run /seo-agent:analysis` and stop. Its `target` must resolve to one page in `inventory.json` (by path); its `brief` must have `intent`, `must cover`, `must answer`, `angle`, `format`, `images`, `internal links`, `avoid`, `sources`, `serp_context`; anything missing → stop and name it (fix is in `analysis`, not here).

**Human-edited guard.** `git log --since=<guard days> --format='%s' -- <article file> <its image dir>`. Any commit whose subject does not start with `seo:` is the owner's: print `guarded: <path> edited by owner on <date>, retry after <date + guard>`, leave the item `open`, and take the next open refresh item (at most 3 tries, then stop). Agent commits (`seo:` prefix) do not count.

Idempotence: branch `seo/<id>-<slug>` already exists locally or on origin → print `already in progress: <branch>` and stop.

Claim on the default branch before any editing: change the item's `- status: open` to `- status: claimed:<date>` and commit `seo: claim <id>` (planning files commit directly). Then `git checkout -b seo/<id>-<slug>` (slug = the target path without the leading slash).

## 2. Read everything the refresh depends on

- The article in full, its route line, its image folder (`ls`), and `git log --format='%h %ad %s' --date=short -- <file>` so you know what the owner changed last and when.
- The brief, `serp_context` JSON (top pages' headings and word counts, PAA, features, `existing`), and the `also_targets` line if present (a second keyword this page must also satisfy; its own `serp_context` is named in the line).
- The item's `gsc:` line if present (from `analysis` discovery mode): the page's own Search Console numbers — impressions now vs prior, position, CTR, the top query. `decaying` means the page is losing impressions; `striking` means it sits at position 8–20; `ctr-gap` means people see it and do not click, and the line says `title/description rewrite in scope`.
- `strategy.md`: the cluster line (hub, priority), `## Never write about`, `## Positioning`.
- `inventory.json`: the cluster's hub and siblings — their titles and h2s, so you neither duplicate their sections nor break the links they already make into this page. Collect every `#anchor` other pages use to point at this article (`grep -rn "<route or path>.*#" <articles dir>`): those `id`s are fixed.
- `voice.md` and `review-rubric.md` in full; the `## Product claims` sources.
- The inbound links: which pages link to this one, and with what anchor text (so a changed H1 or a removed section does not strand them).

## 3. Plan before editing — `/seo/data/drafts/<id>.plan.md`

The plan is a diff in prose. Four lists:

1. **Keep** — every existing H2 with its `id`, every internal link, every image, every config-rendered fact, every paragraph that carries a product claim. Default is keep; list what you will *not* keep and why (duplicate of a sibling's section, contradicted by the brief's sources, below the "honest about limits" bar).
2. **Add** — one entry per `must cover` topic the current h2s do not cover (new H2, where it goes in the order, ~words) and per `must answer` question not yet answered (section or FAQ). The `angle` decides the order and which addition leads. The `also_targets` phrasing goes into the H1, the quick answer or an H2 where it reads naturally; never a second H1.
3. **Change** — title tag and description only if they fail the validator, miss the keyword, or the `gsc:` line says `title/description rewrite in scope` (then rewrite them for the top query, keeping the keyword; ≤ 70 / 120–160 chars); the H1 only if the brief's `angle` says the framing is wrong, and then note that the hero must be re-rendered and inbound anchor text re-checked; the quick answer if it no longer matches the page; sentences the brief's sources show to be out of date.
4. **Images** — frames only for *new* structure: a new table → `compare`; a new numbered procedure → `steps`; a new sourced number in the text → `stat`; a one-sentence takeaway → `quote`. Existing images stay with their file names; new files get new names. The hero (`cover`) is re-rendered only when the H1 changed. 0–3 new frames is normal; the brief's `images` line is the ceiling, not a quota.

Then the word budget: current count, target from `format`, and where the words go (section by section). A refresh does not pad: if the additions do not reach the range floor, the plan says so and the PR body says so.

## 4. Edit

- Work section by section inside the existing markup. Clone the page's own heading, figure, list, callout, FAQ and JSON-LD patterns for anything new; never import markup from another page when this page has its own version.
- Every existing `id` stays. New sections get `id`s in the page's convention (`step-n`, `option-n`, or a slug).
- Added prose follows `voice.md`; it reads as the same author. Second person, direct answer first, honest about limits, product offered once, the existing CTA untouched.
- `must answer` questions: answer in the section that owns the topic, or add a FAQ entry and the matching JSON-LD question the way the page builds it. Keep the existing FAQ entries; reorder only to put the keyword's own question first.
- Internal links: add the brief's `internal links` that are missing, once each, with descriptive anchor text, via the repo's route helper. Never remove an existing link. External links only to the brief's `sources`; forum and video sources are not linked.
- Numbers: anything the repo renders from config stays rendered from config; a new number comes with a source from the brief or `Product claims`, or it does not go in. The "last verified" line, if the page has one, stays.
- Nothing from `## Never write about`, nothing on the `avoid` list, nothing lifted from a competitor page (facts yes, sentences no). The reader never hears about the research: no rankings, no "the top result", no "people also ask".
- Dates and year tokens in title or text: update only when the brief's sources show the fact changed, not to look fresh.

**Rewrite guard.** After editing, `git diff --numstat <article>`: if deleted lines exceed half the file's original line count, this is a rewrite, not a refresh. Revert the article (`git checkout -- <file>`), set the item to `- status: blocked:needs-rewrite-decision` on the default branch with one line saying why, and stop with no PR. The owner decides whether the page is replaced.

## 5. Images

Follow `$P/skills/images/SKILL.md` with the plan's new frames and `--out <Images dir for this article>`. Every value on a frame appears in the article text. An image that fails its check is dropped and its `<img>` removed. Never overwrite an existing file except `cover` when the H1 changed (then it is also the `ogImage`, as before).

## 6. Validate and fix

`<Validate command from the block> --file <article>`. Must exit 0 with no `fails`. Fix and re-run, at most 3 passes. Still failing → commit what exists on the branch, do **not** open a PR, set `- status: blocked:<reason>` on the default branch, report. Also run any other command the `Validate` line names.

If the owner's page failed the validator *before* your edit (an over-long description, a missing canonical), fixing it is part of the refresh; say so in the PR body.

## 7. Commit, push, PR

Files allowed in the commit: the article, new files in its image folder (plus `cover.*` when the H1 changed), `/seo/data/drafts/<id>.plan.md`. Anything else modified → stop and say what.

Commit: `seo: refresh <id> — <path>`; push `-u origin <branch>`. Before the PR, push the default branch if it is ahead of `origin` (`git rev-list --count origin/<default>..<default>` > 0 → `git push origin <default>`), so the PR shows only this branch.

PR mode: `gh pr create --label <PR label> --title "seo: refresh <path>" --body-file <tmp>` with `templates/pr-body.md`:
- **Why**: the item's `evidence` line and score; the `also_targets` line if any.
- **What changed**: ≤ 5 bullets, diff-shaped — sections added (names), sections extended, FAQ entries added, meta or H1 changes, images added; words before → after; anything from the brief not done and why; validator failures inherited from the old page and fixed.
- **Preview**: each *new* rendered image inline via `https://github.com/<owner>/<repo>/blob/<branch>/<path>?raw=true`; the `Preview` URL.
- **Checks**: `validate: pass | links: n internal (+k), m external | words: before → after | images: +k | kept: n/n sections, n/n links | review: pending`.

`--no-pr` mode: write the body to `/seo/data/pr/<id>.md`, print the compare URL `https://github.com/<owner>/<repo>/compare/<default>...<branch>?expand=1`.

Back on the default branch: set the item to `- status: in-review:#<pr>` (or `in-review:branch`), add `- branch: <branch>` and `- claimed: <date>` lines, commit `seo: <id> in review`. Leave the tree clean on the default branch.

## 8. Summary (≤ 12 lines)

Item, target path and URL; words before → after vs range; sections kept / added / changed; FAQ entries added; images added (dropped ones named); links added; validator result and passes used; PR URL or compare URL; caps after this run (open PRs, refreshes this week); guard skips, if any; anything the brief asked for that the refresh does not do, and why.

## Hard rules

- One article, one branch, one PR per run; stop when any cap is hit
- Never touch an article the owner committed to within the guard window; never touch a second article, another backlog item, `strategy.md` or `voice.md`
- The URL, route, file name and every existing `id` survive; existing links and images survive; the owner's paragraphs survive unless the plan names why not
- Deletions over half the file → revert and block, never a silent rewrite
- Every new fact has a source; config-rendered values stay config-rendered
- Images only through the frame kit; a frame shows only text that is in the article; no existing image overwritten except the hero after an H1 change
- The validator must pass before a PR exists; never `gh pr merge`
- No network except `git`, `gh`
- Re-run the same day with the branch present → no-op
