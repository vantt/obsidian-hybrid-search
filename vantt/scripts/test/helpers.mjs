// Builds throwaway git repos for the catchup tests (PRD 11.2): an "upstream"
// bare repo with tags and a fork clone whose master carries vantt/.
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VANTT = path.dirname(SCRIPTS);
const ENV = {
  ...process.env,
  HUSKY: '0',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  npm_config_audit: 'false',
  npm_config_fund: 'false',
  npm_config_update_notifier: 'false',
};

export const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd();

export function write(dir, rel, content) {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), content);
}

export const read = (dir, rel) => readFileSync(path.join(dir, rel), 'utf8');

const BUILD = `import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (pkg.breakBuild) process.exit(1);
mkdirSync('dist/src', { recursive: true });
writeFileSync('dist/src/cli.js', "import { readFileSync } from 'node:fs';\\n" +
  "if (process.argv.includes('--version')) console.log(JSON.parse(readFileSync(new URL('../../package.json', import.meta.url))).version);\\n");
`;

const APP_V1 = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', ''].join('\n');
const APP_V2 = ['alpha', 'beta upstream', 'gamma', 'delta', 'epsilon', ''].join('\n');

function upstreamFiles(dir) {
  const pkg = { name: 'ohs-fixture', version: '0.1.0', type: 'module', scripts: { build: 'node build.mjs', test: 'node -e "process.exit(0)"' } };
  write(dir, 'package.json', JSON.stringify(pkg, null, 2) + '\n');
  write(
    dir,
    'package-lock.json',
    JSON.stringify({ name: 'ohs-fixture', version: '0.1.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'ohs-fixture', version: '0.1.0' } } }, null, 2) + '\n',
  );
  write(dir, 'build.mjs', BUILD);
  write(dir, 'server.json', JSON.stringify({ version: '0.1.0', packages: [{ identifier: 'ohs-fixture', version: '0.1.0' }, { identifier: 'other', version: '9.0.0' }] }, null, 2) + '\n');
  write(dir, '.gitignore', 'node_modules/\ndist/\nreports/\n');
  write(dir, '.github/workflows/ci.yml', 'name: ci\n');
  write(dir, 'src/app.txt', APP_V1);
}

const setVersion = (dir, v) => {
  for (const f of ['package.json', 'package-lock.json']) {
    const j = JSON.parse(read(dir, f));
    j.version = v;
    if (j.packages) j.packages[''].version = v;
    write(dir, f, JSON.stringify(j, null, 2) + '\n');
  }
};

/**
 * Layout under a temp dir:
 *   up/      upstream working repo: v0.1.0, v0.2.0 (changes src/app.txt line 2),
 *            v0.3.0-beta.1 (pre-release) on master; v9.9.9 on a side branch only.
 *   up.git   bare upstream (master + tags; the side branch is not on master).
 *   fork/    clone with remote `upstream`; master has a vantt/ commit.
 */
export function makeFixture() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'catchup-test-'));
  const up = path.join(tmp, 'up');
  mkdirSync(up);
  git(up, 'init', '-q', '-b', 'master');
  upstreamFiles(up);
  git(up, 'add', '-A');
  git(up, 'commit', '-q', '-m', 'init');
  git(up, 'tag', 'v0.1.0');
  write(up, 'src/app.txt', APP_V2);
  setVersion(up, '0.2.0');
  git(up, 'commit', '-q', '-am', 'upstream change');
  git(up, 'tag', 'v0.2.0');
  write(up, 'NEWS.md', 'beta\n');
  git(up, 'add', '-A');
  git(up, 'commit', '-q', '-m', 'beta');
  git(up, 'tag', 'v0.3.0-beta.1');
  git(up, 'checkout', '-q', '-b', 'side', 'v0.1.0');
  write(up, 'side.txt', 'side\n');
  git(up, 'add', '-A');
  git(up, 'commit', '-q', '-m', 'side');
  git(up, 'tag', 'v9.9.9');
  git(up, 'checkout', '-q', 'master');
  const bare = path.join(tmp, 'up.git');
  git(tmp, 'clone', '-q', '--bare', up, bare);

  const fork = path.join(tmp, 'fork');
  git(tmp, 'clone', '-q', '--no-tags', '-b', 'master', bare, fork);
  git(fork, 'remote', 'rename', 'origin', 'upstream');
  git(fork, 'config', 'remote.upstream.fetch', '+refs/heads/master:refs/remotes/upstream/master');
  git(fork, 'branch', '-q', '--unset-upstream');
  // Fork master: upstream master + fork files only.
  mkdirSync(path.join(fork, 'vantt/scripts'), { recursive: true });
  cpSync(path.join(SCRIPTS, 'catchup.mjs'), path.join(fork, 'vantt/scripts/catchup.mjs'));
  cpSync(path.join(SCRIPTS, 'lib'), path.join(fork, 'vantt/scripts/lib'), { recursive: true });
  cpSync(path.join(VANTT, '.gitignore'), path.join(fork, 'vantt/.gitignore'));
  write(fork, 'vantt/patches/series.toml', '# empty series\n');
  write(fork, '.claude/skills/ohs-catchup/SKILL.md', '# skill\n');
  git(fork, 'add', '-A');
  git(fork, 'commit', '-q', '-m', 'chore(vantt): fork files');
  return { tmp, up, bare, fork, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

/** Patch made on top of `base` in the upstream work repo with `edit(dir)`. */
export function makePatch(fx, base, message, edit) {
  git(fx.up, 'checkout', '-q', '-b', 'tmp-patch', base);
  edit(fx.up);
  git(fx.up, 'add', '-A');
  git(fx.up, 'commit', '-q', '-m', message);
  const patch = git(fx.up, 'format-patch', '-1', '--stdout') + '\n';
  git(fx.up, 'checkout', '-q', 'master');
  git(fx.up, 'branch', '-q', '-D', 'tmp-patch');
  return patch;
}

/** Add patches to the fork master: entries = [{id, name, file, content, extra}]. */
export function setSeries(fx, entries, extraToml = '') {
  let toml = '# series\n';
  for (const e of entries) {
    if (e.content !== undefined) write(fx.fork, `vantt/patches/${e.file}`, e.content);
    toml += `\n[[patches]]\nid = "${e.id}"\nname = "${e.name ?? `feat: ${e.id}`}"\npatch_file = "${e.file}"\n${e.extra ?? ''}`;
  }
  write(fx.fork, 'vantt/patches/series.toml', toml + extraToml);
  git(fx.fork, 'add', '-A');
  git(fx.fork, 'commit', '-q', '-m', 'chore(vantt): series');
}

export function runCatchup(cwd, ...args) {
  const res = spawnSync(process.execPath, ['vantt/scripts/catchup.mjs', ...args], {
    cwd,
    env: ENV,
    encoding: 'utf8',
  });
  let report = null;
  if (args.includes('--json')) {
    try {
      report = JSON.parse(res.stdout);
    } catch {
      report = null;
    }
  }
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, report };
}

export const head = (cwd) => git(cwd, 'symbolic-ref', '--short', 'HEAD');
export const status = (cwd) => git(cwd, 'status', '--porcelain');
