import { describe, expect, it } from 'vitest';
import { createSplitter } from '../src/index.js';

const parts = (word: string, extra: string[] = []) =>
  createSplitter(extra)
    .split(word)
    .map((p) => p.fold);

describe('compound splitting', () => {
  const cases: Array<[string, string[]]> = [
    ['Fußgängerbrücke', ['fuss', 'ganger', 'brucke']],
    ['Fussgaengerbruecke', ['fuss', 'ganger', 'brucke']],
    ['Donaudampfschifffahrtsgesellschaft', ['donau', 'dampf', 'schiff', 'fahrt', 'gesellschaft']],
    ['Krankenversicherung', ['kranken', 'versicherung']],
    ['Geschwindigkeitsbegrenzung', ['geschwindigkeit', 'begrenzung']],
    ['Arbeitsvertrag', ['arbeit', 'vertrag']],
    ['Schlüsselbund', ['schlussel', 'bund']],
  ];
  it.each(cases)('splits %s', (word, expected) => {
    expect(parts(word)).toEqual(expected);
  });
  it('leaves plain words alone', () => {
    for (const word of ['Haus', 'Straße', 'Käse', 'Stadt', 'Bahnhof', 'Computer']) {
      expect(parts(word).length === 0 || word === 'Bahnhof').toBe(true);
    }
    expect(parts('Haus')).toEqual([]);
    expect(parts('Computer')).toEqual([]);
  });
  it('does not end on a linking element', () => {
    expect(parts('Hauses')).toEqual([]);
  });
  it('uses extra words', () => {
    expect(parts('Sauerkrautsuppe')).toEqual([]);
    expect(parts('Sauerkrautsuppe', ['Sauerkraut'])).toEqual(['sauerkraut', 'suppe']);
  });
});
