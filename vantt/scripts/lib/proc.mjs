// Process helpers for the fork scripts. Every child gets HUSKY=0 so upstream's
// husky hooks never run (PRD 5 step 6).
import { spawnSync } from 'node:child_process';
import path from 'node:path';

let extraPath = null;

/** Prepend a directory to PATH for every child (used to pin the npm version). */
export function prependPath(dir) {
  extraPath = dir;
}

export const childEnv = (extra = {}) => ({
  ...process.env,
  HUSKY: '0',
  ...(extraPath ? { PATH: `${extraPath}${path.delimiter}${process.env.PATH ?? ''}` } : {}),
  ...extra,
});

export class GitError extends Error {
  constructor(args, res) {
    super(
      `git ${args.join(' ')} failed (${res.status}): ${(res.stderr || res.stdout || '').trim()}`,
    );
    this.name = 'GitError';
    this.status = res.status;
    this.stdout = res.stdout;
    this.stderr = res.stderr;
  }
}

/** Run git; returns trimmed stdout. Throws GitError unless opts.allowFail, then returns {ok, stdout, stderr, status}. */
export function git(cwd, args, opts = {}) {
  const res = spawnSync('git', args, {
    cwd,
    env: childEnv(opts.env),
    encoding: opts.raw ? 'buffer' : 'utf8',
    input: opts.input,
    maxBuffer: 512 * 1024 * 1024,
  });
  if (res.error) throw res.error;
  if (opts.allowFail) {
    return {
      ok: res.status === 0,
      status: res.status,
      stdout: opts.raw ? res.stdout : res.stdout.trimEnd(),
      stderr: opts.raw ? String(res.stderr) : res.stderr,
    };
  }
  if (res.status !== 0) throw new GitError(args, { ...res, stderr: String(res.stderr) });
  return opts.raw ? res.stdout : res.stdout.trimEnd();
}

/**
 * Run a shell command (npm, test_command, capability_check). Output goes to
 * stderr so --json stdout stays parseable. Returns {ok, status}.
 */
export function sh(cwd, command, opts = {}) {
  const res = spawnSync(command, {
    cwd,
    shell: true,
    env: childEnv(opts.env),
    stdio: ['ignore', opts.capture ? 'pipe' : 2, opts.capture ? 'pipe' : 2],
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
  });
  if (res.error) return { ok: false, status: null, error: res.error.message, stdout: '' };
  return {
    ok: res.status === 0,
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
  };
}
