// Side-effecting helpers of the upstream review (PRD 12): worktrees and builds, patch
// applicability, probes, upstream diffs, vi eval. Pure logic lives in review-core.mjs.
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { childEnv, git, sh } from './proc.mjs';
import { HOOK_FILES, extractTiming, probeVerdict } from './review-core.mjs';

const tail = (s, n = 600) => (s.length > n ? `…${s.slice(-n)}` : s);

/**
 * Build a language pack (its `main` is a build output, absent in a fresh clone). Same steps as the
 * quality gate's pack build: install dependencies when missing, `npm run build`, check `main`.
 * Throws when the pack cannot be built.
 */
export function buildPack(dir, log = () => {}) {
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

/** Run `npm run build` (tsc) in a tree; returns {ok, log}. */
export function buildTree(dir) {
  const res = sh(dir, 'npm run build', { capture: true });
  return { ok: res.ok, log: tail(`${res.stdout}${res.stderr ?? ''}`) };
}

/**
 * Apply the series in order on a throw-away worktree of `sha` the way catchup does (`git apply --3way`).
 * Returns {patch_id: 'applies' | 'already_present' | 'conflict' | 'skipped_merged'} and never touches `root`'s checkout.
 */
export function checkApplicability(root, patches, sha, dir, patchesDir) {
  rmSync(dir, { recursive: true, force: true });
  git(root, ['worktree', 'prune']);
  git(root, ['worktree', 'add', '--detach', dir, sha]);
  const out = {};
  try {
    const cfg = ['-c', 'user.name=review', '-c', 'user.email=review@example.invalid'];
    for (const p of patches) {
      if (p.upstream_status === 'merged') {
        out[p.id] = 'skipped_merged';
        continue;
      }
      const file = path.join(patchesDir, p.patch_file);
      if (git(dir, ['apply', '--reverse', '--check', file], { allowFail: true }).ok) {
        out[p.id] = 'already_present';
        continue;
      }
      const res = git(dir, ['apply', '--3way', '--whitespace=nowarn', file], { allowFail: true });
      if (res.ok) {
        git(dir, [...cfg, 'commit', '--no-verify', '-qam', p.id], { allowFail: true });
        out[p.id] = 'applies';
      } else {
        git(dir, ['reset', '--hard', '-q', 'HEAD'], { allowFail: true });
        git(dir, ['clean', '-fdq'], { allowFail: true });
        out[p.id] = 'conflict';
      }
    }
  } finally {
    git(root, ['worktree', 'remove', '--force', dir], { allowFail: true });
    rmSync(dir, { recursive: true, force: true });
    git(root, ['worktree', 'prune'], { allowFail: true });
  }
  return out;
}

/** Run one probe on a built tree (PRD 9.2). Returns {verdict, exit, output}. */
export function runProbe(probeFile, tree, { timeoutMs = 15 * 60_000, env = {} } = {}) {
  if (!existsSync(probeFile))
    return { verdict: 'error', exit: null, output: `probe file missing: ${probeFile}` };
  const res = spawnSync(process.execPath, [probeFile, '--ohs', tree], {
    env: childEnv(env),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) return { verdict: 'error', exit: null, output: res.error.message };
  return {
    verdict: probeVerdict(res.status),
    exit: res.status,
    output: tail(`${res.stdout}${res.stderr}`.trim()),
  };
}

/**
 * What upstream changed between two tags in the files a patch touches, and in the hook files.
 * Returns {commits: [{sha, subject}], files: [{status, path}]} for `paths`.
 */
export function upstreamChanges(root, oldRef, newRef, paths) {
  if (!paths.length) return { commits: [], files: [] };
  const log = git(root, ['log', '--format=%h %s', `${oldRef}..${newRef}`, '--', ...paths], {
    allowFail: true,
  });
  const names = git(root, ['diff', '--name-status', `${oldRef}..${newRef}`, '--', ...paths], {
    allowFail: true,
  });
  const lines = (r) => (r.ok && r.stdout ? r.stdout.split('\n').filter(Boolean) : []);
  return {
    commits: lines(log).map((l) => ({
      sha: l.slice(0, l.indexOf(' ')),
      subject: l.slice(l.indexOf(' ') + 1),
    })),
    files: lines(names).map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status, path: rest.join('\t') };
    }),
  };
}

export const hookChanges = (root, oldRef, newRef) =>
  upstreamChanges(root, oldRef, newRef, HOOK_FILES);

/** Overall upstream changes: commit list, diffstat, CHANGELOG diff (bounded). */
export function upstreamOverview(root, oldRef, newRef) {
  const commits = git(root, ['log', '--format=%h %s', `${oldRef}..${newRef}`], { allowFail: true });
  const stat = git(root, ['diff', '--stat', `${oldRef}..${newRef}`], { allowFail: true });
  const cl = git(root, ['diff', '--unified=0', `${oldRef}..${newRef}`, '--', 'CHANGELOG.md'], {
    allowFail: true,
  });
  return {
    commits: commits.ok && commits.stdout ? commits.stdout.split('\n') : [],
    diffstat_tail: stat.ok ? (stat.stdout.split('\n').slice(-1)[0]?.trim() ?? '') : '',
    changelog_diff: cl.ok ? tail(cl.stdout, 4000) : '',
  };
}

/**
 * Run a command, echo its output to stderr and record when each output line arrived (for
 * extractTiming). Resolves {status, events: [{t, line}]}.
 */
export function runLogged(cmd, argv, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const events = [];
    const child = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    const feed = (stream) => {
      let buf = '';
      stream.on('data', (chunk) => {
        process.stderr.write(chunk);
        buf += chunk.toString('utf8');
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        const t = Date.now();
        for (const line of lines) events.push({ t, line });
      });
      stream.on('end', () => buf && events.push({ t: Date.now(), line: buf }));
    };
    feed(child.stdout);
    feed(child.stderr);
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, events }));
  });
}

/** Upstream's eval in `tree` on a copy of `vault`, with index and per-query timing. Returns the result JSON plus `review_timing`. */
export async function runEvaluateTimed({ tree, vault, golden, scratch, k = 10, env }) {
  mkdirSync(scratch, { recursive: true });
  const work = mkdtempSync(path.join(scratch, 'eval-'));
  try {
    const copy = path.join(work, 'vault');
    cpSync(vault, copy, {
      recursive: true,
      filter: (src) =>
        !/(^|[\\/])(\.git|node_modules|\.obsidian-hybrid-search\.db(-wal|-shm)?)$/.test(src),
    });
    const out = path.join(work, 'result.json');
    const res = await runLogged(
      process.execPath,
      [
        '--import',
        'tsx',
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
      { cwd: tree, env },
    );
    if (res.status !== 0) throw new Error(`eval failed in ${tree} (exit ${res.status})`);
    return { ...JSON.parse(readFileSync(out, 'utf8')), review_timing: extractTiming(res.events) };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/**
 * Run vantt/eval/vi/run-eval.mjs on `tree`, optionally with a language pack. Returns the parsed
 * result plus `review_timing`. `otf` is a clone of obsidian-test-fixture's otf.mjs (otherwise
 * run-eval uses npx and the network).
 */
export async function runViEval({ forkDir, tree, out, pack = null, otf = null, k = 10, env = {} }) {
  mkdirSync(path.dirname(out), { recursive: true });
  const argv = [
    path.join(forkDir, 'vantt/eval/vi/run-eval.mjs'),
    '--ohs',
    tree,
    '--out',
    out,
    '--k',
    String(k),
  ];
  if (pack) argv.push('--lang-pack', pack);
  if (otf) argv.push('--otf', otf);
  const res = await runLogged(process.execPath, argv, { cwd: forkDir, env: childEnv(env) });
  if (res.status !== 0) throw new Error(`vi eval failed on ${tree} (exit ${res.status})`);
  return { ...JSON.parse(readFileSync(out, 'utf8')), review_timing: extractTiming(res.events) };
}

export const readJsonIfExists = (file) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
export const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
