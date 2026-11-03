import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { QueryAnalysis } from '../src/contract.js';
import {
  bundledDictionary,
  createPack,
  packSignature,
  parseLexicon,
  resolveOptions,
} from '../src/index.js';
import { headingText } from '../src/lexicon.js';
import type { ViAnalysisData } from '../src/query.js';
import { fakeContext } from './fake-context.js';

const LEXICON = `# Từ điển

## Đồng nghĩa

ô tô = xe hơi = car
điện thoại = phone = smartphone

## Viết tắt

KH = khách hàng
HĐ = hợp đồng

## Từ ghép

khách hàng
bạn hàng

## Chờ duyệt

GD = giáo dục
máy bay = airplane
`;

const VAULT_DOCS = [
  'Danh sách khách hàng tiềm năng',
  'Quà cho bố mẹ: điện thoại mới',
  'Mua xe ô tô cũ',
];

describe('parseLexicon', () => {
  it('reads the three sections and ignores pending proposals', () => {
    const lex = parseLexicon(LEXICON);
    expect(lex.synonyms).toEqual([
      [['ô', 'tô'], ['xe', 'hơi'], ['car']],
      [['điện', 'thoại'], ['phone'], ['smartphone']],
    ]);
    expect(lex.abbreviations).toEqual([
      [['kh'], ['khách', 'hàng']],
      [['hđ'], ['hợp', 'đồng']],
    ]);
    expect(lex.compounds).toEqual([
      ['khách', 'hàng'],
      ['bạn', 'hàng'],
    ]);
    const all = JSON.stringify(lex);
    expect(all).not.toContain('giáo');
    expect(all).not.toContain('airplane');
  });

  it('accepts CRLF, bullets, NFD text and heading variants', () => {
    const text =
      '## Dong nghia\r\n- a b = c d\r\n\r\n## VIẾT TẮT\r\n* kh = khách hàng\r\n'.normalize('NFD');
    const lex = parseLexicon(text);
    expect(lex.synonyms).toEqual([
      [
        ['a', 'b'],
        ['c', 'd'],
      ],
    ]);
    expect(lex.abbreviations).toEqual([[['kh'], ['khách', 'hàng']]]);
  });

  it('ignores lines outside sections and single-form lines', () => {
    const lex = parseLexicon('a = b\n## Đồng nghĩa\nonly\nx = x\n## Khác\ny = z\n');
    expect(lex).toEqual({ synonyms: [], abbreviations: [], compounds: [] });
  });
});

describe('headingText', () => {
  it('reads level-2 headings like /^\\s{0,3}##\\s+(.*?)\\s*#*\\s*$/', () => {
    expect(headingText('## Viết tắt')).toBe('Viết tắt');
    expect(headingText('   ##  Đồng nghĩa  ## ')).toBe('Đồng nghĩa');
    expect(headingText('## a # b ##')).toBe('a # b');
    expect(headingText('## C#')).toBe('C');
    expect(headingText('##   ')).toBe('');
    expect(headingText('## ###')).toBe('');
    expect(headingText('##\tTab\u00a0')).toBe('Tab');
    expect(headingText('## a \u2028')).toBe('a');
    expect(headingText('## a\u2028b')).toBeNull();
    for (const no of ['', '#', '##', '##x', '# h', '### h', '    ## h', 'x ## h'])
      expect(headingText(no), JSON.stringify(no)).toBeNull();
  });

  it('stays linear on long runs of spaces and hashes', () => {
    const line = `## a${' '.repeat(50_000)}#${' \t'.repeat(50_000)}`;
    const t0 = performance.now();
    expect(headingText(line)).toBe('a');
    expect(headingText(`## ${'# '.repeat(50_000)}x`)).toMatch(/^#/);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});

describe('lexicon in the pack', () => {
  let dir: string;
  let saved: string | undefined;
  const write = (text: string) => {
    mkdirSync(join(dir, '_ohs'), { recursive: true });
    writeFileSync(join(dir, '_ohs', 'lexicon.md'), text);
  };
  const analyze = (query: string, raw: unknown = {}): QueryAnalysis => {
    const pack = createPack(raw);
    return pack.analyzeQuery(query, {
      ...fakeContext(VAULT_DOCS),
      vaultPath: dir,
    }) as QueryAnalysis;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ohs-lex-'));
    saved = process.env.OBSIDIAN_VAULT_PATH;
    process.env.OBSIDIAN_VAULT_PATH = dir;
    write(LEXICON);
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.OBSIDIAN_VAULT_PATH;
    else process.env.OBSIDIAN_VAULT_PATH = saved;
    rmSync(dir, { recursive: true, force: true });
  });

  it('adds the other synonyms to both view queries, even for an English query', () => {
    const a = analyze('phone');
    expect(a.viewQueries.norm).toBe('điện thoại smartphone');
    expect(a.viewQueries.fold).toBe('dien thoai smartphone');
    expect(a.embedQuery).toBeUndefined();
  });

  it('expands a Vietnamese synonym typed with or without diacritics', () => {
    expect(analyze('xe hơi').viewQueries.norm).toBe('xe hơi ô tô car');
    expect(analyze('xe hoi').viewQueries.fold).toContain('car');
  });

  it('expands an abbreviation one way and keeps the query words', () => {
    const a = analyze('KH tiềm năng');
    expect(a.viewQueries.norm).toContain('khách hàng');
    expect(a.viewQueries.norm).toMatch(/^kh/);
    expect(analyze('khách hàng').viewQueries.norm ?? '').not.toMatch(/\bkh\b/);
  });

  it('a lexicon word is never typo-corrected', () => {
    write('## Đồng nghĩa\nphone = dế\n');
    const docs = ['phong khach rong', 'phong ngu'];
    const pack = createPack({ typo: true });
    const a = pack.analyzeQuery('phone', { ...fakeContext(docs), vaultPath: dir }) as QueryAnalysis;
    expect(a.debug?.rewrite).toBeUndefined();
    expect(a.viewQueries.norm).toBe('dế');
    write('');
    const b = pack.analyzeQuery('phone', { ...fakeContext(docs), vaultPath: dir }) as QueryAnalysis;
    expect(JSON.stringify(b.debug?.rewrite)).toContain('typo');
  });

  it('a word typed with diacritics does not match another diacritic form', () => {
    write('## Đồng nghĩa\nlương = salary\n');
    expect(analyze('lượng').viewQueries.norm ?? '').not.toContain('salary');
    expect(analyze('luong').viewQueries.norm).toContain('salary');
    expect(analyze('lương').viewQueries.norm).toContain('salary');
  });

  it('adds rescore targets with the substituted phrase', () => {
    const data = analyze('KH tiềm năng').data as ViAnalysisData;
    expect(data.targets.some((t) => t.words.join(' ') === 'khách hàng tiềm năng')).toBe(true);
  });

  it('does not use the pending section', () => {
    expect(analyze('GD').viewQueries.norm ?? null).toBeNull();
    expect(analyze('máy bay').viewQueries.norm ?? '').not.toContain('airplane');
  });

  it('leaves queries without lexicon matches alone', () => {
    const withLexicon = analyze('bán hàng');
    write('');
    expect(analyze('bán hàng')).toEqual(withLexicon);
  });

  it('works without a lexicon file', () => {
    rmSync(join(dir, '_ohs'), { recursive: true });
    expect(analyze('phone').viewQueries.norm ?? null).toBeNull();
    expect(createPack().queryCacheKey?.()).toBe('');
  });

  it('honours lexiconPath', () => {
    writeFileSync(join(dir, 'words.md'), '## Đồng nghĩa\nphone = dế\n');
    expect(analyze('phone', { lexiconPath: 'words.md' }).viewQueries.norm).toBe('dế');
  });

  it('synonyms and abbreviations change queryCacheKey but never the signature', () => {
    const pack = createPack();
    const signature = pack.signature();
    const key = pack.queryCacheKey!();
    expect(key).not.toBe('');
    write(LEXICON.replace('xe hơi', 'xe con').replace('KH = khách hàng', 'KH = khách'));
    expect(pack.signature()).toBe(signature);
    expect(pack.queryCacheKey!()).not.toBe(key);
    write(LEXICON.replace('GD = giáo dục', 'GD = giáo dục\nTP = thành phố'));
    expect(pack.queryCacheKey!()).toBe(key);
    expect(pack.signature()).toBe(signature);
  });

  it('compound words do not touch the index without segment', () => {
    const signature = createPack({ segment: false }).signature();
    write(LEXICON.replace('bạn hàng', 'bạn hàng\ngiữ chân khách'));
    expect(createPack({ segment: false }).signature()).toBe(signature);
  });

  it('compound words change the signature (with segment), not the cache key', () => {
    const pack = createPack({ segment: true });
    const signature = pack.signature();
    const key = pack.queryCacheKey!();
    // A compound the bundled dictionary does not have ("nhà hàng" is already there).
    expect(pack.project('seg', 'content', 'Giữ chân khách')).toBe('giữ_chân khách');
    write(LEXICON.replace('bạn hàng', 'bạn hàng\ngiữ chân khách'));
    expect(pack.signature()).not.toBe(signature);
    // project() follows the dictionary the new signature stands for
    expect(pack.project('seg', 'content', 'Giữ chân khách')).toBe('giữ_chân_khách');
    expect(pack.queryCacheKey!()).toBe(key);
    write(LEXICON.replace(/## Từ ghép[\s\S]*?## Chờ/, '## Chờ'));
    expect(pack.signature()).toBe(createPack({ segment: true }).signature());
  });

  it('signature without a lexicon is the plain one', () => {
    rmSync(join(dir, '_ohs'), { recursive: true });
    expect(createPack({ segment: false }).signature()).not.toContain('seg=');
    expect(createPack().signature()).toBe(
      packSignature(resolveOptions(), bundledDictionary('modern').digest),
    );
  });

  it('reports the file as read (sanity)', () => {
    expect(readFileSync(join(dir, '_ohs', 'lexicon.md'), 'utf8')).toContain('Chờ duyệt');
  });
});
