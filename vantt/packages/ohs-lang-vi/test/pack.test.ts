import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import createPackDefault, { createPack, PACK_VERSION } from '../src/index.js';
import type { Candidate, QueryAnalysis } from '../src/contract.js';
import { resolveOptions } from '../src/options.js';
import type { ViAnalysisData } from '../src/query.js';
import { tokenize } from '../src/views.js';
import { fakeContext } from './fake-context.js';
import { allSyllables, viewTokens } from './helpers.js';
import { composeSyllable } from '../src/syllable.js';
import { TONES, type Tone } from '../src/data.js';

const VAULT = [
  'Kế hoạch bán hàng online cho quý một',
  'Chiến lược bán hàng qua mạng xã hội',
  'Bạn bè và bạn hàng của công ty',
  'Bàn làm việc mới',
  'Con đường đến trường',
  'Giữ chân khách hàng thân thiết',
  'Kỹ thuật phần mềm',
];

function analyze(query: string, raw: unknown = {}, docs = VAULT): QueryAnalysis {
  const pack = createPack(raw);
  return pack.analyzeQuery(query, fakeContext(docs, resolveOptions(raw))) as QueryAnalysis;
}

describe('createPack', () => {
  it('builds a P01 v1 pack with norm, fold and seg views', () => {
    const pack = createPack();
    expect(pack.apiVersion).toBe(1);
    expect(pack.id).toBe('vi');
    expect(pack.version).toBe(PACK_VERSION);
    expect(pack.views.map((v) => v.name)).toEqual(['norm', 'fold', 'seg']);
    expect(createPack({ segment: false }).views.map((v) => v.name)).toEqual(['norm', 'fold']);
    for (const v of pack.views) expect(v.name).toMatch(/^[a-z][a-z0-9_]{0,15}$/);
    expect(typeof pack.rescore).toBe('function');
    expect(createPackDefault).toBe(createPack);
  });

  it('signature follows index-affecting options only', () => {
    const base = createPack().signature();
    expect(createPack({ tonePlacement: 'classic' }).signature()).not.toBe(base);
    expect(createPack({ foldIY: true }).signature()).not.toBe(base);
    expect(createPack({ viewWeights: { norm: 3 } }).signature()).toBe(base);
    expect(createPack({ restore: false, rescore: false }).signature()).toBe(base);
    expect(base).toContain(PACK_VERSION);
  });

  it('applies view weights and disables rescore on request', () => {
    const pack = createPack({ viewWeights: { norm: 2, fold: 0.5 }, rescore: false });
    expect(pack.views.map((v) => v.weight)).toEqual([2, 0.5, 1]);
    expect(pack.rescore).toBeUndefined();
  });

  it('rejects invalid options with a clear error', () => {
    expect(() => createPack({ tonePlacement: 'new' })).toThrow(/tonePlacement/);
    expect(() => createPack({ foldIY: 'yes' })).toThrow(/foldIY/);
    expect(() => createPack({ viewWeights: { nrom: 1 } })).toThrow(/viewWeights.nrom/);
    expect(() => createPack({ restoreParams: { maxVariants: -1 } })).toThrow(/maxVariants/);
    expect(() => createPack([])).toThrow(/object/);
    expect(() => createPack({ accentedFold: 'sometimes' })).toThrow(/accentedFold/);
    expect(() => createPack({ minSyllableShare: 2 })).toThrow(/minSyllableShare/);
    expect(() => createPack(null)).not.toThrow();
    expect(() => createPack({ telex: true, segment: false })).not.toThrow();
  });
});

describe('project', () => {
  const pack = createPack();

  it('norm keeps diacritics, lowercases and fixes the tone position', () => {
    expect(pack.project('norm', 'content', 'Hòa Bình, ĐƯỜNG Ðỏ')).toBe('hoà bình, đường đỏ');
  });

  it('fold removes diacritics and đ', () => {
    expect(pack.project('fold', 'title', 'Hòa Bình, ĐƯỜNG Ðỏ')).toBe('hoa binh, duong do');
  });

  it('fold merges i/y only with foldIY', () => {
    expect(createPack({ foldIY: true }).project('fold', 'content', 'kỹ thuật, tay')).toBe('ki thuat, tay');
    expect(pack.project('fold', 'content', 'kỹ thuật')).toBe('ky thuat');
  });

  it('keeps token boundaries when Unicode normalization would move them', () => {
    // U+1D15E is NFC-decomposed into a symbol plus a combining mark (a token
    // character for unicode61); a lone combining mark is a token that folding would delete.
    for (const t of ['a \u{1D15E} b', 'x \u0301 y', '\u0301']) {
      for (const view of ['norm', 'fold']) expect(tokenize(pack.project(view, 'content', t))).toHaveLength(tokenize(t).length);
    }
  });

  it('throws on an unknown view', () => {
    expect(() => pack.project('xyz', 'content', 'x')).toThrow(/unknown view/);
    expect(() => createPack({ segment: false }).project('seg', 'content', 'x')).toThrow(/unknown view/);
  });

  it('never changes English or code-like text beyond case', () => {
    expect(pack.project('norm', 'content', 'Online C++ team #tag')).toBe('online c++ team #tag');
    expect(pack.project('fold', 'content', 'Online C++ team #tag')).toBe('online c++ team #tag');
  });

  const syllables = allSyllables();
  const word = fc
    .tuple(fc.integer({ min: 0, max: syllables.length - 1 }), fc.constantFrom(...TONES), fc.boolean())
    .map(([i, tone, upper]) => {
      const w = composeSyllable({ ...syllables[i]!, tone: tone as Tone }, 'classic');
      return upper ? w.toUpperCase() : w;
    });
  const sep = fc.constantFrom(' ', ', ', '.\n', ' - ', '_', ' c++ ', ' #x ', ' ', '🎉', '2026');
  const text = fc.oneof(
    fc.array(fc.tuple(word, sep), { maxLength: 15 }).map((parts) => parts.map(([w, s]) => w + s).join('')),
    fc.string({ unit: 'grapheme', maxLength: 40 }),
    fc.string({ unit: 'binary', maxLength: 40 }),
  );

  it('keeps the token invariant for every view, field and index option (fast-check)', () => {
    const packs = [createPack(), createPack({ foldIY: true }), createPack({ tonePlacement: 'classic' })];
    fc.assert(
      fc.property(text, fc.constantFrom('title', 'aliases', 'content') as fc.Arbitrary<'title'>, (t, field) => {
        const source = tokenize(t);
        for (const p of packs) {
          for (const view of ['norm', 'fold']) {
            const projected = tokenize(p.project(view, field, t));
            expect(projected.length).toBe(source.length);
            // Same count with an independent emulation of the view tokenizer (tokenchars '+#').
            expect(viewTokens(p.project(view, field, t))).toHaveLength(viewTokens(t).length);
            projected.forEach((tok, k) => {
              // token k of the view is the projection of source token k
              expect(tok.toLowerCase()).toBe(p.project(view, field, source[k]!).toLowerCase());
            });
          }
        }
      }),
      { numRuns: Number(process.env.FC_NUM_RUNS ?? 400) },
    );
  });

  it('keeps the token invariant when a combining mark is glued to + or #', () => {
    // A combining mark next to `#` is one token ("\u0338#"); fold drops the
    // mark and must leave "#" (still one token), never an empty token.
    const packs = [createPack(), createPack({ foldIY: true }), createPack({ tonePlacement: 'classic' })];
    for (const t of ['↚#', '\u2190\u0338#', '\u0301#', 'a\u0301+', '#\u0300', 'x ↚# y', 'c\u0338++']) {
      for (const p of packs) {
        for (const view of ['norm', 'fold']) {
          const out = p.project(view, 'title', t);
          expect(viewTokens(out)).toHaveLength(viewTokens(t).length);
          expect(tokenize(out)).toHaveLength(tokenize(t).length);
        }
      }
    }
    expect(createPack().project('fold', 'title', '\u2190\u0338#')).toBe('\u2190#');
  });

  it('is pure and deterministic', () => {
    fc.assert(
      fc.property(text, (t) => {
        expect(pack.project('norm', 'content', t)).toBe(pack.project('norm', 'content', t));
        expect(pack.project('fold', 'content', t)).toBe(pack.project('fold', 'content', pack.project('norm', 'content', t)));
      }),
      { numRuns: 200 },
    );
  });
});

describe('analyzeQuery', () => {
  const BOTH = { accentedNorm: true, accentedFold: 'always' };

  it('accented query, both views on: norm is the normalized query, fold the folded one, no restoration', () => {
    const a = analyze('Giữ chân khách hàng', BOTH);
    expect(a.viewQueries).toEqual({ norm: 'giữ chân khách hàng', fold: 'giu chan khach hang', seg: 'giữ_chân khách_hàng' });
    expect(a.embedQuery).toBeUndefined();
    expect(a.baseQuery).toBeUndefined();
    expect((a.data as ViAnalysisData).accented).toBe(true);
    expect((a.data as ViAnalysisData).target).toEqual(['giữ', 'chân', 'khách', 'hàng']);
  });

  it('accented query, defaults: no view branch unless the vault has the words typed unaccented', () => {
    const a = analyze('Giữ chân khách hàng');
    expect(a.viewQueries).toEqual({ norm: null, fold: null, seg: 'giữ_chân khách_hàng' });
    expect((a.data as ViAnalysisData).target).toEqual(['giữ', 'chân', 'khách', 'hàng']);
    const typedPlain = analyze('Giữ chân khách hàng', {}, [...VAULT, 'ghi chu: giu chan khach cu']);
    expect(typedPlain.viewQueries).toEqual({ norm: null, fold: 'giu chan khach hang', seg: 'giữ_chân khách_hàng' });
    expect(analyze('khách', {}, [...VAULT, 'khach moi']).viewQueries.fold).toBe('khach');
    expect(analyze('Giữ chân khách hàng', { accentedFold: 'never' }, [...VAULT, 'giu chan khach']).viewQueries.fold).toBeNull();
  });

  it('accented query with classic tone placement normalizes to the index style', () => {
    expect(analyze('hòa bình', BOTH).viewQueries.norm).toBe('hoà bình');
  });

  it('unaccented query: norm is the restoration from the vault', () => {
    const a = analyze('giu chan khach hang');
    expect(a.viewQueries.norm).toBe('giữ chân khách hàng');
    expect(a.viewQueries.fold).toBe('giu chan khach hang');
    expect((a.data as ViAnalysisData).accented).toBe(false);
    expect((a.debug as { restore: unknown }).restore).toBeDefined();
  });

  it('restores đ: "con duong" -> "con đường"', () => {
    expect(analyze('con duong').viewQueries.norm).toBe('con đường');
  });

  it('keeps English words: "ban hang online"', () => {
    const a = analyze('ban hang online');
    expect(a.viewQueries.norm?.split(' ')[0]).toBe('bán');
    expect(a.viewQueries.norm?.split(' ')).toContain('online');
    expect(a.viewQueries.fold).toBe('ban hang online');
  });

  it('adds close alternatives to the norm query', () => {
    const a = analyze('ban hang', { restoreParams: { alternativeThreshold: 0.01 } });
    const words = a.viewQueries.norm!.split(' ');
    expect(words).toEqual(expect.arrayContaining(['bán', 'bạn', 'hàng']));
  });

  it('partially accented query restores the rest', () => {
    const a = analyze('giữ chan khach');
    expect(a.viewQueries.norm).toBe('giữ chân khách');
    expect(a.viewQueries.fold).toBe('giu chan khach');
  });

  it('nothing to restore and no diacritics: both view branches are skipped', () => {
    expect(analyze('online meeting').viewQueries).toEqual({ norm: null, fold: null, seg: null });
    expect(analyze('xyz', {}, []).viewQueries.norm).toBeNull();
  });

  it('English query without Vietnamese evidence leaves the pack inert', () => {
    const docs = [...VAULT, 'How to install plugins', 'Go to the settings'];
    expect(analyze('how to install plugins', {}, docs).viewQueries).toEqual({ norm: null, fold: null, seg: null });
    // "to" has an accented form in this vault ("tô"), so it is Vietnamese evidence
    // once enough of the query is made of syllables.
    expect(analyze('how to install', {}, [...docs, 'bát tô lớn']).viewQueries.fold).toBeNull();
    expect(analyze('to install', {}, [...docs, 'bát tô lớn']).viewQueries.fold).toBe('to install');
  });

  it('Telex keystrokes with few real syllables leave the pack inert (minSyllableShare)', () => {
    const docs = [...VAULT, 'chân dung', 'sử dụng'];
    expect(analyze('bis quyeets chupj anhr chaan dung', {}, docs).viewQueries).toEqual({ norm: null, fold: null, seg: null });
    expect(analyze('bis quyeets chupj anhr chaan dung', { minSyllableShare: 0 }, docs).viewQueries.fold).not.toBeNull();
  });

  it('restore: false never restores', () => {
    expect(analyze('giu chan khach hang', { restore: false }).viewQueries.norm).toBeNull();
  });

  it('empty or punctuation-only query skips both views', () => {
    expect(analyze('  ?! ').viewQueries).toEqual({ norm: null, fold: null, seg: null });
  });

  it('foldIY folds the fold-view query too', () => {
    expect(analyze('kĩ thuật', { ...BOTH, foldIY: true }).viewQueries.fold).toBe('ki thuat');
  });

  it('restoreForEmbedding sends the restored text (punctuation kept) when confident', () => {
    const a = analyze('Giu chan, khach hang!', { restoreForEmbedding: true, embedMinConfidence: 0 });
    expect(a.embedQuery).toBe('giữ chân, khách hàng!');
    expect(analyze('giu chan khach hang', { restoreForEmbedding: false }).embedQuery).toBeUndefined();
    expect(analyze('giu chan khach hang').embedQuery).toBe('giữ chân khách hàng'); // on by default
  });

  describe('restoreForEmbedding on a partially accented query', () => {
    const NAMES = [
      'Phố cổ Hội An mùa đèn lồng',
      'Hội An có nhiều quán ăn ngon',
      'Ăn sáng ở phố cổ',
      'Em ăn cơm với ăn canh',
      'Ăn vặt ở chợ đêm',
      'Ẩn dụ trong thơ',
    ];
    const on = { restoreForEmbedding: true, embedMinConfidence: 0 };

    it('keeps typed words and does not restore the proper name "An"', () => {
      const a = analyze('Hội An', on, NAMES);
      expect((a.debug as { accented: boolean }).accented).toBe(false); // exactly 50% is not "more than 50%"
      expect(a.embedQuery).toBeUndefined();
    });

    it('restores unaccented words the vault never writes bare, keeps typed accents', () => {
      const a = analyze('Hội an nhieu quan', on, NAMES);
      expect((a.debug as { accented: boolean }).accented).toBe(false);
      expect(a.embedQuery).toBe('hội an nhiều quán');
    });

    it('does not restore a word below the confidence threshold', () => {
      const a = analyze('Hội an nhieu quan', { restoreForEmbedding: true, embedMinConfidence: 1 }, NAMES);
      expect(a.embedQuery).toBeUndefined();
    });
  });
});

describe('rescore', () => {
  const pack = createPack();
  function candidate(path: string, score: number, snippet: string, rank: Record<string, number | null> = {}): Candidate {
    return { path, score, title: path, snippet, matchedViews: [], rank };
  }

  it('never drops or adds candidates and boosts the accent-exact phrase', async () => {
    const analysis = analyze('bán hàng');
    const candidates = [
      candidate('ban-hang-decoy.md', 0.05, 'Bạn hàng của công ty'),
      candidate('ban-hang.md', 0.04, 'Kế hoạch bán hàng online'),
      candidate('other.md', 0.03, 'Không liên quan'),
    ];
    const out = await pack.rescore!(candidates, analysis, fakeContext(VAULT));
    expect(out.map((c) => c.path).sort()).toEqual(candidates.map((c) => c.path).sort());
    const score = Object.fromEntries(out.map((c) => [c.path, c.score]));
    expect(score['ban-hang.md']).toBeGreaterThan(score['ban-hang-decoy.md']!);
    expect(score['other.md']).toBe(0.03);
  });

  it('scales the bonus by restoration confidence for unaccented queries', async () => {
    const analysis = analyze('ban hang');
    const out = await pack.rescore!([candidate('a.md', 0.01, 'bán hàng'), candidate('b.md', 0.02, 'nothing')], analysis, fakeContext(VAULT));
    expect(out[0]!.score).toBeGreaterThan(0.01);
    expect(out[1]!.score).toBe(0.02);
  });

  it('passes scores through when the analysis carries no pack data', async () => {
    const out = await pack.rescore!([candidate('a.md', 0.5, 'bán hàng')], { viewQueries: {} }, fakeContext(VAULT));
    expect(out).toEqual([{ path: 'a.md', score: 0.5 }]);
  });

  it('keeps the candidate set for arbitrary inputs (fast-check)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.string(), fc.double({ min: 0, max: 1, noNaN: true }), fc.string({ unit: 'grapheme' })), { maxLength: 20 }),
        fc.string({ unit: 'grapheme', maxLength: 30 }),
        (rows, query) => {
          const candidates = rows.map(([p, s, snip], i) => candidate(`${i}${p}`, s, snip));
          const out = pack.rescore!(candidates, analyze(query), fakeContext(VAULT)) as Array<{ path: string; score: number }>;
          expect(out.map((c) => c.path)).toEqual(candidates.map((c) => c.path));
          out.forEach((c, i) => {
            expect(Number.isFinite(c.score)).toBe(true);
            expect(c.score).toBeGreaterThanOrEqual(candidates[i]!.score);
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('alias views', () => {
  it('declares fold as the alias view and keys the query by its fold projection', () => {
    const pack = createPack();
    expect(pack.aliasViews).toEqual(['fold']);
    const a = analyze('Ke hoach quy bon');
    expect(a.aliasKeys).toEqual({ fold: 'ke hoach quy bon' });
  });

  it('matches the key the core stores for an accented alias, with or without marks', () => {
    const pack = createPack();
    const stored = pack.project('fold', 'aliases', 'Kế hoạch quý bốn');
    for (const q of ['Ke hoach quy bon', 'kế hoạch quý bốn', '  KẾ   hoạch quy bon ']) {
      expect((pack.analyzeQuery(q, fakeContext(VAULT)) as QueryAnalysis).aliasKeys?.fold).toBe(stored);
    }
  });

  it('keys đ and title projections the same way', () => {
    const pack = createPack();
    expect(analyze('Đường di chuyen').aliasKeys?.fold).toBe(pack.project('fold', 'title', 'Đường di chuyển'));
  });

  it('gives no key for an empty query', () => {
    expect(analyze('   ').aliasKeys).toEqual({ fold: null });
  });
});
