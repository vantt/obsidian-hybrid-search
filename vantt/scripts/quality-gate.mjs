#!/usr/bin/env node
// Quality gate (PRD 11.6, tier T5).
//
//   node vantt/scripts/quality-gate.mjs --target-ref <ref> --target-sha <sha> --branch <branch> --json
//        [--with-lang <id>]...   evaluate with that language pack (vantt/packages/ohs-lang-<id>)
//        [--strict]              pending targets fail too
//        [--write-baseline]      record the measured results as new baseline files (refuses to replace one)
//        [--force]               with --write-baseline: replace existing files (lowering needs a reviewed PR)
//        [--otf <otf.mjs>]       cloned obsidian-test-fixture for the vi corpus (default: npx from GitHub)
//        [--k 10]
//   node vantt/scripts/quality-gate.mjs --private <dir|golden-set.json> [--vault <dir>] [--with-lang <id>] [--json] [--out <file>]
//        [--private-detail <file>]   local per-query JSON (queries, paths, ranks): the file must be outside the repository
//
// Run from the repo root of the release branch (built, dependencies installed). Exit 0 =
// pass (pending targets are reported, not failed), 1 = a check failed, 2 = could not run.
// Thresholds: vantt/scripts/quality-gates.json; baselines: vantt/eval/baselines/<platform>/.
//
// Private mode (V15) evaluates the user's own vault with their own golden set, which
// live outside the repository. Only aggregate numbers are printed or written: never
// a query, a path or a note title; the child's own output is swallowed, except that a failed
// child's own stderr tail is printed on the terminal (never into the report) so the failure can
// be diagnosed. The vault is indexed with the user's note selection (OBSIDIAN_IGNORE_PATTERNS...)
// and `_ohs/**` (the lexicon) ignored. `--private-detail` is the one exception: it writes
// per-query content to a local file outside the repository (refused otherwise) and prints only
// that the file was written.
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { baseVersion, pickBaseline, writeBaseline } from './lib/baselines.mjs';
import {
  evalEnv,
  goldenFile,
  nfdGolden,
  platformKey,
  prepareDataset,
  privateEvalEnv,
  runDetail,
  runEvaluate,
} from './lib/eval-run.mjs';
import {
  regressionChecks,
  upstreamChecks,
  upstreamPackCheck,
  verdict,
  viChecks,
} from './lib/gates.mjs';
import { ensureNpm } from './lib/npm.mjs';
import { git, sh } from './lib/proc.mjs';
import { sameRunUpstream } from './lib/same-run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const log = (m) => process.stderr.write(`${m}\n`);

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'target-ref': { type: 'string' },
      'target-sha': { type: 'string' },
      branch: { type: 'string' },
      json: { type: 'boolean', default: false },
      'with-lang': { type: 'string', multiple: true },
      strict: { type: 'boolean', default: false },
      'write-baseline': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      k: { type: 'string', default: '10' },
      otf: { type: 'string' },
      private: { type: 'string' },
      vault: { type: 'string' },
      out: { type: 'string' },
      'private-detail': { type: 'string' },
    },
    strict: true,
  });
  return values;
}

/**
 * Why `file` may not receive private per-query content, or null when it may: it must lie outside
 * the repository work tree (and so outside vantt/) and outside any other git work tree.
 */
export function detailPathError(file, root) {
  const target = path.resolve(file);
  let ancestor = path.dirname(target);
  while (!existsSync(ancestor) && ancestor !== path.dirname(ancestor))
    ancestor = path.dirname(ancestor);
  const real = path.join(realpathSync(ancestor), path.relative(ancestor, target));
  const inside = (dir) => {
    const rel = path.relative(realpathSync(dir), real);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (inside(root))
    return '--private-detail must be outside the repository (it holds real queries and note paths)';
  const other = git(realpathSync(ancestor), ['rev-parse', '--show-toplevel'], { allowFail: true });
  if (other.ok) return '--private-detail must not be inside a git work tree';
  return null;
}

const packDir = (root, lang) => path.join(root, 'vantt', 'packages', `ohs-lang-${lang}`);

/** Build the pack (its `main` is a build output); installs its dependencies first when they are missing. */
function buildPack(dir, log) {
  if (!existsSync(path.join(dir, 'package.json'))) return;
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (!pkg.scripts?.build) return;
  log(`  building ${pkg.name}`);
  if (
    !existsSync(path.join(dir, 'node_modules')) &&
    !sh(dir, existsSync(path.join(dir, 'package-lock.json')) ? 'npm ci' : 'npm install').ok
  )
    throw new Error(`npm install failed in ${pkg.name}`);
  if (!sh(dir, 'npm run build').ok) throw new Error(`build of ${pkg.name} failed`);
  if (pkg.main && !existsSync(path.join(dir, pkg.main)))
    throw new Error(`${pkg.name} has no ${pkg.main} after the build`);
}

function packEnv(config, lang, dir, base = evalEnv) {
  const extra = { OHS_LANGUAGE_PACK: dir };
  const options = config.pack_options?.[lang];
  if (options) extra.OHS_LANGUAGE_PACK_OPTIONS = JSON.stringify(options);
  return base(extra);
}

/** eval/quality.ts floors (macOS ARM, as upstream's own gate). */
function qualityFloors(root, result, scratch) {
  mkdirSync(scratch, { recursive: true });
  const file = path.join(scratch, 'floors-input.json');
  writeFileSync(file, JSON.stringify(result));
  const script =
    "import('./eval/quality.ts').then((m)=>{m.assertEvalQuality(JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8')))}).catch((e)=>{console.log(e.message);process.exit(1)})";
  const res = spawnSync(process.execPath, ['--import', 'tsx', '-e', script, file], {
    cwd: root,
    env: evalEnv(),
    encoding: 'utf8',
  });
  return {
    ok: res.status === 0,
    message:
      res.status === 0
        ? 'eval/quality.ts floors passed'
        : res.stdout.trim() || 'eval/quality.ts floors failed',
  };
}

/** The vi corpus eval of a pack through vantt/eval/vi/run-eval.mjs. */
function runViEval(root, lang, dir, config, scratch, k, otf) {
  mkdirSync(scratch, { recursive: true });
  // lang null: the same tree without a pack.
  const out = path.join(scratch, `vi-${lang ?? 'nopack'}.json`);
  const options = lang ? config.pack_options?.[lang] : null;
  const res = spawnSync(
    process.execPath,
    [
      path.join(root, 'vantt', 'eval', 'vi', 'run-eval.mjs'),
      '--ohs',
      root,
      ...(lang ? ['--lang-pack', dir] : []),
      ...(options ? ['--lang-options', JSON.stringify(options)] : []),
      '--k',
      String(k),
      '--out',
      out,
      ...(otf ? ['--otf', path.resolve(otf)] : []),
    ],
    // run-eval.mjs builds its corpus under os.tmpdir() and fetches the fixture with npx from GitHub,
    // which npm 12 (the version upstream pins) only does with allow-git.
    {
      cwd: root,
      env: evalEnv({ TMPDIR: scratch, npm_config_allow_git: 'all' }),
      stdio: ['ignore', 2, 2],
    },
  );
  if (res.status !== 0)
    throw new Error(
      `vi eval ${lang ? `with pack ${lang}` : 'without a pack'} failed (exit ${res.status})`,
    );
  return JSON.parse(readFileSync(out, 'utf8'));
}

/** Tag of the obsidian-test-fixture that run-eval.mjs pins (the vi corpus is generated from it). */
function fixtureTag(root) {
  const src = readFileSync(path.join(root, 'vantt', 'eval', 'vi', 'run-eval.mjs'), 'utf8');
  const m = /FIXTURE_TAG\s*=\s*'(v[^']+)'/.exec(src);
  if (!m) throw new Error('cannot read FIXTURE_TAG from vantt/eval/vi/run-eval.mjs');
  return m[1];
}

/**
 * vi-snippet criterion (PRD 11.6, G8): every snippet is original text and contains the match,
 * checked by vantt/eval/vi/check-snippets.mjs on a fresh copy of the generated vi vault.
 * Returns the share of passing queries, or undefined when the checker does not exist.
 */
function runSnippetCheck(root, lang, dir, config, scratch, otf) {
  const script = path.join(root, 'vantt', 'eval', 'vi', 'check-snippets.mjs');
  if (!existsSync(script)) return undefined;
  const work = path.join(scratch, 'snippets');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const vault = path.join(work, 'vault');
  const env = evalEnv({ TMPDIR: scratch, npm_config_allow_git: 'all' });
  const gen = [
    'generate',
    '--preset',
    config.vi.set,
    '--out',
    vault,
    '--answers-out',
    path.join(work, 'answers.json'),
  ];
  const made = otf
    ? spawnSync(process.execPath, [path.resolve(otf), ...gen], {
        cwd: work,
        env,
        stdio: ['ignore', 2, 2],
      })
    : spawnSync(
        'npx',
        ['--yes', `github:vantt/obsidian-test-fixture#${fixtureTag(root)}`, ...gen],
        { cwd: work, env, stdio: ['ignore', 2, 2] },
      );
  if (made.status !== 0) throw new Error('could not generate the vi corpus for the snippet check');
  const options = config.pack_options?.[lang];
  const out = path.join(work, 'snippets.json');
  spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      script,
      '--lang-pack',
      dir,
      '--vault',
      vault,
      ...(options ? ['--lang-options', JSON.stringify(options)] : []),
      '--json',
      out,
    ],
    { cwd: root, env, stdio: ['ignore', 2, 2] },
  );
  if (!existsSync(out)) throw new Error('snippet check produced no result');
  const { summary } = JSON.parse(readFileSync(out, 'utf8'));
  rmSync(work, { recursive: true, force: true });
  return summary.queries ? summary.snippetCriterion / summary.queries : undefined;
}

async function standard(opts, root, config) {
  const k = Number(opts.k);
  const platform = platformKey();
  const pkgVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const baselines = path.join(root, 'vantt', 'eval', 'baselines', platform);
  const scratch = path.join(root, 'vantt', '.work', 'quality');
  const langs = [...new Set(opts['with-lang'] ?? [])];
  const report = {
    gate: 'fail',
    platform,
    version: pkgVersion,
    target: {
      ref: opts['target-ref'] ?? null,
      sha: opts['target-sha'] ?? null,
      branch: opts.branch ?? null,
    },
    languages: {},
    checks: [],
    pending: [],
  };
  const checks = report.checks;
  const written = [];
  try {
    // The vi corpus is fetched with npx, and the fixture pins npm like upstream does.
    const npmErr = ensureNpm(root, log);
    if (npmErr) throw new Error(npmErr);
    const corpus = config.upstream.corpus;
    log(`Quality gate on ${platform}, version ${pkgVersion}.`);
    log(`Upstream eval (${corpus}), no pack`);
    const dataset = prepareDataset(root, corpus, log);
    const golden = goldenFile(root, corpus);
    const common = { vault: dataset, golden, scratch, k, log };
    const noPack = runEvaluate({ ...common, tree: root, env: evalEnv() });
    const floors = platform === 'darwin-arm64' ? qualityFloors(root, noPack, scratch) : null;
    const upBaseline = pickBaseline(baselines, { set: corpus, version: baseVersion(pkgVersion) });
    // Pristine upstream measured in this run, on this machine (T4's result when it is current).
    const reference =
      platform === 'darwin-arm64'
        ? null
        : sameRunUpstream({ root, sha: opts['target-sha'], corpus, k, scratch, log });
    checks.push(
      ...upstreamChecks(config.upstream, {
        platform,
        result: noPack,
        reference,
        baseline: upBaseline,
        floors,
      }),
    );
    if (opts['write-baseline'])
      written.push(
        writeBaseline(baselines, {
          version: baseVersion(pkgVersion),
          set: corpus,
          result: noPack,
          force: opts.force,
        }),
      );

    if (!langs.length) log('No language pack requested: pack checks skipped.');
    for (const lang of langs) {
      const dir = packDir(root, lang);
      const entry = (report.languages[lang] = { pack: existsSync(dir) ? 'present' : 'absent' });
      if (!existsSync(dir)) {
        checks.push({
          id: `pack-${lang}`,
          status: 'pending',
          detail: `vantt/packages/ohs-lang-${lang} is not present yet`,
        });
        continue;
      }
      buildPack(dir, log);
      log(`Upstream eval (${corpus}) with pack ${lang}`);
      const withPack = runEvaluate({ ...common, tree: root, env: packEnv(config, lang, dir) });
      checks.push(upstreamPackCheck(config.upstream, { noPack, withPack }));
      entry.upstream_summary = { without: noPack.summary, with: withPack.summary };
      if (lang !== 'vi') {
        checks.push({ id: `${lang}-eval`, status: 'pending', detail: `no ${lang} golden set yet` });
        continue;
      }
      log('vi eval without a pack (same-run reference)');
      const viNoPack = {
        version: 'same run',
        result: runViEval(root, null, null, config, scratch, k, opts.otf),
      };
      log(`vi eval with pack ${lang}`);
      const vi = runViEval(root, lang, dir, config, scratch, k, opts.otf);
      const snippetOk = runSnippetCheck(root, lang, dir, config, scratch, opts.otf);
      if (snippetOk !== undefined)
        vi.by_category['vi-snippet'] = { ...vi.by_category['vi-snippet'], snippet_ok: snippetOk };
      const stored = pickBaseline(baselines, {
        set: config.vi.set,
        version: baseVersion(pkgVersion),
      });
      const prevRelease = pickBaseline(baselines, {
        set: config.vi.set,
        lang,
        version: pkgVersion,
      });
      checks.push(...viChecks(config.vi, { result: vi, upstream: viNoPack, stored, prevRelease }));
      entry.vi = {
        summary: vi.summary,
        by_category: Object.fromEntries(
          Object.entries(vi.by_category).map(([c, m]) => [
            c,
            {
              ndcg_5: m.ndcg_5,
              hit_5: m.hit_5,
              mrr: m.mrr,
              snippet_ok: m.snippet_ok ?? null,
              upstream_ndcg_5: viNoPack.result.by_category?.[c]?.ndcg_5 ?? null,
            },
          ]),
        ),
        reference: 'no-pack eval of the same tree, same run',
        stored_baseline: stored?.version ?? null,
        previous_release_baseline: prevRelease?.version ?? null,
      };
      if (opts['write-baseline'])
        written.push(
          writeBaseline(baselines, {
            version: pkgVersion,
            set: config.vi.set,
            lang,
            result: vi,
            force: opts.force,
          }),
        );
    }
  } catch (e) {
    report.gate = 'error';
    report.error = e.message;
    log(`quality-gate: ${e.message}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  if (written.length) report.baselines_written = written.map((f) => path.relative(root, f));
  report.pending = checks.filter((c) => c.status === 'pending').map((c) => c.id);
  report.warnings = checks.filter((c) => c.status === 'warn').map((c) => c.id);
  if (report.gate !== 'error') {
    const v = verdict(checks, opts.strict);
    report.gate = v.status;
    report.failed = v.failed;
  }
  return report;
}

const countBy = (result) => {
  const n = {};
  for (const q of result.per_query ?? []) n[q.category] = (n[q.category] ?? 0) + 1;
  return n;
};

const aggregate = (result) => ({
  queries: result.per_query?.length ?? result.meta?.golden_set_size ?? null,
  summary: result.summary,
  categories: Object.fromEntries(
    Object.entries(result.by_category ?? {}).map(([c, m]) => [
      c,
      {
        n: countBy(result)[c] ?? null,
        ndcg_5: m.ndcg_5,
        mrr: m.mrr,
        hit_1: m.hit_1,
        hit_5: m.hit_5,
      },
    ]),
  ),
});

/** Private vault (V15): same tree with and without the pack; aggregate numbers only. */
async function privateMode(opts, root, config) {
  const k = Number(opts.k);
  const src = path.resolve(opts.private);
  const isDir = existsSync(src) && statSync(src).isDirectory();
  const golden = isDir ? path.join(src, 'golden-set.json') : src;
  const vault = path.resolve(
    opts.vault ?? process.env.OHS_PRIVATE_VAULT ?? (isDir ? path.join(src, 'vault') : ''),
  );
  const lang = opts['with-lang']?.[0] ?? 'vi';
  const dir = packDir(root, lang);
  const report = { gate: 'error', private: true, pack: lang };
  const scratch = path.join(root, 'vantt', '.work', 'quality-private');
  try {
    if (!existsSync(golden)) throw new Error('private golden set not found');
    if (!opts.vault && !process.env.OHS_PRIVATE_VAULT && !(isDir && existsSync(vault)))
      throw new Error(
        'private vault not given: use --vault <dir>, OHS_PRIVATE_VAULT, or <dir>/vault',
      );
    if (!existsSync(vault)) throw new Error('private vault not found');
    if (!existsSync(dir)) throw new Error(`vantt/packages/ohs-lang-${lang} is not present`);
    buildPack(dir, log);
    mkdirSync(scratch, { recursive: true });
    const evalGolden = path.join(scratch, 'golden-set.json');
    writeFileSync(evalGolden, JSON.stringify(nfdGolden(JSON.parse(readFileSync(golden, 'utf8')))));
    log('Private eval: without pack, then with pack (output suppressed).');
    const common = { tree: root, vault, golden: evalGolden, scratch, k, capture: true };
    const without = runEvaluate({ ...common, env: privateEvalEnv() });
    const withPack = runEvaluate({ ...common, env: packEnv(config, lang, dir, privateEvalEnv) });
    report.without_pack = aggregate(without);
    report.with_pack = aggregate(withPack);
    report.checks = regressionChecks('private-regression', {
      result: withPack,
      ref: without,
      refLabel: 'the same vault without the pack',
      metric: config.vi.metric,
      categoryMax: config.vi.category_regression_max,
      overallMax: config.vi.overall_regression_max,
    }).map(({ categories, ...c }) => c); // category names are labels, but keep the checks minimal
    const v = verdict(report.checks);
    report.gate = v.status;
    report.failed = v.failed;
    if (opts['private-detail']) {
      log('Private detail: per-query search with explain (output suppressed).');
      const detailWithout = runDetail({ ...common, env: privateEvalEnv() });
      const detailWith = runDetail({ ...common, env: packEnv(config, lang, dir, privateEvalEnv) });
      const queries = JSON.parse(readFileSync(golden, 'utf8'));
      const file = path.resolve(opts['private-detail']);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(
        file,
        `${JSON.stringify(buildDetail({ queries, without, withPack, detailWithout, detailWith, k, lang }), null, 2)}\n`,
        { mode: 0o600 },
      );
      log(`Per-query detail written to ${file}`);
    }
  } catch (e) {
    report.gate = 'error';
    report.error = e.message;
    // Terminal only: the child's own stderr may name notes, so it never goes into the report.
    if (e.stderrTail)
      log(
        `--- end of the child's stderr (local terminal only, do not paste publicly) ---\n${e.stderrTail}\n---`,
      );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return report;
}

const nfc = (p) => p.normalize('NFC');

/** One side (without or with the pack) of a query's detail. */
function detailSide(row, detail, relevant) {
  const top = row.top_paths ?? [];
  return {
    ndcg_5: row.ndcg_5,
    mrr: row.mrr,
    hit_5: row.hit_5,
    top_paths: top.map(nfc),
    relevant_ranks: Object.fromEntries(
      relevant.map((p) => [nfc(p), top.indexOf(p.normalize('NFD')) + 1 || null]),
    ),
    results: (detail?.results ?? []).map((r) => ({ ...r, path: nfc(r.path) })),
    analysis: detail?.analysis ?? null,
  };
}

/** Per-query detail of the two runs, joined by query id. */
function buildDetail({ queries, without, withPack, detailWithout, detailWith, k, lang }) {
  const by = (list, key = 'id') => new Map((list ?? []).map((x) => [x[key], x]));
  const [w, p, dw, dp] = [
    by(without.per_query),
    by(withPack.per_query),
    by(detailWithout),
    by(detailWith),
  ];
  return {
    note: 'PRIVATE: real queries and note paths. Keep outside the repository.',
    pack: lang,
    k,
    queries: queries.map((q) => {
      const relevant = q.relevant_paths ?? [];
      return {
        id: q.id,
        category: q.category,
        query: q.query,
        relevant_paths: relevant.map(nfc),
        without_pack: detailSide(w.get(q.id) ?? {}, dw.get(q.id), relevant),
        with_pack: detailSide(p.get(q.id) ?? {}, dp.get(q.id), relevant),
      };
    }),
  };
}

function printHuman(report) {
  const out = (m) => process.stderr.write(`${m}\n`);
  out(`quality-gate: ${report.gate}${report.error ? ` (${report.error})` : ''}`);
  for (const c of report.checks ?? []) out(`  [${c.status}] ${c.id}: ${c.detail}`);
}

export async function main(argv, { cwd = process.cwd() } = {}) {
  let opts;
  try {
    opts = parseCli(argv);
    if (opts['private-detail'] && !opts.private)
      throw new Error('--private-detail is only valid with --private');
    if (!opts.private && !opts['target-sha'])
      throw new Error('--target-sha is required (or --private)');
  } catch (e) {
    log(`quality-gate: ${e.message}`);
    return 2;
  }
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  if (opts['private-detail']) {
    const refusal = detailPathError(opts['private-detail'], root);
    if (refusal) {
      log(`quality-gate: ${refusal}`);
      return 2;
    }
  }
  const config = JSON.parse(readFileSync(path.join(here, 'quality-gates.json'), 'utf8'));
  const report = opts.private
    ? await privateMode(opts, root, config)
    : await standard(opts, root, config);
  if (opts.out) {
    mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
    writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else printHuman(report);
  return report.gate === 'pass' ? 0 : report.gate === 'fail' ? 1 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
