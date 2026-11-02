import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { fold } from '../src/fold.js';
import { normalize } from '../src/normalize.js';
import { composeSyllable, isPossibleFoldedSyllable, parseSyllable } from '../src/syllable.js';
import { allSyllables, vietnameseText } from './helpers.js';

const ONE_MB = 1024 * 1024;
const PROJECT_BUDGET_MS = 200;

/** Best of a few runs: perf asserts should catch regressions, not scheduler noise. */
function bestOf(runs: number, fn: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    fn();
    best = Math.min(best, performance.now() - t0);
  }
  return best;
}

/** First run only (cold caches), no repeat. */
function once(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe('performance: 1 MB projection (M1 pieces of project())', () => {
  const nfc = vietnameseText(ONE_MB, 'NFC', 1);
  const nfd = vietnameseText(ONE_MB, 'NFD', 2);

  it('builds a ~1 MB corpus', () => {
    expect(Buffer.byteLength(nfc)).toBeGreaterThanOrEqual(ONE_MB);
  });

  it('norm view (normalize) on 1 MB, cold caches, under 200 ms', () => {
    const ms = once(() => normalize(nfc));
    console.log(`normalize 1 MB NFC cold: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(PROJECT_BUDGET_MS);
  });

  it('norm view (normalize) on 1 MB NFD, under 200 ms', () => {
    const ms = bestOf(3, () => normalize(nfd));
    console.log(`normalize 1 MB NFD: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(PROJECT_BUDGET_MS);
  });

  it('fold view (fold) on 1 MB, under 200 ms', () => {
    const ms = bestOf(3, () => fold(nfc));
    console.log(`fold 1 MB: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(PROJECT_BUDGET_MS);
  });

  it('fold view with foldIY on 1 MB, under 200 ms', () => {
    const ms = bestOf(3, () => fold(nfc, { foldIY: true }));
    console.log(`fold+foldIY 1 MB: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(PROJECT_BUDGET_MS);
  });

  it('fold(normalize(x)) chain on 1 MB, under 200 ms', () => {
    const ms = bestOf(3, () => fold(normalize(nfc), { foldIY: true }));
    console.log(`fold(normalize()) 1 MB: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(PROJECT_BUDGET_MS);
  });

  it('classic style on 1 MB, under 200 ms', () => {
    const ms = bestOf(3, () => normalize(nfc, { tonePlacement: 'classic' }));
    console.log(`normalize classic 1 MB: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(PROJECT_BUDGET_MS);
  });

  it('worst case for caches: 1 MB of mostly distinct non-ASCII words, under 200 ms', () => {
    // Every word is distinct, so the per-word memo never hits.
    const toned = allSyllables().map((s) => composeSyllable({ ...s, tone: 2 }));
    const words: string[] = [];
    let size = 0;
    for (let round = 0; size < ONE_MB; round++) {
      for (const w of toned) {
        const word = round === 0 ? w : w + String.fromCodePoint(0x4e00 + (round % 5000)) + round;
        words.push(word);
        size += Buffer.byteLength(word) + 1;
        if (size >= ONE_MB) break;
      }
    }
    const text = words.join(' ');
    const ms = once(() => normalize(text));
    console.log(`normalize 1 MB distinct words cold: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(PROJECT_BUDGET_MS);
  });

  it('10 KB projection is far below 1 ms budget scale (under 5 ms)', () => {
    const small = nfc.slice(0, 10_000);
    const ms = bestOf(5, () => fold(normalize(small)));
    console.log(`fold(normalize()) 10 KB: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(5);
  });
});

describe('performance: primitives that analyzeQuery (V13) will call', () => {
  const sentence = 'toi muon tim ke hoach ban hang online cho quy bon nam';
  const accented = 'Tôi muốn tìm kế hoạch bán hàng online cho quý bốn năm';

  it('12-syllable query: normalize + fold + parse + folded lookup under 20 ms, cold start included', () => {
    // First call also builds the folded-syllable set; that cost must fit in the budget too.
    const words = accented.split(' ');
    expect(words).toHaveLength(12);
    const ms = once(() => {
      normalize(accented);
      fold(accented, { foldIY: true });
      for (const w of words) parseSyllable(w);
      for (const w of sentence.split(' ')) isPossibleFoldedSyllable(w);
    });
    console.log(`12-syllable primitives cold: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(20);
  });

  it('12-syllable query warm: well under 1 ms', () => {
    const words = accented.split(' ');
    const ms = bestOf(20, () => {
      for (let i = 0; i < 100; i++) {
        normalize(accented);
        fold(accented, { foldIY: true });
        for (const w of words) parseSyllable(w);
        for (const w of sentence.split(' ')) isPossibleFoldedSyllable(w);
      }
    });
    const perQuery = ms / 100;
    console.log(`12-syllable primitives warm: ${perQuery.toFixed(4)} ms per query`);
    expect(perQuery).toBeLessThan(1);
  });

  it('parseSyllable on 50,000 distinct words is fast (uncached path), under 500 ms', () => {
    const toned = allSyllables().flatMap((s) => [1, 2, 3, 4, 5].map((tone) => composeSyllable({ ...s, tone: tone as 1 })));
    const sample = toned.slice(0, 50_000);
    const ms = once(() => {
      for (const w of sample) parseSyllable(w);
    });
    console.log(`parseSyllable x${sample.length} distinct: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500);
  });
});
