// Tests of the side-effecting helpers of review-upstream on throwaway git repos.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkApplicability, runProbe, upstreamChanges, upstreamOverview } from '../lib/review-run.mjs';
import { git, write } from './helpers.mjs';

let dir;
let repo;
let patchesDir;

const commit = (msg) => {
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', msg);
};

beforeAll(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'review-run-'));
  repo = path.join(dir, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'master');
  write(repo, 'src/a.ts', 'one\ntwo\nthree\n');
  write(repo, 'src/b.ts', 'b\n');
  commit('v1');
  git(repo, 'tag', 'v1.0.0');

  // Patch 1 edits a.ts line 3; patch 2 edits b.ts. Cut from the v1 tree.
  patchesDir = path.join(dir, 'patches');
  mkdirSync(patchesDir);
  write(repo, 'src/a.ts', 'one\ntwo\nTHREE\n');
  git(repo, 'diff', '--output=' + path.join(patchesDir, 'p1.patch'));
  git(repo, 'checkout', '-q', '--', 'src/a.ts');
  write(repo, 'src/b.ts', 'b\nbee\n');
  git(repo, 'diff', '--output=' + path.join(patchesDir, 'p2.patch'));
  git(repo, 'checkout', '-q', '--', 'src/b.ts');

  // v2 changes a.ts line 3 (conflicts with p1), leaves b.ts alone, adds a note to the changelog.
  write(repo, 'src/a.ts', 'one\ntwo\nthree-changed\n');
  write(repo, 'CHANGELOG.md', '## 2\n- changed a\n');
  commit('change a');
  git(repo, 'tag', 'v2.0.0');
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('checkApplicability', () => {
  const patches = [
    { id: 'p1', patch_file: 'p1.patch', upstream_status: 'unsubmitted' },
    { id: 'p2', patch_file: 'p2.patch', upstream_status: 'unsubmitted' },
    { id: 'p3', patch_file: 'p2.patch', upstream_status: 'merged' },
  ];
  it('applies on the old tag', () => {
    const r = checkApplicability(repo, patches.slice(0, 2), 'v1.0.0', path.join(dir, 'wt1'), patchesDir);
    expect(r).toEqual({ p1: 'applies', p2: 'applies' });
  });
  it('reports a conflict and keeps going with the next patch', () => {
    const r = checkApplicability(repo, patches, 'v2.0.0', path.join(dir, 'wt2'), patchesDir);
    expect(r).toEqual({ p1: 'conflict', p2: 'applies', p3: 'skipped_merged' });
  });
  it('leaves no worktree behind', () => {
    expect(git(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
  });
});

describe('upstreamChanges and overview', () => {
  it('lists commits and files touching the given paths only', () => {
    const a = upstreamChanges(repo, 'v1.0.0', 'v2.0.0', ['src/a.ts']);
    expect(a.commits.map((c) => c.subject)).toEqual(['change a']);
    expect(a.files).toEqual([{ status: 'M', path: 'src/a.ts' }]);
    expect(upstreamChanges(repo, 'v1.0.0', 'v2.0.0', ['src/b.ts'])).toEqual({ commits: [], files: [] });
    expect(upstreamChanges(repo, 'v1.0.0', 'v2.0.0', [])).toEqual({ commits: [], files: [] });
  });
  it('summarises the whole range with the changelog diff', () => {
    const o = upstreamOverview(repo, 'v1.0.0', 'v2.0.0');
    expect(o.commits).toHaveLength(1);
    expect(o.changelog_diff).toContain('+- changed a');
  });
});

describe('runProbe', () => {
  const probe = (code) => {
    const f = path.join(dir, `probe-${code}.mjs`);
    writeFileSync(f, `console.log('args', process.argv.slice(2).join(' '));\nprocess.exit(${code});\n`);
    return f;
  };
  it('maps exit codes and passes --ohs', () => {
    const r = runProbe(probe(1), '/some/tree');
    expect(r).toMatchObject({ verdict: 'present', exit: 1 });
    expect(r.output).toContain('--ohs /some/tree');
    expect(runProbe(probe(0), '/t').verdict).toBe('solved');
    expect(runProbe(probe(2), '/t').verdict).toBe('error');
  });
  it('reports a missing probe file as an error', () => {
    expect(runProbe(path.join(dir, 'nope.mjs'), '/t')).toMatchObject({ verdict: 'error', exit: null });
  });
  it('times out into an error', () => {
    const f = path.join(dir, 'slow.mjs');
    writeFileSync(f, 'setTimeout(() => {}, 60000);\n');
    expect(runProbe(f, '/t', { timeoutMs: 300 }).verdict).toBe('error');
  });
});
