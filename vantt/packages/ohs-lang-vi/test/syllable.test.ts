import { describe, expect, it } from 'vitest';
import { composeSyllable, isPossibleFoldedSyllable, isVietnameseSyllable, parseSyllable } from '../src/syllable.js';
import { TONE_PAIRS } from './tone-pairs.js';

describe('parseSyllable', () => {
  const cases: Array<[string, { onset: string; glide: string; nucleus: string; coda: string; tone: number }]> = [
    ['tiếng', { onset: 't', glide: '', nucleus: 'iê', coda: 'ng', tone: 2 }],
    ['việt', { onset: 'v', glide: '', nucleus: 'iê', coda: 't', tone: 5 }],
    ['nghiêng', { onset: 'ngh', glide: '', nucleus: 'iê', coda: 'ng', tone: 0 }],
    ['nghỉ', { onset: 'ngh', glide: '', nucleus: 'i', coda: '', tone: 3 }],
    ['ghế', { onset: 'gh', glide: '', nucleus: 'ê', coda: '', tone: 2 }],
    ['quả', { onset: 'qu', glide: '', nucleus: 'a', coda: '', tone: 3 }],
    ['quý', { onset: 'qu', glide: '', nucleus: 'y', coda: '', tone: 2 }],
    ['quyền', { onset: 'qu', glide: '', nucleus: 'yê', coda: 'n', tone: 1 }],
    ['giá', { onset: 'gi', glide: '', nucleus: 'a', coda: '', tone: 2 }],
    ['gì', { onset: 'g', glide: '', nucleus: 'i', coda: '', tone: 1 }],
    ['gìn', { onset: 'g', glide: '', nucleus: 'i', coda: 'n', tone: 1 }],
    ['giường', { onset: 'gi', glide: '', nucleus: 'ươ', coda: 'ng', tone: 1 }],
    ['người', { onset: 'ng', glide: '', nucleus: 'ươi', coda: '', tone: 1 }],
    ['hoàn', { onset: 'h', glide: 'o', nucleus: 'a', coda: 'n', tone: 1 }],
    ['thuỷ', { onset: 'th', glide: 'u', nucleus: 'y', coda: '', tone: 3 }],
    ['khuyên', { onset: 'kh', glide: 'u', nucleus: 'yê', coda: 'n', tone: 0 }],
    ['ngoằn', { onset: 'ng', glide: 'o', nucleus: 'ă', coda: 'n', tone: 1 }],
    ['ăn', { onset: '', glide: '', nucleus: 'ă', coda: 'n', tone: 0 }],
    ['yêu', { onset: '', glide: '', nucleus: 'yêu', coda: '', tone: 0 }],
    ['ừ', { onset: '', glide: '', nucleus: 'ư', coda: '', tone: 1 }],
    ['đường', { onset: 'đ', glide: '', nucleus: 'ươ', coda: 'ng', tone: 1 }],
  ];

  it.each(cases)('%s', (word, expected) => {
    expect(parseSyllable(word)).toEqual(expected);
  });

  it('accepts NFD, upper case and a misplaced tone mark', () => {
    expect(parseSyllable('TIẾNG'.normalize('NFD'))).toEqual(parseSyllable('tiếng'));
    expect(parseSyllable('toań')).toEqual(parseSyllable('toán'));
    expect(parseSyllable('hòan')).toEqual(parseSyllable('hoàn'));
  });

  it('rejects English and other non-Vietnamese words', () => {
    for (const w of ['online', 'team', 'seen', 'hello', 'world', 'Python', 'function', 'test', 'xyz', 'ok', 'wifi', 'phone', 'string']) {
      expect(isVietnameseSyllable(w), w).toBe(false);
    }
  });

  it('rejects spelling errors: c/k, g/gh, ng/ngh', () => {
    for (const w of ['ce', 'ci', 'ka', 'ko', 'ghá', 'gẻ', 'ngi', 'nghá', 'nghư']) {
      expect(isVietnameseSyllable(w), w).toBe(false);
    }
    for (const w of ['ca', 'ke', 'ki', 'ghe', 'ghi', 'nghe', 'nghi', 'ga', 'ngo', 'cu', 'kê']) {
      expect(isVietnameseSyllable(w), w).toBe(true);
    }
  });

  it('rejects malformed input', () => {
    for (const w of ['', ' ', 'a b', '12', 'á̀', 'ấ́', 'verylongwordhere']) {
      expect(parseSyllable(w), JSON.stringify(w)).toBeNull();
    }
  });

  it('accepts all well-known syllables of a sample sentence', () => {
    const sentence = 'Tôi yêu Việt Nam quê hương tôi đất nước thân thương cuộc sống hạnh phúc';
    for (const w of sentence.split(' ')) expect(isVietnameseSyllable(w), w).toBe(true);
  });
});

describe('composeSyllable', () => {
  it.each(TONE_PAIRS)('%s / %s', (classic, modern) => {
    const parsed = parseSyllable(modern);
    expect(parsed).not.toBeNull();
    expect(composeSyllable(parsed!, 'modern')).toBe(modern);
    expect(composeSyllable(parsed!, 'classic')).toBe(classic);
  });
});

describe('isPossibleFoldedSyllable', () => {
  it('accepts unaccented Vietnamese syllables', () => {
    for (const w of ['ban', 'hang', 'tieng', 'viet', 'nam', 'khach', 'khuyen', 'duong', 'nguoi', 'quoc', 'gia', 'gi', 'giang', 'ngoan', 'thuy', 'quy', 'Hoa', 'KHACH', 'yeu', 'uong']) {
      expect(isPossibleFoldedSyllable(w), w).toBe(true);
    }
  });

  it('rejects English words', () => {
    for (const w of ['online', 'team', 'seen', 'hello', 'string', 'wifi', 'phone', 'project', 'meeting']) {
      expect(isPossibleFoldedSyllable(w), w).toBe(false);
    }
  });

  it('agrees with parseSyllable on folded forms of accented syllables', () => {
    for (const [, modern] of TONE_PAIRS) {
      const folded = modern.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
      expect(isPossibleFoldedSyllable(folded), modern).toBe(true);
    }
  });
});
