import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { git, head, makeFixture, makePatch, read, runCatchup, setSeries, status, write } from './helpers.mjs';

let fx;
beforeEach(() => {
  fx = makeFixture();
});
afterEach(() => fx.cleanup());

const showFile = (rev, file) => git(fx.fork, 'show', `${rev}:${file}`);
const subjects = (rev) => git(fx.fork, 'log', '--format=%s', `v0.2.0..${rev}`).split('\n').reverse();
const appEdit = (line2) => (dir) =>
  write(dir, 'src/app.txt', ['alpha', line2, 'gamma', 'delta', 'epsilon', ''].join('\n'));

describe('target selection', () => {
  it('picks the highest stable tag on upstream/master, skipping pre-releases and off-master tags', () => {
    // dry-run does not fetch; fetch first like a real run would
    git(fx.fork, 'fetch', '-q', '--tags', 'upstream', '+refs/heads/master:refs/remotes/upstream/master');
    const d = runCatchup(fx.fork, '--dry-run', '--json');
    expect(d.code).toBe(0);
    expect(d.report).toMatchObject({ status: 'DRY_RUN', target_ref: 'v0.2.0', release_branch: 'vantt/v0.2.0' });
    expect(git(fx.fork, 'branch', '--list', 'vantt/*')).toBe('');
  });

  it('refuses a tag that is not reachable from upstream/master', () => {
    const r = runCatchup(fx.fork, '--ref', 'v9.9.9');
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/not reachable from upstream\/master/);
  });

  it('names non-tag refs vantt/upstream-master-<sha7>', () => {
    const r = runCatchup(fx.fork, '--ref', 'upstream/master', '--json');
    expect(r.code).toBe(0);
    const sha = git(fx.fork, 'rev-parse', 'upstream/master');
    expect(r.report.release_branch).toBe(`vantt/upstream-master-${sha.slice(0, 7)}`);
    expect(r.report.version).toBe(`0.2.0-vantt.0.g${sha.slice(0, 7)}`);
  });
});

describe('release branch', () => {
  it('builds vantt/<tag> green with an empty series and returns to master', () => {
    const r = runCatchup(fx.fork, '--json', '--with-lang', 'vi');
    expect(r.stderr).not.toMatch(/catchup: /);
    expect(r.code).toBe(0);
    expect(r.report).toMatchObject({
      status: 'SUCCESS',
      target_ref: 'v0.2.0',
      release_branch: 'vantt/v0.2.0',
      version: '0.2.0-vantt.1',
      patches: [],
      capability: { version: 'pass' },
      tests: { upstream: 'pass', invariance: 'skipped', lang_vi: 'skipped' },
      quality: { gate: 'skipped' },
    });
    expect(head(fx.fork)).toBe('master');
    expect(status(fx.fork)).toBe('');
    expect(subjects('vantt/v0.2.0')).toEqual([
      'chore(vantt): include fork maintenance files',
      'chore(vantt): set version 0.2.0-vantt.1',
      'chore(vantt): drop upstream workflows from release branch',
    ]);
    expect(JSON.parse(showFile('vantt/v0.2.0', 'package.json'))).toMatchObject({ version: '0.2.0-vantt.1', vanttFork: true });
    expect(JSON.parse(showFile('vantt/v0.2.0', 'server.json'))).toEqual({
      version: '0.2.0-vantt.1',
      packages: [{ identifier: 'ohs-fixture', version: '0.2.0-vantt.1' }, { identifier: 'other', version: '9.0.0' }],
    });
    expect(JSON.parse(showFile('vantt/v0.2.0', 'package-lock.json')).packages['']).toMatchObject({ version: '0.2.0-vantt.1' });
    expect(showFile('vantt/v0.2.0', 'vantt/scripts/catchup.mjs')).toContain('Catchup');
    expect(showFile('vantt/v0.2.0', '.claude/skills/ohs-catchup/SKILL.md')).toBe('# skill');
    expect(git(fx.fork, 'ls-tree', '-r', '--name-only', 'vantt/v0.2.0', '.github')).toBe('');
    expect(existsSync(path.join(fx.fork, 'vantt/reports/catchup-v0.2.0.json'))).toBe(true);
    expect(existsSync(path.join(fx.fork, 'vantt/.catchup-state.json'))).toBe(false);

    // Second run: already green, no rebuild.
    const again = runCatchup(fx.fork, '--json');
    expect(again.code).toBe(0);
    expect(again.report.already_green).toBe(true);
    expect(again.stderr).toMatch(/already green/);
    expect(again.stderr).not.toMatch(/npm ci/);
  });

  it('does not carry untracked files onto the release branch', () => {
    write(fx.fork, 'vantt/wip.txt', 'not committed\n');
    expect(runCatchup(fx.fork).code).toBe(0);
    expect(git(fx.fork, 'ls-tree', '-r', '--name-only', 'vantt/v0.2.0', 'vantt')).not.toContain('wip.txt');
    expect(read(fx.fork, 'vantt/wip.txt')).toBe('not committed\n');
  });

  it('applies a fake patch with Patch-Id and runs its test_command', () => {
    const content = makePatch(fx, 'v0.2.0', 'feat: fake', (d) => write(d, 'src/fake.txt', 'fake\n'));
    setSeries(fx, [{ id: 'fake', name: 'feat(fake): add fake file', file: '0001-fake.patch', content, extra: 'test_command = "test -f src/fake.txt"\ncapability_check = "node dist/src/cli.js --version"\n' }]);
    const r = runCatchup(fx.fork, '--json');
    expect(r.code).toBe(0);
    expect(r.report.patches).toEqual([{ id: 'fake', status: 'APPLIED', commit: expect.any(String) }]);
    expect(r.report.tests.patches).toEqual({ fake: 'pass' });
    expect(r.report.capability.patches).toEqual({ fake: 'pass' });
    expect(r.report.reexported_patches).toEqual([]);
    const msg = git(fx.fork, 'log', '-1', '--format=%B', r.report.patches[0].commit);
    expect(msg).toBe('feat(fake): add fake file\n\nPatch-Id: fake');
    expect(showFile('vantt/v0.2.0', 'src/fake.txt')).toBe('fake');
  });

  it('skips patches upstream already has or marks merged', () => {
    const has = makePatch(fx, 'v0.1.0', 'same as upstream', appEdit('beta upstream'));
    const merged = makePatch(fx, 'v0.2.0', 'merged', (d) => write(d, 'src/m.txt', 'm\n'));
    setSeries(fx, [
      { id: 'has-it', file: '0001.patch', content: has },
      { id: 'merged-one', file: '0002.patch', content: merged, extra: 'upstream_status = "merged"\n' },
    ]);
    const r = runCatchup(fx.fork, '--json');
    expect(r.code).toBe(0);
    expect(r.report.patches.map((p) => p.status)).toEqual(['SKIPPED_UPSTREAM_HAS_IT', 'SKIPPED_UPSTREAM_HAS_IT']);
  });

  it('bumps -vantt.N only when the fork inputs change', () => {
    expect(runCatchup(fx.fork).code).toBe(0);
    git(fx.fork, 'tag', 'v0.2.0-vantt.1', 'vantt/v0.2.0');
    expect(runCatchup(fx.fork, '--clean', '--json').report.version).toBe('0.2.0-vantt.1');
    const content = makePatch(fx, 'v0.2.0', 'feat: x', (d) => write(d, 'src/x.txt', 'x\n'));
    setSeries(fx, [{ id: 'x', file: '0001-x.patch', content }]);
    const r = runCatchup(fx.fork, '--json');
    expect(r.report.version).toBe('0.2.0-vantt.2');
  });

  it('reports test, build and quality failures with their exit codes', () => {
    const p = makePatch(fx, 'v0.2.0', 'feat: t', (d) => write(d, 'src/t.txt', 't\n'));
    setSeries(fx, [{ id: 't', file: '0001-t.patch', content: p, extra: 'test_command = "exit 1"\n' }]);
    let r = runCatchup(fx.fork, '--json');
    expect(r.code).toBe(5);
    expect(r.report).toMatchObject({ status: 'TESTS_FAILED', tests: { patches: { t: 'fail' } } });
    expect(head(fx.fork)).toBe('master');
    expect(status(fx.fork)).toBe('');

    const b = makePatch(fx, 'v0.2.0', 'break build', (d) => {
      const pkg = JSON.parse(read(d, 'package.json'));
      pkg.breakBuild = true;
      write(d, 'package.json', JSON.stringify(pkg, null, 2) + '\n');
    });
    setSeries(fx, [{ id: 'b', file: '0001-b.patch', content: b }]);
    r = runCatchup(fx.fork, '--json');
    expect(r.code).toBe(4);
    expect(r.report.status).toBe('BUILD_FAILED');

    setSeries(fx, []);
    write(fx.fork, 'vantt/scripts/quality-gate.mjs', 'console.log(JSON.stringify({ vi_eval: { ndcg5: 0.1 } })); process.exit(1);\n');
    write(fx.fork, 'vantt/scripts/invariance.mjs', 'if (!process.argv.includes("--target-sha")) process.exit(1);\n');
    git(fx.fork, 'add', '-A');
    git(fx.fork, 'commit', '-q', '-m', 'hooks');
    r = runCatchup(fx.fork, '--json');
    expect(r.code).toBe(6);
    expect(r.report).toMatchObject({ status: 'QUALITY_FAILED', tests: { invariance: 'pass' }, quality: { gate: 'fail', vi_eval: { ndcg5: 0.1 } } });
    r = runCatchup(fx.fork, '--json', '--skip-quality');
    expect(r.code).toBe(0);
  });
});

describe('usage errors', () => {
  it('refuses a dirty tree, bad flags and a broken series', () => {
    write(fx.fork, 'package.json', '{}\n');
    expect(runCatchup(fx.fork).code).toBe(2);
    git(fx.fork, 'checkout', '--', 'package.json');
    expect(runCatchup(fx.fork, '--bogus').code).toBe(2);
    expect(runCatchup(fx.fork, '--continue').code).toBe(2);
    expect(runCatchup(fx.fork, '--abort').code).toBe(2);
    write(fx.fork, 'vantt/patches/series.toml', '[[patches]]\nid = "x\n');
    git(fx.fork, 'commit', '-q', '-am', 'broken');
    const r = runCatchup(fx.fork);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/series\.toml:2: unterminated string/);
  });
});

describe('conflict rehearsal (T8)', () => {
  function conflictingSeries() {
    // Made against v0.1.0, edits the line upstream changed in v0.2.0.
    const before = makePatch(fx, 'v0.2.0', 'feat: before', (d) => write(d, 'src/before.txt', 'b\n'));
    const fake = makePatch(fx, 'v0.1.0', 'feat: fork line', appEdit('beta fork'));
    const after = makePatch(fx, 'v0.2.0', 'feat: after', (d) => write(d, 'src/after.txt', 'a\n'));
    setSeries(fx, [
      { id: 'before', file: '0001-before.patch', content: before },
      { id: 'fake-conflict', file: '0002-fake-conflict.patch', content: fake, extra: 'metadata_file = "0002-fake-conflict.spec.md"\n' },
      { id: 'after', file: '0003-after.patch', content: after },
    ]);
    return fake;
  }

  it('stops with exit 3, --abort restores a clean repo', () => {
    conflictingSeries();
    const masterSha = git(fx.fork, 'rev-parse', 'master');
    const r = runCatchup(fx.fork, '--json');
    expect(r.code).toBe(3);
    expect(r.report).toMatchObject({
      status: 'CONFLICT',
      failed_patch: 'fake-conflict',
      conflicted_files: ['src/app.txt'],
      patches: [
        { id: 'before', status: 'APPLIED' },
        { id: 'fake-conflict', status: 'CONFLICT' },
      ],
    });
    expect(r.stderr).toMatch(/vantt\/patches\/0002-fake-conflict\.spec\.md/);
    expect(r.stderr).toMatch(/git log -p v0\.1\.0\.\./);
    expect(head(fx.fork)).toBe('vantt/v0.2.0');
    const state = JSON.parse(read(fx.fork, 'vantt/.catchup-state.json'));
    expect(state).toMatchObject({ index: 1, conflicted_files: ['src/app.txt'], orig: 'master' });
    expect(read(fx.fork, 'src/app.txt')).toMatch(/<<<<<<<.*\n/);

    // A new run refuses while the session is open.
    expect(runCatchup(fx.fork).code).toBe(2);
    // --continue refuses while files are unmerged.
    expect(runCatchup(fx.fork, '--continue').code).toBe(2);

    const a = runCatchup(fx.fork, '--abort');
    expect(a.code).toBe(0);
    expect(head(fx.fork)).toBe('master');
    expect(git(fx.fork, 'rev-parse', 'master')).toBe(masterSha);
    expect(status(fx.fork)).toBe('');
    expect(git(fx.fork, 'branch', '--list', 'vantt/*')).toBe('');
    expect(existsSync(path.join(fx.fork, 'vantt/.catchup-state.json'))).toBe(false);
    expect(git(fx.fork, 'status', '--porcelain', '--ignored', 'vantt')).not.toMatch(/backup-/);
  });

  it('--abort restores a release branch that existed before', () => {
    expect(runCatchup(fx.fork).code).toBe(0);
    const green = git(fx.fork, 'rev-parse', 'vantt/v0.2.0');
    conflictingSeries();
    expect(runCatchup(fx.fork).code).toBe(3);
    expect(runCatchup(fx.fork, '--abort').code).toBe(0);
    expect(git(fx.fork, 'rev-parse', 'vantt/v0.2.0')).toBe(green);
  });

  it('--continue after a fix goes green and re-exports the patch', () => {
    const original = conflictingSeries();
    expect(runCatchup(fx.fork).code).toBe(3);
    // Resolve: keep upstream's line 2 and add the fork's intent on a new line.
    write(fx.fork, 'src/app.txt', ['alpha', 'beta upstream', 'beta fork', 'gamma', 'delta', 'epsilon', ''].join('\n'));
    git(fx.fork, 'add', 'src/app.txt');
    const r = runCatchup(fx.fork, '--continue', '--json');
    expect(r.stderr).not.toMatch(/catchup: /);
    expect(r.code).toBe(0);
    expect(r.report.status).toBe('SUCCESS');
    expect(r.report.patches.map((p) => [p.id, p.status])).toEqual([
      ['before', 'APPLIED'],
      ['fake-conflict', 'APPLIED'],
      ['after', 'APPLIED'],
    ]);
    expect(r.report.patches[1].resolved).toBe(true);
    expect(r.report.reexported_patches).toEqual([
      'vantt/patches/0001-before.patch',
      'vantt/patches/0002-fake-conflict.patch',
      'vantt/patches/0003-after.patch',
    ]);
    expect(r.stderr).toMatch(/refresh patches for v0\.2\.0/);
    expect(head(fx.fork)).toBe('master');
    expect(showFile('vantt/v0.2.0', 'src/app.txt')).toContain('beta fork');

    // The re-exported patch sits uncommitted on master and now applies cleanly.
    const refreshed = read(fx.fork, 'vantt/patches/0002-fake-conflict.patch');
    expect(refreshed).not.toBe(original);
    expect(refreshed).toContain('Patch-Id: fake-conflict');
    expect(status(fx.fork)).toMatch(/M vantt\/patches\/0002-fake-conflict\.patch/);
    git(fx.fork, 'commit', '-q', '-am', 'chore(vantt): refresh patches for v0.2.0');
    const again = runCatchup(fx.fork, '--clean', '--json');
    expect(again.code).toBe(0);
    expect(again.report.patches.map((p) => p.status)).toEqual(['APPLIED', 'APPLIED', 'APPLIED']);
    expect(again.report.reexported_patches).toEqual([]);
  });

  it('--continue with an empty resolution records SKIPPED_UPSTREAM_HAS_IT', () => {
    conflictingSeries();
    expect(runCatchup(fx.fork).code).toBe(3);
    git(fx.fork, 'reset', '-q', '--hard', 'HEAD');
    const r = runCatchup(fx.fork, '--continue', '--json');
    expect(r.code).toBe(0);
    expect(r.report.patches.map((p) => p.status)).toEqual(['APPLIED', 'SKIPPED_UPSTREAM_HAS_IT', 'APPLIED']);
  });

  it('dry-run previews the conflict without touching git', () => {
    conflictingSeries();
    git(fx.fork, 'fetch', '-q', '--tags', 'upstream', '+refs/heads/master:refs/remotes/upstream/master');
    const before = git(fx.fork, 'for-each-ref');
    const r = runCatchup(fx.fork, '--dry-run', '--json');
    expect(r.code).toBe(0);
    expect(r.report.patches.map((p) => p.action)).toEqual([
      'APPLY',
      'CONFLICT (needs 3-way merge or a rewrite)',
      'UNKNOWN (after a conflict)',
    ]);
    expect(git(fx.fork, 'for-each-ref')).toBe(before);
    expect(status(fx.fork)).toBe('');
  });
});
