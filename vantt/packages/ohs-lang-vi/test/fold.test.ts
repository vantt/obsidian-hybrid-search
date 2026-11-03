import { describe, expect, it } from 'vitest';
import { BASE_VOWELS, TONES, toneVowel } from '../src/data.js';
import { fold } from '../src/fold.js';

describe('fold', () => {
  it('strips every toned vowel to its ASCII base letter', () => {
    const base: Record<string, string> = {
      a: 'a',
      ă: 'a',
      â: 'a',
      e: 'e',
      ê: 'e',
      i: 'i',
      o: 'o',
      ô: 'o',
      ơ: 'o',
      u: 'u',
      ư: 'u',
      y: 'y',
    };
    for (const v of BASE_VOWELS) {
      for (const t of TONES) {
        const nfc = toneVowel(v, t);
        expect(fold(nfc), nfc).toBe(base[v]);
        expect(fold(nfc.normalize('NFD')), nfc).toBe(base[v]);
        expect(fold(nfc.toUpperCase()), nfc).toBe((base[v] as string).toUpperCase());
      }
    }
  });

  it('turns đ/Đ into d/D and keeps case', () => {
    expect(fold('Đường đi')).toBe('Duong di');
    expect(fold('ĐẠI HỌC Quốc Gia')).toBe('DAI HOC Quoc Gia');
  });

  it('handles Ð/ð like Đ/đ and non-breaking spaces', () => {
    expect(fold('Ðông ðó')).toBe('Dong do');
    expect(fold('a b')).toBe('a b');
  });

  it('folds whole sentences', () => {
    expect(fold('Tôi yêu Việt Nam, quê hương tôi!')).toBe('Toi yeu Viet Nam, que huong toi!');
  });

  it('gives the same result for NFC and NFD input', () => {
    const s = 'Nguyễn Thị Hoàng Ánh ở Đà Nẵng';
    expect(fold(s.normalize('NFD'))).toBe(fold(s.normalize('NFC')));
  });

  it('keeps digits, punctuation, emoji and other scripts', () => {
    expect(fold('2026-11-02 🎉 日本語 한국어')).toBe('2026-11-02 🎉 日本語 한국어');
  });

  it('strips accents of other Latin letters too', () => {
    expect(fold('Café Zürich')).toBe('Cafe Zurich');
  });

  it('is idempotent on examples', () => {
    for (const s of ['Đường', 'hoà bình', 'Ðông', 'Straße', 'ǆ', 'Ａ']) {
      expect(fold(fold(s))).toBe(fold(s));
    }
  });
});

describe('fold with foldIY', () => {
  const opts = { foldIY: true };

  it.each([
    ['kĩ', 'ki'],
    ['kỹ', 'ki'],
    ['lí', 'li'],
    ['lý', 'li'],
    ['mĩ', 'mi'],
    ['mỹ', 'mi'],
    ['hi', 'hi'],
    ['hy', 'hi'],
    ['tí', 'ti'],
    ['tý', 'ti'],
    ['sĩ', 'si'],
    ['sỹ', 'si'],
    ['vi', 'vi'],
    ['vy', 'vi'],
    ['quý', 'qui'],
    ['qui', 'qui'],
    ['kỳ', 'ki'],
    ['dy', 'di'],
  ])('%s -> %s', (input, expected) => {
    expect(fold(input, opts)).toBe(expected);
  });

  it('keeps case', () => {
    expect(fold('Lý Thường Kiệt', opts)).toBe('Li Thuong Kiet');
    expect(fold('KỸ SƯ', opts)).toBe('KI SU');
  });

  it('never merges after a vowel', () => {
    for (const w of ['tai', 'tay', 'mai', 'may', 'hai', 'hay', 'lai', 'lay', 'vui', 'cay']) {
      expect(fold(w, opts), w).toBe(w);
    }
    expect(fold('tai', opts)).not.toBe(fold('tay', opts));
  });

  it('does not merge after other onsets or with no onset', () => {
    for (const w of ['bi', 'by', 'xi', 'xy', 'ny', 'ý', 'y', 'i', 'ỷ', 'thy', 'nghi', 'chy']) {
      expect(fold(w, opts), w).toBe(fold(w));
    }
    expect(fold('by', opts)).toBe('by');
    expect(fold('y', opts)).toBe('y');
  });

  it('only acts on whole words', () => {
    expect(fold('my2 kyx', opts)).toBe('my2 kyx');
    expect(fold('my, ky.', opts)).toBe('mi, ki.');
  });

  it('is idempotent', () => {
    const s = 'Kỹ sư Lý quý hy vọng tay mỹ';
    expect(fold(fold(s, opts), opts)).toBe(fold(s, opts));
  });

  it('is off by default', () => {
    expect(fold('kỹ')).toBe('ky');
    expect(fold('lý')).toBe('ly');
  });
});
