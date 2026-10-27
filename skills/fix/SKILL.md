---
name: fix
description: Execute the top open `fix` or `link` item from /seo/backlog.md — mechanical hygiene a refresh is too big for: over-long titles and descriptions, missing canonical or ogImage, empty alt text, broken internal links and anchors (fix items), and missing hub↔spoke links between pages of one cluster (link items). Small diff, validator-clean, one PR labelled `seo`. Never rewrites prose beyond one linking sentence or an alt text; never touches ids, routes, facts or sections.
---

# fix — small mechanical PRs

`analysis` creates `fix` and `link` items from `scripts/sitecheck.js` (validator findings per article, missing hub↔spoke links, orphans). This skill executes one item: a `fix` item touches one page's head and links; a `link` item adds one sentence with a link in each page of a cluster that should point at a sibling and does not. It is the cheapest PR the agent makes and the easiest to review, so it holds itself to the smallest diff that resolves the finding.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/{sitecheck,validate-article,inventory,render}.js`. Skills followed inline: `${CLAUDE_PLUGIN_ROOT}/skills/images/SKILL.md` (only for a missing `ogImage`), `${CLAUDE_PLUGIN_ROOT}/skills/revise/SKILL.md`. Set `P=${CLAUDE_PLUGIN_ROOT}`.

Arguments: `--item B-nnn`, `--no-pr`, `--revise <pr>`, `--no-revise`.

**Revision first.** `gh pr list --label <PR label> --label needs-work --state open`; any such PR whose item is `type: fix` or `type: link` → follow `$P/skills/revise/SKILL.md` with `--type fix` (or `--type link`), then stop. None (or `--no-revise`) → continue.

## 0. Preconditions — stop on the first failure, print why

1. Product repo root; `git status --porcelain` empty; on the default branch. Dirty → print the files and stop; never stash or discard.
2. `/seo/strategy.md`, `/seo/voice.md`, `/seo/backlog.md`, `CLAUDE.md` with the `## SEO agent` block. From `## Caps`: `fixes_per_week` (default 3, counts `fix` + `link` items claimed or done in the current calendar week, Monday to Sunday — never last week's), `open_prs_max`. From the block: `Articles`, `Validate`, `PR label`, `Human-edited guard` days, `Images` dir rule.
3. `gh auth status` → PR mode, else `--no-pr` mode.
4. Caps: open SEO PRs ≥ `open_prs_max` → `PR cap reached`; fixes this week ≥ `fixes_per_week` → `weekly fix cap reached`.
5. `node $P/scripts/inventory.js --root .` (refresh the inventory).

## 1. Select, confirm, claim

Top item = the `fix` or `link` item with `status: open` and the highest score (`--item` overrides). None → `no open fix or link items — run /seo-agent:analysis` and stop.

**Confirm the findings still exist.** `node $P/scripts/sitecheck.js --root .` (a `link` item: `--cluster <name>`). Keep only the item's `fixes:` lines that sitecheck still reports for that page (same `code`), or the `links:` pairs it still lists. Everything already fixed by the owner is dropped with `already fixed: …` in the summary. Nothing left → set the item `- status: done:<date> (already fixed)` on the default branch, commit `seo: <id> already fixed`, and stop.

**Human-edited guard**, per file the item will touch: `git log --since=<guard days> --format='%s' -- <file>`; a commit whose subject does not start with `seo:` → that file is off limits. A `fix` item whose page is guarded → `guarded: …`, leave it open, take the next item (max 3 tries). A `link` item → drop the guarded pairs, keep the rest; all guarded → treat as empty.

Branch `seo/<id>-fix-<slug>` (fix) or `seo/<id>-link-<cluster>` (link); exists → `already in progress` and stop. Claim: `- status: claimed:<date>`, commit `seo: claim <id>` on the default branch, then `git checkout -b <branch>`.

## 2. Apply — `fix` items

Read the page, its head include (the siblings' `@include('partials.marketing-head', [...])` or frontmatter pattern), `voice.md › Product claims` and the inventory row. Per finding, the whole change:

| code | change | not allowed |
|---|---|---|
| `title` | ≤ 70 chars: keep the keyword and the site's title pattern (look at two siblings), cut qualifiers first, brand suffix last | a new claim or year |
| `description` | 120–160 chars, keyword once, states what the page answers in the page's own words (quick answer or first paragraph) | numbers not already on the page |
| `canonical` | add the arg the way siblings do, value = the route slug | any other head change |
| `og-image` | render a `cover` frame with the page's H1 via `$P/skills/images/SKILL.md --out <Images dir>` and set `ogImage` the way siblings do; render fails → `not applied` | AI images, a sibling's image |
| `alt` | describe what the image shows using the nearest caption, heading or sentence; ≤ 125 chars | keyword stuffing |
| `link` | re-point to the page the anchor text means (inventory match on title/h1); no such page → unwrap the anchor, keep the text | removing the sentence |
| `anchor` | point at the existing `id` the text means, or add the `id` to that heading in the page's convention | renaming any existing id |
| `sitemap` | run the sitemap command the `## SEO agent` block names if the file is committed; otherwise note it for the owner | editing the sitemap by hand |

Anything the table does not cover → `not applied: <reason>`; the item's line stays for the owner.

## 2. Apply — `link` items

For each `/from → /to (<reason>)` pair: open `from`, find the section whose topic is closest to `to`'s H1 (the H2 that names the same thing; else the section before the CTA; a page with an existing "related guides" list → add a list entry there instead). Add **one sentence** at the end of that section, in `voice.md`'s voice, that says why the reader would go there, with the link through the repo's helper (`route('<name>')` when the route is named, else `url('/<slug>')`). Anchor text = the target's H1 shortened to its subject, never "here" or "this guide". One link per target per page; the page already links `to` anywhere → skip the pair as `already linked`. Never inside a heading, a FAQ answer (JSON-LD mirror), a callout, a table, or a code block.

## 3. Validate and guard

`<Validate command> --file <file>` for every touched file; must exit 0 with no `fails`, ≤ 3 passes. A change that cannot pass is reverted (`git checkout -- <file>`, or undo that one hunk) and recorded `not applied: validator — <msg>`.

**Diff guard.** `git diff --numstat` per file: a `fix` file may delete ≤ 5 lines; a `link` file may delete ≤ 2 (the sentence is an insertion, reflowed markup is not). Over → revert that file, `not applied: diff too large`.

## 4. Commit, push, PR

Allowed files: the files the item names, plus the image folder for an `ogImage` render. Anything else modified → stop and say what.

Commit `seo: fix <path> — <codes applied>` or `seo: link <cluster> — <n> links`; push `-u origin <branch>`; push the default branch first if it is ahead of origin. PR with `templates/pr-body.md`:
- **Why**: the item's `evidence` line.
- **What changed**: one bullet per finding or pair, `file:line — <before> → <after>` (titles and descriptions quoted in full; links as the sentence added); the `not applied` lines with reasons.
- **Preview**: the rendered `cover` inline if one was made; the `Preview` URL.
- **Checks**: `validate: pass | files: n | applied: a/total | deletions: n | review: pending`.

`--no-pr`: body to `/seo/data/pr/<id>.md`, print the compare URL. Back on the default branch: `- status: in-review:#<pr>`, `- branch:`, `- claimed:`, commit `seo: <id> in review`.

## 5. Summary (≤ 10 lines)

Item and type; findings applied / not applied with reasons; files touched and deletions; validator passes used; PR URL; caps after this run; guard skips.

## Hard rules

- One item, one branch, one PR per run; stop at any cap
- Only the changes in the tables above: no new sections, no reworded paragraphs, no fact or number changes, no id or route changes, no sitemap edits by hand, no deletions beyond the guard
- A linking sentence is the only prose a `link` item adds; a title, description or alt text is the only prose a `fix` item writes
- Never touch a file the owner committed to inside the guard window; never touch a second page in a `fix` item
- Images only through the frame kit, only for a missing `ogImage`
- Validator must pass before a PR exists; never `gh pr merge`; no network except `git`, `gh`
