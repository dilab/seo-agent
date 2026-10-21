---
name: brand
description: Extract the product's branding from its own repo into /seo/brand.json and a Design system block in CLAUDE.md. Extraction only — no files rendered. Run once per product, or after a brand change.
---

# brand

You read the repo, not the live site. Outputs: `/seo/brand.json`, a `## Design system` block in `CLAUDE.md`. Nothing else.

## 1. Extract

Look, in this order, and stop when you have each value:

| Value | Where |
|---|---|
| colors.primary / accent | `tailwind.config.js` `theme.extend.colors`; `resources/css/app.css` `@theme` or `:root` vars; most-used `bg-*`/`text-*` non-grey class on buttons/links in `resources/views/layouts/*.blade.php` and `resources/views/components/` |
| colors.bg / surface / text / muted | same sources; default `#ffffff / #f6f7f9 / #111827 / #6b7280` |
| fonts.heading / body / google_url | `<link>` to fonts.googleapis.com in the layout; `fontFamily` in Tailwind config; `@font-face` in CSS → `source: local`; default Inter / Inter |
| radius | most common `rounded-*` on buttons/cards; map Tailwind token → px (`rounded-lg` 8, `-xl` 12, `-2xl` 16) |
| logo | `public/logo.svg`, `public/img/logo*`, `resources/svg/logo*`, `<img ... logo>` in the layout; prefer SVG; record the repo-relative path |
| motif | repeated background pattern in the layout (dots, grid, gradient blob) → name it; else `none` |
| product / domain | `config/app.php` name, `APP_URL` in `.env.example`, `package.json` name |

Record every file a value came from in `derived_from`. Values you could not find take the default and go in `defaults_used`.

Contrast: text on bg, and `on_primary` on primary, must each be ≥ 4.5:1 (WCAG). Set `on_primary` to `#ffffff` or `#111827`, whichever passes.

## 2. Write `/seo/brand.json`

```json
{
  "product": "", "domain": "",
  "colors": { "primary": "", "accent": "", "bg": "", "surface": "", "text": "", "muted": "", "on_primary": "" },
  "fonts": { "heading": "", "body": "", "source": "google|local", "google_url": "" },
  "radius": "12px",
  "logo": "relative/path/or/null",
  "motif": "dots|grid|waves|none",
  "derived_from": [], "defaults_used": []
}
```

If `brand.json` exists, diff against it and show the diff before overwriting; keep any key the owner added that you do not produce.

## 3. Write the design-system block in `CLAUDE.md`

Replace the content between the markers if present, else append:

```
<!-- seo-agent:design-system -->
## Design system
- Colors: primary <primary>, accent <accent>, surface <surface>, background <bg>, text <text>, muted <muted>
- Typography: <heading> for headings, <body> for body
- Spacing: 8px scale, <radius> border radius
- Logo: <logo path or "wordmark only">
- Motif: <motif>
<!-- /seo-agent:design-system -->
```

## 4. Report

Print: each value with its source file or `default`; the contrast ratios; the diff if `brand.json` existed. Suggest `/seo-agent:frames` as the next step.

Commit on the **current branch** (`seo: brand tokens`) — never create a branch or PR; setup files are config the owner reviews in the diff, and later skills need to see them. When called by `init`, just return.

## Hard rules
- Repo only; fetch the live site only if no stylesheet exists anywhere in the repo, and say so
- No rendering, no images, no frames, no API calls
- Never drop owner-added keys from an existing `brand.json`
