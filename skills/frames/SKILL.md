---
name: frames
description: Build or update the /seo/frames kit (six HTML frame templates driven by brand.json), render a contact sheet for approval, and optionally convert an approved Claude Design canvas into frames. Requires /seo/brand.json.
---

# frames

Inputs: `/seo/brand.json` (from `brand`). Outputs: `/seo/frames/*.html`, `/seo/frames/_base.css`, `/seo/frames/logo.*`, `/seo/frames/DESIGN-BRIEF.md`, `/seo/image-style.md`, `/seo/frames/contact-sheet.png`.

Scripts: `${CLAUDE_PLUGIN_ROOT}/scripts/render.js`. Templates: `${CLAUDE_PLUGIN_ROOT}/templates/frames/`.

Modes:
- `/seo-agent:frames` — install or refresh the default kit
- `/seo-agent:frames --from-canvas <artifact url>` — replace the kit with frames converted from an approved design canvas

## 0. Preconditions
`/seo/brand.json` must exist; else print `Run /seo-agent:brand first` and stop. Check `node_modules/playwright` and `sharp` resolve from the plugin root; if not, print the install command and stop.

## 1. Default kit
1. Copy `_base.css` and `hero, inline, stat, compare, steps, quote`.html from the plugin templates to `/seo/frames/`.
   Guard: if a target exists and `git log --format=%an -- <file>` shows a commit not authored by the agent, keep it and print `kept (owner-edited)`.
2. Copy the logo named in `brand.json` to `/seo/frames/logo.<ext>`. No logo → skip; frames fall back to a dot + product name.
3. Write `/seo/frames/DESIGN-BRIEF.md` (prompt the owner can paste into `/design`):

```
/design six SEO image frames for <product>, one artboard each, using the design system in CLAUDE.md:
hero 1200×630 — eyebrow, title, optional 360px square illustration slot right, brand mark bottom-left
inline 1600×900 — 620px square illustration slot centred, optional caption below
stat 1600×900 — eyebrow, one very large number, label, small source line
compare 1600×900 — eyebrow, title, table: label column + 2–3 value columns, header row in primary
steps 1600×900 — eyebrow, title, 3–5 numbered cards in a row
quote 1600×900 — large quotation mark, one bold sentence, attribution
Flat, generous whitespace, brand mark small bottom-left on every frame, no gradients, no stock imagery.
Placeholder copy about Zoom cloud recording storage.
```

4. Write `/seo/image-style.md` if missing (never overwrite):

```
# Image style — <product>

## House style (prepended to every subject prompt)
Flat vector illustration, single subject centred, plain solid background <bg>,
palette limited to <primary>, <accent>, <text>, <muted>, soft geometric shapes, no gradients,
no text, no letters, no logos, no faces, no screenshots or UI mockups, no photographic realism.

## Reference prompts (replace after bootstrap)
1. a folder moving from a cloud to a hard drive
2. a calendar with three days crossed out
3. a padlock sitting on a stack of documents

## Subjects to avoid
abstract concepts (security, growth, success), people, hands, brand mascots, anything with text

## Reference images
/seo/frames/ref/ — empty until the owner picks 5 from the bootstrap sheet
```

## 2. From canvas (`--from-canvas <url>`)
1. Read the artifact (own artifacts return raw HTML). Identify six artboards by name or size.
2. Rewrite each as a frame template: keep layout, colours, type and spacing; replace placeholder copy with the tokens `render.js` fills — `{{eyebrow}} {{title}} {{caption}} {{value}} {{label}} {{source}} {{text}} {{attribution}} {{column_cells}} {{row_html}} {{step_html}} {{subject_img}} {{logo_html}} {{product}}`; put `{{font_link}}` in `<head>` and `{{base_css}}` first in `<style>`; add `<!-- size: WxH -->`; root element `class="frame motif-{{motif}}"`, plus `{{subject_class}}` on hero.
3. Overwrite `/seo/frames/<name>.html` (owner-approved design, guard does not apply). Keep `_base.css`.
4. Render the sheet (step 3); compare to the canvas; fix differences, max two passes; report anything unmatched.

## 3. Contact sheet
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/render.js --contact-sheet --brand seo/brand.json --frames seo/frames --out seo/frames/contact-sheet.png
```
Read the PNG. Check: heading font loaded (not a fallback serif), contrast, logo visible, nothing clipped, subject slots populated with the placeholder. Font not loaded → set `fonts.source: local` in `brand.json` and retry once, then report.

## 4. Finish
Standalone: `git add seo/frames seo/image-style.md seo/brand.json`, commit on branch `seo/frames`, open PR `seo: frame kit` with the contact sheet in the body. Called by `init`: return.

Print: files written / kept, contact sheet path, next step (`/design` with the brief, or `/seo-agent:images` once an article exists).

## Hard rules
- No image-generation API calls; the only rendering is local HTML → PNG
- Never overwrite owner-edited frames except in `--from-canvas` mode
- Never overwrite an existing `image-style.md`
