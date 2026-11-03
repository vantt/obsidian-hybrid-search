import { describe, expect, it } from 'vitest';
import { normalize } from '../src/normalize.js';
import { TONE_PAIRS } from './tone-pairs.js';

describe('normalize tone placement table', () => {
  it('has at least 60 pairs', () => {
    expect(TONE_PAIRS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(TONE_PAIRS)('classic %s / modern %s', (classic, modern) => {
    for (const input of [classic, modern]) {
      for (const form of ['NFC', 'NFD'] as const) {
        expect(normalize(input.normalize(form), { tonePlacement: 'modern' })).toBe(modern);
        expect(normalize(input.normalize(form), { tonePlacement: 'classic' })).toBe(classic);
      }
    }
  });

  it('defaults to modern placement', () => {
    expect(normalize('hòa')).toBe('hoà');
  });
});

describe('normalize', () => {
  it('lowercases and keeps accents', () => {
    expect(normalize('Việt Nam')).toBe('việt nam');
    expect(normalize('ĐẠI HỌC')).toBe('đại học');
    expect(normalize('HOÀ BÌNH')).toBe('hoà bình');
  });

  it('only lowercases ASCII and English text', () => {
    expect(normalize('Hello World, Online TEAM 123!')).toBe('hello world, online team 123!');
  });

  it('turns Ð / ð into đ', () => {
    expect(normalize('Ðại học')).toBe('đại học');
    expect(normalize('ðường')).toBe('đường');
  });

  it('turns non-breaking spaces into plain spaces', () => {
    expect(normalize('a b c d')).toBe('a b c d');
  });

  it('composes loose tone marks (NFD) and keeps tone placement', () => {
    expect(normalize('Tiếng Việt')).toBe('tiếng việt');
    expect(normalize('hoà')).toBe('hoà');
  });

  it('moves a tone mark that sits on the wrong letter', () => {
    // sắc typed on the coda consonant: toań -> toán
    expect(normalize('toań')).toBe('toán');
    // a tone mark on the glide of a closed syllable moves to the nucleus
    expect(normalize('hòan')).toBe('hoàn');
  });

  it('leaves non-Vietnamese accented words alone (apart from case)', () => {
    expect(normalize('Café')).toBe('café');
    expect(normalize('Gdańsk')).toBe('gdańsk');
    expect(normalize('Straße')).toBe('straße');
  });

  it('keeps digits, punctuation and emoji', () => {
    expect(normalize('Ngày 12/03: 🎉 xong!')).toBe('ngày 12/03: 🎉 xong!');
  });

  it('is idempotent on examples', () => {
    for (const s of ['Hòa Bình', 'THUỶ', 'Quý', 'toań', 'İstanbul', 'Ðông']) {
      const once = normalize(s);
      expect(normalize(once)).toBe(once);
    }
  });

  it('does not mutate or depend on previous calls (pure)', () => {
    const a = normalize('Hòa', { tonePlacement: 'classic' });
    const b = normalize('Hòa', { tonePlacement: 'modern' });
    const c = normalize('Hòa', { tonePlacement: 'classic' });
    expect([a, b, c]).toEqual(['hòa', 'hoà', 'hòa']);
  });
});
