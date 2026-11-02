#!/usr/bin/env node
// Integration check and eval of the German pack through a built OHS (patch language-pack-api), no core changes.
//
//   node scripts/run-eval.mjs --ohs <built OHS tree> [--work-dir <dir>] [--out result.json] [--k 10]
//
// Builds the pack (needs `npm run build` first), indexes eval/vault twice (no pack, then OHS_LANGUAGE_PACK=this
// package), runs eval/golden-set.json in fulltext mode (a fake embedding server only lets indexing succeed, so
// vectors carry no signal; the eval measures the lexical branches) and prints per-category Hit/MRR/nDCG.
// Exit 0 when every integration check passes and the pack is not worse than no pack in any category; 1 otherwise.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const args = process.argv.slice(2);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const ohs = path.resolve(value('--ohs') ?? '');
const k = Number(value('--k') ?? 10);
const cli = path.join(ohs, 'di' + 'st/src/cli.js');
if (!value('--ohs') || !fs.existsSync(cli)) {
  console.error(`usage: run-eval.mjs --ohs <built OHS tree> (cli not found: ${cli})`);
  process.exit(2);
}
if (!fs.existsSync(path.join(pkg, 'bui' + 'ld/index.js'))) {
  console.error('build the pack first: npm run build');
  process.exit(2);
}

const golden = JSON.parse(fs.readFileSync(path.join(pkg, 'eval/golden-set.json'), 'utf8'));
const work = fs.mkdtempSync(path.join(value('--work-dir') ?? os.tmpdir(), 'ohs-de-'));

const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let inputs = [''];
    try {
      const parsed = JSON.parse(body || '{}');
      inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? ''];
    } catch {}
    const data = inputs.map((text, index) => {
      const v = Array.from({ length: 8 }, (_, i) => ((String(text).length + i) % 7) + 1);
      const n = Math.hypot(...v);
      return { object: 'embedding', index, embedding: v.map((x) => x / n) };
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data, model: 'text-embedding-3-small' }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
};

function envFor(vault, withPack) {
  const env = {
    ...process.env,
    OBSIDIAN_VAULT_PATH: vault,
    OPENAI_API_KEY: 'eval',
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    OHS_DISABLE_UPDATE_CHECK: '1',
    NO_COLOR: '1',
  };
  delete env.OHS_LANGUAGE_PACK;
  delete env.OHS_LANGUAGE_PACK_OPTIONS;
  if (withPack) env.OHS_LANGUAGE_PACK = pkg;
  return env;
}

async function ohsRun(vault, withPack, argv) {
  const { stdout } = await run(process.execPath, [cli, ...argv], {
    cwd: vault,
    env: envFor(vault, withPack),
    timeout: 180_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function score(paths, q) {
  const rel = new Set(q.relevant_paths);
  const part = new Set(q.partial_paths ?? []);
  const gain = (p) => (rel.has(p) ? 2 : part.has(p) ? 1 : 0);
  const rank = paths.findIndex((p) => rel.has(p)) + 1;
  const top = (n) => (rank > 0 && rank <= n ? 1 : 0);
  const dcg = (list) => list.slice(0, 5).reduce((s, p, i) => s + (2 ** gain(p) - 1) / Math.log2(i + 2), 0);
  const ideal = [...q.relevant_paths, ...(q.partial_paths ?? [])];
  const best = ideal.sort((a, b) => gain(b) - gain(a));
  const seen = paths.slice(0, k);
  const found = q.relevant_paths.filter((p) => seen.includes(p)).length;
  return {
    hit_1: top(1), hit_3: top(3), hit_5: top(5),
    mrr: rank > 0 ? 1 / rank : 0,
    ndcg_5: dcg(best) === 0 ? 0 : dcg(paths) / dcg(best),
    recall_k: found / q.relevant_paths.length,
  };
}

const METRICS = ['hit_1', 'hit_3', 'hit_5', 'mrr', 'ndcg_5', 'recall_k'];
const mean = (rows, m) => (rows.length ? rows.reduce((s, r) => s + r[m], 0) / rows.length : 0);
const round = (x) => Math.round(x * 1000) / 1000;

async function evaluate(label, withPack) {
  const vault = path.join(work, label);
  fs.cpSync(path.join(pkg, 'eval/vault'), vault, { recursive: true });
  await ohsRun(vault, withPack, ['reindex']);
  const rows = await pool(golden, 4, async (q) => {
    const out = await ohsRun(vault, withPack, ['search', q.query, '--mode', 'fulltext', '--json', '--limit', String(k)]);
    const results = JSON.parse(out);
    return { q, results, ...score(results.map((r) => r.path), q) };
  });
  return { vault, rows };
}

function summarize(rows) {
  const cats = [...new Set(golden.map((q) => q.category))];
  const part = (rs) => Object.fromEntries(METRICS.map((m) => [m, round(mean(rs, m))]));
  return {
    summary: part(rows),
    by_category: Object.fromEntries(cats.map((c) => [c, { n: rows.filter((r) => r.q.category === c).length, ...part(rows.filter((r) => r.q.category === c)) }])),
  };
}

let exitCode = 0;
try {
  const base = await evaluate('base', false);
  const withPack = await evaluate('pack', true);

  // Integration checks, all through the public CLI of an unmodified OHS.
  const status = JSON.parse(await ohsRun(withPack.vault, true, ['status']));
  check('status reports the pack loaded', status.language_pack?.loaded === true && status.language_pack?.id === 'de', JSON.stringify(status.language_pack));
  const baseStatus = JSON.parse(await ohsRun(base.vault, false, ['status']));
  check('no pack: status has no loaded pack', !baseStatus.language_pack || baseStatus.language_pack.loaded !== true, JSON.stringify(baseStatus.language_pack));

  const explain = JSON.parse(await ohsRun(withPack.vault, true, ['search', 'grosse strasse', '--json', '--explain', '--limit', '5']));
  const top = explain[0];
  check('hybrid search with explain returns a view:de branch rank', explain.some((r) => r.explain?.ranks && 'view:de' in r.explain.ranks), JSON.stringify(top?.explain));
  check('hybrid search finds the eszett note', explain.some((r) => r.path === 'grosse-strasse.md'));

  const snip = JSON.parse(await ohsRun(withPack.vault, true, ['search', 'kaese', '--mode', 'fulltext', '--json', '--limit', '5']));
  const hit = snip.find((r) => r.path === 'kaesekuchen.md');
  check('snippet from view branch is original text', !!hit && /Käse/.test(hit.snippet ?? ''), JSON.stringify(hit?.snippet));

  const a = summarize(base.rows);
  const b = summarize(withPack.rows);
  const pad = (v) => String(v).padStart(11);
  console.log(`\n${'category'.padEnd(12)}${'n'.padStart(3)}  ${['Hit@1', 'Hit@3', 'Hit@5', 'MRR', 'nDCG@5', 'Rec@k'].map(pad).join('')}   (no pack -> pack)`);
  const line = (name, n, x, y) =>
    console.log(`${name.padEnd(12)}${String(n).padStart(3)}  ${METRICS.map((m) => pad(`${x[m].toFixed(2)}>${y[m].toFixed(2)}`)).join('')}`);
  line('ALL', golden.length, a.summary, b.summary);
  for (const c of Object.keys(a.by_category)) line(c, a.by_category[c].n, a.by_category[c], b.by_category[c]);

  const worse = [];
  for (const [c, x] of Object.entries(a.by_category)) for (const m of METRICS) if (b.by_category[c][m] < x[m]) worse.push(`${c}.${m}`);
  for (const m of METRICS) if (b.summary[m] < a.summary[m]) worse.push(`ALL.${m}`);
  check('pack is not worse than no pack (summary and every category)', worse.length === 0, worse.join(', '));

  const misses = withPack.rows.filter((r) => r.hit_5 === 0).map((r) => r.q.id);
  console.log(`\nqueries missing Hit@5 with pack: ${misses.join(', ') || 'none'}`);
  console.log(`queries missing Hit@5 without pack: ${base.rows.filter((r) => r.hit_5 === 0).map((r) => r.q.id).join(', ') || 'none'}`);

  if (value('--out')) {
    const slim = (rows) => rows.map((r) => ({ id: r.q.id, query: r.q.query, category: r.q.category, top: r.results.slice(0, 5).map((x) => x.path), ...Object.fromEntries(METRICS.map((m) => [m, round(r[m])])) }));
    fs.writeFileSync(path.resolve(value('--out')), JSON.stringify({ k, golden: golden.length, no_pack: { ...a, per_query: slim(base.rows) }, pack: { ...b, per_query: slim(withPack.rows) }, checks }, null, 2) + '\n');
  }
  exitCode = checks.every((c) => c.ok) ? 0 : 1;
} catch (error) {
  console.error(`run-eval: ${error.stderr || error.message || error}`);
  exitCode = 2;
} finally {
  server.close();
  fs.rmSync(work, { recursive: true, force: true });
}
process.exit(exitCode);
