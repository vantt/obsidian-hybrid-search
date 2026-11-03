/**
 * Language packs re-score fused hybrid candidates on the core's RRF scale: a
 * pack rebuilds a branch's vote as `weight / (k + rank)` over the best possible
 * sum. This pins that scale against the copy each pack keeps in
 * `vantt/packages/<pack>/test/fixtures/core-fusion.json` (the pack's own tests
 * check its code against the same file), the score the core gives a fused
 * candidate, and the branch names in `Candidate.rank`.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Candidate } from '../../src/language/types.js';
import { writeLanguagePackVault } from './fixtures/language-pack-vault.js';

const vault = mkdtempSync(path.join(tmpdir(), 'ohs-core-fusion-'));
process.env.OBSIDIAN_VAULT_PATH = vault;
const PACK_DIR = path.resolve(import.meta.dirname, 'fixtures/lang-upper');
const PACKAGES_DIR = path.resolve(import.meta.dirname, '../../vantt/packages');

const queryEmbedding = vi.hoisted(() => ({ fail: false }));
vi.mock('../../src/inference/embedder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/inference/embedder.js')>();
  const { fixtureVector } = await import('./fixtures/language-pack-vault.js');
  return {
    ...actual,
    activeModelName: () => 'fixture-model',
    getEmbeddingDim: () => Promise.resolve(8),
    getContextLength: () => Promise.resolve(512),
    getDocumentTokenPolicy: () =>
      Promise.resolve({ limit: 508, count: (text: string) => text.length / 4 }),
    embedDetailed: vi.fn((texts: string[]) =>
      Promise.resolve(texts.map((text) => ({ ok: true as const, embedding: fixtureVector(text) }))),
    ),
    embed: vi.fn((texts: string[], type?: 'query' | 'document') =>
      Promise.resolve(
        texts.map((t) => (queryEmbedding.fail && type === 'query' ? null : fixtureVector(t))),
      ),
    ),
  };
});

const { openIndexDatabase, createIndexService } =
  await import('../../src/indexing/index-service.js');
const { HYBRID_FUSION, search } = await import('../../src/search/searcher.js');
const { closeDb } = await import('../../src/storage/db.js');

type Hooks = {
  __langUpperSynonyms?: Record<string, string>;
  __langUpperQueryKey?: string;
  __langUpperCandidates?: Candidate[];
};
const hooks = globalThis as Hooks;

/** Branch weights of the fused list, with the fake pack's only view as `lang-upper` declares it. */
const WEIGHTS: Record<string, number> = { ...HYBRID_FUSION.weights, 'view:upper': 1.0 };
const BRANCHES = ['semantic', 'bm25', 'alias', 'title', 'view:upper'];

let call = 0;
/** Candidates the pack's rescore receives for a single-query hybrid search. */
async function rescoreInput(query: string): Promise<Candidate[]> {
  hooks.__langUpperQueryKey = `core-fusion-${++call}`;
  delete hooks.__langUpperCandidates;
  await search(query, { mode: 'hybrid' });
  return hooks.__langUpperCandidates!;
}

const isRank = (rank: number | null | undefined): rank is number =>
  typeof rank === 'number' && rank > 0;

/** Best possible RRF sum: every branch with a candidate (a non-empty list) votes rank 1. */
function bestSum(candidates: readonly Candidate[]): number {
  const active = BRANCHES.filter((b) => candidates.some((c) => isRank(c.rank[b])));
  return active.reduce((sum, b) => sum + WEIGHTS[b]!, 0) / (HYBRID_FUSION.k + 1);
}

/** RRF score rebuilt from branch ranks, the way a pack does it. */
function packScore(candidates: readonly Candidate[], candidate: Candidate): number {
  let sum = 0;
  for (const [branch, rank] of Object.entries(candidate.rank))
    if (isRank(rank)) sum += WEIGHTS[branch]! / (HYBRID_FUSION.k + rank);
  return Math.min(1, sum / bestSum(candidates));
}

beforeAll(async () => {
  writeLanguagePackVault(vault);
  closeDb();
  process.env.OHS_LANGUAGE_PACK = PACK_DIR;
  process.env.OHS_LANGUAGE_PACK_OPTIONS = JSON.stringify({ rescore: 'record' });
  await openIndexDatabase();
  const service = createIndexService();
  try {
    expect((await service.reindex()).errors).toEqual([]);
  } finally {
    await service.close();
  }
});

afterEach(() => {
  queryEmbedding.fail = false;
  delete hooks.__langUpperSynonyms;
  delete hooks.__langUpperQueryKey;
  delete hooks.__langUpperCandidates;
});

afterAll(() => {
  closeDb();
  delete process.env.OHS_LANGUAGE_PACK;
  delete process.env.OHS_LANGUAGE_PACK_OPTIONS;
  rmSync(vault, { recursive: true, force: true });
});

describe('hybrid fusion contract for language packs', () => {
  it('matches the constants every language pack copies', () => {
    expect(HYBRID_FUSION).toEqual({
      k: 60,
      weights: { semantic: 1.5, bm25: 1.5, alias: 2.0, title: 0.25 },
    });
    const copies = readdirSync(PACKAGES_DIR)
      .map((name) => path.join(PACKAGES_DIR, name, 'test/fixtures/core-fusion.json'))
      .filter((file) => existsSync(file));
    expect(copies.length).toBeGreaterThan(0);
    for (const file of copies)
      expect(JSON.parse(readFileSync(file, 'utf8')), file).toEqual(HYBRID_FUSION);
  });

  it('passes unprefixed branch ranks and RRF scores to rescore', async () => {
    const candidates = await rescoreInput('bread');
    expect(candidates.length).toBeGreaterThan(1);
    for (const c of candidates) {
      expect(Object.keys(c.rank)).toEqual(BRANCHES);
      expect(c.score).toBeCloseTo(packScore(candidates, c), 12);
    }
  });

  it('scores a candidate with only a BM25 vote as weight / (k + rank) over the best sum', async () => {
    // No query vector and a view query matching other notes leave BM25-only hits.
    queryEmbedding.fail = true;
    hooks.__langUpperSynonyms = { bread: 'canyon' };
    const candidates = await rescoreInput('bread');
    for (const c of candidates) expect(c.rank.semantic).toBeNull();
    const bm25Only = candidates.filter(
      (c) => isRank(c.rank.bm25) && BRANCHES.every((b) => b === 'bm25' || !isRank(c.rank[b])),
    );
    expect(bm25Only.length).toBeGreaterThan(0);
    expect(candidates.some((c) => isRank(c.rank['view:upper']))).toBe(true);
    for (const c of bm25Only)
      expect(c.score).toBeCloseTo(
        HYBRID_FUSION.weights.bm25 / (HYBRID_FUSION.k + c.rank.bm25!) / bestSum(candidates),
        12,
      );
  });
});
