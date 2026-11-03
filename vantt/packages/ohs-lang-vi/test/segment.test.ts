import fc from 'fast-check';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { QueryAnalysis } from '../src/contract.js';
import { TONES, type Tone } from '../src/data.js';
import { createPack, packSignature } from '../src/index.js';
import { resolveOptions } from '../src/options.js';
import {
  buildDictionary,
  bundledCompounds,
  compoundsOf,
  CompoundSource,
  projectSegmented,
  readCompoundList,
  SEG_TOKENIZER,
  segmentWords,
} from '../src/segment.js';
import { composeSyllable } from '../src/syllable.js';
import { createTokenProjector, tokenize } from '../src/views.js';
import { fakeContext } from './fake-context.js';
import { allSyllables } from './helpers.js';

const SEG = { segment: true };
const segPack = createPack(SEG);
const seg = (text: string) => segPack.project('seg', 'content', text);

/**
 * The P01 token invariant as the core checks it (src/language/tokens.ts):
 * source text split without `_`, view text split with `_` as a token
 * character, a view token with `_` counting as its non-empty parts.
 */
const sourceTokens = (text: string) => text.match(/[\p{L}\p{N}\p{Co}\p{M}+#]+/gu) ?? [];
const viewTokens = (text: string) => text.match(/[\p{L}\p{N}\p{Co}\p{M}+#_]+/gu) ?? [];
const viewParts = (text: string) => viewTokens(text).flatMap((t) => t.split('_').filter(Boolean));

describe('bundled dictionary', () => {
  const entries = bundledCompounds();

  it('has two-syllable compounds only, normalized, unique and sorted', () => {
    expect(entries.length).toBeGreaterThan(20_000);
    expect(new Set(entries).size).toBe(entries.length);
    expect([...entries].sort()).toEqual(entries);
    for (const e of entries) {
      expect(e.split(' ')).toHaveLength(2);
      expect(e).toBe(e.normalize('NFC').toLowerCase());
    }
  });

  it('knows common compounds', () => {
    const set = new Set(entries);
    for (const w of [
      'khách hàng',
      'hàng hoá',
      'học sinh',
      'sinh học',
      'ngân hàng',
      'nhà hàng',
      'kế toán',
    ])
      expect(set.has(w)).toBe(true);
  });

  it('fails loudly when the data file is missing or empty', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ohs-lang-vi-'));
    try {
      expect(() => readCompoundList(pathToFileURL(path.join(dir, 'compounds.txt')))).toThrow(
        /installed without its data/,
      );
      writeFileSync(path.join(dir, 'compounds.txt'), '# comment only\n');
      expect(() => readCompoundList(pathToFileURL(path.join(dir, 'compounds.txt')))).toThrow(
        /is empty/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ships with the package: npm pack includes the dictionary, its notes and attribution', () => {
    const res = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8',
    });
    expect(res.status, res.stderr).toBe(0);
    // npm 11 prints an array of packages, npm 12 an object keyed by package name.
    type Packed = { files: { path: string }[] };
    const parsed = JSON.parse(res.stdout) as Packed[] | Record<string, Packed>;
    const packed = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
    expect(packed, res.stdout).toBeDefined();
    const files = packed!.files.map((f) => f.path);
    for (const f of ['data/compounds.txt', 'data/README.md', 'data/ATTRIBUTION.md'])
      expect(files).toContain(f);
    // The compiled output only exists after the package is compiled, so check it is declared for packing.
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as {
      files: string[];
    };
    expect(pkg.files).toContain('build');
  });

  it('follows the tone placement option', () => {
    expect(buildDictionary(['hàng hoá'], 'classic').entries.has('hàng hóa')).toBe(true);
    expect(buildDictionary(['hàng hóa'], 'modern').entries.has('hàng hoá')).toBe(true);
  });
});

describe('segmentWords', () => {
  const dict = buildDictionary([
    'học sinh',
    'sinh học',
    'khách hàng',
    'hàng hoá',
    'thân thiết',
    'khách hàng thân thiết',
  ]);

  it('joins compounds and leaves other words alone', () => {
    expect(segmentWords(['khách', 'hàng', 'mua', 'hàng', 'hoá'], dict)).toEqual([2, 1, 2]);
    expect(segmentWords(['mua'], dict)).toEqual([1]);
    expect(segmentWords([], dict)).toEqual([]);
  });

  it('prefers the fewest words, then the longest first word', () => {
    expect(segmentWords(['học', 'sinh', 'học'], dict)).toEqual([2, 1]);
    expect(segmentWords(['khách', 'hàng', 'thân', 'thiết'], dict)).toEqual([4]);
    expect(compoundsOf(['em', 'học', 'sinh', 'học', 'sinh'], dict)).toEqual([
      'học sinh',
      'học sinh',
    ]);
  });
});

describe('seg view projection', () => {
  it('joins compounds with _ and keeps everything else like the norm view', () => {
    expect(seg('Khách hàng mua hàng hoá')).toBe('khách_hàng mua hàng_hoá');
    expect(seg('Học sinh học sinh học.')).toBe('học_sinh học_sinh học.');
    expect(seg('Hòa Bình, ĐƯỜNG Ðó')).toBe('hoà_bình, đường đó');
    expect(seg('ĐƯỜNG Ðó C++ #tag')).toBe(segPack.project('norm', 'content', 'ĐƯỜNG Ðó C++ #tag'));
  });

  it('never joins across punctuation or line breaks', () => {
    expect(seg('khách, hàng')).toBe('khách, hàng');
    expect(seg('khách\nhàng')).toBe('khách\nhàng');
    expect(seg('khách - hàng')).toBe('khách - hàng');
    expect(seg('khách hàng')).toBe('khách_hàng');
  });

  it('follows the tone placement of the pack', () => {
    expect(
      createPack({ segment: true, tonePlacement: 'classic' }).project('seg', 'content', 'hàng hoá'),
    ).toBe('hàng_hóa');
  });

  it('keeps text without tokens unchanged', () => {
    for (const t of ['', ' ', '...', '🎉 - 🎉']) expect(seg(t)).toBe(t);
  });

  const syllables = allSyllables();
  const word = fc
    .tuple(
      fc.integer({ min: 0, max: syllables.length - 1 }),
      fc.constantFrom(...TONES),
      fc.boolean(),
    )
    .map(([i, tone, upper]) => {
      const w = composeSyllable({ ...syllables[i]!, tone: tone as Tone }, 'classic');
      return upper ? w.toUpperCase() : w;
    });
  const compound = fc.constantFrom(...bundledCompounds().slice(0, 2000));
  const sep = fc.constantFrom(
    ' ',
    ' ',
    ' ',
    ', ',
    '.\n',
    ' - ',
    '_',
    '__',
    ' c++ ',
    ' #x ',
    ' ',
    '\t',
    '🎉',
    '2026',
    '⁠',
  );
  const text = fc.oneof(
    fc
      .array(fc.tuple(fc.oneof(word, compound), sep), { maxLength: 15 })
      .map((parts) => parts.map(([w, s]) => w + s).join('')),
    fc.string({ unit: 'grapheme', maxLength: 40 }),
    fc.string({ unit: 'binary', maxLength: 40 }),
  );

  it('keeps the P01 token invariant (fast-check, every field and index option)', () => {
    const packs = [
      segPack,
      createPack({ ...SEG, foldIY: true }),
      createPack({ ...SEG, tonePlacement: 'classic' }),
    ];
    fc.assert(
      fc.property(
        text,
        fc.constantFrom('title', 'aliases', 'content') as fc.Arbitrary<'title'>,
        (t, field) => {
          const source = sourceTokens(t);
          for (const p of packs) {
            const projected = p.project('seg', field, t);
            const parts = viewParts(projected);
            // Same count; part k of the view is the norm projection of source token k.
            expect(parts).toHaveLength(source.length);
            parts.forEach((part, k) => expect(part).toBe(p.project('norm', field, source[k]!)));
            // Removing the joins gives the norm view back.
            expect(projected.replace(/_/g, ' ')).toBe(
              p.project('norm', field, t).replace(/_/g, ' '),
            );
          }
        },
      ),
      { numRuns: 400 },
    );
  });

  it('is pure and deterministic', () => {
    const other = createPack(SEG);
    fc.assert(
      fc.property(text, (t) => {
        expect(seg(t)).toBe(seg(t));
        expect(other.project('seg', 'content', t)).toBe(seg(t));
      }),
      { numRuns: 200 },
    );
  });

  it('projectSegmented works with any token projector', () => {
    const dict = buildDictionary(['khách hàng']);
    const norm = createTokenProjector(resolveOptions());
    expect(projectSegmented('Khách Hàng!', (t) => norm('norm', t), dict)).toBe('khách_hàng!');
  });
});

describe('pack with segment', () => {
  it('adds the seg view with its own tokenizer and weight', () => {
    expect(createPack({ segment: false }).views.map((v) => v.name)).toEqual(['norm', 'fold']);
    const pack = createPack({ segment: true, viewWeights: { seg: 2 } });
    expect(pack.views.map((v) => v.name)).toEqual(['norm', 'fold', 'seg']);
    expect(pack.views[2]).toEqual({ name: 'seg', weight: 2, tokenizer: SEG_TOKENIZER });
    expect(() => createPack({ segment: false }).project('seg', 'content', 'x')).toThrow(
      /unknown view/,
    );
  });

  it('puts the dictionary digest into the signature', () => {
    const plain = createPack({ segment: false }).signature();
    const withSeg = createPack(SEG).signature();
    expect(withSeg).not.toBe(plain);
    expect(withSeg).toMatch(/;seg=[0-9a-f]{12}$/);
    expect(createPack({ ...SEG, viewWeights: { seg: 3 } }).signature()).toBe(withSeg);
    expect(packSignature(resolveOptions({ segment: false }), 'abc')).toBe(plain);
    expect(createPack().signature()).toBe(withSeg); // on by default
  });

  it('rebuilds the dictionary when the lexicon compounds change, and only then', () => {
    let extra: string[][] = [];
    const source = new CompoundSource('modern', () => extra);
    const first = source.refresh();
    expect(source.refresh()).toBe(first);
    expect(first.entries.has('giữ chân khách hàng')).toBe(false);
    extra = [['giữ', 'chân', 'khách', 'hàng']];
    // project() keeps the dictionary signature() reported until the next refresh
    expect(source.current()).toBe(first);
    const second = source.refresh();
    expect(second.entries.has('giữ chân khách hàng')).toBe(true);
    expect(second.maxWords).toBe(4);
    expect(second.digest).not.toBe(first.digest);
    expect(source.current()).toBe(second);
  });
});

describe('seg view query', () => {
  const VAULT = [
    'Chăm sóc khách hàng thân thiết',
    'Nhập hàng hoá cho cửa hàng',
    'Môn sinh học lớp mười',
    'Học sinh giỏi cấp tỉnh',
    'Kế hoạch bán hàng online',
  ];
  const analyze = (query: string, raw: Record<string, unknown> = SEG): QueryAnalysis =>
    createPack(raw).analyzeQuery(query, fakeContext(VAULT, resolveOptions(raw))) as QueryAnalysis;

  it('searches the compounds of an accented query', () => {
    expect(analyze('khách hàng').viewQueries.seg).toBe('khách_hàng');
    expect(analyze('chăm sóc khách hàng').viewQueries.seg).toBe('chăm_sóc khách_hàng');
  });

  it('searches the compounds of the restored query', () => {
    const a = analyze('kham soc khach hang'.replace('kham', 'cham'));
    expect(a.viewQueries.seg).toContain('khách_hàng');
    expect(a.viewQueries.seg).toContain('chăm_sóc');
  });

  it('is null without compounds, for English, and absent when segment is off', () => {
    expect(analyze('mua').viewQueries.seg).toBeNull();
    expect(analyze('customer care team').viewQueries.seg).toBeNull();
    // mixed with English, accented or not: the vector branch carries it
    expect(analyze('chăm sóc khách hàng online').viewQueries.seg).toBeNull();
    expect(analyze('kiểm tra code trước khi merge').viewQueries.seg).toBeNull();
    expect('seg' in analyze('khách hàng', { segment: false }).viewQueries).toBe(false);
  });

  it('adds a different split of the query when the vault has it', () => {
    // Segmented alone, "học sinh học" is "học_sinh học"; the vault also has "sinh_học".
    const q = analyze('học sinh học').viewQueries.seg!.split(' ');
    expect(q).toContain('học_sinh');
    expect(q).toContain('sinh_học');
    // Without that note, only the segmentation itself.
    const other = createPack(SEG).analyzeQuery(
      'học sinh học',
      fakeContext(VAULT.slice(3), resolveOptions(SEG)),
    ) as QueryAnalysis;
    expect(other.viewQueries.seg).toBe('học_sinh');
  });

  it('segments queries and notes the same way', () => {
    const emptyVault = fakeContext([], resolveOptions(SEG));
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('khách', 'hàng', 'hoá', 'học', 'sinh', 'mua', 'thân', 'thiết'), {
          minLength: 1,
          maxLength: 8,
        }),
        (words) => {
          const projected = seg(words.join(' '));
          const compounds = projected.split(' ').filter((t) => t.includes('_'));
          const query = segPack.analyzeQuery(words.join(' '), emptyVault) as QueryAnalysis;
          const queried = query.viewQueries.seg?.split(' ') ?? [];
          for (const c of compounds) expect(queried).toContain(c);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('tokenizes the seg query as one token per compound', () => {
    expect(tokenize('khách_hàng')).toEqual(['khách', 'hàng']);
    expect(viewTokens('khách_hàng chăm_sóc')).toEqual(['khách_hàng', 'chăm_sóc']);
  });
});
