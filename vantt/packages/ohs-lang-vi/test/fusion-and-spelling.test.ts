import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import type { Candidate, QueryAnalysis } from '../src/contract.js';
import { fold, iyCanonical, iyVariant } from '../src/fold.js';
import { createPack } from '../src/index.js';
import { isCommon, MIN_COMMON_DOCS, resolveOptions } from '../src/options.js';
import type { ViAnalysisData } from '../src/query.js';
import { bm25Agreement, evidenceIn, weakBm25Penalty } from '../src/rescore.js';
import { FUNCTION_WORDS } from '../src/segment-query.js';
import { fakeContext } from './fake-context.js';

function analyze(query: string, docs: readonly string[], raw: Record<string, unknown> = {}, vaultPath?: string): QueryAnalysis {
  const ctx = fakeContext(docs, resolveOptions(raw));
  return createPack(raw).analyzeQuery(query, vaultPath ? { ...ctx, vaultPath } : ctx) as QueryAnalysis;
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
    for (const word of ['tay', 'tai', 'y', 'ý', 'kim', 'đi', 'kỹ năng']) expect(iyVariant(word)).toBeNull();
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
    expect(evidenceIn('Rèn kỹ năng nói', ['kĩ', 'năng'], options)).toEqual(evidenceIn('Rèn kĩ năng nói', ['kĩ', 'năng'], options));
  });

  it('rescore never finds a phrase across the title and snippet boundary', () => {
    const options = resolveOptions();
    expect(evidenceIn(['Ghi chép bán', 'hàng tồn kho'], ['bán', 'hàng'], options)).toEqual({ coverage: 1, bigrams: 0, phrase: 0 });
    expect(evidenceIn(['Ghi chép', 'bán hàng tồn kho'], ['bán', 'hàng'], options).phrase).toBe(1);
  });

  it('adds the other spelling the vault has to the fold and norm queries as an exact term', () => {
    const docs = ['Rèn kĩ năng mềm', 'Kĩ thuật nấu ăn', 'Ghi chú khác'];
    const accented = analyze('kỹ năng mềm', docs, { accentedFold: 'always' });
    expect(accented.viewTerms?.fold).toEqual([{ text: 'ky', prefix: true }, { text: 'nang', prefix: true }, { text: 'mem', prefix: true }, 'ki']);
    const plain = analyze('ky nang', docs);
    expect(plain.viewTerms?.fold).toContain('ki');
    // foldIY merges the spellings in the index already; a vault without the other spelling adds nothing
    expect(analyze('kỹ năng mềm', docs, { accentedFold: 'always', foldIY: true }).viewTerms?.fold).toBeUndefined();
    expect(analyze('kỹ năng mềm', ['Ghi chú khác'], { accentedFold: 'always' }).viewTerms).toBeUndefined();
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
    expect(analyze(query, typedPlain).viewQueries.fold).toBe('cach chon giay chay bo cho nguoi moi');
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
    const docs = [...filler(30, 'Gặp khách hàng ở quán'), 'Danh sách khách hàng tiềm năng', 'Ghi chú khác', ...filler(60)];
    const a = analyze('khách hàng tiềm năng', docs);
    expect(a.viewQueries.seg).toBe('tiềm_năng');
    expect(analyze('khách hàng tiềm năng', docs, { segMaxDocShare: 1 }).viewQueries.seg).toBe('khách_hàng tiềm_năng');
  });

  it('weights the seg branch by the share of the query its compounds cover', () => {
    const docs = ['Chọn giày chạy bộ cho người mới', 'Ghi chú khác'];
    const a = analyze('chọn giày chạy bộ', docs);
    expect(a.viewQueries.seg).toBe('chạy_bộ');
    expect(a.viewWeights?.seg).toBeCloseTo(0.5);
    expect(analyze('chọn giày chạy bộ', docs, { segWeightByCoverage: false }).viewWeights?.seg).toBeUndefined();
  });
});

describe('abbreviations with a common expansion', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ohs-abbr-'));
  mkdirSync(join(dir, '_ohs'));
  writeFileSync(join(dir, '_ohs', 'lexicon.md'), '## Viết tắt\n\nKH = khách hàng\n');
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('stays a rescore target but leaves the view queries when the phrase is common', () => {
    const common = [...filler(30, 'Gặp khách hàng ở quán'), 'Danh sách khách hàng tiềm năng', ...filler(60)];
    const a = analyze('KH tiềm năng', common, {}, dir);
    expect(a.viewQueries.norm ?? '').not.toContain('khách');
    expect((a.data as ViAnalysisData).targets.some((t) => t.words.join(' ') === 'khách hàng tiềm năng')).toBe(true);
    const rare = ['Danh sách khách hàng tiềm năng', ...filler(60)];
    expect(analyze('KH tiềm năng', rare, {}, dir).viewQueries.norm).toContain('khách hàng');
    expect(analyze('KH tiềm năng', common, { abbrMaxDocShare: 1 }, dir).viewQueries.norm).toContain('khách hàng');
  });
});

describe('weak BM25 votes in hybrid fusion', () => {
  const options = resolveOptions();
  const candidate = (path: string, score: number, rank: Record<string, number | null>): Candidate => ({
    path,
    score,
    title: path,
    snippet: '',
    matchedViews: [],
    rank: { semantic: null, bm25: null, alias: null, title: null, ...rank },
  });
  const analysis: QueryAnalysis = { viewQueries: {} };

  it('measures how many BM25 top results the semantic branch agrees with', () => {
    expect(bm25Agreement([candidate('a', 1, { bm25: 1, semantic: 3 }), candidate('b', 1, { bm25: 2 })])).toBe(0.5);
    expect(bm25Agreement([candidate('a', 1, { bm25: 1 })])).toBeNull(); // no semantic branch
    expect(bm25Agreement([candidate('a', 1, { semantic: 1 })])).toBeNull(); // no BM25 branch
  });

  it('drops BM25 votes when BM25 and semantic disagree, and only those', () => {
    const answer = candidate('answer.md', 0.2, { semantic: 1 });
    const junk = candidate('junk.md', 0.35, { semantic: 16, bm25: 1, 'view:seg': 2 });
    const penalty = weakBm25Penalty([answer, junk], analysis, options);
    expect(penalty[0]).toBe(0);
    // BM25 rank 1 counted 1.5/61 of a best possible (1.5 + 1.5 + 1) / 61
    expect(penalty[1]).toBeCloseTo(1.5 / 61 / (4 / 61));
    expect(junk.score - penalty[1]!).toBeLessThan(answer.score);
  });

  it('keeps every vote when BM25 agrees, when off, and for non-Vietnamese queries', async () => {
    const agreeing = [candidate('a.md', 0.9, { semantic: 2, bm25: 1 }), candidate('b.md', 0.4, { bm25: 2 })];
    expect(weakBm25Penalty(agreeing, analysis, options)).toEqual([0, 0]);
    const disagreeing = [candidate('a.md', 0.2, { semantic: 1 }), candidate('b.md', 0.4, { bm25: 1 })];
    expect(weakBm25Penalty(disagreeing, analysis, resolveOptions({ minBm25Agreement: 0 }))).toEqual([0, 0]);
    const pack = createPack();
    const english = pack.analyzeQuery('quarterly sales plan', fakeContext(['Quarterly sales plan', 'Other']));
    const out = await pack.rescore!(disagreeing, await english, fakeContext(['Quarterly sales plan']));
    expect(out.map((c) => c.score)).toEqual(
      (await createPack({ minBm25Agreement: 0 }).rescore!(disagreeing, await english, fakeContext(['Quarterly sales plan']))).map((c) => c.score),
    );
  });

  it('never adds or drops candidates and only lowers BM25-voted scores (fast-check)', () => {
    const rank = fc.option(fc.integer({ min: 1, max: 40 }), { nil: null });
    fc.assert(
      fc.property(
        fc.array(fc.record({ score: fc.double({ min: 0, max: 1, noNaN: true }), semantic: rank, bm25: rank, seg: rank }), { maxLength: 25 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (rows, threshold) => {
          const candidates = rows.map((r, i) => candidate(`${i}.md`, r.score, { semantic: r.semantic, bm25: r.bm25, 'view:seg': r.seg }));
          const penalty = weakBm25Penalty(candidates, analysis, resolveOptions({ minBm25Agreement: threshold }));
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
