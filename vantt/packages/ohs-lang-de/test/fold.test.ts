import { describe, expect, it } from 'vitest';
import { foldWord, transliterateWord } from '../src/index.js';

describe('fold', () => {
  it('drops umlauts and expands eszett', () => {
    expect(foldWord('Käse')).toBe('kase');
    expect(foldWord('Große')).toBe('grosse');
    expect(foldWord('STRASSE')).toBe('strasse');
    expect(foldWord('Straße')).toBe('strasse');
    expect(foldWord('Café')).toBe('cafe');
  });
  it('transliterates umlauts to digraphs', () => {
    expect(transliterateWord('Käse')).toBe('kaese');
    expect(transliterateWord('Schön')).toBe('schoen');
    expect(transliterateWord('Müßig')).toBe('muessig');
  });
  it('treats decomposed and composed umlauts alike', () => {
    expect(foldWord('Käse')).toBe(foldWord('Käse'));
    expect(transliterateWord('Käse')).toBe('kaese');
  });
});
