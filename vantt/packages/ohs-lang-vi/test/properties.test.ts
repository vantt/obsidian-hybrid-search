import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BASE_VOWELS, TONES, toneVowel, type Tone } from '../src/data.js';
import { fold } from '../src/fold.js';
import { normalize } from '../src/normalize.js';
import { composeSyllable, parseSyllable } from '../src/syllable.js';
import { allSyllables, tokens } from './helpers.js';

const NUM_RUNS = 400;

const vowelChars = BASE_VOWELS.flatMap((v) => TONES.map((t) => toneVowel(v, t)));
const letterPool = [
  ...vowelChars,
  ...vowelChars.map((c) => c.toUpperCase()),
  ...'bcdđghklmnpqrstvxfjwzBCDĐGHKLMNPQRSTVXFJWZ',
  ...'abcdefghijklmnopqrstuvwxyz',
  'Đ',
  'Ð',
  'ð',
];
const nonLetterPool = [
  ' ',
  ' ',
  ' ',
  ',',
  '.',
  '-',
  ':',
  '!',
  '?',
  '(',
  ')',
  '#',
  '+',
  '_',
  '/',
  '\n',
  '\t',
  '0',
  '7',
  '2026',
  '🎉',
  '😀',
  '…',
  '“',
  '”',
];
const nbspPool = [' ', ' ', ' '];

/** Free-form text mixing letters, digits, punctuation, emoji. */
const textChars = fc.string({
  unit: fc.constantFrom(...letterPool, ...nonLetterPool),
  maxLength: 80,
});
const textCharsNbsp = fc.string({
  unit: fc.constantFrom(...letterPool, ...nonLetterPool, ...nbspPool),
  maxLength: 80,
});

/** Text made of real syllables with arbitrary tones, case and separators. */
const syllableList = allSyllables();
const syllableWord = fc
  .tuple(
    fc.integer({ min: 0, max: syllableList.length - 1 }),
    fc.constantFrom(...TONES),
    fc.boolean(),
    fc.constantFrom('modern', 'classic') as fc.Arbitrary<'modern' | 'classic'>,
  )
  .map(([i, tone, upper, style]) => {
    const w = composeSyllable(
      { ...(syllableList[i] as ReturnType<typeof parseSyllable> & object), tone: tone as Tone },
      style,
    );
    return upper ? w.toUpperCase() : w;
  });
const syllableText = fc
  .array(fc.tuple(syllableWord, fc.constantFrom(' ', ', ', '. ', '\n', ' - ', '1 ', '')), {
    maxLength: 12,
  })
  .map((parts) => parts.map(([w, sep]) => w + sep).join(''));

const vietnameseLike = fc.oneof(textChars, syllableText);
const anyUnicode = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 40 }),
  fc.string({ unit: 'grapheme', maxLength: 30 }),
  vietnameseLike,
);
const styles = fc.constantFrom('modern', 'classic') as fc.Arbitrary<'modern' | 'classic'>;

const run = { numRuns: NUM_RUNS };

describe('normalize properties', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(anyUnicode, styles, (x, tonePlacement) => {
        const once = normalize(x, { tonePlacement });
        expect(normalize(once, { tonePlacement })).toBe(once);
      }),
      run,
    );
  });

  it('gives the same result for NFC and NFD input', () => {
    fc.assert(
      fc.property(vietnameseLike, styles, (x, tonePlacement) => {
        expect(normalize(x.normalize('NFD'), { tonePlacement })).toBe(
          normalize(x.normalize('NFC'), { tonePlacement }),
        );
      }),
      run,
    );
  });

  it('only changes case for ASCII text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary-ascii', maxLength: 80 }), (x) => {
        expect(normalize(x)).toBe(x.toLowerCase());
      }),
      run,
    );
  });

  it('only changes case for English-like text with punctuation and emoji', () => {
    const english = fc.string({
      unit: fc.constantFrom(
        ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:!?-_()#+/'.split(''),
        '🎉',
        '…',
      ),
      maxLength: 80,
    });
    fc.assert(
      fc.property(english, (x) => {
        expect(normalize(x)).toBe(x.toLowerCase());
      }),
      run,
    );
  });

  it('keeps every non-letter character in order (NBSP aside)', () => {
    const nonLetters = (s: string) => [...s].filter((c) => !/[\p{L}\p{M}]/u.test(c)).join('');
    fc.assert(
      fc.property(textChars, (x) => {
        expect(nonLetters(normalize(x))).toBe(nonLetters(x));
      }),
      run,
    );
  });

  it('turns NBSP-like characters into spaces and nothing else', () => {
    fc.assert(
      fc.property(textCharsNbsp, (x) => {
        const out = normalize(x);
        expect(out).not.toMatch(/[   ]/);
        expect([...out].length).toBe([...x].length);
      }),
      run,
    );
  });

  it('keeps the token invariant: same count, token k <-> token k', () => {
    fc.assert(
      fc.property(vietnameseLike, styles, (x, tonePlacement) => {
        const before = tokens(x);
        const after = tokens(normalize(x, { tonePlacement }));
        expect(after).toHaveLength(before.length);
        before.forEach((t, k) => expect(after[k]).toBe(normalize(t, { tonePlacement })));
      }),
      run,
    );
  });

  it('classic and modern differ only in tone position', () => {
    fc.assert(
      fc.property(vietnameseLike, (x) => {
        const classic = normalize(x, { tonePlacement: 'classic' });
        const modern = normalize(x, { tonePlacement: 'modern' });
        expect(fold(classic)).toBe(fold(modern));
        expect(normalize(classic, { tonePlacement: 'modern' })).toBe(modern);
        expect(normalize(modern, { tonePlacement: 'classic' })).toBe(classic);
      }),
      run,
    );
  });
});

describe('fold properties', () => {
  it('is idempotent', () => {
    fc.assert(
      fc.property(anyUnicode, fc.boolean(), (x, foldIY) => {
        const once = fold(x, { foldIY });
        expect(fold(once, { foldIY })).toBe(once);
      }),
      run,
    );
  });

  it('fold(normalize(x)) equals lowercase(fold(x))', () => {
    fc.assert(
      fc.property(vietnameseLike, fc.boolean(), styles, (x, foldIY, tonePlacement) => {
        expect(fold(normalize(x, { tonePlacement }), { foldIY })).toBe(
          fold(x, { foldIY }).toLowerCase(),
        );
      }),
      run,
    );
  });

  it('gives the same result for NFC and NFD input', () => {
    fc.assert(
      fc.property(vietnameseLike, fc.boolean(), (x, foldIY) => {
        expect(fold(x.normalize('NFD'), { foldIY })).toBe(fold(x.normalize('NFC'), { foldIY }));
      }),
      run,
    );
  });

  it('leaves ASCII text untouched', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary-ascii', maxLength: 80 }), (x) => {
        expect(fold(x)).toBe(x);
      }),
      run,
    );
  });

  it('produces ASCII for Vietnamese text', () => {
    fc.assert(
      fc.property(syllableText, (x) => {
        expect(fold(x)).toMatch(/^[\x00-\x7f]*$/);
      }),
      run,
    );
  });

  it('keeps every non-letter character in order (NBSP aside)', () => {
    const nonLetters = (s: string) => [...s].filter((c) => !/[\p{L}\p{M}]/u.test(c)).join('');
    fc.assert(
      fc.property(textChars, fc.boolean(), (x, foldIY) => {
        expect(nonLetters(fold(x, { foldIY }))).toBe(nonLetters(x));
      }),
      run,
    );
  });

  it('keeps the token invariant: same count, token k <-> token k', () => {
    fc.assert(
      fc.property(vietnameseLike, fc.boolean(), (x, foldIY) => {
        const before = tokens(x);
        const after = tokens(fold(x, { foldIY }));
        expect(after).toHaveLength(before.length);
        before.forEach((t, k) => expect(after[k]).toBe(fold(t, { foldIY })));
      }),
      run,
    );
  });

  it('never changes the length by more than the NBSP replacement allows (code points)', () => {
    fc.assert(
      fc.property(vietnameseLike, (x) => {
        expect([...fold(x)].length).toBeLessThanOrEqual([...x.normalize('NFC')].length);
      }),
      run,
    );
  });

  it('foldIY never merges tai/tay style pairs', () => {
    const vowelOnset = fc.constantFrom('', 'b', 'c', 'h', 'k', 'l', 'm', 't', 'v', 'qu');
    const vowel = fc.constantFrom('a', 'o', 'u', 'e', 'â');
    fc.assert(
      fc.property(vowelOnset, vowel, (onset, v) => {
        const withI = fold(onset + v + 'i', { foldIY: true });
        const withY = fold(onset + v + 'y', { foldIY: true });
        expect(withI).not.toBe(withY);
      }),
      run,
    );
  });
});

describe('syllable properties', () => {
  const syllables = allSyllables();
  const anySyllable = fc
    .integer({ min: 0, max: syllables.length - 1 })
    .map((i) => syllables[i] as NonNullable<ReturnType<typeof parseSyllable>>);

  it('has a healthy number of syllables', () => {
    expect(syllables.length).toBeGreaterThan(2000);
  });

  it('compose then parse gives the same syllable, for both styles', () => {
    fc.assert(
      fc.property(anySyllable, fc.constantFrom(...TONES), styles, (s, tone, style) => {
        const syllable = { ...s, tone: tone as Tone };
        const word = composeSyllable(syllable, style);
        expect(parseSyllable(word)).toEqual(syllable);
        expect(parseSyllable(word.normalize('NFD'))).toEqual(syllable);
        expect(parseSyllable(word.toUpperCase())).toEqual(syllable);
      }),
      run,
    );
  });

  it('normalize leaves composed syllables unchanged for the same style', () => {
    fc.assert(
      fc.property(anySyllable, fc.constantFrom(...TONES), styles, (s, tone, style) => {
        const word = composeSyllable({ ...s, tone: tone as Tone }, style);
        expect(normalize(word, { tonePlacement: style })).toBe(word);
      }),
      run,
    );
  });
});
