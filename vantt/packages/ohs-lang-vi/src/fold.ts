import { ASCII_RE, cleanOddChars } from './chars.js';
import { IY_ONSETS } from './data.js';

export interface FoldOptions {
  /**
   * Merge a syllable-final `y` into `i` after the onsets in `IY_ONSETS`
   * (kĩ/kỹ, lí/lý, hi/hy). Never merges after a vowel (tai stays != tay).
   */
  foldIY?: boolean;
}

const COMBINING_MARKS_RE = /[̀-ͯ]/g;
// eslint-disable-next-line no-control-regex -- ASCII range check; \x00 is its intended lower bound
const NON_ASCII_RE = /[^\x00-\x7f]/gu;
const MAX_CACHE = 4096;
const charCache = new Map<string, string>();

function foldChar(ch: string): string {
  const hit = charCache.get(ch);
  if (hit !== undefined) return hit;
  let out: string;
  if (ch === 'đ') out = 'd';
  else if (ch === 'Đ') out = 'D';
  else out = ch.normalize('NFD').replace(COMBINING_MARKS_RE, '').normalize('NFC');
  if (charCache.size >= MAX_CACHE) charCache.clear();
  charCache.set(ch, out);
  return out;
}

const IY_RE = new RegExp(
  `(?<![\\p{L}\\p{N}\\p{M}])(?:${IY_ONSETS.join('|')})y(?![\\p{L}\\p{N}\\p{M}])`,
  'giu',
);

function foldIYWord(word: string): string {
  const last = word.charCodeAt(word.length - 1);
  return word.slice(0, -1) + (last === 0x59 ? 'I' : 'i');
}

/**
 * Remove diacritics: NFC, strip the combining marks of every Latin letter
 * (tone marks, circumflex, breve, horn), `đ -> d`, `Đ -> D`. Case is
 * preserved; characters that are not diacritic-bearing letters (digits,
 * punctuation, emoji, other scripts) are untouched. Idempotent.
 */
export function fold(text: string, options?: FoldOptions): string {
  let s = text;
  if (!ASCII_RE.test(s)) {
    s = cleanOddChars(s).normalize('NFC').replace(NON_ASCII_RE, foldChar);
    if (!ASCII_RE.test(s)) s = s.normalize('NFC');
  }
  if (options?.foldIY) s = s.replace(IY_RE, foldIYWord);
  return s;
}

const I_FORMS = 'iíìỉĩị';
const Y_FORMS = 'yýỳỷỹỵ';
const IY_WORD_RE = new RegExp(`^(${IY_ONSETS.join('|')})([${I_FORMS}${Y_FORMS}])$`, 'u');

/**
 * The other spelling of a lowercase NFC syllable written with a final i or y
 * after an onset of `IY_ONSETS` (kĩ <-> kỹ, lí <-> lý, quí <-> quý), keeping
 * the tone; null for any other word. Both spellings are in use for the same
 * word, so query-time matching treats them alike even when the index keeps
 * them apart (`foldIY` off).
 */
export function iyVariant(word: string): string | null {
  const m = IY_WORD_RE.exec(word);
  if (!m) return null;
  const vowel = m[2]!;
  const i = I_FORMS.indexOf(vowel);
  return m[1]! + (i >= 0 ? Y_FORMS[i]! : I_FORMS[Y_FORMS.indexOf(vowel)]!);
}

/** One spelling for both i/y forms of a syllable (the i one); other words unchanged. */
export function iyCanonical(word: string): string {
  const m = IY_WORD_RE.exec(word);
  if (!m) return word;
  const y = Y_FORMS.indexOf(m[2]!);
  return y >= 0 ? m[1]! + I_FORMS[y]! : word;
}
