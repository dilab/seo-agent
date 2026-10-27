---
name: write
description: Take the top open `write` item from /seo/backlog.md, draft the article in the product's own article format from its brief and SERP context, follow voice.md, render its images through the frame kit, validate, and open one PR labelled `seo`. One article per run, capped by strategy.md; nothing publishes without the PR.
---

# write — one new article, one PR

You produce one article per run and stop. The brief in the backlog item is the spec; `voice.md` is the style; existing articles are the skeleton; `validate-article.js` is the gate; the PR is the only output the world sees. You never edit an existing article (that is `refresh`), never touch anything outside the files listed in §5, and never merge.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/{inventory,validate-article,render}.js`. Skills you follow inline: `${CLAUDE_PLUGIN_ROOT}/skills/images/SKILL.md`, `${CLAUDE_PLUGIN_ROOT}/skills/revise/SKILL.md`. Set `P=${CLAUDE_PLUGIN_ROOT}`.

Arguments: `--item B-nnn` (pick this item instead of the top one), `--no-pr` (stop after pushing the branch; also the automatic mode when `gh` is missing), `--revise <pr>` (only revise that PR, then stop), `--no-revise` (skip the revision pass).

**Revision first.** Before anything new: `gh pr list --label <PR label> --label needs-work --state open`. Any such PR whose backlog item is `type: write` → follow `$P/skills/revise/SKILL.md` with `--type write` (or the `--revise <pr>` given), then **stop**: one unit of work per run, and the reviewer's fixes come before new articles. No `needs-work` PR of this type (or `--no-revise`) → continue below.

## 0. Preconditions — stop on the first failure, print why

1. Product repo root; `git status --porcelain` is empty; current branch is the default branch. A dirty tree means the owner has work in progress: print the file list and stop. Never commit, stash, or discard those changes yourself, even when they are `seo/` planning files — the only commits this skill makes are the claim, the article, and the in-review status.
2. `/seo/strategy.md`, `/seo/voice.md`, `/seo/brand.json`, `/seo/frames/`, `/seo/backlog.md` exist; `CLAUDE.md` has the `## SEO agent` block. Missing → name the skill that creates it (`init`, `brand`, `frames`, `analysis`).
3. From `## Caps`: `new_per_week` (1), `open_prs_max` (3), `word_range`. From the block: `Articles` glob and format, `Title/description`, `URL slug`, `Images`, `Validate`, `Sitemap`, `Preview`, `PR label`.
4. `gh auth status` works → PR mode; else `--no-pr` mode and say so.
5. **Caps.** Open SEO PRs: `gh pr list --label seo --state open --json number` (no `gh` → count backlog items with `in-review`); ≥ `open_prs_max` → stop `PR cap reached`. New this week: backlog `write` items with a `claimed:` date in the current week plus `done.md` write lines dated in the current week; ≥ `new_per_week` → stop `weekly new-article cap reached`. **Week** = the calendar week, Monday 00:00 to Sunday, local time (`date -v-monday` on macOS / `date -d 'last monday'` on Linux gives the start when today is not Monday; today itself when it is). Last week's merges never count against this week.
6. `node $P/scripts/inventory.js --root .` (refreshes `seo/inventory.json`; the siblings and link targets come from it).

## 1. Select and claim

Top item = the `write` item with `status: open` and the highest score (`--item` overrides; it must be open). None → print `no open write items — run /seo-agent:analysis` and stop. Its `brief` must have `intent`, `must cover`, `must answer`, `angle`, `format`, `images`, `internal links`, `avoid`, `sources`, `serp_context`; anything missing → stop and name it (fix is in `analysis`, not here).

Idempotence: branch `seo/<id>-<slug>` already exists locally or on origin → print `already in progress: <branch>` and stop.

Claim on the default branch before any writing: change the item's `- status: open` to `- status: claimed:<date>` and commit `seo: claim <id>` (planning files commit directly). Then `git checkout -b seo/<id>-<slug>`.

## 2. Read everything the article depends on

- The brief and `serp_context` JSON (top pages' headings and word counts, PAA, features, `existing` pages).
- `strategy.md`: the item's cluster line (hub, priority, description), `## Never write about`, `## Positioning`, `## ICP`.
- `inventory.json`: the hub page and the cluster's siblings (pages the brief lists under `internal links`, plus any guide whose title shares content words with the keyword). Note each one's exact route name or path, title, and h2s, so the new article links to them with the right anchor text and does not duplicate their sections.
- `voice.md` in full, `review-rubric.md` in full.
- `## Product claims` sources from `voice.md`: open each file named there. Every statement about the product or a third-party number in the article must be traceable to one of these or to a `sources` URL in the brief; if the product renders such facts from config (a `zoom_facts`-style file), the article renders them the same way and never types the value.
- **Skeleton:** the two existing articles closest in shape to the brief's `format` (problem page vs how-to; in the inventory, how-to pages have numbered `step-n` sections, problem pages have `option-n`). Read them whole. Their head include, hero block, quick-answer component, section/heading markup, figure markup, FAQ block, CTA component and footer are the template; reuse the exact classes and components. For Markdown products use `templates/article.md` instead.

## 3. Plan before drafting

Write the plan to `/seo/data/drafts/<id>.plan.md` (committed with the article, useful for review and refresh):

1. **H1** ≤ 70 chars in the site's house pattern (voice.md › Structure), containing the keyword or its natural variant. **Title tag** = H1 pattern used by existing pages (suffix, year token). **Description** 120–160 chars, answers the query, no hype.
2. **Outline**: hero subhead or quick answer (the direct answer in 2–4 sentences, as the house style places it); then one H2 per `must cover` topic in the order the brief's `angle` implies; the `must answer` questions go either into the section that answers them or into the FAQ; close with the house "how to make this permanent" section and the CTA. Mark which H2 carries each internal link from the brief; the hub is linked in the first 300 words.
3. **Image plan** (3–5, JSON per the images skill): `hero` always with the H1 and description; a `compare` only if the outline has a real table; a `stat` only for a number that appears in the text with its source; `steps` only for a numbered procedure in the text; `quote` for the one-sentence takeaway. Alt text describes content, not design. Never a stat invented for the frame.
4. **Claims list**: every product fact and number the outline needs, each with its source file or URL. Anything without a source gets cut from the outline now.
5. **Avoid list** from the brief, plus the sibling h2s you must not duplicate.

## 4. Draft

Write the article file at the path the `Articles` glob implies. File name = the slug (so the `<file>` and `<slug>` image tokens agree) unless the repo's convention is visibly different. Rules:

- Follow the skeleton exactly for everything that is not prose: head include args (`title`, `description`, `canonical` = the slug, `ogImage` = the hero image path), nav, hero, quick answer, section markup, numbered-section badges, figure markup with `width`/`height`/`loading="lazy"`/`decoding="async"`, FAQ markup, JSON-LD `FAQPage` built from the FAQ questions the same way the siblings build it, CTA, footer.
- Prose follows `voice.md`: the tone rules, the structure rules, the formatting rules, no banned word or pattern. Second person, direct answer first, honest about limits, product offered once and left alone.
- Word count inside `word_range`, counting body prose only. The brief's `format` line gives the target; do not pad with a definition section or a history of Zoom.
- Every `must answer` question is answered verbatim-recognisably somewhere (section or FAQ). Every `internal link` from the brief appears once with descriptive anchor text, using the repo's route helper when the siblings do. External links only to the brief's `sources`; forum and video sources are not linked.
- Nothing from `## Never write about`; nothing on the `avoid` list; nothing lifted from a competitor page (facts yes, sentences no).
- The reader never hears about the research: no "the top result for this search", no rankings, no competitor names as evidence, no "people also ask". `serp_context` shapes the outline; it is not content.
- Image placeholders: write the `<img>` (or `![alt](path)`) at the planned sections now, with the paths the images step will produce.

Register the URL the way the repo does (for Laravel: a `Route::view('<slug>', '<view>')->name('<group>.<file>')` next to the sibling routes). If the block names a `Sitemap` mechanism, add the page there too and run its generator when it is a local command; commit the regenerated sitemap.

## 5. Images

Follow `$P/skills/images/SKILL.md` with the plan from §3 and `--out <Images dir for this article>`. Every value on a frame must appear in the article text. An image that fails its check is dropped from the plan and its `<img>` removed from the article. The hero PNG is also the `ogImage`.

## 6. Validate and fix

`<Validate command from the block> --file <article>`; for Markdown the same script. Must exit 0 with no `fails`. Fix and re-run, at most 3 passes; the usual fixes are description length, a banned word, a missing hub link, a route name typo, word count. Still failing → commit what exists on the branch, do **not** open a PR, set the backlog item to `- status: blocked:<reason>` on the default branch, and report.

Also run the repo's own checks if the block names any (`Validate` may list more than one command).

## 7. Commit, push, PR

Files allowed in the commit: the article, its route line, the sitemap generator line and regenerated sitemap, the image folder, `/seo/data/drafts/<id>.plan.md`. Anything else modified → stop and say what (a skeleton copy went wrong).

Commit: `seo: write <id> — <H1>`; push `-u origin <branch>`.

Before the PR, push the default branch if it is ahead of `origin` (`git rev-list --count origin/<default>..<default>` > 0 → `git push origin <default>`). The claim commit and any earlier planning commits live there, and a PR whose base is behind shows every one of them as part of this article.

PR mode: `gh pr create --label <PR label> --title "seo: <H1>" --body-file <tmp>` with the body from `templates/pr-body.md`:
- **Why**: the item's `evidence` line and score.
- **What changed**: ≤ 5 bullets — the article (words, sections), route and sitemap, images (count and types), anything dropped from the brief and why.
- **Preview**: each rendered image inline via `https://github.com/<owner>/<repo>/blob/<branch>/<image path>?raw=true`; the `Preview` URL from the block.
- **Checks**: `validate: pass | links: n internal, m external | words: n | images: k/plan | review: pending`.

`--no-pr` mode: write the same body to `/seo/data/pr/<id>.md`, print the compare URL `https://github.com/<owner>/<repo>/compare/<default>...<branch>?expand=1`, and tell the owner to open the PR from it.

Back on the default branch: set the item's status to `- status: in-review:#<pr>` (or `in-review:branch` in `--no-pr` mode), add `- branch: <branch>` and `- claimed: <date>` lines under it, commit `seo: <id> in review`. Return to the default branch; leave the working tree clean.

## 8. Summary (≤ 12 lines)

Item, H1, path and URL; words vs range; sections and FAQ count; images rendered / planned (dropped ones named); internal and external link counts; validator result and passes used; PR URL or compare URL; caps after this run (open PRs, new this week); anything the brief asked for that the article does not do, and why.

## Hard rules

- One article, one branch, one PR per run; stop when any cap is hit
- Never modify an existing article, another backlog item, `strategy.md` or `voice.md`
- Every product fact and number has a source in `voice.md › Product claims` or the brief's `sources`; none typed when the repo renders it from config
- Images only through the frame kit; a frame shows only text that is in the article
- The validator must pass before a PR exists; never `gh pr merge`
- No network except `git`, `gh`, and the local sitemap generator
- Re-run the same day with the branch present → no-op
