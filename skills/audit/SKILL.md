---
name: audit
description: Quarterly technical audit of the live site. Crawls every page from the home page, the sitemap and the inventory, checks internal and external links, redirects, titles, descriptions, canonicals, noindex, h1s, alt text, thin pages, sitemap gaps and (optionally) Core Web Vitals, saves the crawl to seo/data/crawl/<date>.json with a diff against the previous audit, turns article-level findings into `fix` and `link` backlog items, and prints the rest as an owner list. Read-only on the site, no PR; `fix` executes the items on its Friday slot. Use on the first weekday of a quarter, after a site migration, or when the owner asks "audit the site", "check for broken links", "technical SEO check".
---

# audit — the quarterly crawl

`analysis` sees the repo; `audit` sees what a visitor and a crawler see: the live HTML, the real status codes, the redirects, the sitemap as served. Everything it finds either becomes a backlog item the `fix` skill can execute mechanically, or a line in the owner list for things no skill should touch (navigation, layouts, pricing and legal pages, hosting). It never edits an article and never opens a PR.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/{crawl,inventory,sitecheck}.js`. Set `P=${CLAUDE_PLUGIN_ROOT}`.

Arguments: `--origin <url>` (default: `https://<domain>` from `seo/brand.json`, else the `Preview` line's host), `--max <n>` pages (500), `--external <n>` external links to check (200), `--cwv` (ask PageSpeed Insights for the home page and cluster hubs; needs network to googleapis.com, `PAGESPEED_API_KEY` optional), `--no-items` (report only, write nothing to the backlog), `--dry-run` (crawl and report, commit nothing).

## 0. Preconditions

Product repo root; `git status --porcelain` empty; on the default branch; `seo/strategy.md` and the `## SEO agent` block exist. `node $P/scripts/inventory.js --root .` first so the crawl can map paths to files and kinds. No `gh` needed.

## 1. Crawl

```
PREV=$(ls seo/data/crawl/*.json 2>/dev/null | sort | tail -1)
node $P/scripts/crawl.js --root . --origin <origin> --max <n> --external <n> [--cwv] --save seo/data/crawl ${PREV:+--diff $PREV} --quiet
```

Read the JSON: `summary` (pages, findings by code, `truncated`), `findings[]` (`code`, `severity` fix|report, `path`, `file`, `msg`, `to`), `sitemap` (`count`, `error`, `missing`), `external[]`, `cwv[]`, `diff` (`new`, `resolved` since the previous audit). An `error` key at the top level or `sitemap.error` → say so and stop; a site that is down is the owner's problem, not a backlog item. `truncated: true` → say the crawl hit `--max` and which paths were still queued.

Then `node $P/scripts/sitecheck.js --root .` as well: it sees the source (Blade args, routes, frames) that the live HTML hides, and the two together are the full picture.

## 2. Triage

Three buckets, in this order:

1. **`fix` items** — findings with `severity: fix` (codes `title`, `description`, `canonical`, `alt`, `link`, `sitemap`) on a page whose inventory entry has a `file` of kind guide, article or tool. One item per page, exactly as `analysis` §1c writes them, with two differences: `- evidence: audit <date>: <n> findings` and every `fixes:` line ends with `(audit <date>)` so `fix` knows to confirm it against the live site instead of sitecheck:
   ```
   ### [B-nnn] fix: <path>
   - type: fix
   - target: <path>
   - score: <n> (potential <p> × ease 10 × fit <f>)      ← potential 3, or the page's gsc_potential from the latest seo/data/gsc snapshot; fit from the cluster priority
   - evidence: audit <date>: <n> findings
   - status: open
   - fixes:
     link: internal link /old-path redirects to /new-path: link the final URL (audit <date>)
     description: no meta description (audit <date>)
   ```
   A page that already has an open/claimed/in-review `fix` item → append the new `fixes:` lines to it (skip lines already present by code + `to`). A page owned by an open `refresh` item → `owned by B-nnn`, no fix item. A finding sitecheck also reports (same page, same code) is listed once, from the audit, with the `(audit <date>)` tag.
2. **`link` items** — `orphan` findings on article pages: one `link` item per cluster (`$P/skills/analysis/SKILL.md` §1c format, `- links:` lines `/hub → /orphan (orphan, audit <date>)`); a cluster with an open `link` item gets the pairs appended. Orphans with no cluster (no hub matches) go to the owner list.
3. **Owner list** — everything else: `broken-external`, `redirect-chain`, `duplicate-title`/`duplicate-description`, `noindex-in-sitemap`, `sitemap-404`, `thin`, `h1`, `mixed-content`, `slow`, `server-error`, every finding on a non-article page (home, pricing, legal, layouts), `sitemap.missing`, and the CWV rows. Group by code, worst first, ≤ 3 example paths per code; name the file when the inventory knows it. `thin` on an article is a refresh signal, not a fix: say so and leave it to `analysis`.

`--no-items` → bucket 3 only, with the would-be items counted.

## 3. Commit

Unless `--dry-run`: `git add seo/data/crawl/<date>.json seo/backlog.md` and commit `seo: audit <date> — <pages> pages, <findings> findings, <k> fix items, <m> link items` on the default branch (planning files commit directly); push if the branch has an upstream. No PR.

## 4. Report (≤ 15 lines)

- `audit <date>: <pages> pages crawled (<html> html, <truncated?>), <findings> findings (<fixable> fixable)`; sitemap `<count>` URLs, `<missing>` missing or failing
- Findings by code, one line, counts
- Diff vs `<previous>`: `<new>` new, `<resolved>` resolved (name the new ones if ≤ 5)
- Items: `fix` ids with paths; `link` ids with clusters; `owned by` / `already open` notes
- Owner list: ≤ 8 lines, worst first (a 5xx or a redirect chain in the navigation before a long description)
- CWV table when `--cwv`: path, LCP, CLS, INP, perf, source
- Next: `fix` runs the items on Friday (or `/seo-agent:fix` now); the next audit is due in 3 months

## Hard rules

- Read-only on the site: GET/HEAD with the `seo-agent-audit` user agent, one origin, `--max` pages, `--delay` between requests; never submit forms, never log in, never crawl another host
- Never edits articles, layouts or the sitemap; never opens a PR; writes only `seo/data/crawl/` and `seo/backlog.md`
- Backlog items only for article pages the `fix` skill may edit; everything else is the owner's
- Deterministic: the findings come from `crawl.js`; no finding is added from reading HTML by eye
- `thin` is never a fix item
