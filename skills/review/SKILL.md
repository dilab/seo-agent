---
name: review
description: Review every open SEO PR that has no verdict yet, in a fresh session — re-run the validator, check the diff against the brief, voice.md, review-rubric.md and rejected.md, verify every product claim and every frame image against the article, then label `ready` (and auto-merge if strategy.md allows) or `needs-work` with exact fixes; `escalate` after two failed rounds. Also sweeps merged and closed SEO PRs into done.md and rejected.md. Never edits a branch.
---

# review — the second pair of eyes

`write` and `refresh` check their own work with the validator. You are the reviewer who did not write it: you read the PR as the owner would, with the brief in one hand and the rules in the other, and you say *ready* or *this, this and this*. You never fix anything yourself; fixes go in the comment and the branch stays as it is. Run this in a session that did not produce the PR.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/{inventory,validate-article}.js`. Set `P=${CLAUDE_PLUGIN_ROOT}`.

Arguments: `--pr <n>` (review this PR only, even if it already has a verdict label — a re-review), `--no-merge` (never auto-merge this run).

## 0. Preconditions and sweep

1. Product repo root; `git status --porcelain` empty; on the default branch. `gh auth status` works — review needs GitHub; without it stop: `review needs gh`.
2. `/seo/strategy.md` (`## Caps`, `## Auto-merge`, `## Never write about`), `/seo/voice.md`, `/seo/review-rubric.md`, `/seo/rejected.md`, `/seo/backlog.md` exist. From `CLAUDE.md › ## SEO agent`: `Articles`, `Validate`, `Preview`, `PR label`, `Footer` (optional).
3. Labels: `gh label create ready --color 0E8A16 --description "SEO review passed" --force`, same for `needs-work` (`D93F0B`, "SEO review: fixes listed in comment") and `escalate` (`B60205`, "SEO review failed twice; owner decides"). `--force` makes this idempotent.
4. **Sweep.** `gh pr list --label <PR label> --state all --json number,state,mergedAt,closedAt,title,headRefName`. For each backlog item with `status: in-review:#n`:
   - PR `MERGED` → append to `/seo/done.md`: `- <mergedAt date> <id> <type> <path> pr#<n>`; set the item's status to `- status: done:<date>`.
   - PR `CLOSED` and not merged → `gh pr view <n> --json comments,reviews` and take the owner's last comment or review body (not one of yours — yours carry `<!-- seo-review`) as the reason, `"no reason given"` if none; append to `/seo/rejected.md`: `- <closedAt date> <id> <type> <path> pr#<n> | "<reason>"`; set `- status: rejected:#<n>`. The branch stays; never delete it.
   Anything changed → commit `seo: sweep PRs <date>` on the default branch (planning files commit directly; pushed in §5). Nothing → say `sweep: nothing new`.

## 1. Pick the PRs

Candidates: open PRs with the `PR label` and none of `ready`, `needs-work`, `escalate` (`--pr` overrides and may re-review a labelled PR). None → print `no PRs waiting for review` and stop after the sweep. Review each in turn; they are independent.

For each PR collect: `gh pr view <n> --json number,title,body,headRefName,baseRefName,files,commits,labels,comments` and the backlog item whose `branch:` line matches `headRefName` (no item → the PR was not made by `write`/`refresh`: comment that and label `escalate`; a human-made PR is not yours to judge). From the item: `type`, `keyword`/`target`, `score`, `evidence`, the `brief`, `also_targets`, the `serp_context` path.

Rounds: count your earlier comments on the PR containing `<!-- seo-review round`. This review is round `n+1`.

## 2. Check out and read

`git fetch origin <branch>`; `git worktree add <tmp>/pr-<n> origin/<branch>` (the owner's checkout is never touched; remove the worktree in §6). In the worktree:

- `git diff --stat <base>...HEAD` and the full diff of every non-binary file. The allowed set: the article, its route line, the sitemap generator line, the footer partial when the block names a `Footer` (one added link line only), its image folder, `seo/data/drafts/<id>.plan.md`, (write) the regenerated sitemap; for a `fix` item the one file its `target` names plus its image folder; for a `link` item the `from` files its `links:` lines name. Any other file → a finding.
- The article in full as it stands on the branch; for `refresh`, also the base version (`git show <base>:<file>`).
- `seo/data/drafts/<id>.plan.md`, the brief, `serp_context` JSON (top pages' headings, PAA, `existing`).
- `voice.md`, `review-rubric.md`, `rejected.md` in full; `strategy.md › Never write about` and the cluster line.
- Every file named under `voice.md › Product claims`, so claims can be traced.
- Every PNG the PR adds or changes (read them — you are checking the pixels, not the file names).
- `node $P/scripts/inventory.js --root .` in the worktree, then `<Validate command> --file <article>`.

## 3. Checks

Work the list; every finding gets `file:line` (branch line numbers), what is wrong, and the exact change that fixes it. A finding is **blocking** or **note**; only blocking findings fail the PR.

**Mechanical (blocking)**
1. Validator exits 0 with no `fails`. Any `warns` are notes unless the rubric names them.
2. Files outside the allowed set; a route or sitemap change for `refresh`; a deleted article anywhere.
3. `refresh`: every `id=` from the base version still exists; every internal link from the base version still exists; deleted lines ≤ half the base line count; config-rendered values still rendered from config (no `{{ $facts… }}` turned into a literal); the H1 unchanged unless the plan's **Change** list says why.
4. `write`: route registered in the repo's way; sitemap entry present; when the block names a `Footer`, one link to the new page added there in the siblings' markup and nothing else changed in that file; hub page linked within the first 300 words; file name equals the slug unless the repo's convention differs.
4b. `fix`: every hunk is one of the item's `fixes:` codes (head include args, an `alt`, an `href`, an `id` added to a heading); no prose line changed except a title, description or alt; deletions ≤ 5 per file; every `fixes:` line is either applied or listed `not applied` in the PR body; a rendered `cover` shows the page's H1 verbatim.
4c. `link`: insertions only (deletions ≤ 2 per file, reflow); each added link resolves (validator) and points at the `to` of a `links:` pair; one new sentence per pair, outside headings, FAQ answers, callouts, tables and code; anchor text names the target's subject (no "here", "this guide"); the page did not already link the target; each pair is applied or `not applied` in the PR body.
5. Research talk in prose: `grep -niE "top result|ranks? (first|#|[0-9])|people also ask|this search|the serp|competitor"` on the article — any hit in prose (not in a code comment) is blocking.
6. Frames: for every image the PR adds, the text on the frame (title, rows, steps, value, quote) appears in the article body; alt text describes the content and matches the frame; the file sits in the article's image folder; `<img>` has `width`, `height`, `loading="lazy"`, `decoding="async"` where the siblings do; the hero is the `ogImage`. An image not referenced by the article, or a reference to a missing file, is blocking. A hero with an empty placeholder box is blocking.
7. FAQ: every FAQ question in the body has the same text in the JSON-LD and vice versa; JSON-LD built the way the siblings build it (`json_encode` or the Markdown equivalent), not hand-written.
8. PR body honesty: the `Checks` line's words, link counts and image counts agree with the validator's `stats` (±5 words); every "What changed" bullet is true of the diff; nothing the diff does is missing from the bullets.
9. Nothing lifted: no H2 identical to a heading in `serp_context`'s top pages; no sentence of 12+ words identical to a snippet there. Facts yes, sentences no.

**Brief and intent (blocking unless noted)**
10. The keyword (and `also_targets`) is answered outright in the first screen — quick answer or hero subhead — and appears in title and H1 (or a natural variant).
11. Every `must cover` topic has a section or a substantial paragraph; every `must answer` question is answered recognisably (section or FAQ). Missing → blocking; thin → note.
12. The `angle` is visible in the structure (what leads, what the page does that the SERP does not). Not visible → note, with the sentence that would fix it.
13. Nothing from `avoid`; nothing from `## Never write about` (blocking); no sibling's section duplicated (note, with the sibling named).
14. Word count inside `word_range` and near the brief's `format` target; padding (a definition section, a history, a restated intro) is a note naming the paragraph.

**Voice and claims (blocking)**
15. Every tone, structure and formatting rule in `voice.md` holds for the new prose; every banned word or pattern is absent; good paragraph shape, not the bad ones. Cite the rule and the sentence.
16. Every product behaviour, number and third-party number in new prose is traceable to a `Product claims` file or a brief `sources` URL; anything the repo renders from config is rendered, never typed. List each claim you could not trace.
17. Every check under `review-rubric.md › Product-specific checks`; every `Automatic fails` line — one hit fails the PR regardless of anything else.
18. `rejected.md`: for each past reason, would the owner say it again about this PR? If yes, blocking, quoting the past line.

## 4. Verdict

**Pass** (no blocking findings):
- Comment, 5 lines, headed `<!-- seo-review round n: ready -->`: what the page now does for the keyword; validator and word count; claims traced n/n; images k/k checked; notes (≤ 2, or "none").
- `gh pr edit <n> --add-label ready`.
- **Auto-merge** only when all hold: the item's `type` is in `strategy.md › ## Auto-merge`; `--no-merge` not given; this is round 1; the diff touches no pricing, legal or compliance text (any line containing a price, "consent", "licence/license", "privacy", "terms"); `strategy.md` has no commit in the last 7 days. Then `gh pr merge <n> --squash --auto` and say so in the comment. Otherwise the owner merges.

**Fail** (any blocking finding):
- Round 1 → comment headed `<!-- seo-review round 1: needs-work -->`: the blocking findings numbered, each `file:line — problem — fix`, then the notes; last line `Fix these and the next write/refresh run (or /seo-agent:revise --pr <n>) picks the PR up.` Label `needs-work`.
- Round 2 (a `needs-work` round already exists and the PR was pushed since) → review again; still blocking → comment headed `<!-- seo-review round 2: escalate -->` with the findings that survived and the ones that were fixed, label `escalate` and remove `needs-work`. No third round: an `escalate` PR waits for the owner.
- Never push to the branch, never edit files, never close the PR.

## 5. Backlog note

In the item on the default branch, add or replace one line `- review: round <n> <ready|needs-work|escalate> <date>` (do not change `status`); commit `seo: review <id> round <n>` together with any other items reviewed this run, and push the default branch (`git push origin <default>`) so the sweep and review lines are on GitHub before the next run.

## 6. Clean up and report

Remove every worktree you added (`git worktree remove --force <dir>`); return to the default branch with a clean tree.

Summary ≤ 12 lines: sweep results (merged → done, closed → rejected); per PR one line `#<n> <id> <type> <path> — <ready|needs-work|escalate>, <b> blocking, <k> notes[, auto-merge queued]`; claims untraced (count, PR); anything in the rubric or voice.md you could not evaluate and why.

## Hard rules

- Read-only on the branch: comments and labels only; never push, edit, rebase or close
- Every finding carries `file:line` and the exact fix; no "consider improving"
- One rubric automatic fail → the PR fails, whatever else is good
- Auto-merge only via the `## Auto-merge` list, only on round 1, only on `ready`, never when the diff touches pricing or compliance text or when `strategy.md` changed this week
- Two failed rounds → `escalate`, then stop; the owner decides
- A PR with no backlog item behind it is not yours to judge: `escalate` with one line saying so
- The owner's checkout is never switched: worktrees only, removed before you finish
- Re-run the same day → labelled PRs are skipped; `--pr` is the only way to re-review
