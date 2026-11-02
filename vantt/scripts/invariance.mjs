#!/usr/bin/env node
// Invariance test (PRD 11.4, tier T4): without a language pack and without any patch
// switch, the fork release build must return exactly what pristine upstream returns at
// the same tag, on this machine, in this run.
//
//   node vantt/scripts/invariance.mjs --target-ref <ref> --target-sha <sha> --branch <branch> --json
//        [--with-lang <id>]   accepted and ignored: the test is always run without a pack
//        [--corpora a,b]      default from quality-gates.json: obsidian-help, plus evergreen-notes when its dataset is prepared
//        [--k 10] [--keep]
//
// Run from the repo root of the release branch (built, dependencies installed). Exit 0 =
// identical on every query; 1 = a query differs; 2 = the test could not run. With --json
// one JSON object goes to stdout (catchup stores it); progress goes to stderr.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compareResults } from './lib/compare.mjs';
import { datasetDir, evalEnv, goldenFile, prepareDataset, runEvaluate } from './lib/eval-run.mjs';
import { git } from './lib/proc.mjs';
import { sameRunFile } from './lib/same-run.mjs';
import { createUpstreamTree } from './lib/trees.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_REPORTED = 20;

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'target-ref': { type: 'string' },
      'target-sha': { type: 'string' },
      branch: { type: 'string' },
      json: { type: 'boolean', default: false },
      'with-lang': { type: 'string', multiple: true },
      corpora: { type: 'string' },
      k: { type: 'string', default: '10' },
      keep: { type: 'boolean', default: false },
    },
    strict: true,
  });
  if (!values['target-sha']) throw Object.assign(new Error('--target-sha is required'), { usage: true });
  return values;
}

export async function main(argv, { cwd = process.cwd() } = {}) {
  const log = (m) => process.stderr.write(`${m}\n`);
  let opts;
  try {
    opts = parseCli(argv);
  } catch (e) {
    log(`invariance: ${e.message}`);
    return 2;
  }
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const config = JSON.parse(readFileSync(path.join(here, 'quality-gates.json'), 'utf8'));
  const corpora = opts.corpora ? opts.corpora.split(',') : [...config.invariance.corpora];
  const skipped = [];
  if (!opts.corpora)
    for (const c of config.invariance.optional_corpora ?? []) {
      if (existsSync(datasetDir(root, c))) corpora.push(c);
      else skipped.push(c);
    }
  const k = Number(opts.k);
  const scratch = path.join(root, 'vantt', '.work', 'invariance');
  const report = {
    status: 'error',
    target: { ref: opts['target-ref'] ?? null, sha: opts['target-sha'], branch: opts.branch ?? null },
    fork_head: git(root, ['rev-parse', 'HEAD']),
    k,
    pack: null,
    corpora: {},
    corpora_skipped: skipped,
    queries: 0,
    identical: 0,
  };
  let upstream;
  try {
    log(`Invariance: upstream ${opts['target-sha'].slice(0, 9)} vs fork ${report.fork_head.slice(0, 9)} (no pack).`);
    upstream = createUpstreamTree(root, opts['target-sha'], path.join(scratch, 'upstream'), log);
    report.upstream_deps = upstream.deps;
    for (const corpus of corpora) {
      log(`Corpus ${corpus}`);
      const dataset = prepareDataset(root, corpus, log);
      const golden = goldenFile(root, corpus);
      const common = { vault: dataset, golden, scratch, k, env: evalEnv(), log };
      log('  upstream run');
      const a = runEvaluate({ ...common, tree: upstream.dir });
      log('  fork run');
      const b = runEvaluate({ ...common, tree: root });
      const cmp = compareResults(a, b);
      report.corpora[corpus] = {
        queries: cmp.queries,
        identical: cmp.identical,
        summary_upstream: a.summary,
        summary_fork: b.summary,
        mismatches: cmp.mismatches.slice(0, MAX_REPORTED),
        mismatches_total: cmp.mismatches.length,
      };
      report.queries += cmp.queries;
      report.identical += cmp.identical;
      log(`  ${cmp.identical}/${cmp.queries} queries identical`);
    }
    report.status = report.identical === report.queries ? 'pass' : 'fail';
  } catch (e) {
    report.error = e.message;
    log(`invariance: ${e.message}`);
  } finally {
    if (upstream && !opts.keep) upstream.cleanup();
    if (!opts.keep) rmSync(scratch, { recursive: true, force: true });
  }
  if (report.status !== 'error') {
    // Same-run record of pristine upstream, reused by quality-gate.mjs (see lib/same-run.mjs).
    mkdirSync(path.dirname(sameRunFile(root)), { recursive: true });
    writeFileSync(sameRunFile(root), `${JSON.stringify(report)}\n`);
  }
  if (opts.json) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else log(`invariance: ${report.status} (${report.identical}/${report.queries})`);
  return report.status === 'pass' ? 0 : report.status === 'fail' ? 1 : 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
