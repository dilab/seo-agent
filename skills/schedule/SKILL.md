---
name: schedule
description: Put the daily `run` on autopilot. Installs (or inspects, tests, removes) a launchd job on this Mac that calls `/seo-agent:run` headlessly on weekday mornings through `scripts/schedule.sh`, which loops fresh sessions until the run says `next: tomorrow`, logs to ~/Library/Logs/seo-agent and posts a macOS notification with what it did and what the owner must merge or deploy. Use when the owner says "schedule it", "run this every morning", "put it on autopilot", "is the schedule running", "what did the schedule do", or "stop the schedule".
---

# schedule — install the morning job

Everything that runs unattended is `scripts/schedule.sh`; this skill only drives it and explains the result. Set `S=${CLAUDE_PLUGIN_ROOT}/scripts/schedule.sh` and `PRODUCT` = the product repo root (the current directory when it holds `seo/strategy.md`, else ask).

Arguments: `install [--at HH:MM] [--days 1-5]` (default), `--quarterly [--at HH:MM]` (a second job, `com.seo-agent.<product>.audit`, that runs `/seo-agent:audit` on 1 Jan/Apr/Jul/Oct), `status`, `test`, `kick`, `log [n]`, `uninstall` (removes both), `env`.

## install (default)

1. Preconditions, in this order, stop at the first failure and say what to do:
   - `$PRODUCT` has the `## SEO agent` block in `CLAUDE.md` and `seo/strategy.md` → else `Run /seo-agent:init first`.
   - `gh auth status` works (the headless run opens and reviews PRs).
   - `$S env` has been run and `~/.config/seo-agent/env` exists (`$S env` creates it from `templates/env.example` with mode 600). Tell the owner which values to fill: `DATAFORSEO_LOGIN/PASSWORD` (keywords, analysis), `GSC_SA_FILE` (feedback, discovery — optional), `https_proxy` if their network needs it. Never read, print or guess the file's contents.
   - `node ${CLAUDE_PLUGIN_ROOT}/scripts/dfs.js check` and `gsc.js check` from a shell that has sourced that file are the owner's test; say so rather than running them here.
2. Pick the time: `--at` or 07:00 local; weekdays `--days` or 1-5. One firing a day is enough — a firing chains execute → review → revise → review in separate sessions on its own.
3. `$S install $PRODUCT --at <HH:MM> --days <days>` and show its output. With `--quarterly`: `$S install $PRODUCT --quarterly --at <HH:MM>` instead (one session, the audit skill, no chaining). The plist lands in `~/Library/LaunchAgents/com.seo-agent.<product>.plist` and captures the current `PATH` (so `claude`, `node`, `gh`, `php` resolve under launchd); re-run install after moving any of them.
4. Explain the permission model in two lines: unattended sessions use `templates/runner-settings.json` (git, gh, node, php artisan, read-only shell tools, file edits; `rm`, force-push and `sudo` denied). A denied tool fails that one call and the run reports it; widen the file deliberately if a log shows a legitimate denial.
5. Tell the owner to test now with `test` (below) and that a Mac asleep at the hour runs the job on wake; a Mac that is off skips the day (the next firing catches up — the ledger is git, nothing is lost).

## status

`$S status $PRODUCT`: installed or not, the weekday/time lines, launchd state and last exit code, env-file presence, and the last log's `===`/`did:`/`stop:`/`abort:` lines. Translate exit codes: 0 ok, 1 a session failed (read the log), 3 the repo was dirty or diverged (the owner has uncommitted work or a non-fast-forward main), 4 no network.

## test

`$S run $PRODUCT --dry-run` — one real headless session that prints the decision without acting, through the exact flags the job will use. Show the `did:`/decision block and the log path. If it aborts on a dirty tree or the production branch, say that is the same guard the morning job applies.

## kick

`$S kick $PRODUCT` fires the installed job through launchd itself — a real `run`, exactly as the morning will do it (proves `PATH`, the env file and the keychain login under launchd). Only when the owner asks for a real run; otherwise point them to `test`. Then `log`.

## log

`$S log $PRODUCT [n]` → the last log's tail; summarise `did:` lines and anything after `You:` (merges, deploy line).

## uninstall

`$S uninstall $PRODUCT`; confirm the plist is gone. The env file and logs stay.

## Hard rules

- Never create, read, print or edit the env file's values; only check that the file exists
- Never pass `--dangerously-skip-permissions`; the runner's allowlist is the permission model, and widening it is an edit to `templates/runner-settings.json` the owner makes knowingly
- One job per product; `install` replaces an existing one
- This skill never runs `/seo-agent:run` itself except through `test` (`--dry-run`)
