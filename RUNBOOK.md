# Runbook — operating the SEO agent by hand

## Setup

### Once per machine

1. **Claude Code**, logged in: `claude --version`.
2. **Node 18+** and **git**: `node -v`, `git --version`. Laravel products also need PHP on the PATH for the sitemap generator (`php artisan sitemap:generate`); the validator itself does not.
3. **The plugin**, cloned next to your product repos so `../seo-agent` resolves from each of them:
   ```
   git clone <seo-agent repo> ~/Code/seo-agent
   cd ~/Code/seo-agent
   npm install                       # playwright + sharp, used by scripts/render.js
   npx playwright install chromium   # the headless browser that renders frames to PNG
   claude plugin validate .          # must print "Validation passed"
   ```
4. **GitHub CLI**, logged in — `write`, `refresh`, `review` and `revise` need it:
   ```
   brew install gh      # or let /seo-agent:init --install-tools do this part
   gh auth login        # interactive; always done by you
   ```
5. **DataForSEO** account (pay-as-you-go; a run costs cents, caps in `seo/strategy.md`). Put the credentials in your shell profile, not in any repo:
   ```
   export DATAFORSEO_LOGIN=…
   export DATAFORSEO_PASSWORD=…
   node ~/Code/seo-agent/scripts/dfs.js check   # prints the account balance
   ```
   Only `keywords` and `analysis` use them. The other skills make no API calls.
6. **Google Search Console** (for `feedback` and, later, discovery-mode `analysis`):
   - Google Cloud console → APIs & Services → Enable APIs → enable **Google Search Console API** for the project.
   - IAM → Service accounts → create one (no roles needed), add a JSON key, download it to a path outside any repo.
   - Search Console → the property → Settings → Users and permissions → add the account's `client_email` with Restricted permission.
   - In your shell profile: `export GSC_SA_FILE=/path/to/key.json` (and `export GSC_SITE=sc-domain:<domain>` if the property is not `sc-domain:` or `https://` of the domain in `seo/brand.json`).
   - `node ~/Code/seo-agent/scripts/gsc.js check` must print `ok: true` with the property and permission. Data lags 3 days; every window ends at today − 3.
   - `gsc.js` honours `https_proxy` / `HTTPS_PROXY` (HTTP CONNECT proxies only; a `socks://` value is ignored), since Node's own `fetch` does not.
7. Optional: `alias seo='claude --plugin-dir ~/Code/seo-agent'` so a session is `cd ~/Code/<product> && seo`.

The plugin is loaded per session with `--plugin-dir`; nothing is installed into Claude Code globally. To update it: `cd ~/Code/seo-agent && git pull && npm install && claude plugin validate .`.

### Once per product

1. The product repo has a GitHub remote, a default branch (`main`), and a clean tree. Commit or stash your own work first; every skill refuses a dirty tree.
2. Bootstrap:
   ```
   cd ~/Code/<product>
   claude --plugin-dir ../seo-agent
   /seo-agent:init --domain <product domain>      # add --install-tools to let it brew install gh
   ```
   It detects where articles live and writes the `## SEO agent` block in `CLAUDE.md`, drafts `seo/strategy.md`, `seo/voice.md` and `seo/review-rubric.md` from your existing pages, extracts `seo/brand.json`, installs the frame kit in `seo/frames/`, creates `backlog.md` / `done.md` / `rejected.md`, creates the `seo` label, and commits `seo: init <date>` on the current branch. It prints the manual steps it could not do (login, credentials, GSC). Re-run it after a layout change (articles moved, new sitemap mechanism); it only fills gaps and never overwrites a file you edited.
3. Read the init commit. Check the `Articles:` glob in the CLAUDE.md block above everything else: every later skill reads it. Open `seo/frames/contact-sheet.png` to see the frames.
4. Edit **`seo/strategy.md`**: ICP, positioning, clusters and their hub pages, `## Never write about`, `## Caps` (defaults: `new_per_week: 1`, `refresh_per_week: 2`, `open_prs_max: 3`, `discovery_max_items: 2`, `fixes_per_week: 3`, `word_range: 1200–2200`, spend caps), `## Auto-merge` (`[]` until you trust the reviewer; then `[refresh]`, later `[refresh, write]`), and the seed lines under `## Tracked keywords`. Edit **`seo/voice.md`** where the draft got your voice wrong. Commit: `git commit -am "seo: strategy and voice edits"`.
5. Optional: run the frame design loop (`/seo-agent:frames`, then `--from-canvas <url>` after you approve the Claude Design canvas). The default kit works without it.
6. Fill the pipeline: `/seo-agent:keywords` → delete the proposals you do not want in `seo/strategy.md` (commit) → `/seo-agent:analysis`. Then start the weekly loop below.
7. Before the first `write`/`refresh`: if the product renders facts from a config file (RecordMover: `config/zoom_facts.php`), make sure `seo/voice.md › Product claims` names it, so every number on a page is rendered, never typed.

What lives where after setup: `CLAUDE.md` (the `## SEO agent` block: article glob, slug rule, image dir, validate command, sitemap, preview URL), `seo/strategy.md` (yours), `seo/voice.md` and `seo/review-rubric.md` (yours, drafted by init), `seo/brand.json` and `seo/frames/` (generated, edit if you like), `seo/backlog.md` / `done.md` / `rejected.md` (the agent's), `seo/data/` (snapshots, spend ledger, plans, SERP context — committed, small), `seo/inventory.json` (regenerated every run).

## Running

Every run starts the same way, from the product repo, on the default branch with a clean tree:

```
cd ~/Code/recordmover
git status            # must be clean, on main
claude --plugin-dir ../seo-agent
```

Credentials: `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` exported in the shell for `keywords` and `analysis`; `GSC_SA_FILE` for `feedback`; `gh auth status` green for `write`, `refresh`, `review`, `revise`, `feedback`. Nothing else needs network.

Each skill does one unit of work and stops. Run one skill per session; `review` in a session that did not write the PR.

## Weekly loop (caps from `seo/strategy.md`: 1 new article, 2 refreshes, 3 fixes, 3 open PRs)

Caps count calendar weeks, Monday to Sunday: a merge on Friday never blocks the following Tuesday.

| Day | Command | What it does | What you do after |
|---|---|---|---|
| Mon | `/seo-agent:analysis` | Briefs any keyword accepted since last time, commits `backlog.md`. With GSC wired it also saves a Search Console snapshot and runs discovery: open items whose page is decaying or in striking distance get a `gsc:` line and a new score; up to `discovery_max_items` (2) pages with a signal and no item get a refresh brief. Spend ≤ $0.50. Says `backlog is current` when nothing changed. | Read the top of `seo/backlog.md`. Delete an item you do not want before Tuesday. |
| Tue | `/seo-agent:write` | Revises a `needs-work` write PR if one exists and stops; else takes the top open `write` item → branch → article → images → validator → PR. | — |
| Tue later | `/seo-agent:review` (fresh session) | Sweeps merged/closed PRs into `done.md`/`rejected.md`, then reviews every unlabelled SEO PR → `ready` or `needs-work`. | Merge `ready` PRs: `gh pr merge <n> --squash`. Close a PR you dislike with a one-line comment; the sweep records it. |
| Wed | `/seo-agent:refresh` | Same shell for the top open `refresh` item (revision first if a refresh PR is `needs-work`). | — |
| Wed later | `/seo-agent:review` | As Tuesday. | Merge / close. |
| Thu | `/seo-agent:refresh` | Second refresh of the week, or the revision of Wednesday's PR. | — |
| Thu later | `/seo-agent:review` | As Tuesday. | Merge / close. |
| Fri | `/seo-agent:fix` | Top open `fix` or `link` item → one small PR: a head fix for one page, or the missing links inside one cluster. Says `no open fix or link items` when the site is clean. | — |
| Fri later | `/seo-agent:review` | As Tuesday. | Merge / close. |
| Fri | deploy | — | `git checkout production && git merge main && git push`, then on the server `php artisan sitemap:generate`. Run `/seo-agent:review` once more so the sweep records the merges. |

A `needs-work` PR costs one extra execute run: the next `write`/`refresh` revises it instead of starting new work, and the following `review` passes or escalates it. `/seo-agent:revise --pr <n>` does the revision on demand without waiting for the next day.

## Monthly

| When | Command | Notes |
|---|---|---|
| 1st | `/seo-agent:keywords` | Discovers and ranks candidates per cluster, appends them to `## Tracked keywords` tagged `proposed <date>`. Spend ≤ $1.00. Also run it any week `analysis` says the backlog is current and fewer than 3 items are open. |
| within 7 days | edit `seo/strategy.md` | Delete the proposals you do not want. Anything still tagged after 7 days is accepted automatically; remove the tag to accept early. Commit the edit. |
| 1st | `/seo-agent:feedback` | Needs the Search Console setup above. Saves a 28-day snapshot, appends a 4-week outcome (and a 12-week one later) to every merged item in `done.md`, reports tracked-keyword positions, and opens one PR when three rejections or review findings share a theme. Merge or close that PR like any other. |

## Quarterly

`/seo-agent:audit` — not built yet. Crawl, broken links, meta, orphan pages → fix PR + backlog items.

## When something stops

| Message | Meaning | Do |
|---|---|---|
| dirty tree, file list | you have uncommitted work | commit or stash it yourself, re-run |
| `PR cap reached` | 3 SEO PRs open | merge or close some |
| `weekly new-article cap reached` / `weekly refresh cap reached` | caps hit | wait for next week, or raise the cap in `## Caps` |
| `no open write items` / `no open refresh items` | backlog empty for that type | run `keywords`, prune, `analysis` |
| `no open fix or link items` | site hygiene is clean | nothing |
| `weekly fix cap reached` | 3 fix/link items this week | wait, or raise `fixes_per_week` |
| `guarded: <path> edited by owner …` | you edited that article in the last 14 days | nothing; it tries the next item |
| `blocked:<reason>` on an item | validator failed 3 times or a rewrite was needed | read the reason in `backlog.md`; fix the brief or decide the rewrite; set `status: open` to retry |
| `escalate` label | review failed twice | read both review comments and decide; merge, close, or fix by hand and remove the label |
| `already in progress: <branch>` | same-day re-run | nothing |

## Facts that must live in config

Any Zoom number or behaviour the pages state comes from `config/zoom_facts.php`. When a brief and a page disagree (as B-002 and the storage-limits page do on whether trashed recordings count toward storage), settle it in config first, then let the run happen.
