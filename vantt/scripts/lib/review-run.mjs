// Side-effecting helpers of the upstream review (PRD 12): worktrees and builds, patch
// applicability, probes, upstream diffs, vi eval. Pure logic lives in review-core.mjs.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { childEnv, git, sh } from './proc.mjs';
import { probeVerdict, HOOK_FILES } from './review-core.mjs';

const tail = (s, n = 600) => (s.length > n ? `…${s.slice(-n)}` : s);

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
  if (!existsSync(probeFile)) return { verdict: 'error', exit: null, output: `probe file missing: ${probeFile}` };
  const res = spawnSync(process.execPath, [probeFile, '--ohs', tree], {
    env: childEnv(env),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) return { verdict: 'error', exit: null, output: res.error.message };
  return { verdict: probeVerdict(res.status), exit: res.status, output: tail(`${res.stdout}${res.stderr}`.trim()) };
}

/**
 * What upstream changed between two tags in the files a patch touches, and in the hook files.
 * Returns {commits: [{sha, subject}], files: [{status, path}]} for `paths`.
 */
export function upstreamChanges(root, oldRef, newRef, paths) {
  if (!paths.length) return { commits: [], files: [] };
  const log = git(root, ['log', '--format=%h %s', `${oldRef}..${newRef}`, '--', ...paths], { allowFail: true });
  const names = git(root, ['diff', '--name-status', `${oldRef}..${newRef}`, '--', ...paths], { allowFail: true });
  const lines = (r) => (r.ok && r.stdout ? r.stdout.split('\n').filter(Boolean) : []);
  return {
    commits: lines(log).map((l) => ({ sha: l.slice(0, l.indexOf(' ')), subject: l.slice(l.indexOf(' ') + 1) })),
    files: lines(names).map((l) => {
      const [status, ...rest] = l.split('\t');
      return { status, path: rest.join('\t') };
    }),
  };
}

export const hookChanges = (root, oldRef, newRef) => upstreamChanges(root, oldRef, newRef, HOOK_FILES);

/** Overall upstream changes: commit list, diffstat, CHANGELOG diff (bounded). */
export function upstreamOverview(root, oldRef, newRef) {
  const commits = git(root, ['log', '--format=%h %s', `${oldRef}..${newRef}`], { allowFail: true });
  const stat = git(root, ['diff', '--stat', `${oldRef}..${newRef}`], { allowFail: true });
  const cl = git(root, ['diff', '--unified=0', `${oldRef}..${newRef}`, '--', 'CHANGELOG.md'], { allowFail: true });
  return {
    commits: commits.ok && commits.stdout ? commits.stdout.split('\n') : [],
    diffstat_tail: stat.ok ? stat.stdout.split('\n').slice(-1)[0]?.trim() ?? '' : '',
    changelog_diff: cl.ok ? tail(cl.stdout, 4000) : '',
  };
}

/**
 * Run vantt/eval/vi/run-eval.mjs on `tree`, optionally with a language pack. Returns the parsed result.
 * `otf` is a clone of obsidian-test-fixture's otf.mjs (otherwise run-eval uses npx and the network).
 */
export function runViEval({ forkDir, tree, out, pack = null, otf = null, k = 10, env = {} }) {
  mkdirSync(path.dirname(out), { recursive: true });
  const argv = [path.join(forkDir, 'vantt/eval/vi/run-eval.mjs'), '--ohs', tree, '--out', out, '--k', String(k)];
  if (pack) argv.push('--lang-pack', pack);
  if (otf) argv.push('--otf', otf);
  const res = spawnSync(process.execPath, argv, {
    env: childEnv(env),
    stdio: ['ignore', 2, 2],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) throw new Error(`vi eval failed on ${tree} (exit ${res.status})`);
  return JSON.parse(readFileSync(out, 'utf8'));
}

export const readJsonIfExists = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
export const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
};
