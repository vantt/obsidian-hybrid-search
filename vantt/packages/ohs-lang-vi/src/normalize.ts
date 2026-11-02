import { ASCII_RE, cleanOddChars } from './chars.js';
import type { TonePlacement } from './data.js';
import { composeSyllable, parseSyllable } from './syllable.js';

export interface NormalizeOptions {
  /**
   * Where the tone mark goes on the open clusters oa, oe, uy:
   * "modern" (hoà, khoẻ, thuỷ; default) or "classic" (hòa, khỏe, thủy).
   */
  tonePlacement?: TonePlacement;
}

const WORD_RE = /[\p{L}\p{M}]+/gu;
const MAX_CACHE = 32768;
const caches: Record<TonePlacement, Map<string, string>> = { modern: new Map(), classic: new Map() };

function lowerCase(s: string): string {
  if (!s.includes('İ')) return s.toLowerCase();
  // U+0130 lowercases to two code points ("i" + a combining dot); keep it as is
  // so token boundaries never change.
  let out = '';
  for (const ch of s) out += ch === 'İ' ? ch : ch.toLowerCase();
  return out;
}

function fixWord(word: string, style: TonePlacement): string {
  if (ASCII_RE.test(word)) return word;
  const cache = caches[style];
  const hit = cache.get(word);
  if (hit !== undefined) return hit;
  const syllable = parseSyllable(word);
  const out = syllable !== null && syllable.tone !== 0 ? composeSyllable(syllable, style) : word;
  if (cache.size >= MAX_CACHE) cache.clear();
  cache.set(word, out);
  return out;
}

/**
 * Accent-preserving normalization: NFC; lowercase; Ð/ð become đ; non-breaking
 * spaces become plain spaces; the tone mark of every well-formed Vietnamese
 * syllable moves to the position chosen by `tonePlacement` (a loose tone mark
 * is attached to the right vowel). Words that are not Vietnamese syllables are
 * only lowercased. Pure and idempotent.
 */
export function normalize(text: string, options?: NormalizeOptions): string {
  if (ASCII_RE.test(text)) return text.toLowerCase();
  const style = options?.tonePlacement ?? 'modern';
  const s = lowerCase(cleanOddChars(text).normalize('NFC')).normalize('NFC');
  return s.replace(WORD_RE, (word) => fixWord(word, style));
}
