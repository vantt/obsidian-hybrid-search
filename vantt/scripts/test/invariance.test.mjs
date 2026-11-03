// Invariance test (PRD 11.4) on a throw-away repo whose "eval" is a stub: the upstream
// commit and the fork commit are compared through the real worktree + eval plumbing.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../invariance.mjs';
import { compareResults } from '../lib/compare.mjs';
import { evalEnv } from '../lib/eval-run.mjs';
import { createUpstreamTree, lockFingerprint } from '../lib/trees.mjs';
import { git, write } from './helpers.mjs';

const REAL_MODULES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../node_modules',
);

// Stub of eval/evaluate.ts: results depend on eval/behavior.txt, the "search behavior" of the tree.
const EVALUATE = `import fs from 'node:fs';
const a = process.argv;
const get = (f) => a[a.indexOf(f) + 1];
const behavior = fs.existsSync('eval/behavior.txt') ? fs.readFileSync('eval/behavior.txt', 'utf8').trim() : 'same';
const golden = JSON.parse(fs.readFileSync(get('--golden-set'), 'utf8'));
const per_query = golden.map((q, i) => ({
  id: q.id, category: q.category, ndcg_5: 1, ndcg_k: 1, mrr: 1, recall_k: 1,
  top_paths: behavior === 'swap' && i === 0 ? ['b.md', 'a.md'] : ['a.md', 'b.md'],
}));
if (behavior === 'score') per_query[0].ndcg_5 = 0.9;
fs.writeFileSync(get('--output'), JSON.stringify({ meta: {}, summary: { ndcg_5: 1 }, by_category: {}, per_query }));
`;

let dir;
let root;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'ohs-inv-'));
  root = path.join(dir, 'fork');
  mkdirSync(root);
  git(root, 'init', '-q', '-b', 'master');
  write(root, 'package.json', '{"name":"x","version":"1.0.0"}\n');
  write(
    root,
    'package-lock.json',
    '{"name":"x","version":"1.0.0","packages":{"":{"version":"1.0.0"}}}\n',
  );
  write(root, 'eval/evaluate.ts', EVALUATE);
  write(
    root,
    'fixtures/obsidian-help/golden-set.json',
    JSON.stringify([
      { id: 'q1', category: 'c' },
      { id: 'q2', category: 'c' },
    ]),
  );
  write(root, 'fixtures/obsidian-help/dataset/a.md', '# a\n');
  write(root, '.gitignore', 'node_modules\nvantt/.work\nfixtures/*/dataset\n');
  symlinkSync(REAL_MODULES, path.join(root, 'node_modules'), 'dir');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'upstream');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

async function capture(sha, extra = []) {
  const chunks = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (c) => (chunks.push(String(c)), true);
  let code;
  try {
    const argv = [
      '--target-sha',
      sha,
      '--target-ref',
      'v1.0.0',
      '--branch',
      'vantt/v1.0.0',
      '--json',
      '--corpora',
      'obsidian-help',
      ...extra,
    ];
    code = await main(argv, { cwd: root });
  } finally {
    process.stdout.write = orig;
  }
  return { code, report: JSON.parse(chunks.join('')) };
}

const forkCommit = (file, content) => {
  write(root, file, content);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'fork');
};

describe('invariance.mjs', () => {
  it('passes when the fork returns what upstream returns, and cleans up its worktree', async () => {
    const upstream = git(root, 'rev-parse', 'HEAD');
    forkCommit('src/fork-only.txt', 'a patch that does not change search\n');
    const { code, report } = await capture(upstream);
    expect(code).toBe(0);
    expect(report).toMatchObject({
      status: 'pass',
      queries: 2,
      identical: 2,
      upstream_deps: 'shared',
    });
    expect(existsSync(path.join(root, 'vantt/.work/invariance'))).toBe(false);
    // Left for quality-gate.mjs, which compares the fork with this same-run upstream measurement.
    const record = JSON.parse(
      readFileSync(path.join(root, 'vantt/.work/invariance-last.json'), 'utf8'),
    );
    expect(record).toMatchObject({ target: { sha: upstream }, k: 10 });
    expect(record.corpora['obsidian-help'].summary_upstream).toEqual({ ndcg_5: 1 });
    expect(git(root, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('fails and names the query when top_paths differ', async () => {
    const upstream = git(root, 'rev-parse', 'HEAD');
    forkCommit('eval/behavior.txt', 'swap');
    const { code, report } = await capture(upstream);
    expect(code).toBe(1);
    expect(report.status).toBe('fail');
    expect(report.identical).toBe(1);
    expect(report.corpora['obsidian-help'].mismatches[0]).toMatchObject({
      id: 'q1',
      kind: 'top_paths',
    });
  });

  it('fails when only a score drifts beyond 1e-6', async () => {
    const upstream = git(root, 'rev-parse', 'HEAD');
    forkCommit('eval/behavior.txt', 'score');
    const { code, report } = await capture(upstream);
    expect(code).toBe(1);
    expect(report.corpora['obsidian-help'].mismatches[0]).toMatchObject({
      kind: 'score',
      field: 'ndcg_5',
    });
  });

  it('exits 2 when the target commit does not exist', async () => {
    const { code, report } = await capture('0'.repeat(40));
    expect(code).toBe(2);
    expect(report.status).toBe('error');
  });

  it('exits 2 without --target-sha', async () => {
    expect(await main(['--json'], { cwd: root })).toBe(2);
  });
});

describe('compareResults', () => {
  const q = (id, top, extra = {}) => ({
    id,
    top_paths: top,
    ndcg_5: 1,
    ndcg_k: 1,
    mrr: 1,
    recall_k: 1,
    ...extra,
  });
  it('accepts identical results and sub-tolerance score noise', () => {
    const a = { per_query: [q('1', ['x', 'y'])] };
    const b = { per_query: [q('1', ['x', 'y'], { ndcg_5: 1 + 1e-7 })] };
    expect(compareResults(a, b)).toMatchObject({ queries: 1, identical: 1, mismatches: [] });
  });
  it('flags order, scores and queries present on one side only', () => {
    const a = { per_query: [q('1', ['x', 'y']), q('2', ['x']), q('3', ['x'])] };
    const b = { per_query: [q('1', ['y', 'x']), q('2', ['x'], { mrr: 0.5 }), q('4', ['x'])] };
    const r = compareResults(a, b);
    expect(r.mismatches.map((m) => `${m.id}:${m.kind}`)).toEqual([
      '1:top_paths',
      '2:score',
      '3:missing_in_fork',
      '4:missing_in_upstream',
    ]);
    expect(r.identical).toBe(0);
  });
});

describe('trees and eval environment', () => {
  it('lockFingerprint ignores the version stamp only', () => {
    const lock = (v, dep) =>
      JSON.stringify({
        version: v,
        packages: { '': { version: v }, 'node_modules/a': { version: dep } },
      });
    expect(lockFingerprint(lock('1.0.0', '2.0.0'))).toBe(
      lockFingerprint(lock('1.0.0-vantt.1', '2.0.0')),
    );
    expect(lockFingerprint(lock('1.0.0', '2.0.0'))).not.toBe(
      lockFingerprint(lock('1.0.0', '2.0.1')),
    );
  });

  it('evalEnv drops pack, db-path and personal vault settings', () => {
    const saved = { ...process.env };
    Object.assign(process.env, {
      OHS_LANGUAGE_PACK: '/p',
      OHS_LANGUAGE_PACK_OPTIONS: '{}',
      OBSIDIAN_DB_PATH: '/db',
      OBSIDIAN_VAULT_PATH: '/v',
      OPENAI_API_KEY: 'k',
    });
    try {
      const env = evalEnv();
      expect(env.OHS_LANGUAGE_PACK).toBeUndefined();
      expect(env.OHS_LANGUAGE_PACK_OPTIONS).toBeUndefined();
      expect(env.OBSIDIAN_DB_PATH).toBeUndefined();
      expect(env.OBSIDIAN_VAULT_PATH).toBeUndefined();
      expect(env.OPENAI_API_KEY).toBeUndefined();
      expect(env.OBSIDIAN_IGNORE_PATTERNS).toBe('');
      expect(evalEnv({ OHS_LANGUAGE_PACK: '/q' }).OHS_LANGUAGE_PACK).toBe('/q');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    }
  });

  it('createUpstreamTree checks out the commit; cleanup removes it and spares the shared modules', () => {
    const sha = git(root, 'rev-parse', 'HEAD');
    const t = createUpstreamTree(root, sha, path.join(dir, 'wt'), () => {});
    expect(t.deps).toBe('shared');
    expect(existsSync(path.join(t.dir, 'eval/evaluate.ts'))).toBe(true);
    t.cleanup();
    expect(existsSync(t.dir)).toBe(false);
    expect(existsSync(path.join(root, 'node_modules'))).toBe(true);
  });
});
