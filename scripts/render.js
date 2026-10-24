#!/usr/bin/env node
// render.js — fill a frame template with brand.json + data, render to PNG (+WebP).
//
//   node render.js --frame stat --data d.json --brand seo/brand.json --frames seo/frames --out out.png [--scale 2]
//   node render.js --contact-sheet --brand seo/brand.json --frames seo/frames --out seo/frames/contact-sheet.png
//
// Prints JSON {out, webp, width, height} on success. Deps: playwright (chromium), sharp.

const fs = require('fs');
const path = require('path');

const args = parseArgs(process.argv.slice(2));
const SIZES = { hero: [1200, 630], stat: [1600, 900], compare: [1600, 900], steps: [1600, 900], quote: [1600, 900] };

main().catch(e => { console.error(e.message || e); process.exit(1); });

async function main() {
  const brand = JSON.parse(fs.readFileSync(args.brand || 'seo/brand.json', 'utf8'));
  const framesDir = args.frames || 'seo/frames';
  const scale = Number(args.scale || 2);

  if (args['contact-sheet']) return contactSheet(brand, framesDir, args.out || path.join(framesDir, 'contact-sheet.png'), scale);

  const frame = args.frame;
  if (!frame || !SIZES[frame]) throw new Error(`--frame must be one of ${Object.keys(SIZES).join(', ')}`);
  const data = args.data ? JSON.parse(fs.readFileSync(args.data, 'utf8')) : {};
  const html = buildHtml(frame, data, brand, framesDir);
  const [w, h] = SIZES[frame];
  const out = await renderHtml(html, w, h, scale, args.out, framesDir);
  console.log(JSON.stringify(out));
}

// ---------- template filling ----------

function buildHtml(frame, data, brand, framesDir) {
  const tplPath = path.join(framesDir, `${frame}.html`);
  const basePath = fs.existsSync(path.join(framesDir, '_base.css')) ? path.join(framesDir, '_base.css') : path.join(__dirname, '..', 'templates', 'frames', '_base.css');
  let tpl = fs.readFileSync(tplPath, 'utf8');
  let base = fs.readFileSync(basePath, 'utf8');

  const c = brand.colors || {};
  const tokens = {
    'colors.primary': c.primary || '#2563eb',
    'colors.accent': c.accent || c.primary || '#f59e0b',
    'colors.bg': c.bg || '#ffffff',
    'colors.surface': c.surface || '#f6f7f9',
    'colors.text': c.text || '#111827',
    'colors.muted': c.muted || '#6b7280',
    'colors.on_primary': c.on_primary || '#ffffff',
    'radius': brand.radius || '12px',
    'fonts.heading': (brand.fonts && brand.fonts.heading) || 'Inter',
    'fonts.body': (brand.fonts && brand.fonts.body) || 'Inter',
    'motif': brand.motif || 'none',
    'product': esc(brand.product || ''),
    'font_link': fontLink(brand),
    'logo_html': logoHtml(brand, framesDir),
    'subject_img': subjectHtml(data),
    'subject_class': subjectHtml(data) ? '' : 'no-subject',
    'eyebrow': esc(data.eyebrow || ''),
    'title': esc(data.title || ''),
    'description': esc(data.description || ''),
    'value': esc(data.value || ''),
    'label': esc(data.label || ''),
    'source': esc(data.source || ''),
    'text': esc(data.text || ''),
    'attribution': esc(data.attribution || ''),
    'column_cells': (data.columns || []).map(x => `<th>${esc(x)}</th>`).join(''),
    'row_html': (data.rows || []).map(r => `<tr>${r.map((x, i) => i === 0 ? `<td>${esc(x)}</td>` : `<td>${esc(x)}</td>`).join('')}</tr>`).join(''),
    'step_html': (data.steps || []).map((s, i) => `<div class="step"><div class="num">${i + 1}</div><div class="step-text">${esc(s)}</div></div>`).join(''),
    'title_size': fitSize(data.title || '', { 40: 64, 70: 54, 100: 46, 999: 40 }),
    'value_size': fitSize(data.value || '', { 4: 260, 8: 200, 14: 150, 999: 110 }),
    'text_size': fitSize(data.text || '', { 60: 72, 110: 60, 170: 50, 999: 42 }),
  };
  base = fill(base, tokens);
  tokens.base_css = base;
  return fill(tpl, tokens);
}

function fill(s, tokens) {
  return s.replace(/\{\{([a-z_.]+)\}\}/g, (_, k) => (k in tokens ? tokens[k] : ''));
}
function esc(s) { return String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
function fitSize(text, table) { const n = String(text).length; for (const k of Object.keys(table).map(Number).sort((a, b) => a - b)) if (n <= k) return table[k]; return 40; }
function fileUrl(p) {
  const ext = path.extname(p).slice(1).toLowerCase();
  const mime = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`;
}
function fontLink(brand) {
  const f = brand.fonts || {};
  if (f.google_url) return `<link rel="stylesheet" href="${f.google_url}">`;
  if (f.source === 'local') return '';
  const fams = [...new Set([f.heading || 'Inter', f.body || 'Inter'])].map(x => `family=${encodeURIComponent(x)}:wght@400;600;700;800`).join('&');
  return `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fams}&display=swap">`;
}
// hero only: an optional product screenshot or illustration in the subject slot.
// data.subject = path to a png/jpg/svg/webp; absent or missing file → the frame gets class no-subject and the slot is hidden.
function subjectHtml(data) {
  const p = data.subject;
  if (p && fs.existsSync(p)) return `<img src="${fileUrl(p)}" alt="">`;
  return '';
}
function logoHtml(brand, framesDir) {
  const cands = [brand.logo, ...['logo.svg', 'logo.png'].map(x => path.join(framesDir, x))].filter(Boolean);
  for (const p of cands) if (p && fs.existsSync(p)) return `<img src="${fileUrl(p)}" alt="">`;
  return '<span class="dot"></span>';
}

// ---------- rendering ----------

async function renderHtml(html, w, h, scale, outPath, framesDir) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: scale });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();
  let webp = null;
  try {
    const sharp = require('sharp');
    webp = outPath.replace(/\.png$/, '.webp');
    await sharp(outPath).webp({ quality: 88 }).toFile(webp);
  } catch { webp = null; }
  return { out: outPath, webp, width: w * scale, height: h * scale };
}

// ---------- contact sheet ----------

async function contactSheet(brand, framesDir, outPath, scale) {
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'frames-'));
  const samples = {
    hero: { eyebrow: 'Guide', title: 'How long does Zoom keep cloud recordings?', description: 'Retention limits by plan, what happens at the cap, and how to keep every recording.' },
    stat: { eyebrow: 'Storage', value: '5 GB', label: 'Included cloud recording storage on a Pro licence', source: 'zoom.us/pricing' },
    compare: { eyebrow: 'Plans', title: 'Cloud recording storage by plan', columns: ['Pro', 'Business', 'Enterprise'], rows: [['Storage', '5 GB', '10 GB', 'Unlimited'], ['Retention', 'Manual', 'Manual', 'Policy'], ['Export', 'One by one', 'One by one', 'Bulk']] },
    steps: { eyebrow: 'Setup', title: 'Back up recordings in three steps', steps: ['Connect your Zoom account', 'Choose a Drive or Dropbox folder', 'Set a retention rule'] },
    quote: { text: 'Zoom deletes what you don’t move. Make moving automatic.', attribution: 'RecordMover docs' },
  };
  const rendered = [];
  for (const [frame, data] of Object.entries(samples)) {
    const [w, h] = SIZES[frame];
    const p = path.join(tmp, `${frame}.png`);
    await renderHtml(buildHtml(frame, data, brand, framesDir), w, h, 1, p, framesDir);
    rendered.push({ frame, p, w, h });
  }
  const sharp = require('sharp');
  const cellW = 800, gap = 24, cols = 2;
  const tiles = [];
  let x = 0, y = 0, rowH = 0, maxH = 0;
  for (let i = 0; i < rendered.length; i++) {
    const r = rendered[i];
    const h = Math.round(r.h * (cellW / r.w));
    const buf = await sharp(r.p).resize(cellW, h).toBuffer();
    tiles.push({ input: buf, left: x, top: y });
    rowH = Math.max(rowH, h);
    if ((i + 1) % cols === 0) { y += rowH + gap; rowH = 0; x = 0; } else { x += cellW + gap; }
    maxH = y + rowH;
  }
  const sheetH = maxH + (rowH ? 0 : 0);
  await sharp({ create: { width: cellW * cols + gap, height: sheetH, channels: 4, background: '#e5e7eb' } })
    .composite(tiles).png().toFile(outPath);
  console.log(JSON.stringify({ out: outPath, frames: rendered.map(r => r.frame) }));
}


function parseArgs(a) {
  const o = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; o[k] = v; }
  }
  return o;
}
