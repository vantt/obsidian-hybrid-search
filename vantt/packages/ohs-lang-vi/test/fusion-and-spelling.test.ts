import fc from 'fast-check';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Candidate, QueryAnalysis } from '../src/contract.js';
import { fold, iyCanonical, iyVariant } from '../src/fold.js';
import { createPack } from '../src/index.js';
import { isCommon, MIN_COMMON_DOCS, resolveOptions } from '../src/options.js';
import type { ViAnalysisData } from '../src/query.js';
import { bm25Agreement, evidenceIn, weakBm25Penalty } from '../src/rescore.js';
import { FUNCTION_WORDS } from '../src/segment-query.js';
import { fakeContext } from './fake-context.js';

function analyze(
  query: string,
  docs: readonly string[],
  raw: Record<string, unknown> = {},
  vaultPath?: string,
): QueryAnalysis {
  const ctx = fakeContext(docs, resolveOptions(raw));
  return createPack(raw).analyzeQuery(
    query,
    vaultPath ? { ...ctx, vaultPath } : ctx,
  ) as QueryAnalysis;
}

/** `count` filler notes that share nothing with the queries below. */
const filler = (count: number, text = 'Ghi chép linh tinh về thời tiết') =>
  Array.from({ length: count }, (_, i) => `${text} số ${i}`);

describe('i/y spellings', () => {
  it('pairs the two spellings after an i/y onset, keeping the tone', () => {
    expect(iyVariant('kĩ')).toBe('kỹ');
    expect(iyVariant('kỹ')).toBe('kĩ');
    expect(iyVariant('lý')).toBe('lí');
    expect(iyVariant('quý')).toBe('quí');
    expect(iyVariant('ky')).toBe('ki');
    for (const word of ['tay', 'tai', 'y', 'ý', 'kim', 'đi', 'kỹ năng'])
      expect(iyVariant(word)).toBeNull();
    expect(iyCanonical('kỹ')).toBe('kĩ');
    expect(iyCanonical('kĩ')).toBe('kĩ');
    expect(iyCanonical('tay')).toBe('tay');
  });

  it('variant is an involution that foldIY merges, canonical is idempotent (fast-check)', () => {
    const onset = fc.constantFrom('k', 'l', 'm', 't', 's', 'h', 'v', 'd', 'qu');
    const vowel = fc.constantFrom(...'iíìỉĩịyýỳỷỹỵ');
    fc.assert(
      fc.property(onset, vowel, (o, v) => {
        const word = o + v;
        const other = iyVariant(word)!;
        expect(other).not.toBe(word);
        expect(iyVariant(other)).toBe(word);
        expect(fold(other, { foldIY: true })).toBe(fold(word, { foldIY: true }));
        expect(iyCanonical(other)).toBe(iyCanonical(word));
        expect(iyCanonical(iyCanonical(word))).toBe(iyCanonical(word));
      }),
    );
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 6 }), (word) => {
        const other = iyVariant(word);
        if (other !== null) expect(iyVariant(other)).toBe(word);
        else expect(iyCanonical(word)).toBe(word);
      }),
    );
  });

  it('rescore evidence prefers neither spelling of the query', () => {
    const options = resolveOptions();
    expect(evidenceIn('Rèn kỹ năng nói', ['kĩ', 'năng'], options)).toEqual(
      evidenceIn('Rèn kĩ năng nói', ['kĩ', 'năng'], options),
    );
  });

  it('rescore never finds a phrase across the title and snippet boundary', () => {
    const options = resolveOptions();
    expect(evidenceIn(['Ghi chép bán', 'hàng tồn kho'], ['bán', 'hàng'], options)).toEqual({
      coverage: 1,
      bigrams: 0,
      phrase: 0,
    });
    expect(evidenceIn(['Ghi chép', 'bán hàng tồn kho'], ['bán', 'hàng'], options).phrase).toBe(1);
  });

  it('adds the other spelling the vault has: toned as an exact term, toneless as a phrase', () => {
    const docs = ['Rèn kĩ năng mềm', 'Kĩ thuật nấu ăn', 'Ghi chú khác'];
    const accented = analyze('kỹ năng mềm', docs, { accentedFold: 'always' });
    // the fold view has no tones: "ki" alone would match every kì/kí/kỉ/kị note
    expect(accented.viewTerms?.fold).toEqual([
      { text: 'ky', prefix: true },
      { text: 'nang', prefix: true },
      { text: 'mem', prefix: true },
      'ki nang',
    ]);
    const plain = analyze('ky nang', docs);
    expect(plain.viewTerms?.fold).toContain('ki nang');
    expect(plain.viewTerms?.fold).not.toContain('ki');
    const toned = analyze('kỹ năng', docs, { accentedNorm: true });
    expect(toned.viewTerms?.norm).toContain('kĩ');
    // foldIY merges the spellings in the index already; a vault without the other spelling adds nothing
    expect(
      analyze('kỹ năng mềm', docs, { accentedFold: 'always', foldIY: true }).viewTerms?.fold,
    ).toBeUndefined();
    expect(
      analyze('kỹ năng mềm', ['Ghi chú khác'], { accentedFold: 'always' }).viewTerms,
    ).toBeUndefined();
  });

  it('never adds a toneless i/y spelling as a word of its own (mi/my, ty/ti)', () => {
    const docs = [
      'Uốn mi cong tự nhiên',
      'My plan for the week: my errands and my calls',
      ...filler(5, 'Công ty đang lên kế hoạch'),
    ];
    for (const query of ['uon mi cong', 'lông mi cong', 'sua ti vi']) {
      const a = analyze(query, docs, { accentedFold: 'always' });
      for (const view of ['norm', 'fold']) {
        const terms = a.viewTerms?.[view] ?? [];
        for (const t of terms) if (typeof t === 'string') expect(t.split(' ')).toHaveLength(2);
        expect(terms).not.toContain('my');
        expect(terms).not.toContain('ty');
      }
    }
  });

  it('view terms are the query words plus i/y variants of the target words (fast-check)', () => {
    const syllable = fc.constantFrom(
      'kĩ',
      'kỹ',
      'ky',
      'ki',
      'lý',
      'li',
      'mi',
      'ty',
      'năng',
      'thuật',
      'công',
      'do',
    );
    const docs = [
      'Rèn kĩ năng mềm',
      'Kỹ thuật cơ bản',
      'Lí do nghỉ',
      'Công ty mới',
      'my plan',
      'lông mi',
    ];
    const ctx = fakeContext(docs);
    const pack = createPack();
    fc.assert(
      fc.property(fc.array(syllable, { minLength: 1, maxLength: 5 }), (words) => {
        const a = pack.analyzeQuery(words.join(' '), ctx) as QueryAnalysis;
        const data = a.data as ViAnalysisData;
        for (const view of ['norm', 'fold'] as const) {
          const terms = a.viewTerms?.[view];
          if (!terms) continue;
          const queryWords = a.viewQueries[view]!.split(' ');
          const sequence = view === 'norm' ? data.target : data.targetFolded;
          const variants = new Set(sequence.map((w) => iyVariant(w)).filter(Boolean));
          for (const t of terms) {
            if (typeof t !== 'string') {
              expect(queryWords).toContain(t.text);
              continue;
            }
            const parts = t.split(' ');
            expect(parts.some((p) => variants.has(p))).toBe(true);
            // a single-word variant carries a tone; toneless ones come with a neighbour
            if (parts.length === 1) expect(t).toMatch(/[íìỉĩịýỳỷỹỵ]$/u);
            else expect(parts).toHaveLength(2);
          }
        }
      }),
      { numRuns: 300 },
    );
  });

  it('adds the other spelling of a compound to the seg query', () => {
    const seg = analyze('kỹ năng', ['Rèn kĩ năng mềm', 'Ghi chú khác']).viewQueries.seg!.split(' ');
    expect(seg).toContain('kỹ_năng');
    expect(seg).toContain('kĩ_năng');
  });
});

describe('accentedFold auto', () => {
  const query = 'cách chọn giày chạy bộ cho người mới';
  it('needs a share of the query pairs typed without diacritics, not any one pair', () => {
    const onePair = ['ghi chu: cho nguoi khac muon', 'Chọn giày chạy bộ'];
    expect(analyze(query, onePair).viewQueries.fold).toBeNull();
    expect(analyze(query, onePair, { accentedFoldMinShare: 0 }).viewQueries.fold).not.toBeNull();
    const typedPlain = ['cach chon giay chay bo cho nguoi moi bat dau'];
    expect(analyze(query, typedPlain).viewQueries.fold).toBe(
      'cach chon giay chay bo cho nguoi moi',
    );
  });
});

describe('seg query filters', () => {
  it('skips compounds made only of function words', () => {
    expect([...FUNCTION_WORDS].every((w) => w === w.toLowerCase())).toBe(true);
    const docs = ['Vì vậy chọn giày chạy bộ', 'Ghi chú khác'];
    const seg = analyze('vì vậy chọn giày chạy bộ', docs).viewQueries.seg ?? '';
    expect(seg).not.toContain('vì_vậy');
    expect(seg).toContain('chạy_bộ');
  });

  it('skips compounds that are common in the vault, only past MIN_COMMON_DOCS notes', () => {
    expect(isCommon(MIN_COMMON_DOCS - 1, MIN_COMMON_DOCS, 0.1)).toBe(false);
    expect(isCommon(MIN_COMMON_DOCS, MIN_COMMON_DOCS * 2, 0.1)).toBe(true);
    expect(isCommon(1000, 1000, 1)).toBe(false);
    const docs = [
      ...filler(30, 'Gặp khách hàng ở quán'),
      'Danh sách khách hàng tiềm năng',
      'Ghi chú khác',
      ...filler(60),
    ];
    const a = analyze('khách hàng tiềm năng', docs);
    expect(a.viewQueries.seg).toBe('tiềm_năng');
    expect(analyze('khách hàng tiềm năng', docs, { segMaxDocShare: 1 }).viewQueries.seg).toBe(
      'khách_hàng tiềm_năng',
    );
  });

  it('weights the seg branch by the share of the query its compounds cover (opt-in)', () => {
    const docs = ['Chọn giày chạy bộ cho người mới', 'Ghi chú khác'];
    const a = analyze('chọn giày chạy bộ', docs, { segWeightByCoverage: true });
    expect(a.viewQueries.seg).toBe('chạy_bộ');
    expect(a.viewWeights?.seg).toBeCloseTo(0.5);
    expect(analyze('chọn giày chạy bộ', docs).viewWeights?.seg).toBeUndefined();
  });
});

describe('abbreviations with a common expansion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ohs-abbr-'));
  mkdirSync(join(dir, '_ohs'));
  writeFileSync(join(dir, '_ohs', 'lexicon.md'), '## Viết tắt\n\nKH = khách hàng\n');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('stays a rescore target but leaves the view queries when the phrase is common', () => {
    const common = [
      ...filler(30, 'Gặp khách hàng ở quán'),
      'Danh sách khách hàng tiềm năng',
      ...filler(60),
    ];
    const a = analyze('KH tiềm năng', common, {}, dir);
    expect(a.viewQueries.norm ?? '').not.toContain('khách');
    expect(
      (a.data as ViAnalysisData).targets.some((t) => t.words.join(' ') === 'khách hàng tiềm năng'),
    ).toBe(true);
    const rare = ['Danh sách khách hàng tiềm năng', ...filler(60)];
    expect(analyze('KH tiềm năng', rare, {}, dir).viewQueries.norm).toContain('khách hàng');
    expect(analyze('KH tiềm năng', common, { abbrMaxDocShare: 1 }, dir).viewQueries.norm).toContain(
      'khách hàng',
    );
  });
});

describe('weak BM25 votes in hybrid fusion', () => {
  const options = resolveOptions();
  const candidate = (
    path: string,
    score: number,
    rank: Record<string, number | null>,
  ): Candidate => ({
    path,
    score,
    title: path,
    snippet: '',
    matchedViews: [],
    rank: { semantic: null, bm25: null, alias: null, title: null, ...rank },
  });
  const analysis: QueryAnalysis = { viewQueries: { norm: 'tìm' } };

  it('measures how many BM25 top results the semantic branch agrees with', () => {
    expect(
      bm25Agreement([candidate('a', 1, { bm25: 1, semantic: 3 }), candidate('b', 1, { bm25: 2 })]),
    ).toBe(0.5);
    expect(bm25Agreement([candidate('a', 1, { bm25: 1 })])).toBeNull(); // no semantic branch
    expect(bm25Agreement([candidate('a', 1, { semantic: 1 })])).toBeNull(); // no BM25 branch
  });

  /** BM25 ranks 2..5 for notes the semantic branch does not have. */
  const moreBm25 = [2, 3, 4, 5].map((r) => candidate(`bm25-${r}.md`, 0.1, { bm25: r }));

  it('drops BM25 votes when BM25 and semantic disagree, and only those', () => {
    const answer = candidate('answer.md', 0.2, { semantic: 1 });
    const junk = candidate('junk.md', 0.35, { semantic: 16, bm25: 1, 'view:seg': 2 });
    const penalty = weakBm25Penalty([answer, junk, ...moreBm25], analysis, options);
    expect(penalty[0]).toBe(0);
    // BM25 rank 1 counted 1.5/61 of a best possible (1.5 + 1.5 + 1) / 61
    expect(penalty[1]).toBeCloseTo(1.5 / 61 / (4 / 61));
    expect(junk.score - penalty[1]!).toBeLessThan(answer.score);
  });

  it('keeps the BM25 votes of a short BM25 list or of a query with an identifier', async () => {
    const answer = candidate('answer.md', 0.2, { semantic: 1 });
    const exact = candidate('exact.md', 0.35, { semantic: 16, bm25: 1, 'view:seg': 2 });
    // one BM25 hit: an agreement of 0/1 says nothing
    expect(weakBm25Penalty([answer, exact], analysis, options)).toEqual([0, 0]);
    // an identifier the vectors do not know: its exact BM25 match keeps the vote
    const docs = ['Lỗi ECONNRESET khi gọi máy chủ đối tác', ...filler(10, 'Máy chủ chạy chậm')];
    const ctx = fakeContext(docs);
    const pack = createPack();
    const list = [answer, exact, ...moreBm25];
    const scores = async (query: string) =>
      (await pack.rescore!(list, await pack.analyzeQuery(query, ctx), ctx)).map((c) => c.score);
    const withId = await scores('lỗi ECONNRESET khi gọi máy chủ');
    const plain = await scores('lỗi kết nối khi gọi máy chủ');
    // same evidence for the exact note either way ("lỗi", "máy chủ" are in neither title); only the plain query loses BM25 votes
    expect(withId[1]! - plain[1]!).toBeGreaterThan(0);
  });

  it('keeps every vote when BM25 agrees, when off, and for non-Vietnamese queries', async () => {
    const agreeing = [
      candidate('a.md', 0.9, { semantic: 2, bm25: 1 }),
      candidate('b.md', 0.4, { bm25: 2 }),
    ];
    expect(weakBm25Penalty(agreeing, analysis, options)).toEqual([0, 0]);
    const allAgree = [1, 2, 3, 4, 5].map((r) =>
      candidate(`${r}.md`, 0.5, { semantic: r, bm25: r }),
    );
    expect(weakBm25Penalty(allAgree, analysis, options)).toEqual([0, 0, 0, 0, 0]);
    const disagreeing = [
      candidate('a.md', 0.2, { semantic: 1 }),
      candidate('b.md', 0.4, { bm25: 1 }),
      ...moreBm25,
    ];
    expect(weakBm25Penalty(disagreeing, analysis, options)[1]).toBeGreaterThan(0);
    expect(weakBm25Penalty(disagreeing, analysis, resolveOptions({ minBm25Agreement: 0 }))).toEqual(
      new Array(6).fill(0),
    );
    const pack = createPack();
    const english = pack.analyzeQuery(
      'quarterly sales plan',
      fakeContext(['Quarterly sales plan', 'Other']),
    );
    const out = await pack.rescore!(
      disagreeing,
      await english,
      fakeContext(['Quarterly sales plan']),
    );
    expect(out.map((c) => c.score)).toEqual(
      (
        await createPack({ minBm25Agreement: 0 }).rescore!(
          disagreeing,
          await english,
          fakeContext(['Quarterly sales plan']),
        )
      ).map((c) => c.score),
    );
  });

  it('never adds or drops candidates and only lowers BM25-voted scores (fast-check)', () => {
    const rank = fc.option(fc.integer({ min: 1, max: 40 }), { nil: null });
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            score: fc.double({ min: 0, max: 1, noNaN: true }),
            semantic: rank,
            bm25: rank,
            seg: rank,
          }),
          { maxLength: 25 },
        ),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (rows, threshold) => {
          const candidates = rows.map((r, i) =>
            candidate(`${i}.md`, r.score, {
              semantic: r.semantic,
              bm25: r.bm25,
              'view:seg': r.seg,
            }),
          );
          const penalty = weakBm25Penalty(
            candidates,
            analysis,
            resolveOptions({ minBm25Agreement: threshold }),
          );
          expect(penalty).toHaveLength(candidates.length);
          penalty.forEach((p, i) => {
            expect(Number.isFinite(p)).toBe(true);
            expect(p).toBeGreaterThanOrEqual(0);
            if (candidates[i]!.rank.bm25 === null) expect(p).toBe(0);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('query analysis bookkeeping', () => {
  it('drops the seg branch when no compound of the query is in the vault', () => {
    const a = analyze('chạy bộ buổi sáng', ['Ghi chú khác', 'Nấu cơm']);
    expect(a.viewQueries.seg).toBeNull();
    const b = analyze('chạy bộ buổi sáng', ['Chạy bộ quanh hồ', 'Ghi chú khác']);
    expect(b.viewQueries.seg).toContain('chạy_bộ');
    expect(b.debug?.segWeight).toBeGreaterThan(0);
  });

  it('credits the coverage of a compound the vault has only in the other i/y spelling', () => {
    const a = analyze('kỹ năng mềm', ['Rèn kĩ năng mềm', 'Ghi chú khác']);
    expect(a.viewQueries.seg?.split(' ')).toContain('kĩ_năng');
    expect(a.debug?.segCoverage).toBeGreaterThan(0);
  });

  it('stops the unaccented-pair lookups once the answer is known', () => {
    const query = 'chọn giày chạy bộ cho người mới bắt đầu tập';
    const docs = ['chon giay chay bo cho nguoi moi bat dau tap'];
    const lookups = (accentedFoldMinShare: number) => {
      const raw = { segment: false, accentedFoldMinShare };
      const ctx = fakeContext(docs, resolveOptions(raw));
      const a = createPack(raw).analyzeQuery(query, ctx) as QueryAnalysis;
      expect(a.viewQueries.fold).not.toBeNull();
      return ctx.calls.phraseDocs;
    };
    // 8 pairs, all in the vault: share 1 needs all eight lookups, share 0.5 stops after four
    expect(lookups(1) - lookups(0.5)).toBe(4);
    expect(lookups(0)).toBeLessThan(lookups(0.5));
  });

  it('reads each vault statistic once per query and again only after a write', async () => {
    const docs = ['Danh sách khách hàng tiềm năng', 'Rèn kĩ năng mềm', ...filler(30)];
    const ctx = fakeContext(docs);
    const pack = createPack();
    await pack.analyzeQuery('khach hang tiem nang ky nang', ctx);
    const first = { ...ctx.calls };
    await pack.analyzeQuery('khach hang tiem nang ky nang', ctx);
    expect(ctx.calls).toEqual(first);
    ctx.bump();
    await pack.analyzeQuery('khach hang tiem nang ky nang', ctx);
    expect(ctx.calls.termStats).toBeGreaterThan(first.termStats);
  });

  it('shows view terms, the seg weight and the fusion check in debug', async () => {
    const docs = ['Rèn kĩ năng mềm', 'Ghi chú khác'];
    const ctx = fakeContext(docs);
    const pack = createPack();
    const a = await pack.analyzeQuery('ki nang mem', ctx);
    expect(a.debug?.viewTerms).toEqual(a.viewTerms);
    expect(a.debug?.segWeight).toBeTypeOf('number');
    const c: Candidate = {
      path: 'a.md',
      score: 0.5,
      title: 'Rèn kĩ năng mềm',
      snippet: '',
      matchedViews: [],
      rank: { semantic: 1, bm25: 1 },
    };
    await pack.rescore!([c], a, ctx);
    expect(a.debug?.bm25Agreement).toBe(1);
    expect(a.debug?.bm25Penalty).toBe(0);
  });
});
