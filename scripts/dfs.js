#!/usr/bin/env node
// dfs.js — DataForSEO REST client with compact extractors. Prints JSON to stdout.
//
//   node dfs.js check
//   node dfs.js serp        --keyword "k" [--location 2840] [--language en] [--domain recordmover.com] [--save dir]
//   node dfs.js overview    --keywords "a|b|c"                       volume, KD, intent, cpc per keyword (Labs, ≤700)
//   node dfs.js suggestions --keyword "seed" [--limit 200] [--min-volume 20] [--max-kd 60] [--exact]
//   node dfs.js ideas       --keywords "s1|s2" [--limit 200] [--min-volume 20] [--max-kd 60]
//   node dfs.js related     --keyword "seed" [--depth 1] [--limit 100] [--min-volume 20] [--max-kd 60]
//   node dfs.js ranked      --target domain [--limit 500] [--max-rank 30] [--min-volume 20]
//   node dfs.js competitors --target domain [--limit 15]
//   node dfs.js serp-competitors --keywords "a|b|c" [--limit 15] [--exclude d1|d2]   domains ranking for these keywords (≤200; fallback when competitors is empty)
//   node dfs.js volume      --keywords "a|b|c"                       Google Ads volume (fallback)
//   node dfs.js difficulty  --keywords "a|b|c"                       Labs bulk KD (fallback)
//   node dfs.js parse       --url https://example.com/page [--js] [--save dir]
//   node dfs.js spend       [--since 2026-10-23T06:00] [--ledger seo/data/spend.jsonl]
//   node dfs.js extract     --kind <command> --input raw.json [--domain d]   re-run an extractor on a saved raw response
//
// Auth: DATAFORSEO_LOGIN (or DATAFORSEO_USERNAME) + DATAFORSEO_PASSWORD from the environment. HTTP Basic.
// Exit codes: 0 ok · 1 API/task error (JSON {error} on stdout) · 2 usage/credentials.
// Every result carries `cost` (USD, from the API). Every network call appends {ts, cmd, endpoint, cost}
// to the ledger (default seo/data/spend.jsonl under the cwd; --ledger overrides; --no-ledger skips).
// Labs rows share one shape: {keyword, volume, kd, intent, cpc, competition, trend_12m, ...}.

const fs = require('fs');
const path = require('path');

const BASE = 'https://api.dataforseo.com/v3';
const BIG_BRANDS = ['zoom.com', 'zoom.us', 'google.com', 'microsoft.com', 'apple.com', 'reddit.com', 'youtube.com', 'wikipedia.org', 'amazon.com', 'facebook.com'];
const NOISE_DOMAINS = [...BIG_BRANDS, 'quora.com', 'medium.com', 'linkedin.com', 'github.com', 'stackoverflow.com', 'pinterest.com', 'x.com', 'twitter.com', 'instagram.com', 'tiktok.com'];
const LABS = '/dataforseo_labs/google';

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

async function main() {
  if (!cmd || args.help) usage();
  const location = Number(args.location || 2840);
  const language = args.language || 'en';
  const limit = n => Math.min(Number(args.limit || n), 1000);

  if (cmd === 'extract') {
    if (!args.kind || !args.input || !EXTRACT[args.kind]) usage('extract needs --kind <command> and --input');
    const raw = JSON.parse(fs.readFileSync(args.input, 'utf8'));
    return out(EXTRACT[args.kind](raw, args));
  }

  if (cmd === 'spend') return out(spend(args.since));

  const auth = credentials();
  const run = async (endpoint, body, saveKey) => {
    const raw = await call(auth, endpoint, body);
    ledger(cmd, endpoint, raw.cost || 0);
    if (saveKey) save(cmd, saveKey, raw);
    return raw;
  };

  if (cmd === 'check') {
    const raw = await call(auth, '/appendix/user_data', null, 'GET');
    const r = raw.tasks && raw.tasks[0] && raw.tasks[0].result && raw.tasks[0].result[0];
    return out({ ok: true, login: r && r.login, balance: r && r.money && r.money.balance, cost: raw.cost || 0 });
  }

  if (cmd === 'serp') {
    if (!args.keyword) usage('serp needs --keyword');
    const raw = await run('/serp/google/organic/live/advanced', [{ keyword: args.keyword, location_code: location, language_code: language, depth: 10, device: 'desktop' }], args.keyword);
    return out(EXTRACT.serp(raw, args));
  }

  if (cmd === 'overview') {
    const keywords = splitList(args.keywords);
    if (!keywords.length) usage('overview needs --keywords "a|b|c"');
    const raw = await run(`${LABS}/keyword_overview/live`, [{ keywords: keywords.slice(0, 700), location_code: location, language_code: language }], keywords[0]);
    return out(EXTRACT.overview(raw, args));
  }

  if (cmd === 'suggestions') {
    if (!args.keyword) usage('suggestions needs --keyword');
    const raw = await run(`${LABS}/keyword_suggestions/live`, [{ keyword: args.keyword, location_code: location, language_code: language, limit: limit(200), exact_match: !!args.exact, ...filterBlock() }], args.keyword);
    return out(EXTRACT.suggestions(raw, args));
  }

  if (cmd === 'ideas') {
    const keywords = splitList(args.keywords);
    if (!keywords.length) usage('ideas needs --keywords "s1|s2"');
    const raw = await run(`${LABS}/keyword_ideas/live`, [{ keywords: keywords.slice(0, 200), location_code: location, language_code: language, limit: limit(200), ...filterBlock() }], keywords[0]);
    return out(EXTRACT.ideas(raw, args));
  }

  if (cmd === 'related') {
    if (!args.keyword) usage('related needs --keyword');
    const raw = await run(`${LABS}/related_keywords/live`, [{ keyword: args.keyword, location_code: location, language_code: language, depth: Number(args.depth || 1), limit: limit(100), ...filterBlock('keyword_data.') }], args.keyword);
    return out(EXTRACT.related(raw, args));
  }

  if (cmd === 'ranked') {
    if (!args.target) usage('ranked needs --target domain');
    const filters = [];
    if (args['max-rank']) filters.push(['ranked_serp_element.serp_item.rank_group', '<=', Number(args['max-rank'])]);
    if (args['min-volume']) filters.push(['keyword_data.keyword_info.search_volume', '>=', Number(args['min-volume'])]);
    const raw = await run(`${LABS}/ranked_keywords/live`, [{ target: cleanDomain(args.target), location_code: location, language_code: language, limit: limit(500), item_types: ['organic'], order_by: ['keyword_data.keyword_info.search_volume,desc'], ...(filters.length ? { filters: joinFilters(filters) } : {}) }], args.target);
    return out(EXTRACT.ranked(raw, args));
  }

  if (cmd === 'competitors') {
    if (!args.target) usage('competitors needs --target domain');
    const raw = await run(`${LABS}/competitors_domain/live`, [{ target: cleanDomain(args.target), location_code: location, language_code: language, limit: limit(15), exclude_top_domains: true, max_rank_group: Number(args['max-rank'] || 20), item_types: ['organic'] }], args.target);
    return out(EXTRACT.competitors(raw, args));
  }

  if (cmd === 'serp-competitors') {
    const keywords = splitList(args.keywords);
    if (!keywords.length) usage('serp-competitors needs --keywords "a|b|c"');
    if (keywords.length > 200) usage('serp-competitors takes at most 200 keywords');
    const raw = await run(`${LABS}/serp_competitors/live`, [{ keywords, location_code: location, language_code: language, limit: limit(15), item_types: ['organic'], order_by: ['keywords_count,desc', 'rating,desc'] }], keywords[0]);
    return out(EXTRACT['serp-competitors'](raw, args));
  }

  if (cmd === 'volume' || cmd === 'difficulty') {
    const keywords = splitList(args.keywords);
    if (!keywords.length) usage(`${cmd} needs --keywords "a|b|c"`);
    const ep = cmd === 'volume' ? '/keywords_data/google_ads/search_volume/live' : `${LABS}/bulk_keyword_difficulty/live`;
    const raw = await run(ep, [{ keywords, location_code: location, language_code: language }], keywords[0]);
    return out(EXTRACT[cmd](raw, args));
  }

  if (cmd === 'parse') {
    if (!args.url) usage('parse needs --url');
    const raw = await run('/on_page/content_parsing/live', [{ url: args.url, markdown_view: true, enable_javascript: !!args.js, disable_cookie_popup: true }], args.url);
    return out(EXTRACT.parse(raw, args));
  }

  usage(`unknown command ${cmd}`);
}

// ---------- extractors (pure; also used by `extract`) ----------

const EXTRACT = {
  serp(raw, a) {
    const task = firstTask(raw);
    const res = (task.result && task.result[0]) || {};
    const items = res.items || [];
    const ours = cleanDomain(a.domain || '');
    const isOurs = d => ours && d && cleanDomain(d).endsWith(ours);

    const organic = items.filter(i => i.type === 'organic').map(i => ({
      rank: i.rank_group, abs: i.rank_absolute, url: i.url, domain: i.domain, title: i.title,
      description: i.description || null, ours: isOurs(i.domain) || undefined,
    }));
    const paaBlock = items.find(i => i.type === 'people_also_ask');
    const paa = ((paaBlock && paaBlock.items) || []).map(i => i.title).filter(Boolean);
    const fs_ = items.find(i => i.type === 'featured_snippet');
    const aio = items.find(i => i.type === 'ai_overview');
    const aioRefs = aio ? collectRefs(aio).map(r => r.domain).filter(Boolean) : [];
    const types = res.item_types || [...new Set(items.map(i => i.type))];
    const has = t => types.includes(t);
    const top10 = organic.filter(o => o.rank <= 10);

    return {
      keyword: res.keyword, location_code: res.location_code, language_code: res.language_code,
      results_count: res.se_results_count, check_url: res.check_url,
      top: top10, paa,
      features: {
        featured_snippet: !!fs_, featured_snippet_domain: fs_ ? fs_.domain : null,
        ai_overview: !!aio, ai_overview_async: aio ? !!aio.asynchronous_ai_overview : false, ai_overview_sources: [...new Set(aioRefs)],
        video: has('video'), knowledge_graph: has('knowledge_graph'), discussions: has('discussions_and_forums'),
        people_also_ask: has('people_also_ask'), shopping: has('shopping'), paid: has('paid'),
      },
      item_types: types,
      big_brands_in_top10: top10.filter(o => BIG_BRANDS.some(b => (o.domain || '').endsWith(b))).length,
      ours: organic.filter(o => o.ours).map(o => ({ rank: o.rank, url: o.url })),
      cost: raw.cost || 0,
    };
  },

  overview(raw) { return labsRows(raw, i => i); },
  suggestions(raw) { const r = labsRows(raw, i => i); r.seed = seedOf(raw); return r; },
  ideas(raw) { const r = labsRows(raw, i => i); r.seeds = seedOf(raw); return r; },
  related(raw) { const r = labsRows(raw, i => i.keyword_data, i => ({ depth: i.depth, also_searched: i.related_keywords || [] })); r.seed = seedOf(raw); return r; },

  ranked(raw, a) {
    const r = labsRows(raw, i => i.keyword_data, i => {
      const s = (i.ranked_serp_element && i.ranked_serp_element.serp_item) || {};
      return { rank: s.rank_group, abs: s.rank_absolute, url: s.url, type: s.type, etv: s.etv };
    });
    const res = firstResult(raw);
    r.target = res.target || (a && a.target) || null;
    r.total = res.total_count || r.rows.length;
    const m = (res.metrics && res.metrics.organic) || {};
    r.metrics = { count: m.count, pos_1: m.pos_1, pos_2_3: m.pos_2_3, pos_4_10: m.pos_4_10, pos_11_20: m.pos_11_20, pos_21_30: m.pos_21_30, etv: m.etv };
    return r;
  },

  competitors(raw, a) {
    const task = firstTask(raw);
    const res = firstResult(raw);
    const rows = (res.items || []).map(i => ({
      domain: i.domain, intersections: i.intersections, avg_position: i.avg_position,
      noise: NOISE_DOMAINS.some(d => (i.domain || '').endsWith(d)) || /\.(edu|gov|ac\.[a-z]+)$/.test(i.domain || '') || undefined,
      their_organic: i.full_domain_metrics && i.full_domain_metrics.organic ? { count: i.full_domain_metrics.organic.count, etv: i.full_domain_metrics.organic.etv } : undefined,
    }));
    return { target: res.target || (a && a.target) || null, rows, total: res.total_count || rows.length, cost: raw.cost || 0, task_status: task.status_code };
  },

  // Domains ranking for a keyword set. `intersections` = keywords_count so rows match `competitors`.
  'serp-competitors'(raw, a) {
    const task = firstTask(raw);
    const res = firstResult(raw);
    const exclude = splitList(a && a.exclude).map(cleanDomain);
    const rows = (res.items || []).map(i => ({
      domain: i.domain, intersections: i.keywords_count, avg_position: i.avg_position, median_position: i.median_position,
      etv: i.etv, visibility: i.visibility,
      noise: NOISE_DOMAINS.some(d => (i.domain || '').endsWith(d)) || /\.(edu|gov|ac\.[a-z]+)$/.test(i.domain || '') || undefined,
      ours: exclude.some(d => (i.domain || '').endsWith(d)) || undefined,
    }));
    return { keywords: res.seed_keywords || [], rows, total: res.total_count || rows.length, cost: raw.cost || 0, task_status: task.status_code };
  },

  volume(raw) {
    const task = firstTask(raw);
    const rows = (task.result || []).filter(Boolean).map(r => ({
      keyword: r.keyword, volume: r.search_volume, competition: r.competition, competition_index: r.competition_index, cpc: r.cpc,
      trend_12m: (r.monthly_searches || []).slice(0, 12).map(m => m.search_volume),
    }));
    return { rows, cost: raw.cost || 0 };
  },

  difficulty(raw) {
    const res = firstResult(raw);
    return { rows: (res.items || []).map(i => ({ keyword: i.keyword, kd: i.keyword_difficulty })), cost: raw.cost || 0 };
  },

  parse(raw) {
    const task = firstTask(raw);
    const res = (task.result && task.result[0]) || {};
    const item = (res.items && res.items[0]) || {};
    const pc = item.page_content || {};
    const md = item.page_as_markdown || '';
    const url = res.url || (task.data && task.data.url);

    let headings = [];
    if (md) {
      for (const line of md.split('\n')) {
        const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line);
        if (m) headings.push({ level: m[1].length, text: m[2].replace(/\[(.*?)\]\(.*?\)/g, '$1').trim() });
      }
    }
    if (!headings.length) {
      for (const t of pc.main_topic || []) headings.push({ level: levelNum(t.level), text: t.h_title || t.main_title || '' });
      for (const t of pc.secondary_topic || []) headings.push({ level: levelNum(t.level), text: t.h_title || t.main_title || '' });
      headings = headings.filter(h => h.text);
    }

    const text = md
      ? md.replace(/```[\s\S]*?```/g, ' ').replace(/!\[.*?\]\(.*?\)/g, ' ').replace(/\[(.*?)\]\(.*?\)/g, '$1').replace(/[#>*_|`-]+/g, ' ')
      : [...(pc.main_topic || []), ...(pc.secondary_topic || [])].flatMap(t => [...(t.primary_content || []), ...(t.secondary_content || [])]).map(c => c.text || '').join(' ');
    const word_count = text.split(/\s+/).filter(w => /\w/.test(w)).length;

    const tables = md ? (md.match(/^\s*\|?\s*:?-{3,}/gm) || []).length : (pc.table_content || []).length;
    const head = (md || text).slice(0, 4000);
    const dateHints = [...new Set((head.match(/(?:updated|published|last modified|reviewed)[^.\n]{0,40}?(?:20\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/gi) || []).map(s => s.trim()))].slice(0, 3);
    const years = [...new Set((head.match(/\b20\d{2}\b/g) || []))].slice(0, 5);
    const title = (pc.header && (pc.header.main_title || pc.header.h_title)) || (headings[0] && headings[0].text) || (pc.main_topic && pc.main_topic[0] && pc.main_topic[0].h_title) || null;

    return {
      url, status_code: item.status_code, fetch_time: item.fetch_time, title,
      headings: headings.slice(0, 60), word_count, tables, date_hints: dateHints, years,
      format_hints: {
        numbered_list: /^\s*\d+\.\s/m.test(md), has_table: tables > 0, faq: /\bFAQ|frequently asked|\?\s*$/im.test(md),
        steps: headings.filter(h => /^step\s*\d|^\d+[.)]\s/i.test(h.text)).length,
      },
      cost: raw.cost || 0,
    };
  },
};

// ---------- Labs normaliser ----------

// One row shape for every Labs keyword endpoint. `pick` returns the keyword block of an item
// (the item itself, or item.keyword_data); `extra` adds endpoint-specific fields.
function labsRows(raw, pick, extra) {
  const res = firstResult(raw);
  const rows = (res.items || []).map(i => {
    const k = pick(i) || {};
    const info = k.keyword_info || {};
    const props = k.keyword_properties || {};
    const intent = k.search_intent_info || {};
    return Object.assign({
      keyword: k.keyword,
      volume: info.search_volume == null ? null : info.search_volume,
      kd: props.keyword_difficulty == null ? null : props.keyword_difficulty,
      intent: intent.main_intent || null,
      secondary_intents: intent.foreign_intent || [],
      cpc: info.cpc == null ? null : info.cpc,
      competition: info.competition_level || null,
      trend_12m: (info.monthly_searches || []).slice(0, 12).map(m => m.search_volume),
      core: props.core_keyword || null,
    }, extra ? extra(i) : {});
  }).filter(r => r.keyword);
  return { rows, total: res.total_count == null ? rows.length : res.total_count, cost: raw.cost || 0 };
}

function filterBlock(prefix = '') {
  const f = [];
  if (args['min-volume']) f.push([`${prefix}keyword_info.search_volume`, '>=', Number(args['min-volume'])]);
  if (args['max-kd']) f.push([`${prefix}keyword_properties.keyword_difficulty`, '<=', Number(args['max-kd'])]);
  return f.length ? { filters: joinFilters(f), order_by: [`${prefix}keyword_info.search_volume,desc`] } : { order_by: [`${prefix}keyword_info.search_volume,desc`] };
}

// DataForSEO filter syntax: [cond, "and", cond, "and", cond]
function joinFilters(conds) { return conds.flatMap((c, i) => (i ? ['and', c] : [c])); }

function seedOf(raw) { const t = raw.tasks && raw.tasks[0]; const d = (t && t.data) || {}; return d.keyword || d.keywords || null; }

// ---------- spend ledger ----------

function ledgerPath() { return args.ledger || path.join('seo', 'data', 'spend.jsonl'); }

function ledger(c, endpoint, cost) {
  if (args['no-ledger']) return;
  try {
    fs.mkdirSync(path.dirname(ledgerPath()), { recursive: true });
    fs.appendFileSync(ledgerPath(), JSON.stringify({ ts: new Date().toISOString(), cmd: c, endpoint, cost: Number(cost) || 0 }) + '\n');
  } catch (e) { process.stderr.write(`ledger: ${e.message}\n`); }
}

function spend(since) {
  const file = ledgerPath();
  if (!fs.existsSync(file)) return { since: since || null, total: 0, calls: 0, by_cmd: {}, ledger: file };
  // Ledger timestamps are UTC; a --since without a zone suffix is read as UTC too, so a local time never over-counts.
  const from = since ? new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(since) || !/T/.test(since) ? since : since + 'Z') : null;
  if (since && isNaN(from)) usage('--since must be an ISO date or datetime');
  let total = 0, calls = 0; const by = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (from && new Date(e.ts) < from) continue;
    total += e.cost || 0; calls++; by[e.cmd] = Math.round(((by[e.cmd] || 0) + (e.cost || 0)) * 1e5) / 1e5;
  }
  return { since: since || null, total: Math.round(total * 1e5) / 1e5, calls, by_cmd: by, ledger: file };
}

// ---------- helpers ----------

function firstTask(raw) {
  if (!raw || raw.status_code !== 20000) throw new Error(`API ${raw && raw.status_code}: ${raw && raw.status_message}`);
  const t = raw.tasks && raw.tasks[0];
  if (!t) throw new Error('no task in response');
  if (t.status_code !== 20000) throw new Error(`task ${t.status_code}: ${t.status_message}`);
  return t;
}
function firstResult(raw) { const t = firstTask(raw); return (t.result && t.result[0]) || {}; }

function collectRefs(node, acc = []) {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) { node.forEach(n => collectRefs(n, acc)); return acc; }
  if (Array.isArray(node.references)) acc.push(...node.references);
  for (const k of Object.keys(node)) if (k !== 'references' && typeof node[k] === 'object') collectRefs(node[k], acc);
  return acc;
}

function levelNum(l) { const m = /h?(\d)/i.exec(String(l || '')); return m ? Number(m[1]) : 2; }
function cleanDomain(d) { return String(d || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase(); }

async function call(auth, endpoint, body, method = 'POST') {
  const r = await fetch(BASE + endpoint, {
    method, headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`); }
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${json.status_message || text.slice(0, 200)}`);
  return json;
}

function credentials() {
  const login = process.env.DATAFORSEO_LOGIN || process.env.DATAFORSEO_USERNAME;
  const pass = process.env.DATAFORSEO_PASSWORD;
  if (!login || !pass) {
    process.stdout.write(JSON.stringify({ error: 'DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD not set in the environment' }) + '\n');
    process.exit(2);
  }
  return Buffer.from(`${login}:${pass}`).toString('base64');
}

function save(kind, key, raw) {
  if (!args.save) return;
  fs.mkdirSync(args.save, { recursive: true });
  const slug = String(key).toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  fs.writeFileSync(path.join(args.save, `${kind}-${slug}.json`), JSON.stringify(raw));
}

function splitList(s) { return String(s || '').split('|').map(x => x.trim()).filter(Boolean); }
function out(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (!k.startsWith('--')) continue;
    const name = k.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) a[name] = true; else { a[name] = next; i++; }
  }
  return a;
}

function usage(msg) {
  if (msg) process.stderr.write(msg + '\n');
  process.stderr.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 21).map(l => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
  process.exit(2);
}

main().catch(e => { process.stdout.write(JSON.stringify({ error: String(e.message || e) }) + '\n'); process.exit(1); });
