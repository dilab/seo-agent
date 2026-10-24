---
name: revise
description: Apply the fixes from a `needs-work` review comment to the SEO PR it belongs to — exactly those fixes, each one re-checked against the brief, voice.md and the rubric — re-render any frame whose text changed, re-validate, push, correct the PR body, reply to the review, and hand the PR back to `review` by removing the `needs-work` label. Run by `write`/`refresh` before they start new work, or directly with `--pr`.
---

# revise — apply a review's fixes, nothing more

The reviewer said what is wrong and how to fix it, with `file:line`. You apply those fixes and only those. You do not re-read the SERP, do not re-plan, do not improve things the reviewer did not raise. When a finding is wrong — it cites a rule that does not say that, or a fix that would break another rule — you leave it and say why in the reply, quoting the rule. Then you hand the PR back to `review`.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/{inventory,validate-article,render}.js`. Skills you follow inline: `${CLAUDE_PLUGIN_ROOT}/skills/images/SKILL.md`. Set `P=${CLAUDE_PLUGIN_ROOT}`.

Arguments: `--pr <n>` (revise this PR only), `--type write|refresh` (used by the calling skill: only PRs of that type). With neither, every open `needs-work` PR, oldest first.

## 0. Preconditions

1. Product repo root; `git status --porcelain` empty; on the default branch; `gh auth status` works (the findings live in PR comments; without `gh` stop: `revise needs gh`).
2. `/seo/voice.md`, `/seo/review-rubric.md`, `/seo/backlog.md`, `/seo/brand.json`, `/seo/frames/` exist; `CLAUDE.md › ## SEO agent` gives `Validate`, `Images`, `PR label`.
3. Candidates: `gh pr list --label <PR label> --label needs-work --state open --json number,headRefName,title`. Keep those whose backlog item (`- branch:` matches `headRefName`) exists and, with `--type`, has that `type`. A PR carrying `escalate` is never revised. None → print `no needs-work PRs` and return.

## 1. Read the review

For the PR: `gh pr view <n> --json body,comments,commits`. The findings are the **latest** comment headed `<!-- seo-review round k: needs-work -->`; if a comment of yours headed `<!-- seo-revise round k -->` is already newer than it, this round was revised and `review` has not run yet → print `#<n> already revised, waiting for review` and skip.

Parse the comment into **Blocking** items (numbered: `file:line — problem — fix`) and **Notes**. Then read the backlog item (type, brief, `avoid`), `voice.md`, `review-rubric.md` in full, and the article as it stands on the branch. Line numbers in the comment refer to the branch at review time: locate each finding by its quoted text, not by line number alone.

## 2. Check out

`git fetch origin <branch>`; `git worktree add <tmp>/revise-<n> <branch>` (the owner's checkout stays on the default branch). Work in the worktree. Commits by the owner on the branch since the review (subject not starting with `seo:`) → stop for this PR: `#<n> has owner commits since review; leaving it to the owner`, and move on.

## 3. Apply

For each **blocking** finding, in order:

1. Confirm the rule it cites says what the finding says (`voice.md`, `review-rubric.md`, the brief, a skill invariant). It does → apply the reviewer's fix as written, adjusting only what the surrounding markup needs (quotes, Blade syntax, link classes copied from the page's own links).
2. The fix would break something else — a `must answer` lost, a claim without a source introduced, a `refresh` id or link removed, a banned word added, a config value turned into a literal — → do not apply; record `not applied: <reason, quoting the rule>`. Never choose a different fix of your own for a blocking item; the reviewer's fix or nothing.
3. The finding is factually wrong (the line does not contain what it says, the rule does not exist) → `not applied: <what the file/rule actually says>`.

For each **note**: apply it when it is a one-line change with a rule or the brief behind it (a stale PR-body bullet, an alt text, a literal that config provides, a frame title that should match the H2). Skip notes addressed to the owner ("for the owner", "check Zoom's KB", "worth doing while you're in the file" on pre-existing text the brief did not ask to change) and anything that is a matter of taste; list each skipped note with one reason.

Invariants that hold whatever the findings say: `write` — route, sitemap, hub link, slug stay; `refresh` — every base `id` and link, config-rendered values, ≤ half the file deleted; both — only files the PR already touches may change (plus a re-rendered frame of this PR), nothing from `## Never write about` or the brief's `avoid`.

## 4. Images

A fix that changes text shown on one of this PR's frames (a title, a step, a row, a quote) → re-render **that frame** with the corrected text through `$P/skills/images/SKILL.md`, same `id` and file name (the file is this PR's own; the owner's images are never touched). A fix that changes only the alt text needs no render. Check the PNG as the images skill says.

## 5. Validate

`<Validate command> --file <article>` → exit 0, no `fails`. Then the research-talk grep from `review` §3.5 and, for `refresh`, `git diff --numstat <base>...HEAD` for the deletion guard. A failure introduced by an applied fix → revert that one fix, mark it `not applied: validator — <msg>`, re-run. Up to 3 passes; still failing → push nothing, comment `<!-- seo-revise round k: blocked -->` with the validator output, leave `needs-work` on, and report.

## 6. Commit, push, PR body, reply

- `git add` only the changed files; commit `seo: revise <id> round <k> — <a> applied, <b> not applied`; `git push origin <branch>`.
- PR body: `gh pr view <n> --json body` → correct any "What changed" bullet the diff now contradicts, append `- Round <k> revision: <one line>`, refresh the `Checks` line from the validator's `stats` (`review: pending`); `gh pr edit <n> --body-file <tmp>`.
- Reply comment headed `<!-- seo-revise round k -->`: one line per blocking finding `n. applied — <file:line on the new branch>` or `n. not applied — <reason>`; then notes applied / skipped; then `validate: pass | words: n | commit <sha>`.
- `gh pr edit <n> --remove-label needs-work` — the PR is back in `review`'s queue. Never add `ready` yourself.

Remove the worktree. On the default branch add `- revised: round <k> <date> (<a>/<total> applied)` under the item (keep `status` and `review` lines), commit `seo: revise <id> round <k>`, push the default branch.

## 7. Report (≤ 8 lines per PR)

PR, item, applied / not applied counts with the not-applied reasons in one line each, frames re-rendered, validator result, commit, `back in review queue` or `blocked`.

## Hard rules

- Only the reviewer's fixes, only for the reviewer's findings; no other edits, however tempting
- A wrong finding is answered, not obeyed: quote the rule and move on
- Only files this PR already touches change; the owner's files and images are never touched; owner commits on the branch since the review → hands off
- Validator passes before any push; a fix that breaks it is reverted, not patched around
- `needs-work` is removed only after a successful push; `ready` and `escalate` are never set here; never merge
- One revise comment per round; a round already revised waits for `review`
