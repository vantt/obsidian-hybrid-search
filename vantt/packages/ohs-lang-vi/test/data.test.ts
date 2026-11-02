import { describe, expect, it } from 'vitest';
import {
  BASE_VOWELS,
  IY_ONSETS,
  TELEX_TABLE,
  TELEX_TONE_KEYS,
  TONES,
  TONE_MARKS,
  TONE_NAMES,
  VNI_TABLE,
  VNI_TONE_KEYS,
  VOWEL_TONE_TABLE,
  toneVowel,
  toneVowelNfd,
} from '../src/data.js';

/** Diacritic of the vowel itself (breve, circumflex, horn), by letter. */
const VOWEL_DIACRITIC: Record<string, { base: string; mark: string }> = {
  a: { base: 'a', mark: '' },
  ă: { base: 'a', mark: '̆' },
  â: { base: 'a', mark: '̂' },
  e: { base: 'e', mark: '' },
  ê: { base: 'e', mark: '̂' },
  i: { base: 'i', mark: '' },
  o: { base: 'o', mark: '' },
  ô: { base: 'o', mark: '̂' },
  ơ: { base: 'o', mark: '̛' },
  u: { base: 'u', mark: '' },
  ư: { base: 'u', mark: '̛' },
  y: { base: 'y', mark: '' },
};

describe('vowel x tone table', () => {
  it('has 12 vowels x 6 tones, all distinct', () => {
    expect(BASE_VOWELS).toHaveLength(12);
    const all = BASE_VOWELS.flatMap((v) => TONES.map((t) => toneVowel(v, t)));
    expect(all).toHaveLength(72);
    expect(new Set(all).size).toBe(72);
  });

  it('matches an independent Unicode composition for every cell (NFC and NFD)', () => {
    for (const vowel of BASE_VOWELS) {
      const { base, mark } = VOWEL_DIACRITIC[vowel] as { base: string; mark: string };
      for (const tone of TONES) {
        const expectedNfc = (base + mark + (TONE_MARKS[tone] as string)).normalize('NFC');
        expect(toneVowel(vowel, tone), `${vowel} tone ${TONE_NAMES[tone]}`).toBe(expectedNfc);
        // NFC form is a single code point, NFD is base + diacritics
        expect([...toneVowel(vowel, tone)]).toHaveLength(1);
        expect(toneVowelNfd(vowel, tone)).toBe((base + mark + (TONE_MARKS[tone] as string)).normalize('NFD'));
        expect(toneVowelNfd(vowel, tone).normalize('NFC')).toBe(toneVowel(vowel, tone));
      }
    }
  });

  it('has the five tone marks in order', () => {
    expect(TONE_MARKS).toEqual(['', '̀', '́', '̉', '̃', '̣']);
    expect(TONE_NAMES).toEqual(['ngang', 'huyen', 'sac', 'hoi', 'nga', 'nang']);
  });
});

describe('Telex and VNI tables', () => {
  const TELEX_LETTER: Record<string, string> = { a: 'a', ă: 'aw', â: 'aa', e: 'e', ê: 'ee', i: 'i', o: 'o', ô: 'oo', ơ: 'ow', u: 'u', ư: 'uw', y: 'y' };
  const VNI_LETTER: Record<string, string> = { a: 'a', ă: 'a8', â: 'a6', e: 'e', ê: 'e6', i: 'i', o: 'o', ô: 'o6', ơ: 'o7', u: 'u', ư: 'u7', y: 'y' };

  it('Telex tone keys are f s r x j (z clears)', () => {
    expect(TELEX_TONE_KEYS).toEqual(['z', 'f', 's', 'r', 'x', 'j']);
  });

  it('VNI tone keys are 2 1 3 4 5 (0 clears)', () => {
    expect(VNI_TONE_KEYS).toEqual(['0', '2', '1', '3', '4', '5']);
  });

  it('covers every vowel x tone in Telex', () => {
    for (const vowel of BASE_VOWELS) {
      for (const tone of TONES) {
        const typed = (TELEX_LETTER[vowel] as string) + (tone === 0 ? '' : (TELEX_TONE_KEYS[tone] as string));
        expect(TELEX_TABLE.get(typed), typed).toBe(toneVowel(vowel, tone));
      }
    }
    expect(TELEX_TABLE.get('dd')).toBe('đ');
    expect(TELEX_TABLE.get('aas')).toBe('ấ');
    expect(TELEX_TABLE.get('uwj')).toBe('ự');
  });

  it('covers every vowel x tone in VNI', () => {
    for (const vowel of BASE_VOWELS) {
      for (const tone of TONES) {
        const typed = (VNI_LETTER[vowel] as string) + (tone === 0 ? '' : (VNI_TONE_KEYS[tone] as string));
        expect(VNI_TABLE.get(typed), typed).toBe(toneVowel(vowel, tone));
      }
    }
    expect(VNI_TABLE.get('d9')).toBe('đ');
    expect(VNI_TABLE.get('a61')).toBe('ấ');
    expect(VNI_TABLE.get('u75')).toBe('ự');
  });

  it('Telex and VNI tables produce the same set of letters', () => {
    expect(new Set(TELEX_TABLE.values())).toEqual(new Set(VNI_TABLE.values()));
  });
});

describe('i/y table', () => {
  it('lists the onsets chosen for foldIY', () => {
    expect([...IY_ONSETS]).toEqual(['k', 'l', 'm', 't', 's', 'h', 'v', 'd', 'qu']);
  });
});
