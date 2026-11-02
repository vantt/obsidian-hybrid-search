// Runs upstream's eval (eval/evaluate.ts) in a given OHS tree on a throw-away copy of a vault
// (the eval writes its database into the vault directory and rebuilds it). Shared by
// invariance.mjs and quality-gate.mjs (PRD 11.4, 11.6).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { childEnv } from './proc.mjs';

export const platformKey = () => `${process.platform}-${process.arch}`;

/** Corpora of upstream's eval: dataset location and prepare command, relative to the OHS tree. */
export const CORPORA = {
  'obsidian-help': { prepare: ['eval/prepare-obsidian-help.ts'], count: 171 },
  'evergreen-notes': { prepare: ['eval/prepare-evergreen-notes.ts', '--no-images'] },
};

export const datasetDir = (tree, corpus) => path.join(tree, 'fixtures', corpus, 'dataset');
export const goldenFile = (tree, corpus) => path.join(tree, 'fixtures', corpus, 'golden-set.json');

/**
 * Golden set in the form upstream's eval compares: upstream stores note paths in NFD
 * (src/content/text-normalization.ts) and compares paths as strings, so an NFC path
 * (what Linux and Windows file names and a hand-written golden set use) never matches.
 */
export const nfdGolden = (queries) =>
  queries.map((q) => ({
    ...q,
    ...(q.relevant_paths && { relevant_paths: q.relevant_paths.map((p) => p.normalize('NFD')) }),
    ...(q.partial_paths && { partial_paths: q.partial_paths.map((p) => p.normalize('NFD')) }),
  }));

/**
 * Environment of an eval run: local embedding model, no personal vault settings, and no
 * fork switches (language pack, db path...) unless passed in `extra`.
 */
export function evalEnv(extra = {}) {
  const env = childEnv();
  for (const name of Object.keys(env)) {
    if (/^(OBSIDIAN_|OHS_|OPENAI_|RERANKER_)/.test(name) || name === 'LOCAL_EMBEDDING_MODEL') delete env[name];
  }
  env.LOCAL_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
  // Evaluation selects the whole pinned corpus (same policy as upstream's scripts/eval-quality.mjs).
  env.OBSIDIAN_INCLUDE_PATTERNS = '';
  env.OBSIDIAN_IGNORE_PATTERNS = '';
  env.OBSIDIAN_RESPECT_GITIGNORE = 'false';
  return { ...env, ...extra };
}

const tsx = (cwd, argv, env, capture) => {
  const res = spawnSync(process.execPath, ['--import', 'tsx', ...argv], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', capture ? 'pipe' : 2, capture ? 'pipe' : 2],
    maxBuffer: 512 * 1024 * 1024,
  });
  return { ok: res.status === 0, status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
};

/** Make sure `<tree>/fixtures/<corpus>/dataset` exists (downloads on first use). Returns its path. */
export function prepareDataset(tree, corpus, log) {
  const spec = CORPORA[corpus];
  if (!spec) throw new Error(`unknown corpus "${corpus}" (known: ${Object.keys(CORPORA).join(', ')})`);
  const dir = datasetDir(tree, corpus);
  if (!existsSync(dir)) {
    log(`  preparing ${corpus} dataset (first use, needs network)`);
    const res = tsx(tree, spec.prepare, evalEnv());
    if (!res.ok || !existsSync(dir)) throw new Error(`could not prepare the ${corpus} dataset in ${tree}`);
  }
  return dir;
}

/**
 * Run the eval in `tree` on a copy of `vault` (placed under `scratch`), with `golden`.
 * Returns the parsed result JSON. `capture` keeps the child's output away from the
 * terminal (private mode). Throws on failure.
 */
export function runEvaluate({ tree, vault, golden, scratch, k = 10, env = evalEnv(), capture = false, log = () => {} }) {
  mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(path.join(scratch, 'eval-'));
  try {
    const copy = path.join(work, 'vault');
    cpSync(vault, copy, {
      recursive: true,
      filter: (src) => !/(^|[\\/])(\.git|node_modules|\.obsidian-hybrid-search\.db(-wal|-shm)?)$/.test(src),
    });
    const out = path.join(work, 'result.json');
    const res = tsx(
      tree,
      ['eval/evaluate.ts', '--vault', copy, '--golden-set', golden, '--output', out, '--k', String(k)],
      env,
      capture,
    );
    if (!res.ok) throw new Error(`eval failed in ${capture ? 'private run' : tree} (exit ${res.status})`);
    log('  eval done');
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
