// Process helpers for the fork scripts. Every child gets HUSKY=0 so upstream's
// husky hooks never run (PRD 5 step 6).
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

let extraPath = null;

/** Prepend a directory to PATH for every child (used to pin the npm version). */
export function prependPath(dir) {
  extraPath = dir;
}

/** Name of the PATH variable in an environment object (a copy of Windows' process.env keeps `Path`). */
export const pathKey = (env) => Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';

export const childEnv = (extra = {}) => {
  const env = { ...process.env, HUSKY: '0' };
  if (extraPath) {
    const key = pathKey(env);
    env[key] = `${extraPath}${path.delimiter}${env[key] ?? ''}`;
  }
  return { ...env, ...extra };
};

/**
 * Command and arguments that run npm or npx without a shell. On Windows both are .cmd shims, which
 * spawn cannot start without a shell (EINVAL), and a shell would split and expand the arguments
 * again. The shim only runs node on npm's own JS entry, so this resolves that entry next to the
 * first shim on `env`'s PATH and runs it with this node. Elsewhere the tool is spawned by name.
 */
export function npmCommand(
  tool,
  args,
  { env = process.env, platform = process.platform, exists = existsSync } = {},
) {
  if (tool !== 'npm' && tool !== 'npx') throw new Error(`npmCommand runs npm or npx, not ${tool}`);
  if (platform !== 'win32') return { command: tool, args };
  const dirs = (env[pathKey(env)] ?? '')
    .split(';')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
  const dir = dirs.find((d) => exists(path.win32.join(d, `${tool}.cmd`)));
  if (!dir) throw new Error(`${tool}.cmd is not on PATH`);
  // Next to node.exe (Node's installer, or npm -g into that prefix) or in a node_modules/.bin.
  const cli = [
    path.win32.join(dir, 'node_modules', 'npm', 'bin', `${tool}-cli.js`),
    path.win32.join(dir, '..', 'npm', 'bin', `${tool}-cli.js`),
  ].find((f) => exists(f));
  if (!cli)
    throw new Error(`no npm/bin/${tool}-cli.js next to ${path.win32.join(dir, `${tool}.cmd`)}`);
  return { command: process.execPath, args: [cli, ...args] };
}

/**
 * cmd.exe invocation that runs a .cmd/.bat file with each argument passed through as one argument
 * (spawn it with windowsVerbatimArguments). Every token is quoted; characters that cmd.exe or a
 * batch file still expands inside quotes (`"`, `%`, `!`, line breaks) are refused, not escaped.
 */
export function batchCommand(file, args, env = process.env) {
  const quote = (a) => {
    const s = String(a);
    if (/["%!\r\n]/.test(s)) throw new Error(`cannot pass ${JSON.stringify(s)} through cmd.exe`);
    // A backslash before the closing quote would escape it for the program's argument parser.
    return `"${s.replace(/(\\+)$/, '$1$1')}"`;
  };
  const line = [file, ...args].map(quote).join(' ');
  return {
    command: env.ComSpec || env.COMSPEC || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
  };
}

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
