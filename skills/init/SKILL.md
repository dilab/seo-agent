---
name: init
description: Bootstrap a product repo for the SEO agent — detect where articles live and write the `## SEO agent` block in CLAUDE.md, draft seo/strategy.md and seo/voice.md from the existing pages, run brand and frames, create the bookkeeping files, check access, and report the owner's remaining manual steps. Re-runnable — fills gaps and reports differences, never overwrites a file the owner has edited.
---

# init — bootstrap a product

Run from the product repo root, once per product, and again whenever the layout changes. Every step is **fill-if-missing**: an existing file is read, compared with what you would have written, and left alone; the differences go in the report. Nothing here needs DataForSEO or GSC; the access check only reports.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/inventory.js`. Templates: `${CLAUDE_PLUGIN_ROOT}/templates/{strategy,voice,review-rubric}.md`. Set `P=${CLAUDE_PLUGIN_ROOT}`.

Arguments: `--domain example.com` (preview base when the repo only knows localhost), `--no-frames` (skip step 3b), `--install-tools` (let step 5 install missing CLIs with the system package manager; off by default because that changes the machine, not the repo).

## 0. Preconditions

1. `git rev-parse --show-toplevel` equals the cwd; else stop: `run init from the product repo root`.
2. The working tree has no uncommitted changes under `seo/` or `CLAUDE.md`; else stop and say which files, so the owner's edits never get mixed into this run's commit.

## 1. Detect article storage → `## SEO agent` block

`node $P/scripts/inventory.js --detect [--domain …]` prints `framework`, `candidates` (each glob with file count, average words, title and slug sources), the best guess `articles`, `images_dir` (token `<slug>` or `<file>`, whichever the existing image folders use), `sitemap`, `sitemap_generator`, `preview_base`, `validate`, `existing_block`, `seo_dir`, `gh`, `git_remote`.

Sanity-check the guess by opening two files from the chosen glob: they must be long-form pages, not tools, forms or layouts. If the best guess is wrong, pick another candidate and say why. If no candidate has ≥ 3 long-form pages, write the block with `Articles: (none yet — <where new ones should go>)` and continue.

Block (replace the content between the markers if `existing_block`, else append to `CLAUDE.md`; create `CLAUDE.md` if absent):

```
<!-- seo-agent -->
## SEO agent
- Articles: <glob>, format: <format>
- Title/description: <title_source>
- URL slug: <slug_source>
- Images: <images_dir>
- Validate: <validate or "(none yet)">
- Sitemap: <sitemap_generator, when detected — how a new page gets into the sitemap>
- Footer: <footer partial, when a shared one links the articles — where the new link goes and the label style>
- Preview: <preview_base>/<slug>
- PR label: seo
- Human-edited guard: 14 days
<!-- /seo-agent -->
```

Guard: when the block exists, compare line by line. Keep every existing line as is; only add lines that are missing; report lines whose detected value differs (`Validate` is the usual one, once the validator exists). `inventory.js` reads the `Articles:` line, so a wrong glob breaks every later skill: say explicitly which glob is in force.

## 2. Inventory, strategy, voice

1. `node $P/scripts/inventory.js --root .` → read `/seo/inventory.json`. These pages are the evidence for everything in this step.
2. Read every page of kind `guide`/`article` in full, and the home, pricing and docs pages. Note the product's own feature claims and where they come from in the repo (`config/*.php`, docs pages, a features table, README).
3. **`/seo/strategy.md`** — missing → fill `templates/strategy.md`:
   - `ICP`: who the existing pages address (role, team size, plan), in 2–3 sentences, drawn from the pages' own "you" and examples.
   - `Positioning`: one paragraph, product's job and how content earns rank (accuracy, tools, currency), no slogans.
   - `Clusters`: 3–6 lines, one per subject group of existing pages; the hub is the broadest existing page in the group or `none`; priority 1 for the groups closest to the product's core job. Every guide/article page belongs to exactly one cluster.
   - `Never write about`: start from the product's domain (legal/consent topics, licence circumvention, competitor roundups, unsourced pricing) and anything the pages themselves refuse to do.
   - `Tracked keywords`: 1–2 per cluster, the phrase each hub page is plainly written for (its title without the product name), tagged `(cluster: <name>)`. These are seeds; `keywords` grows the list.
   Existing → keep; report which ★ sections are missing or empty and which caps are absent (list the defaults the skills will assume).
4. **`/seo/voice.md`** — missing → fill `templates/voice.md` from the pages read in 2. Every rule must quote the page it was derived from; invent nothing. Good paragraphs are verbatim with paths; bad paragraphs are your rewrites of those same paragraphs with the fault named. Remove any banned word the existing pages actually use, and say so. `Product claims` lists the repo files found in step 2.2.
   Existing → keep, report nothing unless a section from the template is missing.
5. **`/seo/review-rubric.md`** — missing → fill the template with 3–6 checks you can defend from the pages and repo (sourcing rules the pages already follow, link patterns, units, naming). Existing → keep.

## 3. Brand and frames

a. `/seo/brand.json` missing → run the `brand` skill's steps (it returns without committing when called from here). Existing → leave it; note `brand.json present (<n> derived values)`.
b. `/seo/frames/` missing and not `--no-frames` → run the `frames` skill in `--no-design` mode (default kit + contact sheet; the design-canvas loop is the owner's, later). Existing → leave it. If Playwright or sharp are missing, the frames skill prints the install command; record it as a manual step and continue.

## 4. Bookkeeping files

Create if missing, never touch if present: `/seo/backlog.md` (`# Backlog\n`), `/seo/done.md` (`# Done\n`), `/seo/rejected.md` (`# Rejected\n`), `/seo/data/.gitkeep`.

## 5. Label, access, remote

- `gh` present and `gh auth status` ok → `gh label create seo --description "SEO agent PRs" --color 0E8A16 --force`.
  `gh` absent: with `--install-tools` and `brew` on PATH, run `brew install gh` (or `apt-get install -y gh` when `apt-get` exists and you are root); without the flag, or on any other system, leave it manual. Either way the login is always a manual step, because `gh auth login` needs a browser: print `gh auth login` and `gh label create seo …` as the owner's next commands. Never attempt the login yourself.
- `node $P/scripts/dfs.js check` → ok, or manual step `export DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD`.
- `node $P/scripts/gsc.js check` → `GSC: ok (<site>, <permission>)`, or the manual steps from its error: enable the Search Console API in the Cloud project, create a service account, add its `client_email` to the Search Console property (Settings → Users and permissions), `export GSC_SA_FILE=<path>` (and `GSC_SITE=sc-domain:<domain>` if the property is not derivable from `seo/brand.json`). `feedback` and discovery-mode `analysis` need it; nothing else does.
- No `git_remote` → manual step `add a GitHub remote before write/refresh (PRs)`.
- Dashboard registration: not built; skip silently.

## 6. Commit and report

`git add CLAUDE.md seo/` and commit on the **current branch**: `seo: init <date>` with a body listing the files created, files kept, and the manual steps. Setup files are config the owner reviews in the diff, like `brand` and `frames`; no branch, no PR. Nothing created → no commit, say `already initialised`.

Print (≤ 15 lines):
- articles glob in force, framework, pages inventoried by kind
- per file: `created` / `kept` / `kept (differs: …)`
- strategy: clusters drafted, keywords seeded — or sections missing from the existing file
- voice: rules, good/bad paragraphs, banned words removed because the site uses them
- brand/frames: ran or present
- manual steps, numbered
- next: `edit seo/strategy.md and seo/voice.md, then /seo-agent:keywords`

## Hard rules

- Never overwrite or reorder content in an existing `strategy.md`, `voice.md`, `review-rubric.md`, `brand.json`, frames or the `## SEO agent` block; add missing lines only
- Every voice rule and good paragraph is traceable to an existing page; no invented examples presented as the site's own
- No network calls except `dfs.js check`, `gsc.js check` and `gh label create`
- Never create a branch or PR; never delete anything
