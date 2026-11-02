import { describe, expect, it } from 'vitest';
import {
  buildQualityRows,
  flagQuality,
  highestStableTag,
  makeBlindPairs,
  makeSnippet,
  pickBlindQueries,
  probeVerdict,
  rng,
  scrubPrivate,
  suggestPatch,
  tallyVerdicts,
  upstreamTagOf,
} from '../lib/review-core.mjs';

describe('tags', () => {
  it('maps fork release tags to the upstream tag', () => {
    expect(upstreamTagOf('v0.17.2-vantt.3')).toBe('v0.17.2');
    expect(upstreamTagOf('v0.17.1')).toBe('v0.17.1');
    expect(upstreamTagOf('v0.18.0-beta.1')).toBeNull();
    expect(upstreamTagOf('main')).toBeNull();
  });
  it('picks the highest stable tag numerically', () => {
    expect(highestStableTag(['v0.9.9', 'v0.17.2', 'v0.17.10', 'v0.18.0-rc.1', 'x'])).toBe('v0.17.10');
    expect(highestStableTag([])).toBeNull();
  });
});

describe('probe verdicts', () => {
  it('follows the exit codes of PRD 9.2', () => {
    expect(probeVerdict(0)).toBe('solved');
    expect(probeVerdict(1)).toBe('present');
    expect(probeVerdict(2)).toBe('error');
    expect(probeVerdict(null)).toBe('error');
    expect(probeVerdict(139)).toBe('error');
  });
  it('suggests per verdict and apply state', () => {
    expect(suggestPatch({ upstream: 'present', apply: 'applies' })).toBe('keep');
    expect(suggestPatch({ upstream: 'present', apply: 'conflict' })).toMatch(/^rewrite/);
    expect(suggestPatch({ upstream: 'solved', apply: 'applies' })).toMatch(/^drop candidate/);
    expect(suggestPatch({ upstream: 'error', apply: 'applies' })).toMatch(/^unknown/);
    expect(suggestPatch({ upstream: 'present', apply: 'applies', upstreamStatus: 'merged' })).toMatch(/^drop/);
  });
});

const result = (ndcg, cats) => ({
  summary: { ndcg_5: ndcg, mrr: ndcg, hit_1: ndcg, hit_5: ndcg, recall_k: ndcg },
  by_category: Object.fromEntries(Object.entries(cats).map(([c, v]) => [c, { ndcg_5: v, mrr: v, hit_1: v, hit_5: v, recall_k: v }])),
});

describe('quality table', () => {
  const sides = {
    up_new: result(0.6, { a: 0.5, b: 0.9 }),
    fork_prev: result(0.7, { a: 0.8, b: 0.9 }),
    fork_new: result(0.65, { a: 0.8, b: 0.85 }),
  };
  const rows = buildQualityRows(sides);
  it('has ALL plus every category for every metric', () => {
    expect(rows).toHaveLength(3 * 5);
    const r = rows.find((x) => x.category === 'a' && x.metric === 'ndcg_5');
    expect(r).toMatchObject({ up_new: 0.5, fork_prev: 0.8, fork_new: 0.8, delta: 0.3, delta_vs_prev: 0 });
  });
  it('flags upstream-better and fork-regressed cells above the threshold only', () => {
    // ALL: fork_new - up_new = +0.05 (fine), fork_new - fork_prev = -0.05 (regressed)
    // b: -0.05 vs upstream (flag), -0.05 vs prev (regressed)
    const flags = flagQuality(rows);
    expect(flags).toContainEqual({ kind: 'fork_regressed', category: 'ALL', delta: -0.05 });
    expect(flags).toContainEqual({ kind: 'upstream_better', category: 'b', delta: -0.05 });
    expect(flags.some((f) => f.category === 'a')).toBe(false);
    expect(flagQuality(buildQualityRows({ up_new: result(0.6, {}), fork_new: result(0.59, {}) }))).toEqual([]);
  });
  it('gives null cells for a missing side', () => {
    const r = buildQualityRows({ up_new: result(0.6, {}) }).find((x) => x.metric === 'mrr');
    expect(r).toMatchObject({ fork_new: null, delta: null });
  });
});

describe('blind comparison', () => {
  const q = (id, category, ndcg, top) => ({ id, category, ndcg_5: ndcg, top_paths: top });
  const A = [
    q('q1', 'x', 1, ['a', 'b', 'c', 'd', 'e']),
    q('q2', 'vi-unaccented', 0.5, ['a', 'b', 'c', 'd', 'e']),
    q('q3', 'y', 0.5, ['a', 'b', 'c', 'd', 'e']),
    q('q4', 'y', 0.5, ['a', 'b', 'c', 'd', 'e']),
  ];
  const B = [
    q('q1', 'x', 0, ['z', 'b', 'c', 'd', 'e']), // big difference
    q('q2', 'vi-unaccented', 0.5, ['b', 'a', 'c', 'd', 'e']), // same score, different order
    q('q3', 'y', 0.5, ['a', 'b', 'c', 'd', 'e']), // identical: never chosen
    q('q4', 'y', 0.5, ['a', 'b', 'c', 'd', 'x']),
  ];
  it('orders by difference, then category, then random; skips identical lists; honours max', () => {
    expect(pickBlindQueries(A, B, { max: 20 })).toEqual(['q1', 'q2', 'q4']);
    expect(pickBlindQueries(A, B, { max: 2 })).toEqual(['q1', 'q2']);
  });
  it('is reproducible for a seed', () => {
    const r = rng(5);
    const first = [r(), r()];
    const r2 = rng(5);
    expect([r2(), r2()]).toEqual(first);
  });
  it('hides the side behind A/B and keeps the key apart', () => {
    const ids = ['q1', 'q2', 'q4'];
    const { pairs, key } = makeBlindPairs(ids, { q1: 'one', q2: 'two', q4: 'four' }, (side, id) => [{ title: `${side}:${id}`, snippet: '' }], { seed: 3 });
    expect(pairs).toHaveLength(3);
    for (const p of pairs) {
      expect(Object.keys(p).sort()).toEqual(['A', 'B', 'id', 'query']);
      const k = key[p.id];
      expect(new Set([k.A, k.B])).toEqual(new Set(['upstream', 'fork']));
      expect(p.A[0].title.startsWith(k.A)).toBe(true);
    }
    const again = makeBlindPairs(ids, { q1: 'one', q2: 'two', q4: 'four' }, () => [], { seed: 3 });
    expect(again.key).toEqual(key);
  });
  it('tallies verdicts for the fork whichever side it sat on', () => {
    const key = {
      p01: { A: 'fork', B: 'upstream' },
      p02: { A: 'upstream', B: 'fork' },
      p03: { A: 'fork', B: 'upstream' },
      p04: { A: 'upstream', B: 'fork' },
      p05: { A: 'fork', B: 'upstream' },
      p06: { A: 'fork', B: 'upstream' },
    };
    const t = tallyVerdicts({ p01: 'A++', p02: 'B+', p03: 'tie', p04: 'A+', p05: 'B++', p06: 'nonsense' }, key);
    expect(t).toMatchObject({ fork_clear: 1, fork_slight: 1, tie: 1, other_slight: 1, other_clear: 1, judged: 5, fork_wins: 2, fork_losses: 2 });
    expect(t.missing).toEqual(['p06']);
  });
});

describe('snippets and private scrub', () => {
  it('centres the excerpt on the first query word, ignoring accents and front matter', () => {
    const text = `---\ntitle: x\n---\n${'lorem '.repeat(40)}Nước mắm ngon nhất ${'ipsum '.repeat(40)}`;
    const s = makeSnippet(text, 'nuoc mam');
    expect(s).toContain('Nước mắm');
    expect(s.startsWith('…')).toBe(true);
    expect(s).not.toContain('title: x');
  });
  it('falls back to the start when nothing matches', () => {
    expect(makeSnippet('Hello world', 'zzz')).toBe('Hello world');
  });
  it('keeps only aggregates of a private result', () => {
    const out = scrubPrivate({
      summary: { ndcg_5: 1 },
      by_category: { c: { ndcg_5: 1 } },
      per_query: [{ id: 'secret', query: 'my diary', top_paths: ['private/a.md'] }],
    });
    expect(out).toEqual({ summary: { ndcg_5: 1 }, by_category: { c: { ndcg_5: 1 } }, queries: 1 });
    expect(JSON.stringify(out)).not.toMatch(/diary|private\/a/);
  });
});
