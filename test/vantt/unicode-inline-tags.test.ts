import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseInlineTags } from '../../src/content/note-extractor.js';

describe('parseInlineTags — Unicode letters', () => {
  it('keeps Vietnamese tags with diacritics in the U+1EA0–U+1EF9 range', () => {
    assert.deepEqual(parseInlineTags('Ghi chú #tiếng-việt và #đồ_án'), ['tiếng-việt', 'đồ_án']);
  });

  it('keeps a Vietnamese tag without being cut at the first diacritic', () => {
    assert.deepEqual(parseInlineTags('#kếhoạch #ưu_tiên'), ['kếhoạch', 'ưu_tiên']);
  });

  it('keeps hierarchical tags with Unicode segments', () => {
    assert.deepEqual(parseInlineTags('see #dự-án/2026 now'), ['dự-án/2026']);
  });

  it('keeps Cyrillic, Greek and CJK tags', () => {
    assert.deepEqual(parseInlineTags('#тест #αλφα #日本'), ['тест', 'αλφα', '日本']);
  });

  it('keeps decomposed (NFD) Vietnamese tags through combining marks', () => {
    // "kếhoạch" with every precomposed letter split into base + combining marks.
    const tag = 'ke\u0302\u0301hoa\u0323ch';
    assert.deepEqual(parseInlineTags(`#${tag} next`), [tag]);
  });

  it('accepts Unicode tags after punctuation that already started tags', () => {
    assert.deepEqual(parseInlineTags('(#đồ_án), #dữ-liệu;#ôn'), ['đồ_án', 'dữ-liệu', 'ôn']);
  });

  it('does not match Unicode tags inside code', () => {
    assert.deepEqual(parseInlineTags('```\n#ẩn\n```\n`#ẩn2`'), []);
  });
});

describe('parseInlineTags — rules preserved', () => {
  it('still parses ASCII tags exactly as before', () => {
    assert.deepEqual(parseInlineTags('#pkm #note/basic/primary #real-tag #a_b #_x'), [
      'pkm',
      'note/basic/primary',
      'real-tag',
      'a_b',
      '_x',
    ]);
  });

  it('rejects tags whose first character is a digit', () => {
    assert.deepEqual(parseInlineTags('#123 #42foo #٣٤'), []);
  });

  it('does not treat a # inside a word as a tag start', () => {
    assert.deepEqual(parseInlineTags('issue#đồ_án and a#b'), []);
  });

  it('keeps digits after the first character inside a Unicode tag', () => {
    assert.deepEqual(parseInlineTags('#đề2026'), ['đề2026']);
  });

  it('does not extend a tag across a non-letter symbol', () => {
    assert.deepEqual(parseInlineTags('#abc×def #xyz÷uvw'), ['abc', 'xyz']);
  });

  it('deduplicates Unicode tags', () => {
    assert.deepEqual(parseInlineTags('#đồ_án then #đồ_án'), ['đồ_án']);
  });
});
