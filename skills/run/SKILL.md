---
name: run
description: The one daily command. Reads the weekday and the repo state (open SEO PRs and their labels, caps, the backlog, what ran this month) and does exactly one unit of work — review/revise if a PR is waiting, else the day's slot (Mon analysis, Tue write, Wed–Thu refresh, Fri fix) with fall-through when a slot is capped or empty — then prints what the owner has to do (merge, deploy). Safe to run any number of times a day: today's `seo:` commits on the default branch are its ledger, so a step already done today is never repeated — a second run reviews what the first made, a third says what is waiting on the owner.
---

# run — decide and do today's unit of work

The owner should not have to remember the weekly table. `run` is that table plus the state checks, and it delegates every real step to the skill that owns it. It never does two execute steps in one day, never repeats a planning step in one day, and never reviews in the session that wrote the PR: when it opens a PR it stops and says "run again in a new session to review". What it did today it reads back from git, so it needs no state file of its own.

Skills it follows inline: `${CLAUDE_PLUGIN_ROOT}/skills/{review,revise,analysis,keywords,feedback,write,refresh,fix}/SKILL.md`. Set `P=${CLAUDE_PLUGIN_ROOT}`.

Arguments: `--as mon|tue|wed|thu|fri` (pretend it is that weekday; the only way to run on a weekend), `--dry-run` (print the decision and stop), `--skip-review` (go straight to the execute step), `--item B-nnn` (passed through to the execute skill), `--again` (ignore the today-ledger and allow a second execute or planning step today; caps still apply).

## 0. Preconditions

Product repo root; `git status --porcelain` empty; on the default branch; `CLAUDE.md` has the `## SEO agent` block and `/seo/strategy.md` exists. Otherwise print the file list or `Run /seo-agent:init first` and stop. `gh auth status` must work: `run` is the PR loop; without `gh` say so and stop (the individual skills still work by hand in `--no-pr` mode).

## 1. State (read, no changes)

- `DAY` = `--as` or today's weekday, local time. Saturday or Sunday without `--as` → print `weekend — nothing scheduled; use --as <weekday> to force` and stop.
- `PRS` = `gh pr list --label <PR label> --state open --json number,title,labels,headRefName`. Split: `unlabelled` (no `ready`/`needs-work`/`escalate`), `needs_work`, `ready`, `escalate`.
- `MERGED_UNSWEPT` = backlog items with `status: in-review:#n` whose PR is MERGED or CLOSED (`gh pr view n --json state`).
- Caps from `## Caps` and this calendar week's counts (Monday to Sunday) the way `write`, `refresh` and `fix` compute them; open backlog items per type.
- **Today's ledger** = `git log --since="<today> 00:00" --format='%s' <default branch>` (local time; include `origin/<default>` too in case the owner's checkout is behind). From the subjects:
  - `executed_today` = a `seo: claim B-nnn` or `seo: B-nnn in review` line → the day's execute slot is used; `EXEC_ID` = that item. If that item's backlog status is now `blocked:…` (the run found no PR to make), the slot counts as free once more.
  - `planned_today` = a `seo: analysis <date>` or `seo: inventory <date>` line; `keywords_today` = `seo: keywords`; `feedback_today` = `seo: feedback`.
  - `reviewed_today` = `seo: review` / `seo: sweep PRs` / `seo: revise` lines (informational — review is driven by PR labels, which are their own ledger; it never re-reviews a labelled PR).
- Month markers: `seo/data/keywords/<YYYY-MM>-*.json` exists → keywords ran this month; `git log --since=<1st of month> --format=%s | grep '^seo: feedback'` → feedback ran this month; `node $P/scripts/gsc.js check` ok → GSC wired.

`--dry-run` → print the ledger flags and the decision table below with the branch it would take, and stop.

## 2. Decide — first match wins, one unit of work

1. **Sweep or review due** (`MERGED_UNSWEPT` non-empty or `unlabelled` non-empty) → follow `$P/skills/review/SKILL.md` in full (it sweeps first, then reviews every unlabelled PR). Stop.
2. **Revision due** (`needs_work` non-empty) → for the oldest such PR, follow `$P/skills/revise/SKILL.md --pr <n> --type <its item's type>`. Stop.
3. **PR cap** (`open` PRs ≥ `open_prs_max`) → print the `ready` PRs to merge and the `escalate` ones to decide, and stop: nothing new until the owner acts.
4. **Monday**: if keywords did not run this month (and not `keywords_today`) → `$P/skills/keywords/SKILL.md`; then if GSC is wired and feedback did not run this month → `$P/skills/feedback/SKILL.md`; then unless `planned_today` → `$P/skills/analysis/SKILL.md`. These are planning steps (no PR), so they chain in one session. Everything already done today → `Monday planning done today (analysis <commit>); nothing else scheduled on Monday`. Stop.
5. **Tue–Fri execute**: `executed_today` and not `--again` → print `today's slot is done: <EXEC_ID> → PR #n (<label or unlabelled>)` with what the owner is waiting on, and stop. Otherwise, in the day's order, taking the first type that is neither capped nor empty (an execute skill that stops at a cap or with `no open … items` is not a unit of work; move to the next):
   - Tue: `write` → `refresh` → `fix`
   - Wed, Thu: `refresh` → `write` → `fix`
   - Fri: `fix` → `refresh` → `write`
   Each is followed in full with its own preconditions and caps (`--item` passed through on the first type only). The first one that opens a PR (or pushes a branch in `--no-pr` mode) ends the session.
6. Nothing applied → print `nothing to do today` with the reason per type (capped / no open items), and what would unblock it (`/seo-agent:analysis`, `keywords`, merge PRs, raise a cap).

## 3. Report (≤ 10 lines, always last)

- `today: <DAY> — did: <skill> <id/PR>` or `did: nothing (<reason>)`; `already today: <ledger lines>` when the ledger is non-empty
- **You**: `ready` PRs as `gh pr merge <n> --squash` lines (and `escalate` PRs to decide; `needs-work` PRs that will be revised next run); on Friday, or any day a merge happened since the last deploy (`git log origin/<production branch>..origin/<default>` non-empty when the block names a production branch): the deploy line from the `## SEO agent` block or the runbook, and the sitemap command
- **Next**: `run again in a new session to review PR #n` when this session opened a PR; otherwise `tomorrow`
- caps after this run (open PRs, new/refresh/fix this week); month markers (keywords, feedback)

## Hard rules

- One unit of work per session and one execute step per day: one review pass, one revision, one planning chain, or one execute PR — never two execute PRs in a day without `--again`, never review and write in the same session
- The ledger is git: today's `seo:` commits on the default branch; nothing else records what ran
- Review before anything new, revision before anything new — the same order the individual skills enforce
- Delegates everything: no step here edits files or opens PRs except through the named skill, with that skill's caps and guards
- Never merges, never deploys, never edits `strategy.md`; those lines are printed for the owner
- Weekend: no-op without `--as`
