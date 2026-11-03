import { performance } from 'node:perf_hooks';
import { describe, expect, it } from 'vitest';
import { fold } from '../src/fold.js';
import { createPack } from '../src/index.js';
import { normalize } from '../src/normalize.js';
import { bundledCompounds } from '../src/segment.js';
import { composeSyllable, isPossibleFoldedSyllable, parseSyllable } from '../src/syllable.js';
import { fakeContextFromCounts } from './fake-context.js';
import { allSyllables, prng, vietnameseText } from './helpers.js';

const ONE_MB = 1024 * 1024;
/**
 * Budgets are the PRD targets for a user's machine. Shared CI runners are slower,
 * so CI may scale every budget with OHS_PERF_FACTOR (default 1, never below 1).
 */
const PERF_FACTOR = Math.max(1, Number(process.env.OHS_PERF_FACTOR ?? '1') || 1);
const PROJECT_BUDGET_MS = 200 * PERF_FACTOR;

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
    // Best of 3: the per-word memo holds far fewer words than the text has, and
    // the text starts with words the previous run evicted first, so every run
    // stays cold; repeating only filters out a busy scheduler.
    const ms = bestOf(3, () => normalize(text));
    console.log(`normalize 1 MB distinct words cold (best of 3): ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(PROJECT_BUDGET_MS);
  });

  it('10 KB projection is far below 1 ms budget scale (under 5 ms)', () => {
    const small = nfc.slice(0, 10_000);
    const ms = bestOf(5, () => fold(normalize(small)));
    console.log(`fold(normalize()) 10 KB: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(5 * PERF_FACTOR);
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
    expect(ms).toBeLessThan(20 * PERF_FACTOR);
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
    expect(perQuery).toBeLessThan(1 * PERF_FACTOR);
  });

  it('parseSyllable on 50,000 distinct words is fast (uncached path), under 500 ms', () => {
    const toned = allSyllables().flatMap((s) =>
      [1, 2, 3, 4, 5].map((tone) => composeSyllable({ ...s, tone: tone as 1 })),
    );
    const sample = toned.slice(0, 50_000);
    const ms = once(() => {
      for (const w of sample) parseSyllable(w);
    });
    console.log(`parseSyllable x${sample.length} distinct: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(500 * PERF_FACTOR);
  });
});

// ---------------------------------------------------------------------------
// M2/M3: project() and analyzeQuery() of the pack
// ---------------------------------------------------------------------------

describe('performance: pack project() on 1 MB', () => {
  const nfc = vietnameseText(ONE_MB, 'NFC', 3);
  const nfd = vietnameseText(ONE_MB, 'NFD', 4);

  for (const view of ['norm', 'fold'] as const) {
    it(`${view} view on 1 MB under 200 ms (NFC and NFD, fresh pack)`, () => {
      const pack = createPack({ foldIY: true });
      const msNfc = once(() => pack.project(view, 'content', nfc));
      const msNfd = once(() => pack.project(view, 'content', nfd));
      console.log(`project ${view} 1 MB: NFC ${msNfc.toFixed(1)} ms, NFD ${msNfd.toFixed(1)} ms`);
      expect(msNfc).toBeLessThan(PROJECT_BUDGET_MS);
      expect(msNfd).toBeLessThan(PROJECT_BUDGET_MS);
    });
  }

  it('seg view on 1 MB under 200 ms (NFC and NFD, fresh pack, dictionary loaded)', () => {
    const pack = createPack({ segment: true });
    pack.signature(); // loads the compound dictionary, as the core does before indexing
    const compounds = bundledCompounds();
    // Real compounds between the random syllables, so the segmenter has work to do.
    const withCompounds = nfc.replace(
      /\n/g,
      () => ` ${compounds[nfc.length % compounds.length]}\n`,
    );
    const msNfc = once(() => pack.project('seg', 'content', nfc));
    const msNfd = once(() => pack.project('seg', 'content', nfd));
    const msCompounds = once(() => pack.project('seg', 'content', withCompounds));
    console.log(
      `project seg 1 MB: NFC ${msNfc.toFixed(1)} ms, NFD ${msNfd.toFixed(1)} ms, with compounds ${msCompounds.toFixed(1)} ms`,
    );
    expect(msNfc).toBeLessThan(PROJECT_BUDGET_MS);
    expect(msNfd).toBeLessThan(PROJECT_BUDGET_MS);
    expect(msCompounds).toBeLessThan(PROJECT_BUDGET_MS);
  });

  it('loading the compound dictionary stays small', () => {
    const ms = once(() => createPack({ segment: true, tonePlacement: 'classic' }).signature());
    console.log(`seg dictionary load (classic, cold): ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(PROJECT_BUDGET_MS);
  });
});

describe('performance: analyzeQuery, 12 syllables, 50,000-term vocabulary', () => {
  const rand = prng(7);
  const syllables = allSyllables();
  const norm = new Map<string, number>();
  const foldCounts = new Map<string, number>();
  // Every accented syllable that exists, then filler terms up to 50,000.
  for (const s of syllables) {
    for (const tone of [0, 1, 2, 3, 4, 5] as const) {
      const w = composeSyllable({ ...s, tone });
      norm.set(w, 1 + Math.floor(rand() * 500));
    }
  }
  for (let i = 0; norm.size < 50_000; i++) norm.set(`term${i}x`, 1 + Math.floor(rand() * 20));
  for (const [w, n] of norm) {
    const f = fold(w);
    foldCounts.set(f, (foldCounts.get(f) ?? 0) + n);
  }
  const terms = [...norm.keys()].filter((w) => !w.startsWith('term'));
  const phrases = new Map<string, number>();
  for (let i = 0; i < 200_000; i++) {
    const a = terms[Math.floor(rand() * terms.length)]!;
    const b = terms[Math.floor(rand() * terms.length)]!;
    phrases.set(`${a} ${b}`, 1 + Math.floor(rand() * 5));
  }
  const ctx = fakeContextFromCounts(
    new Map([
      ['norm', norm],
      ['fold', foldCounts],
    ]),
    new Map([['norm', phrases]]),
    10_000,
  );
  const query = 'giu chan khach hang ban hang online ke hoach chien luoc duong pho';

  it('has a 50,000-term vocabulary and a 12-syllable query', () => {
    expect(norm.size).toBe(50_000);
    expect(query.split(' ').filter((w) => isPossibleFoldedSyllable(w))).toHaveLength(12);
  });

  it('cold (fresh pack, empty caches) under 20 ms', () => {
    const pack = createPack();
    const ms = once(() => pack.analyzeQuery(query, ctx));
    console.log(`analyzeQuery 12 syllables cold: ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(20 * PERF_FACTOR);
  });

  it('after an index change (caches reset) under 20 ms, warm well below', () => {
    const pack = createPack();
    pack.analyzeQuery(query, ctx);
    ctx.bump();
    const afterWrite = once(() => pack.analyzeQuery(query, ctx));
    const warm = bestOf(5, () => pack.analyzeQuery(query, ctx));
    console.log(
      `analyzeQuery 12 syllables after write: ${afterWrite.toFixed(2)} ms, warm: ${warm.toFixed(3)} ms`,
    );
    expect(afterWrite).toBeLessThan(20 * PERF_FACTOR);
    expect(warm).toBeLessThan(5 * PERF_FACTOR);
  });
});
