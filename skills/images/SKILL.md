---
name: images
description: Render the images for one article from an image plan, using only the /seo/frames kit (hero, stat, compare, steps, quote). No AI image generation. Called by write/refresh, or run standalone with --plan and --out.
---

# images

Every image is a frame template filled with content from the article. No image APIs, no stock, no generated art. Output is deterministic: same plan + same frames = same pixels.

Input: an image plan — a JSON array, from `--plan <file>` or built by the calling skill:

```json
[
  { "id": "hero",    "type": "hero",    "eyebrow": "Guide", "title": "How long does Zoom keep cloud recordings?", "description": "Retention by plan, what happens at the cap, and how to keep every recording.", "alt": "..." },
  { "id": "storage", "type": "stat",    "eyebrow": "Storage", "value": "5 GB", "label": "Cloud storage on Zoom Pro", "source": "zoom.us/pricing", "alt": "..." },
  { "id": "plans",   "type": "compare", "eyebrow": "Plans", "title": "Storage by plan", "columns": ["Pro","Business","Enterprise"], "rows": [["Storage","5 GB","10 GB","Unlimited"]], "alt": "..." },
  { "id": "setup",   "type": "steps",   "eyebrow": "Setup", "title": "Three steps", "steps": ["Connect Zoom","Pick a folder","Set retention"], "alt": "..." },
  { "id": "takeaway","type": "quote",   "text": "Zoom deletes what you don't move.", "attribution": "", "alt": "..." }
]
```

Output dir: `--out <dir>` if given; else the article's image folder per `CLAUDE.md` (`<images path>/<slug>/`); if neither, print `pass --out <dir>` and stop.

Standalone test: `/seo-agent:images --plan ${CLAUDE_PLUGIN_ROOT}/test/plan-template-only.json --out seo/test-images`.

## 0. Preconditions
- `/seo/brand.json` exists, else `Run /seo-agent:brand first`; `/seo/frames/` exists, else `Run /seo-agent:frames first`; stop on either.
- Plan has exactly one `hero`. A hero may carry `"subject": "<path to a product screenshot>"`; without it the kit's subject slot is hidden (never leave a frame with an empty placeholder box). Each entry's `type` is one of `hero stat compare steps quote`; unknown types are skipped and reported.
- `stat`/`compare` values, `steps` text and `quote` text must appear in the article (when called by `write`/`refresh`); never invent numbers.

## 1. Render
For each entry, write it to a temp `data.json` and run:

```
node ${CLAUDE_PLUGIN_ROOT}/scripts/render.js --frame <type> --data <tmp>.json --brand seo/brand.json --frames seo/frames --out <dir>/<id>.png
```

`render.js` also writes `<id>.webp`.

## 2. Check every PNG
Read each output image. Verify: all text present and legible, nothing clipped or overflowing (long titles, 5-column tables, 5 steps are the usual culprits), logo visible, font not a fallback.
On a failure: shorten the offending text in the plan (title ≤ 90 chars, step ≤ 40 chars, ≤ 3 value columns, ≤ 5 steps) and re-render once. Still failing → report it and leave the image out; the calling skill drops the reference.

## 3. Output
Print a manifest: `id → path, type, alt`. The calling skill inserts `![alt](path)` at the planned sections and sets frontmatter `image:` to the hero.

## Planning guidance (for `write`/`refresh`)
Pick 3–5 per article from the article's own structure: a number → `stat`; a table → `compare`; ordered how-to → `steps`; the key sentence → `quote`; `hero` always. An article with none of that structure gets hero + quote only — don't manufacture a stat to fill a slot.

## Hard rules
- No image APIs, no external images, no screenshots, no browser
- Never invent numbers or steps; everything on a frame comes from the article
- Never ship an image that failed the check
