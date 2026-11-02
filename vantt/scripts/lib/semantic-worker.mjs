#!/usr/bin/env node
// One measurement step of the semantic-branch evaluation, run inside the OHS tree under tsx:
//   cd <ohs tree> && node --import tsx <this file> <step> '<json params>'
// The driver (vantt/scripts/semantic-eval.mjs) sets OHS_TREE, OBSIDIAN_VAULT_PATH, OBSIDIAN_DB_PATH,
// LOCAL_EMBEDDING_MODEL, HOME, XDG_CACHE_HOME, OHS_LANGUAGE_PACK(_OPTIONS) and prints nothing but one JSON line
// prefixed with "RESULT " on stdout.
//
// steps: load | index | bench | pairs | query
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [step, rawParams] = process.argv.slice(2);
const params = rawParams ? JSON.parse(rawParams) : {};
const tree = process.env.OHS_TREE;
const load = (rel) => import(pathToFileURL(path.join(tree, rel)).href);
const rssMb = () => Math.round(process.resourceUsage().maxRSS / 1024); // maxRSS is in KiB on Linux
const now = () => performance.now();
const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const emit = (obj) => { process.stdout.write(`RESULT ${JSON.stringify(obj)}\n`); process.exit(0); };

const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }; // vectors are L2-normalised
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const percentile = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
// P(true > noise) with ties counted half (Mann-Whitney U / AUC).
function auc(pos, neg) {
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}
const stdev = (xs) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
function separation(pos, neg) {
  const pooled = Math.sqrt((stdev(pos) ** 2 + stdev(neg) ** 2) / 2) || 1e-9;
  return {
    n_true: pos.length, n_noise: neg.length,
    mean_true: round(mean(pos)), mean_noise: round(mean(neg)),
    gap: round(mean(pos) - mean(neg)), cohen_d: round((mean(pos) - mean(neg)) / pooled, 2), auc: round(auc(pos, neg)),
  };
}

// A pack that fails to load makes OHS run as plain upstream; refuse to measure that by accident.
async function openIndex() {
  await indexService.openIndexDatabase();
  const status = (await load('src/language/loader.ts')).languagePackStatus();
  if (process.env.OHS_LANGUAGE_PACK && !status?.loaded) throw new Error(`language pack not loaded: ${JSON.stringify(status)}`);
  return status;
}

const embedder = await load('src/inference/embedder.ts');
const indexService = await load('src/indexing/index-service.ts');
const db = await load('src/storage/db.ts');

async function embedOne(text, type) {
  const [o] = await embedder.embedDetailed([text], type);
  if (!o?.ok) throw new Error(`embedding failed: ${JSON.stringify(o)}`);
  return o.embedding;
}

if (step === 'load') {
  // Model load (download is done before this step by the driver's first call; the second call measures a warm start).
  const t0 = now();
  const v = await embedOne('khởi động', 'query');
  const t1 = now();
  await embedOne('một câu thứ hai để đo thời gian một lần nhúng', 'query');
  emit({ load_ms: Math.round(t1 - t0), single_embed_ms: round(now() - t1, 1), dim: v.length, rss_mb: rssMb() });
}

if (step === 'index') {
  const pack = await openIndex();
  const svc = indexService.createIndexService();
  const t0 = now();
  const r = await svc.reindex({ force: true }).finally(() => svc.close());
  const ms = now() - t0;
  const d = db.getDb();
  const count = (t) => d.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  emit({
    index_ms: Math.round(ms), indexed: r.indexed, errors: r.errors.length, notes: count('notes'), chunks: count('chunks'),
    dim: db.getStoredEmbeddingDim(), rss_mb: rssMb(), pack: pack?.signature ?? null,
  });
}

if (step === 'bench') {
  // Realistic chunk cost: passages built from vault note bodies, about 350 words (near the 512-token limit for Vietnamese).
  const files = fs.readdirSync(path.join(process.env.OBSIDIAN_VAULT_PATH, 'notes')).filter((f) => f.endsWith('.md')).sort();
  const bodies = files.map((f) => fs.readFileSync(path.join(process.env.OBSIDIAN_VAULT_PATH, 'notes', f), 'utf8'));
  const words = bodies.join(' ').split(/\s+/);
  const passages = [];
  for (let i = 0; i < params.passages; i++) passages.push(words.slice((i * 211) % (words.length - params.words), ((i * 211) % (words.length - params.words)) + params.words).join(' '));
  await embedOne('khởi động', 'document');
  const t0 = now();
  for (let i = 0; i < passages.length; i += 8) {
    const out = await embedder.embedDetailed(passages.slice(i, i + 8), 'document');
    if (out.some((o) => !o.ok)) throw new Error('bench embedding failed');
  }
  emit({ passages: passages.length, words: params.words, ms_per_passage: round((now() - t0) / passages.length, 1), rss_mb: rssMb() });
}

if (step === 'pairs') {
  // (a) lexicon synonym phrases vs cross-group phrases; (b) query vs stored note vectors for the paraphrase categories.
  await openIndex();
  if (db.getStoredEmbeddingDim() !== null) embedder.primeEmbeddingDim(db.getStoredEmbeddingDim());
  const lex = fs.readFileSync(path.join(process.env.OBSIDIAN_VAULT_PATH, '_ohs/lexicon.md'), 'utf8');
  const section = lex.split(/^## /m).find((s) => s.startsWith('Đồng nghĩa')) ?? '';
  const groups = section.split('\n').slice(1).map((l) => l.trim()).filter((l) => l.includes('=')).map((l) => l.split('=').map((x) => x.trim()));
  const phrases = groups.flatMap((g, gi) => g.map((p) => ({ p, gi })));
  const vecs = new Map();
  for (const { p } of phrases) vecs.set(p, await embedOne(p, 'query'));
  const truePairs = [], noisePairs = [];
  for (let i = 0; i < phrases.length; i++) {
    for (let j = i + 1; j < phrases.length; j++) {
      const c = cosine(vecs.get(phrases[i].p), vecs.get(phrases[j].p));
      (phrases[i].gi === phrases[j].gi ? truePairs : noisePairs).push(c);
    }
  }
  const out = { lexicon_phrases: separation(truePairs, noisePairs) };

  const golden = JSON.parse(fs.readFileSync(params.golden, 'utf8'));
  const d = db.getDb();
  const paths = d.prepare('SELECT path FROM notes').all().map((r) => r.path);
  const noteVecs = new Map(paths.map((p) => [p, db.getChunkEmbeddingsByPath(p)]));
  const noteScore = (q, p) => Math.max(...noteVecs.get(p).map((v) => cosine(q, v)));
  for (const category of params.categories) {
    const pos = [], neg = [];
    let top1 = 0, top5 = 0, n = 0;
    for (const g of golden.filter((x) => x.category === category)) {
      const q = await embedOne(g.query, 'query');
      const scored = paths.map((p) => ({ p, s: noteScore(q, p) })).sort((a, b) => b.s - a.s);
      const rel = new Set(g.relevant_paths);
      for (const { p, s } of scored) (rel.has(p) ? pos : neg).push(s);
      const rank = scored.findIndex((x) => rel.has(x.p));
      top1 += rank === 0 ? 1 : 0; top5 += rank >= 0 && rank < 5 ? 1 : 0; n++;
    }
    out[`query_note_${category}`] = { ...separation(pos, neg), dense_only_hit_1: round(top1 / n), dense_only_hit_5: round(top5 / n) };
  }
  out.rss_mb = rssMb();
  emit(out);
}

if (step === 'query') {
  const { search } = await load('src/search/searcher.ts');
  const { buildPerQueryResult } = await load('eval/evaluate.ts');
  const pack = await openIndex();
  const stored = db.getStoredEmbeddingDim();
  if (stored !== null) embedder.primeEmbeddingDim(stored);
  const golden = JSON.parse(fs.readFileSync(params.golden, 'utf8'));
  const passes = [];
  for (const rerank of params.reranks) {
    const tw = now();
    await search('khởi động thử máy', { mode: 'hybrid', limit: params.k, rerank });
    const warmup_ms = Math.round(now() - tw);
    const times = [], rows = [];
    for (const g of golden) {
      const t0 = now();
      const res = await search(g.query, { mode: 'hybrid', limit: params.k, rerank, scope: g.scope });
      times.push(now() - t0);
      rows.push(buildPerQueryResult(g, res.map((r) => r.path), params.k));
    }
    passes.push({
      rerank, warmup_ms, rss_mb: rssMb(),
      ms_mean: round(mean(times), 1), ms_median: round(percentile(times, 0.5), 1), ms_p95: round(percentile(times, 0.95), 1),
      per_query: rows.map((r, i) => ({ id: r.id, category: r.category, ndcg_5: r.ndcg_5, hit_5: r.hit_5, hit_1: r.hit_1, mrr: r.mrr, ms: round(times[i], 1) })),
    });
  }
  emit({ passes, pack: pack?.signature ?? null });
}

throw new Error(`unknown step: ${step}`);
