#!/usr/bin/env node
// genimage.js — one square subject image from an image-generation API.
//
//   node genimage.js --prompt "..." --out subject.png [--ref seo/frames/ref] [--size 1024]
//
// Provider from IMAGE_PROVIDER (openai | fal | replicate | stability), key from IMAGE_API_KEY.
// Only `openai` is implemented; others throw with a pointer to add an adapter below.
// Appends {ts, provider, prompt, cost_usd} to seo/data/image-costs.jsonl.

const fs = require('fs');
const path = require('path');

const args = parseArgs(process.argv.slice(2));
const provider = process.env.IMAGE_PROVIDER || 'openai';
const key = process.env.IMAGE_API_KEY;
if (!args.prompt || !args.out) die('usage: --prompt "..." --out file.png');
if (!key) die('IMAGE_API_KEY not set');

const adapters = {
  async openai(prompt, size) {
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.IMAGE_MODEL || 'gpt-image-1', prompt, n: 1, size: `${size}x${size}`, quality: process.env.IMAGE_QUALITY || 'medium', background: 'opaque' }),
    });
    if (!r.ok) throw new Error(`openai ${r.status}: ${await r.text()}`);
    const j = await r.json();
    const b64 = j.data[0].b64_json;
    return { buf: Buffer.from(b64, 'base64'), cost: Number(process.env.IMAGE_COST_USD || 0.04) };
  },
  // Add adapters here: fal, replicate, stability. Each returns { buf: PNG Buffer, cost: number }.
};

main().catch(e => die(e.message || e));

async function main() {
  const size = Number(args.size || 1024);
  const refs = listRefs(args.ref);
  const adapter = adapters[provider];
  if (!adapter) die(`no adapter for IMAGE_PROVIDER=${provider}; implement it in genimage.js`);
  // Reference images are only passed when the adapter supports them; openai text-only here.
  const { buf, cost } = await adapter(args.prompt, size, refs);
  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, buf);
  logCost({ ts: new Date().toISOString(), provider, prompt: args.prompt, cost_usd: cost, out: args.out });
  console.log(JSON.stringify({ out: args.out, provider, cost_usd: cost, refs: refs.length }));
}

function listRefs(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => /\.(png|jpe?g|webp)$/i.test(f)).map(f => path.join(dir, f));
}
function logCost(row) {
  const p = 'seo/data/image-costs.jsonl';
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, JSON.stringify(row) + '\n'); } catch {}
}
function die(m) { console.error(m); process.exit(1); }
function parseArgs(a) { const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const k = a[i].slice(2); const v = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true; o[k] = v; } return o; }
