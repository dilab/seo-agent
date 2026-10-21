---
name: images
description: Produce the images for one article from an image plan, using the /seo/frames kit. Template frames for stat/compare/steps/quote/hero; AI-generated subject composited into a frame for illustrations. Called by write/refresh, or run standalone with a plan file.
---

# images

Input: an image plan — a JSON array, either passed as a file path (`--plan path`) or built by the calling skill:

```json
[
  { "id": "hero", "type": "hero", "title": "Zoom cloud recording limits in 2026", "subject": "a cloud with a full gauge", "alt": "..." },
  { "id": "limits", "type": "stat", "value": "5 GB", "label": "Cloud storage on Zoom Pro", "source": "zoom.us/pricing", "alt": "..." },
  { "id": "plans", "type": "compare", "columns": ["Pro","Business","Enterprise"], "rows": [["Storage","5 GB","10 GB","Unlimited"]], "alt": "..." },
  { "id": "how", "type": "steps", "steps": ["Connect Zoom","Pick a folder","Set retention"], "alt": "..." },
  { "id": "backup", "type": "illustration", "subject": "a folder moving from a cloud to a hard drive", "caption": "Recordings copied nightly", "alt": "..." },
  { "id": "takeaway", "type": "quote", "text": "Zoom deletes what you don't move.", "attribution": "", "alt": "..." }
]
```

Output dir: the article's image folder per `CLAUDE.md` (`<images path>/<slug>/`). Scripts in `${CLAUDE_PLUGIN_ROOT}/scripts/`.

## 0. Preconditions
- `/seo/brand.json` exists, else print `Run /seo-agent:brand first`; `/seo/frames/` exists, else print `Run /seo-agent:frames first`; stop on either.
- `/seo/image-style.md` exists for any `illustration` or `hero` with a `subject`.
- Count AI-call entries (`illustration`, and `hero` with `subject`). If more than `images_per_article` from `strategy.md` (default 2), drop the lowest-priority extras: keep hero's subject, then illustrations in plan order. Report what was dropped.

## 1. Template-only frames
For each `stat | compare | steps | quote`, and `hero` without a subject:

```
node scripts/render.js --frame <type> --data <tmp>.json --brand seo/brand.json --frames seo/frames --out <dir>/<id>.png
```

`data.json` is the plan entry itself. Sizes come from the frame.

## 2. AI subjects
For each `illustration`, and `hero` with `subject`:

1. Build the prompt: house style block from `image-style.md` + `", " + subject`. Nothing else.
2. ```
   node scripts/genimage.js --prompt "<prompt>" --out <tmp>/<id>-subject.png --ref seo/frames/ref
   ```
   Square, plain background. The script logs cost to `/seo/data/image-costs.jsonl`.
3. ```
   node scripts/compose.js --subject <tmp>/<id>-subject.png --frame inline|hero --data <tmp>.json --brand seo/brand.json --frames seo/frames --out <dir>/<id>.png
   ```

## 3. Check every PNG
Read each output image and verify:
- the subject named in the plan is literally present (a folder, a cloud — not an abstract blob)
- no text, letters, logos, or UI in the generated part
- frame text legible, nothing clipped, logo visible
- background of the subject blends with the frame slot (no hard square edge)

Failing AI image: regenerate the subject once with the same prompt + `", simpler, fewer elements"`. Failing twice: drop the subject and render the template-only variant (`hero` without subject; `illustration` → `quote` using the caption). Failing template image: fix the data and re-render; if a frame itself is broken, report it and continue.

## 4. Output
- Files at `<dir>/<id>.png` plus `.webp` from `render.js`
- Print a manifest: id → path, type, alt, AI-generated yes/no, attempts
- The calling skill inserts `![alt](path)` at the planned sections; hero also goes in frontmatter `image:`

## Hard rules
- Nothing ships without passing through a frame; never copy a raw `genimage.js` output into the article folder
- AI calls ≤ `images_per_article` per article, counting retries as calls; stop generating when the cap is hit
- Never invent numbers for `stat`/`compare`; values must come from the article text
- No browser, no screenshots, no fetching of external images
