// Runs upstream's eval (eval/evaluate.ts) in a given OHS tree on a throw-away copy of a vault
// (the eval writes its database into the vault directory and rebuilds it). Shared by
// invariance.mjs and quality-gate.mjs (PRD 11.4, 11.6).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    if (/^(OBSIDIAN_|OHS_|OPENAI_|RERANKER_)/.test(name) || name === 'LOCAL_EMBEDDING_MODEL')
      delete env[name];
  }
  env.LOCAL_EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
  // Evaluation selects the whole pinned corpus (same policy as upstream's scripts/eval-quality.mjs).
  env.OBSIDIAN_INCLUDE_PATTERNS = '';
  env.OBSIDIAN_IGNORE_PATTERNS = '';
  env.OBSIDIAN_RESPECT_GITIGNORE = 'false';
  return { ...env, ...extra };
}

/** OHS's own default ignore patterns (src/runtime/config.ts). */
const OHS_DEFAULT_IGNORE = '.obsidian/**,templates/**,*.canvas';

/**
 * Environment of a private-vault eval (V15): like `evalEnv`, but the vault is indexed the way
 * the user's own search indexes it. The user's note selection (OBSIDIAN_IGNORE_PATTERNS, else
 * OHS's default, plus OBSIDIAN_INCLUDE_PATTERNS and OBSIDIAN_CONTENT_IGNORE_PATTERNS) is kept,
 * and `_ohs/**` is always ignored so the lexicon file never becomes a search result; so is a
 * `lexiconPath` inside the vault set in `packOptions` (the gate's pack options) or, without one
 * there, in the user's OHS_LANGUAGE_PACK_OPTIONS. Both runs of a comparison must pass the same
 * `packOptions` so they index the same notes. Git ignore rules stay off: the vault copy lives
 * under the repository's ignored work directory, whose ignore rules would hide every note.
 */
export function privateEvalEnv(extra = {}, source = process.env, packOptions = null) {
  const ignore = (source.OBSIDIAN_IGNORE_PATTERNS ?? OHS_DEFAULT_IGNORE)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (!ignore.includes('_ohs/**')) ignore.push('_ohs/**');
  const lexicon = lexiconIgnorePattern(packOptions?.lexiconPath ?? userLexiconPath(source));
  if (lexicon && !ignore.includes(lexicon)) ignore.push(lexicon);
  const env = evalEnv({
    OBSIDIAN_IGNORE_PATTERNS: ignore.join(','),
    OBSIDIAN_INCLUDE_PATTERNS: source.OBSIDIAN_INCLUDE_PATTERNS ?? '',
  });
  if (source.OBSIDIAN_CONTENT_IGNORE_PATTERNS !== undefined)
    env.OBSIDIAN_CONTENT_IGNORE_PATTERNS = source.OBSIDIAN_CONTENT_IGNORE_PATTERNS;
  return { ...env, ...extra };
}

/** Error whose message is fixed text (no input, path or child output): safe for a private report. */
export class ReportableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReportableError';
  }
}

function userLexiconPath(source) {
  const raw = source.OHS_LANGUAGE_PACK_OPTIONS;
  if (!raw) return undefined;
  try {
    return JSON.parse(raw)?.lexiconPath;
  } catch {
    throw new ReportableError('OHS_LANGUAGE_PACK_OPTIONS is not valid JSON');
  }
}

/**
 * OHS ignore pattern for a pack's `lexiconPath` (relative to the vault), or null when there is
 * nothing more to ignore: unset, the default under `_ohs/`, or outside the vault (absolute or
 * `..`). OHS compares a pattern without `*`/`?` as a root-anchored literal path, so the file
 * itself is ignored, not its folder (which may hold notes).
 */
export function lexiconIgnorePattern(lexiconPath) {
  if (lexiconPath === undefined || lexiconPath === null) return null;
  if (typeof lexiconPath !== 'string' || !lexiconPath.trim())
    throw new ReportableError('lexiconPath must be a non-empty string');
  if (path.isAbsolute(lexiconPath) || path.win32.isAbsolute(lexiconPath)) return null;
  const rel = path.posix.normalize(lexiconPath.trim().replaceAll('\\', '/')).replace(/^\.\//, '');
  if (rel === '..' || rel.startsWith('../')) return null;
  if (rel === '_ohs' || rel.startsWith('_ohs/')) return null;
  if (/[,*?]/.test(rel) || rel.startsWith('!'))
    throw new ReportableError('lexiconPath cannot be written as an OHS ignore pattern');
  let end = rel.length;
  while (end > 0 && rel[end - 1] === '/') end--;
  return rel.slice(0, end);
}

/**
 * Terminal text for diagnostic detail that may name notes (a failed child's stderr tail, an
 * unexpected error's message). `show` is true on an interactive terminal or with
 * `--show-child-stderr`; otherwise only one line says how to see it, because agent and CI
 * transcripts are kept. Returns null when there is no detail.
 */
export function terminalDetail(label, text, { show }) {
  if (!text) return null;
  if (show) return `--- ${label} (local terminal only, do not paste publicly) ---\n${text}\n---`;
  return `${label} is hidden (it may name notes); rerun on a local terminal or with --show-child-stderr to see it.`;
}

/** Last `lines` non-empty lines of a child's output. */
export const outputTail = (text, lines = 40) =>
  text
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-lines)
    .join('\n');

/**
 * Error of a failed child run. `stderrTail` holds the end of the child's own stderr when it was
 * captured (never its stdout, where upstream's eval echoes every query): the caller prints it
 * on the user's terminal only, never into a report.
 */
export class ChildRunError extends Error {
  constructor(message, res) {
    super(message);
    this.name = 'ChildRunError';
    this.stderrTail = outputTail(res.stderr ?? '');
  }
}

const copyFilter = (src) =>
  !/(^|[\\/])(\.git|node_modules|\.obsidian-hybrid-search\.db(-wal|-shm)?)$/.test(src);

const tsx = (cwd, argv, env, capture) => {
  const res = spawnSync(process.execPath, ['--import', 'tsx', ...argv], {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', capture ? 'pipe' : 2, capture ? 'pipe' : 2],
    maxBuffer: 512 * 1024 * 1024,
  });
  return {
    ok: res.status === 0,
    status: res.status,
    signal: res.signal,
    error: res.error?.message,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
};

/** How a child run ended: exit code, signal, or spawn error (e.g. output over maxBuffer). */
const exitText = (res) =>
  res.error
    ? `spawn error: ${res.error}`
    : res.signal
      ? `signal ${res.signal}`
      : `exit ${res.status}`;

/** Make sure `<tree>/fixtures/<corpus>/dataset` exists (downloads on first use). Returns its path. */
export function prepareDataset(tree, corpus, log) {
  const spec = CORPORA[corpus];
  if (!spec)
    throw new Error(`unknown corpus "${corpus}" (known: ${Object.keys(CORPORA).join(', ')})`);
  const dir = datasetDir(tree, corpus);
  if (!existsSync(dir)) {
    log(`  preparing ${corpus} dataset (first use, needs network)`);
    const res = tsx(tree, spec.prepare, evalEnv());
    if (!res.ok || !existsSync(dir))
      throw new Error(`could not prepare the ${corpus} dataset in ${tree}`);
  }
  return dir;
}

/**
 * Run the eval in `tree` on a copy of `vault` (placed under `scratch`), with `golden`.
 * Returns the parsed result JSON. `capture` keeps the child's output away from the
 * terminal (private mode). Throws on failure.
 */
export function runEvaluate({
  tree,
  vault,
  golden,
  scratch,
  k = 10,
  env = evalEnv(),
  capture = false,
  log = () => {},
}) {
  mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(path.join(scratch, 'eval-'));
  try {
    const copy = path.join(work, 'vault');
    cpSync(vault, copy, { recursive: true, filter: copyFilter });
    const out = path.join(work, 'result.json');
    const res = tsx(
      tree,
      [
        'eval/evaluate.ts',
        '--vault',
        copy,
        '--golden-set',
        golden,
        '--output',
        out,
        '--k',
        String(k),
      ],
      env,
      capture,
    );
    if (!res.ok)
      throw new ChildRunError(
        `eval failed in ${capture ? 'private run' : tree} (${exitText(res)})`,
        res,
      );
    log('  eval done');
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Per-query search detail (private mode): the ranked results of every query in `golden` with their
 * per-branch ranks and the pack analysis, on a throw-away copy of `vault`. Returns
 * [{id, results, analysis}]. The child's output is always swallowed.
 */
export function runDetail({ tree, vault, golden, scratch, k = 10, env = evalEnv() }) {
  mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(path.join(scratch, 'detail-'));
  try {
    const copy = path.join(work, 'vault');
    cpSync(vault, copy, { recursive: true, filter: copyFilter });
    const out = path.join(work, 'detail.json');
    const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'detail-search.mjs');
    const res = tsx(
      tree,
      [
        script,
        '--tree',
        tree,
        '--vault',
        copy,
        '--queries',
        golden,
        '--output',
        out,
        '--k',
        String(k),
      ],
      env,
      true,
    );
    if (!res.ok) throw new ChildRunError(`detail run failed (${exitText(res)})`, res);
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
