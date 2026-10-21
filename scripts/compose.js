#!/usr/bin/env node
// compose.js — flatten a generated subject onto the brand background, then render it inside a frame.
//
//   node compose.js --subject s.png --frame inline|hero --data d.json --brand seo/brand.json --frames seo/frames --out out.png
//
// The subject is resized to a square, its near-white/near-bg edge pixels are made transparent
// so it sits on the frame without a hard box, then render.js is called with subject_path set.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const args = parseArgs(process.argv.slice(2));
main().catch(e => { console.error(e.message || e); process.exit(1); });

async function main() {
  const sharp = require('sharp');
  const brand = JSON.parse(fs.readFileSync(args.brand || 'seo/brand.json', 'utf8'));
  const bg = (brand.colors && brand.colors.bg) || '#ffffff';
  const data = args.data ? JSON.parse(fs.readFileSync(args.data, 'utf8')) : {};
  const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'compose-'));
  const flat = path.join(tmpDir, 'subject.png');

  // 1. square + flatten onto brand bg, then knock out the flat background to alpha
  const img = sharp(args.subject).resize(1024, 1024, { fit: 'contain', background: bg });
  const { data: raw, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [br, bgG, bb] = hexToRgb(bg);
  const tol = 18;
  for (let i = 0; i < raw.length; i += 4) {
    if (Math.abs(raw[i] - br) <= tol && Math.abs(raw[i + 1] - bgG) <= tol && Math.abs(raw[i + 2] - bb) <= tol) raw[i + 3] = 0;
  }
  await sharp(raw, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(flat);

  // 2. render inside the frame
  const d = { ...data, subject_path: flat };
  const dPath = path.join(tmpDir, 'data.json');
  fs.writeFileSync(dPath, JSON.stringify(d));
  const out = execFileSync('node', [path.join(__dirname, 'render.js'),
    '--frame', args.frame || 'inline', '--data', dPath,
    '--brand', args.brand || 'seo/brand.json', '--frames', args.frames || 'seo/frames',
    '--out', args.out, '--scale', String(args.scale || 2)], { encoding: 'utf8' });
  process.stdout.write(out);
}

function hexToRgb(h) { const s = h.replace('#', ''); const n = parseInt(s.length === 3 ? s.split('').map(c => c + c).join('') : s, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function parseArgs(a) { const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; o[k] = v; } return o; }
