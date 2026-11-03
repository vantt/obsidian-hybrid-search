/**
 * The weak-BM25 penalty rebuilds the core's hybrid RRF votes. The core's
 * constants live in `fixtures/core-fusion.json`; the language-pack-api patch
 * (`test/vantt/core-fusion.test.ts`) fails when the core drifts from that file,
 * and this test fails when the pack drifts from it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Candidate, QueryAnalysis } from '../src/contract.js';
import { CORE_WEIGHTS, RRF_K } from '../src/core-fusion.js';
import { resolveOptions } from '../src/options.js';
import { weakBm25Penalty } from '../src/rescore.js';

const CORE = JSON.parse(
  readFileSync(new URL('./fixtures/core-fusion.json', import.meta.url), 'utf8'),
) as { k: number; weights: Record<'semantic' | 'bm25' | 'alias' | 'title', number> };

const candidate = (path: string, rank: Record<string, number>): Candidate => ({
  path,
  score: 0.5,
  title: path,
  snippet: '',
  matchedViews: [],
  rank: { semantic: null, bm25: null, alias: null, title: null, ...rank },
});

describe('core hybrid fusion constants', () => {
  it('are the values of the core fixture', () => {
    expect(RRF_K).toBe(CORE.k);
    expect(CORE_WEIGHTS).toEqual(CORE.weights);
  });

  const options = resolveOptions();
  const analysis: QueryAnalysis = { viewQueries: {} };
  // The semantic answer misses every BM25 top result: agreement 0, the whole BM25 vote is lost.
  const answer = candidate('answer.md', { semantic: 1 });
  const bm25At = (rank: number) => candidate(`bm25-${rank}.md`, { bm25: rank });

  it('scales each lost BM25 vote by weight / (k + rank) over the best possible sum', () => {
    const others = [
      [[], CORE.weights.semantic + CORE.weights.bm25],
      [[candidate('alias.md', { alias: 1 })], CORE.weights.alias],
      [[candidate('title.md', { title: 1 })], CORE.weights.title],
    ] as const;
    let extra: Candidate[] = [];
    let total = 0;
    for (const [added, weight] of others) {
      extra = [...extra, ...added];
      total += weight;
      // a full BM25 top 5 (a shorter list keeps its votes)
      const candidates = [answer, bm25At(1), bm25At(4), bm25At(2), bm25At(3), bm25At(5), ...extra];
      const penalty = weakBm25Penalty(candidates, analysis, options);
      const best = total / (CORE.k + 1);
      expect(penalty[0]).toBe(0);
      expect(penalty[1]).toBeCloseTo(CORE.weights.bm25 / (CORE.k + 1) / best, 12);
      expect(penalty[2]).toBeCloseTo(CORE.weights.bm25 / (CORE.k + 4) / best, 12);
    }
  });
});
