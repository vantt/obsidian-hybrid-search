#!/usr/bin/env node
// Semantic-branch evaluation (PRD G10, Q3): embedding model x restoreForEmbedding on/off x reranker on/off on the
// Vietnamese eval set. Each model is indexed once; every query variant runs against that index.
//
//   node vantt/scripts/semantic-eval.mjs --ohs <OHS tree> --pack <ohs-lang-vi build/index.js> --work <dir> [options]
//
// Options
//   --models a,b,c     subset of: e5-small, e5-base, bge-m3, halong, halong-fp32   (default: all)
//   --threads N        ONNX intra-op threads for every step (default 4, models an ordinary laptop; 0 = all cores)
//   --k N              result depth (default 10)
//   --vault <dir> --golden <file>   use an existing corpus; default: generate vi-search@v0.11.0 into <work>/vault
//   --otf <otf.mjs>    fixture generator to use instead of npx
//   --python <bin>     python with torch, transformers, onnx, onnxruntime; needed once to export `halong` and `halong-fp32` to ONNX
//   --runs N           repeat each query process N times and report the median timing (default 1; quality is deterministic)
//   --serial           run models one after another (cleaner timings; default runs them in parallel)
//   --force            redo steps that already have a stored result
//   --report-only      do not measure; rebuild the tables from <work>/results
//   --out <file>       aggregated JSON (default <work>/semantic-eval.json)
//
// Everything (cache, databases, logs, temp files) stays under <work>; nothing is written to the OHS tree. Zero dependencies.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(here, 'lib/semantic-worker.mjs');
const EXPORTER = path.join(here, 'lib/semantic-export-onnx.py');
const GOLDEN = path.resolve(here, '../eval/vi/golden-set.json');
const FIXTURE_TAG = 'v0.11.0';
const RERANKER = 'onnx-community/gte-multilingual-reranker-base';

const MODELS = {
  'e5-small': {
    name: 'Xenova/multilingual-e5-small',
    note: 'upstream default; q8 ONNX from Xenova, MIT/Apache upstream model',
  },
  'e5-base': { name: 'Xenova/multilingual-e5-base', note: 'q8 ONNX from Xenova' },
  'bge-m3': {
    name: 'Xenova/bge-m3',
    note: 'q8 ONNX from Xenova, MIT; OHS pools with mean, the model was trained with CLS',
  },
  halong: {
    name: 'contextboxai/halong_embedding',
    note: 'Vietnamese fine-tune of multilingual-e5-base, Apache-2.0; no ONNX upstream, exported and int8-quantised locally',
    exportFrom: 'contextboxai/halong_embedding',
    exportMode: 'q8',
  },
  'halong-fp32': {
    name: 'local/halong-fp32',
    note: 'same model, unquantised graph (shows the quality the int8 export gives up)',
    exportFrom: 'contextboxai/halong_embedding',
    exportMode: 'fp32',
  },
};
const PAIR_CATEGORIES = ['vi-semantic', 'vi-synonym'];

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const need = (n) => {
  const v = value(n);
  if (!v) {
    console.error(`missing ${n}`);
    process.exit(2);
  }
  return path.resolve(v);
};

const work = need('--work');
const results = path.join(work, 'results');
fs.mkdirSync(results, { recursive: true });
const modelIds = (value('--models') ?? Object.keys(MODELS).join(',')).split(',');
for (const m of modelIds)
  if (!MODELS[m]) {
    console.error(`unknown model ${m}`);
    process.exit(2);
  }
const threads = Number(value('--threads') ?? 4);
const k = Number(value('--k') ?? 10);
const runs = Number(value('--runs') ?? 1);

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const dirBytes = (dir) => {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((s, e) => {
    const p = path.join(dir, e.name);
    return s + (e.isDirectory() ? dirBytes(p) : fs.statSync(p).size);
  }, 0);
};
const mb = (b) => Math.round(b / 1048576);
const log = (m) => console.error(`[semantic-eval ${new Date().toISOString().slice(11, 19)}] ${m}`);

// ---------- environment ----------
const home = path.join(work, 'home');
const cacheRoot = path.join(home, '.cache');
const hfCache = path.join(cacheRoot, 'huggingface');
fs.mkdirSync(path.join(work, 'tmp'), { recursive: true });
fs.mkdirSync(path.join(work, 'db'), { recursive: true });
fs.mkdirSync(path.join(work, 'logs'), { recursive: true });
fs.mkdirSync(hfCache, { recursive: true });
if (threads > 0) {
  const state = path.join(cacheRoot, 'obsidian-hybrid-search');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(
    path.join(state, 'inference-settings.json'),
    JSON.stringify({ version: 1, threads }),
  );
}

function baseEnv(vault, model, dbFile, packOptions) {
  const env = { ...process.env };
  for (const v of ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_EMBEDDING_MODEL', 'RERANKER_MODEL'])
    delete env[v];
  Object.assign(env, {
    HOME: home,
    XDG_CACHE_HOME: cacheRoot,
    TMPDIR: path.join(work, 'tmp'),
    OHS_DISABLE_UPDATE_CHECK: '1',
    OHS_TREE: path.resolve(need('--ohs')),
    OBSIDIAN_VAULT_PATH: vault,
    OBSIDIAN_DB_PATH: dbFile,
    OBSIDIAN_IGNORE_PATTERNS: '.obsidian/**,templates/**,*.canvas,_ohs/**',
    LOCAL_EMBEDDING_MODEL: model,
    OHS_LANGUAGE_PACK: need('--pack'),
    OHS_LANGUAGE_PACK_OPTIONS: JSON.stringify(packOptions),
  });
  return env;
}

function runWorker(step, params, env, logName) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', WORKER, step, JSON.stringify(params)],
      { cwd: env.OHS_TREE, env },
    );
    const logFile = fs.createWriteStream(path.join(work, 'logs', `${logName}.log`), { flags: 'a' });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => logFile.write(d));
    child.on('close', (code) => {
      logFile.end();
      const line = out.split('\n').find((l) => l.startsWith('RESULT '));
      if (code !== 0 || !line)
        return reject(
          new Error(
            `step ${step} failed (exit ${code}); see ${path.join(work, 'logs', `${logName}.log`)}`,
          ),
        );
      resolve({ ...JSON.parse(line.slice(7)), wall_ms: Date.now() - t0 });
    });
  });
}

// A step stores its result in <work>/results/<id>.json and is skipped when that file exists.
async function step(id, fn) {
  const file = path.join(results, `${id}.json`);
  if (!flag('--force') && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  log(`start ${id}`);
  const r = await fn();
  fs.writeFileSync(file, JSON.stringify(r));
  log(`done  ${id}`);
  return r;
}

// ---------- corpus ----------
function prepareCorpus() {
  if (value('--vault'))
    return { vault: path.resolve(value('--vault')), golden: path.resolve(need('--golden')) };
  const vault = path.join(work, 'vault');
  const raw = path.join(work, 'golden-raw.json');
  if (!fs.existsSync(vault)) {
    const gen = ['generate', '--preset', 'vi-search', '--out', vault, '--answers-out', raw];
    const otf = value('--otf');
    const r = otf
      ? spawnSync(process.execPath, [path.resolve(otf), ...gen], { stdio: 'inherit' })
      : spawnSync('npx', ['--yes', `github:vantt/obsidian-test-fixture#${FIXTURE_TAG}`, ...gen], {
          cwd: work,
          stdio: 'inherit',
        });
    if (r.status !== 0) {
      console.error('fixture generation failed');
      process.exit(1);
    }
  }
  // The committed golden set (NFD paths, see vantt/eval/vi/README.md) must be the one this corpus generates.
  const expected = JSON.parse(fs.readFileSync(raw, 'utf8')).map((q) => ({
    ...q,
    relevant_paths: q.relevant_paths.map((p) => p.normalize('NFD')),
    partial_paths: q.partial_paths.map((p) => p.normalize('NFD')),
  }));
  const committed = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
  if (JSON.stringify(expected) !== JSON.stringify(committed)) {
    console.error('golden-set.json differs from the corpus in <work>/vault');
    process.exit(1);
  }
  return { vault, golden: GOLDEN };
}

// ---------- measurement ----------
async function measureModel(id, corpus) {
  const { name } = MODELS[id];
  const dbFile = path.join(work, 'db', `${id}.db`);
  const env = (opts) => baseEnv(corpus.vault, name, dbFile, opts);
  const out = { id, model: name, threads };

  if (
    MODELS[id].exportFrom &&
    !fs.existsSync(path.join(hfCache, name, 'onnx/model_quantized.onnx'))
  ) {
    const py = value('--python');
    if (!py)
      throw new Error(
        `${id}: no ONNX in cache; pass --python <python with torch/transformers/onnx/onnxruntime> once to export it`,
      );
    log(`${id}: exporting to ONNX`);
    const r = spawnSync(
      path.resolve(py),
      [EXPORTER, MODELS[id].exportFrom, path.join(hfCache, name), MODELS[id].exportMode],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: home,
          HF_HOME: path.join(work, 'hf-home'),
          TMPDIR: path.join(work, 'tmp'),
        },
      },
    );
    fs.writeFileSync(path.join(work, 'logs', `${id}-export.log`), `${r.stdout}\n${r.stderr}`);
    if (r.status !== 0) throw new Error(`${id}: ONNX export failed, see logs/${id}-export.log`);
    log(`${id}: ${r.stdout.split('\n').find((l) => l.startsWith('cosine')) ?? ''}`);
  }

  // 1. first call downloads the model (not timed); second call is a warm start from disk.
  await step(`${id}-download`, () => runWorker('load', {}, env({}), `${id}-load`));
  out.load = await step(`${id}-load`, () => runWorker('load', {}, env({}), `${id}-load`));
  out.bench = await step(`${id}-bench`, () =>
    runWorker('bench', { passages: 24, words: 350 }, env({}), `${id}-bench`),
  );
  // 2. index once, default pack options (restoreForEmbedding does not touch the index).
  out.index = await step(`${id}-index`, () => {
    for (const ext of ['', '-wal', '-shm']) fs.rmSync(dbFile + ext, { force: true });
    return runWorker('index', {}, env({}), `${id}-index`);
  });
  out.disk = {
    model_mb: mb(dirBytes(path.join(hfCache, name))),
    db_mb: mb(fs.statSync(dbFile).size),
  };
  // 3. near-synonym separation on the stored vectors.
  out.pairs = await step(`${id}-pairs`, () =>
    runWorker(
      'pairs',
      { golden: corpus.golden, categories: PAIR_CATEGORIES },
      env({}),
      `${id}-pairs`,
    ),
  );
  // 4. query variants on that index; the pack option is fixed per process, so one process per restoreForEmbedding value.
  out.query = {};
  for (const restore of [false, true]) {
    const r = await step(`${id}-query-restore-${restore}`, async () => {
      const repeats = [];
      for (let i = 0; i < runs; i++)
        repeats.push(
          await runWorker(
            'query',
            { golden: corpus.golden, k, reranks: [false, true] },
            env({ restoreForEmbedding: restore }),
            `${id}-query`,
          ),
        );
      const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
      // Rankings do not depend on the run; timings and RAM are the median over runs.
      const passes = repeats[0].passes.map((p, pi) => ({
        ...p,
        runs,
        ms_mean: round(median(repeats.map((x) => x.passes[pi].ms_mean)), 1),
        ms_median: round(median(repeats.map((x) => x.passes[pi].ms_median)), 1),
        ms_p95: round(median(repeats.map((x) => x.passes[pi].ms_p95)), 1),
        rss_mb: median(repeats.map((x) => x.passes[pi].rss_mb)),
        warmup_ms: median(repeats.map((x) => x.passes[pi].warmup_ms)),
      }));
      return { passes };
    });
    for (const p of r.passes)
      out.query[`restore=${restore},rerank=${p.rerank}`] = { restore, ...p };
  }
  out.disk.reranker_mb = mb(dirBytes(path.join(hfCache, RERANKER)));
  return out;
}

// ---------- tables ----------
function aggregate(rows) {
  return {
    ndcg_5: round(mean(rows.map((r) => r.ndcg_5))),
    hit_5: round(mean(rows.map((r) => (r.hit_5 ? 1 : 0)))),
    hit_1: round(mean(rows.map((r) => (r.hit_1 ? 1 : 0)))),
    mrr: round(mean(rows.map((r) => r.mrr))),
  };
}
function byCategory(rows) {
  const cats = [...new Set(rows.map((r) => r.category))];
  return Object.fromEntries(cats.map((c) => [c, aggregate(rows.filter((r) => r.category === c))]));
}

function tables(all) {
  const lines = [];
  const variants = [
    'restore=false,rerank=false',
    'restore=true,rerank=false',
    'restore=false,rerank=true',
    'restore=true,rerank=true',
  ];
  const label = (v) =>
    `restore ${v.includes('restore=true') ? 'on' : 'off'}, rerank ${v.includes('rerank=true') ? 'on' : 'off'}`;
  lines.push(
    '### Overall (255 queries)',
    '',
    '| Model | Variant | nDCG@5 | Hit@5 | Hit@1 | MRR | ms/query (mean) | p95 ms |',
    '|---|---|---|---|---|---|---|---|',
  );
  for (const m of all)
    for (const v of variants) {
      const q = m.query[v];
      if (!q) continue;
      const a = aggregate(q.per_query);
      lines.push(
        `| ${m.id} | ${label(v)} | ${a.ndcg_5.toFixed(3)} | ${a.hit_5.toFixed(3)} | ${a.hit_1.toFixed(3)} | ${a.mrr.toFixed(3)} | ${q.ms_mean} | ${q.ms_p95} |`,
      );
    }
  const cats = Object.keys(byCategory(all[0].query[variants[0]].per_query));
  for (const metric of ['ndcg_5', 'hit_5']) {
    for (const rr of [false, true]) {
      lines.push(
        '',
        `### ${metric === 'ndcg_5' ? 'nDCG@5' : 'Hit@5'} by category, rerank ${rr ? 'on' : 'off'} (restore off / on)`,
        '',
        `| Category | ${all.map((m) => m.id).join(' | ')} |`,
        `|---|${all.map(() => '---').join('|')}|`,
      );
      for (const c of cats) {
        const cells = all.map((m) => {
          const [off, on] = [false, true].map(
            (r) => byCategory(m.query[`restore=${r},rerank=${rr}`].per_query)[c][metric],
          );
          return off === on ? off.toFixed(3) : `${off.toFixed(3)} / ${on.toFixed(3)}`;
        });
        lines.push(`| ${c} | ${cells.join(' | ')} |`);
      }
    }
  }
  lines.push(
    '',
    '### Separation of true near-synonym pairs and noise pairs (cosine)',
    '',
    '| Model | Pair set | n true / noise | mean true | mean noise | gap | Cohen d | AUC | dense-only Hit@1 | dense-only Hit@5 |',
    '|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const m of all)
    for (const [set, s] of Object.entries(m.pairs).filter(
      ([key]) => key !== 'rss_mb' && key !== 'wall_ms',
    )) {
      lines.push(
        `| ${m.id} | ${set} | ${s.n_true} / ${s.n_noise} | ${s.mean_true} | ${s.mean_noise} | ${s.gap} | ${s.cohen_d} | ${s.auc} | ${s.dense_only_hit_1 ?? ''} | ${s.dense_only_hit_5 ?? ''} |`,
      );
    }
  lines.push(
    '',
    '### Cost',
    '',
    '| Model | Dim | load (ms) | index (s) | chunks | ms/chunk (index) | ms/350-word passage | RAM index (MB) | RAM query (MB) | RAM query+rerank (MB) | model (MB) | DB (MB) | reranker (MB) |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  );
  for (const m of all) {
    const q0 = m.query['restore=false,rerank=false'],
      q1 = m.query['restore=false,rerank=true'];
    lines.push(
      `| ${m.id} | ${m.index.dim} | ${m.load.load_ms} | ${round(m.index.index_ms / 1000, 1)} | ${m.index.chunks} | ${round(m.index.index_ms / m.index.chunks, 1)} | ${m.bench.ms_per_passage} | ${m.index.rss_mb} | ${q0.rss_mb} | ${q1.rss_mb} | ${m.disk.model_mb} | ${m.disk.db_mb} | ${m.disk.reranker_mb} |`,
    );
  }
  lines.push(
    '',
    '### Extrapolation: indexing 2,000 notes',
    '',
    'Assumption: 2 chunks per note on average, each chunk costs one 350-word passage (upper bound for the chunk size OHS produces).',
    '',
    '| Model | minutes (2,000 notes x 2 chunks x passage cost) |',
    '|---|---|',
  );
  for (const m of all)
    lines.push(`| ${m.id} | ${round((2000 * 2 * m.bench.ms_per_passage) / 60000, 1)} |`);
  return lines.join('\n');
}

// ---------- main ----------
const corpus = flag('--report-only') ? { vault: '', golden: GOLDEN } : prepareCorpus();
let all;
if (flag('--report-only')) {
  all = modelIds.map((id) => {
    const rd = (n) => JSON.parse(fs.readFileSync(path.join(results, `${id}-${n}.json`), 'utf8'));
    const out = {
      id,
      model: MODELS[id].name,
      threads,
      load: rd('load'),
      bench: rd('bench'),
      index: rd('index'),
      pairs: rd('pairs'),
      query: {},
      disk: {},
    };
    for (const restore of [false, true])
      for (const p of rd(`query-restore-${restore}`).passes)
        out.query[`restore=${restore},rerank=${p.rerank}`] = { restore, ...p };
    const db = path.join(work, 'db', `${id}.db`);
    out.disk = {
      model_mb: mb(dirBytes(path.join(hfCache, MODELS[id].name))),
      db_mb: fs.existsSync(db) ? mb(fs.statSync(db).size) : null,
      reranker_mb: mb(dirBytes(path.join(hfCache, RERANKER))),
    };
    return out;
  });
} else if (flag('--serial')) {
  all = [];
  for (const id of modelIds) all.push(await measureModel(id, corpus));
} else {
  all = await Promise.all(modelIds.map((id) => measureModel(id, corpus)));
}
const outFile = path.resolve(value('--out') ?? path.join(work, 'semantic-eval.json'));
fs.writeFileSync(
  outFile,
  JSON.stringify(
    { date: new Date().toISOString(), threads, k, node: process.version, models: all },
    null,
    2,
  ) + '\n',
);
console.log(tables(all));
log(`aggregated results: ${outFile}`);
