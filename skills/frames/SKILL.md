---
name: frames
description: Build or update the /seo/frames kit (six HTML frame templates driven by brand.json), render a contact sheet for approval, and optionally convert an approved Claude Design canvas into frames. Requires /seo/brand.json.
---

# frames

Inputs: `/seo/brand.json` (from `brand`). Outputs: `/seo/frames/*.html`, `/seo/frames/_base.css`, `/seo/frames/logo.*`, `/seo/frames/DESIGN-BRIEF.md`, `/seo/frames/contact-sheet.png`.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/render.js`. Templates: `${CLAUDE_PLUGIN_ROOT}/templates/frames/`.

One command, state-driven. On each run, read `/seo/frames/canvas.json` (if any) and do the next thing:

| State | What this run does |
|---|---|
| no `seo/frames/` | install default kit → draft canvas → record URL → stop for review |
| `canvas.json` exists, `converted: false` | read the canvas, convert artboards → frames → contact sheet, mark converted |
| `canvas.json` exists, `converted: true` | re-read the canvas; if its version changed since `converted_version`, convert again; else just re-render the contact sheet |
| `--no-design` | default kit + contact sheet, never touch the canvas |
| `--new-canvas` | draft a fresh canvas even if one exists |
| `--from-canvas <url>` | use a canvas you made yourself instead of the drafted one |

So the owner's loop is: run → edit the canvas → run → look at the contact sheet → (edit → run) until happy.

## 0. Preconditions
`/seo/brand.json` must exist; else print `Run /seo-agent:brand first` and stop. Check `node_modules/playwright` and `sharp` resolve from the plugin root; if not, print the install command and stop.

## 1. Default kit
1. Copy `_base.css` and `hero, stat, compare, steps, quote`.html from the plugin templates to `/seo/frames/`.
   Guard: if a target exists and `git log --format=%an -- <file>` shows a commit not authored by the agent, keep it and print `kept (owner-edited)`.
2. Copy the logo named in `brand.json` to `/seo/frames/logo.<ext>`. No logo → skip; frames fall back to a dot + product name.
3. Write `/seo/frames/DESIGN-BRIEF.md` (the brief used in step 1b, kept for re-runs):

```
five SEO image frames for <product>, one artboard each, using the design system in CLAUDE.md:
hero 1200×630 — eyebrow, title, one-line description, brand mark bottom-left
stat 1600×900 — eyebrow, one very large number, label, small source line
compare 1600×900 — eyebrow, title, table: label column + 2–3 value columns, header row in primary
steps 1600×900 — eyebrow, title, 3–5 numbered cards in a row
quote 1600×900 — large quotation mark, one bold sentence, attribution
Flat, generous whitespace, brand mark small bottom-left on every frame, no gradients, no stock imagery.
Placeholder copy about Zoom cloud recording storage.
```

## 1b. Draft the design canvas (skipped with `--no-design`)
1. Run the `/design` skill with the brief from `DESIGN-BRIEF.md`, prefixed with: "Read seo/brand.json and the Design system block in CLAUDE.md first." If `/design` is unavailable in this session (no artifacts, API-key login), say so and continue with the default kit.
2. Record it in `/seo/frames/canvas.json`: `{ "url": "...", "created": "<date>", "converted": false, "converted_version": null }`.
3. Stop and tell the owner: open the canvas, adjust the artboards, then run `/seo-agent:frames` again. Never convert in the same run as the draft — the point of the canvas is the owner's edits.

## 2. Convert the canvas
1. Resolve the URL (`--from-canvas` argument, else `canvas.json`). Read the artifact (own artifacts return raw HTML; note its current version). Identify five artboards by name or size.
2. Rewrite each as a frame template: keep layout, colours, type and spacing; replace placeholder copy with the tokens `render.js` fills — `{{eyebrow}} {{title}} {{description}} {{value}} {{label}} {{source}} {{text}} {{attribution}} {{column_cells}} {{row_html}} {{step_html}} {{logo_html}} {{product}}`; put `{{font_link}}` in `<head>` and `{{base_css}}` first in `<style>`; add `<!-- size: WxH -->`; root element `class="frame motif-{{motif}}"`.
3. Overwrite `/seo/frames/<name>.html` (owner-approved design, guard does not apply). Keep `_base.css`.
4. Render the sheet (step 3); compare to the canvas; fix differences, max two passes; report anything unmatched. Set `converted: true` and `converted_version` to the version read in `canvas.json`.

## 3. Contact sheet
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/render.js --contact-sheet --brand seo/brand.json --frames seo/frames --out seo/frames/contact-sheet.png
```
Read the PNG. Check: heading font loaded (not a fallback serif), contrast, logo visible, nothing clipped. Font not loaded → set `fonts.source: local` in `brand.json` and retry once, then report.

## 4. Finish
`git add seo/frames` and commit on the **current branch** (`seo: frame kit`) — never create a branch or PR; setup skills stay on the owner's branch so each run sees the previous one's output. Called by `init`: return.

Print: what state the run was in and what it did, files written / kept, contact sheet path, canvas URL, and the next step (edit the canvas and re-run, or `/seo-agent:images` once an article exists).

## Hard rules
- No image APIs of any kind; the only rendering is local HTML → PNG
- Never overwrite owner-edited frames except in `--from-canvas` mode
