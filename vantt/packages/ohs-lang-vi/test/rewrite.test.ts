import { describe, expect, it } from 'vitest';
import { TELEX_LETTER_KEYS, TELEX_TONE_KEYS, VNI_LETTER_KEYS, VNI_TONE_KEYS } from '../src/data.js';
import { resolveOptions } from '../src/options.js';
import { analyzeQuery, type QueryEnvironment } from '../src/query.js';
import { accentedForms, VocabularyCache } from '../src/restore.js';
import { composeSyllable, parseSyllable } from '../src/syllable.js';
import { decodeKeystrokes, decodeTelex, decodeVni, telexForms, vniForms } from '../src/telex.js';
import { editNeighbours } from '../src/typo.js';
import { projectView } from '../src/views.js';
import { fakeContext } from './fake-context.js';

const FINAL_CONSONANT_KEYS = 'bcdghklmnpqrstvx';

function typeKeys(
  word: string,
  letterKeys: Record<string, string>,
  toneKeys: readonly string[],
  toneFirst: boolean,
): string {
  const syllable = parseSyllable(word)!;
  const bare = composeSyllable({ ...syllable, tone: 0 });
  const keys = [...bare].map((ch) => letterKeys[ch] ?? ch).join('');
  const tone = syllable.tone === 0 ? '' : toneKeys[syllable.tone]!;
  // VNI allows the tone key before the final consonant; Telex needs it at the end.
  if (!toneFirst) return keys + tone;
  let cut = keys.length;
  while (cut > 0 && FINAL_CONSONANT_KEYS.includes(keys[cut - 1]!)) cut--;
  return keys.slice(0, cut) + tone + keys.slice(cut);
}

describe('decodeTelex / decodeVni', () => {
  it('decodes unfinished Telex words', () => {
    expect(decodeTelex('tieengs')).toBe('tiếng');
    expect(decodeTelex('vieetj')).toBe('việt');
    expect(decodeTelex('giuwx')).toBe('giữ');
    expect(decodeTelex('phuwowng')).toBe('phương');
    expect(decodeTelex('luwowcj')).toBe('lược');
    expect(decodeTelex('dduowcj')).toBe('được');
    expect(decodeTelex('ddi')).toBe('đi');
    expect(decodeTelex('tieen')).toBe('tiên');
  });

  it('decodes VNI with the tone key anywhere in the word', () => {
    expect(decodeVni('tie6ng')).toBe('tiêng');
    expect(decodeVni('tie6ng1')).toBe('tiếng');
    expect(decodeVni('vie65t')).toBe('việt');
    expect(decodeVni('d9i')).toBe('đi');
    expect(decodeVni('nuo7c')).toBe('nươc');
    expect(decodeVni('nuo71c')).toBe('nước');
    expect(decodeVni('an8')).toBe('ăn');
  });

  it('round-trips every syllable through Telex and VNI typing', () => {
    let count = 0;
    for (const list of accentedForms('modern', false).values()) {
      for (const word of list) {
        // Telex types a doubled plain vowel ("oong" for "ông") the same way as the modified one.
        if (/aa|ee|oo/.test(composeSyllable({ ...parseSyllable(word)!, tone: 0 }))) continue;
        count++;
        expect(telexForms(typeKeys(word, TELEX_LETTER_KEYS, TELEX_TONE_KEYS, false))).toContain(
          word,
        );
        for (const toneFirst of [false, true]) {
          const typed = typeKeys(word, VNI_LETTER_KEYS, VNI_TONE_KEYS, toneFirst);
          // Without a digit there is nothing to decode (a plain syllable).
          expect(vniForms(typed), typed).toEqual(
            /\d/.test(typed) ? expect.arrayContaining([word]) : [],
          );
        }
      }
    }
    expect(count).toBeGreaterThan(5000);
  });

  it('leaves English words and plain syllables undecoded', () => {
    for (const word of [
      'team',
      'online',
      'markdown',
      'github',
      'ban',
      'chan',
      '2024',
      'c++',
      'node.js',
    ])
      expect(decodeKeystrokes(word)).toEqual([]);
  });
});

describe('editNeighbours', () => {
  it('covers insert, delete, substitute and swap', () => {
    const n = editNeighbours('chna');
    expect(n).toEqual(
      expect.arrayContaining(['chan', 'cha', 'chnaa', ' chna'.trim() + 'x', 'chia']),
    );
    expect(n).not.toContain('chna');
  });
});

const VAULT = [
  'Giữ chân khách hàng',
  'Sắp xếp thời gian biểu',
  'Thói quen ngủ sớm dậy sớm',
  'Bí quyết chụp ảnh chân dung',
  'Nghệ thuật thuyết trình',
  'Team meeting seen online notes about tiếng Việt',
  'Cách trồng rau sạch tại nhà',
];

function env(overrides: Record<string, unknown>): QueryEnvironment {
  const options = resolveOptions(overrides);
  return {
    options,
    cache: new VocabularyCache(),
    forms: accentedForms(options.tonePlacement, options.foldIY),
    project: (view: string, text: string) => projectView(view, text, options),
  };
}

describe('query rewriting', () => {
  const ctx = fakeContext(VAULT);

  it('decodes Telex strings that the vault confirms and hands the text to BM25 and the embedder', () => {
    const analysis = analyzeQuery('giuwx chaan khachs hangf', ctx, env({ telex: true }));
    expect(analysis.baseQuery).toBe('giữ chân khách hàng');
    expect(analysis.embedQuery).toBe('giữ chân khách hàng');
    expect((analysis.data as { target: string[] }).target).toEqual([
      'giữ',
      'chân',
      'khách',
      'hàng',
    ]);
  });

  it('decodes VNI strings', () => {
    const analysis = analyzeQuery('giu74 cha6n kha1ch ha2ng', ctx, env({ telex: true }));
    expect(analysis.baseQuery).toBe('giữ chân khách hàng');
  });

  it('does nothing when the option is off', () => {
    const analysis = analyzeQuery(
      'giuwx chaan khachs hangf',
      ctx,
      env({ telex: false, typo: false }),
    );
    expect(analysis.baseQuery).toBeUndefined();
  });

  it('keeps English words and in-vocabulary words', () => {
    for (const q of ['team meeting', 'seen online', 'team seen online notes', 'khach hang']) {
      const analysis = analyzeQuery(q, ctx, env({ telex: true, typo: true }));
      expect(analysis.baseQuery, q).toBeUndefined();
      expect((analysis.debug as { rewrite?: unknown }).rewrite, q).toBeUndefined();
    }
  });

  it('does not decode a word the vault has no accented form of', () => {
    const analysis = analyzeQuery('hocj taapj', ctx, env({ telex: true }));
    expect(analysis.baseQuery).toBeUndefined();
  });

  it('corrects one-letter typos from the vault vocabulary, using neighbours', () => {
    const analysis = analyzeQuery('giu chna khahc hang', ctx, env({ typo: true }));
    expect((analysis.data as { target: string[] }).target).toEqual([
      'giữ',
      'chân',
      'khách',
      'hàng',
    ]);
    expect(analysis.viewQueries.fold).toBe('giu chan khach hang');
    const swapped = analyzeQuery('thio qune ngu som day som', ctx, env({ typo: true }));
    expect(swapped.viewQueries.fold).toBe('thoi quen ngu som day som');
  });

  it('leaves typos alone when the option is off and short or known words always', () => {
    expect(
      analyzeQuery('giu chna khahc hang', ctx, env({ telex: false, typo: false })).viewQueries.fold,
    ).toBe('giu chna khahc hang');
    const known = analyzeQuery('giu chan khach hang', ctx, env({ typo: true }));
    expect((known.debug as { rewrite?: unknown }).rewrite).toBeUndefined();
    const short = analyzeQuery('ca', ctx, env({ typo: true }));
    expect((short.debug as { rewrite?: unknown }).rewrite).toBeUndefined();
  });

  it('does not correct English words into Vietnamese syllables', () => {
    for (const q of ['markdown plugin', 'meeting notes', 'obsidian vault sync']) {
      const analysis = analyzeQuery(q, ctx, env({ typo: true }));
      expect(analysis.viewQueries.norm).toBeNull();
      expect(analysis.viewQueries.fold).toBeNull();
    }
  });
});
