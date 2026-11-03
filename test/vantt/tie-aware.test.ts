import { expect, it } from 'vitest';
import { sameUpToTies } from './fixtures/tie-aware.js';

const hit = (path: string, score: number, rank: number, extra = {}) => ({
  path,
  score,
  rank,
  ...extra,
});

const expected = [
  hit('a.md', 0.9, 1),
  hit('b.md', 0.5, 2),
  hit('c.md', 0.5, 3),
  hit('d.md', 0.1, 4),
];

it('accepts a permutation inside a group of equal scores', () => {
  const actual = [
    hit('a.md', 0.9, 1),
    hit('c.md', 0.5, 2),
    hit('b.md', 0.5, 3),
    hit('d.md', 0.1, 4),
  ];
  expect(sameUpToTies(actual, expected)).toBe(true);
});

it('accepts identical results', () => {
  expect(sameUpToTies(expected, expected)).toBe(true);
});

it('rejects a different path inside a tie group', () => {
  const actual = [
    hit('a.md', 0.9, 1),
    hit('b.md', 0.5, 2),
    hit('x.md', 0.5, 3),
    hit('d.md', 0.1, 4),
  ];
  expect(sameUpToTies(actual, expected)).toBe(false);
});

it('rejects a different score', () => {
  const actual = [
    hit('a.md', 0.9, 1),
    hit('b.md', 0.5, 2),
    hit('c.md', 0.4, 3),
    hit('d.md', 0.1, 4),
  ];
  expect(sameUpToTies(actual, expected)).toBe(false);
});

it('rejects an order change between different scores', () => {
  const actual = [
    hit('b.md', 0.5, 1),
    hit('a.md', 0.9, 2),
    hit('c.md', 0.5, 3),
    hit('d.md', 0.1, 4),
  ];
  expect(sameUpToTies(actual, expected)).toBe(false);
});

it('rejects a difference in any other field of a tied member', () => {
  const base = [hit('b.md', 0.5, 1, { title: 'B' }), hit('c.md', 0.5, 2, { title: 'C' })];
  const changed = [hit('c.md', 0.5, 1, { title: 'C' }), hit('b.md', 0.5, 2, { title: 'other' })];
  expect(sameUpToTies(changed, base)).toBe(false);
});

it('rejects a missing result and a changed rank sequence', () => {
  expect(sameUpToTies(expected.slice(0, 3), expected)).toBe(false);
  const reranked = expected.map((r, i) => ({ ...r, rank: i + 2 }));
  expect(sameUpToTies(reranked, expected)).toBe(false);
});

const scored = (path: string, hybrid: number, rank: number, semantic: number, extra = {}) => ({
  path,
  score: hybrid,
  rank,
  scores: { semantic, bm25: null, hybrid },
  matchedBy: ['semantic'],
  ...extra,
});

// Two notes with the same semantic score trade places, and with them the fused
// scores that depend on their semantic rank.
const fused = [
  scored('a.md', 0.9, 1, 0.5),
  scored('b.md', 0.78, 2, 0.01, { title: 'B' }),
  scored('c.md', 0.76, 3, 0.01, { title: 'C' }),
];
const traded = [
  scored('a.md', 0.9, 1, 0.5),
  scored('c.md', 0.78, 2, 0.01, { title: 'C' }),
  scored('b.md', 0.76, 3, 0.01, { title: 'B' }),
];

it('accepts notes with identical component scores trading fused scores', () => {
  expect(sameUpToTies(traded, fused)).toBe(true);
});

it('rejects a trade between notes whose component scores differ', () => {
  const different = [fused[0]!, scored('b.md', 0.78, 2, 0.01), scored('c.md', 0.76, 3, 0.02)];
  const swapped = [fused[0]!, scored('c.md', 0.78, 2, 0.02), scored('b.md', 0.76, 3, 0.01)];
  expect(sameUpToTies(swapped, different)).toBe(false);
});

it('rejects a changed fused score table or a changed note field in the trade', () => {
  expect(
    sameUpToTies(
      traded.map((r, i) => (i === 2 ? { ...r, score: 0.7 } : r)),
      fused,
    ),
  ).toBe(false);
  expect(
    sameUpToTies(
      traded.map((r) => ({ ...r, title: 'other' })),
      fused,
    ),
  ).toBe(false);
});
