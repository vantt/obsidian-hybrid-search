import { CODAS, NUCLEI, ONSETS, TONES, toneVowel, type BaseVowel, type Tone } from '../src/data.js';
import { composeSyllable, parseSyllable, type Syllable } from '../src/syllable.js';

/**
 * Tokenization used by the FTS5 `unicode61 remove_diacritics 0` tokenizer:
 * letters, numbers, private-use characters and combining marks are token
 * characters, everything else separates tokens.
 */
export function tokens(text: string): string[] {
  return text.split(/[^\p{L}\p{N}\p{Co}\p{M}]+/u).filter((t) => t !== '');
}

/**
 * Tokenization of the view tokenizer `unicode61 remove_diacritics 0
 * tokenchars '+#'` (the P01 contract, emulated by the core in
 * src/language/tokens.ts): `tokens` plus `+` and `#` as token characters.
 * Written as a split, independently of the pack's own TOKEN_RE.
 */
export function viewTokens(text: string): string[] {
  return text.split(/[^\p{L}\p{N}\p{Co}\p{M}+#]+/u).filter((t) => t !== '');
}

/** Every onset + cluster + coda combination that parses as a syllable (tone 0). */
export function allSyllables(): Syllable[] {
  const seen = new Set<string>();
  const out: Syllable[] = [];
  for (const onset of ['', ...ONSETS]) {
    for (const entry of NUCLEI) {
      for (const coda of ['', ...CODAS]) {
        const word = onset + entry.text + coda;
        if (seen.has(word)) continue;
        seen.add(word);
        const parsed = parseSyllable(word);
        if (parsed !== null) out.push(parsed);
      }
    }
  }
  return out;
}

/** Small deterministic PRNG (mulberry32) for reproducible perf corpora. */
export function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Build roughly `bytes` bytes (UTF-8) of Vietnamese-looking text. */
export function vietnameseText(bytes: number, form: 'NFC' | 'NFD' = 'NFC', seed = 1): string {
  const rand = prng(seed);
  const syllables = allSyllables();
  const words = syllables.map((s) => composeSyllable({ ...s, tone: TONES[Math.floor(rand() * 6)] as Tone }));
  const english = ['online', 'team', 'meeting', 'project', 'deadline', 'review'];
  const seps = [' ', ' ', ' ', ' ', ', ', '. ', '\n', ' - '];
  const parts: string[] = [];
  let size = 0;
  while (size < bytes) {
    const w = rand() < 0.04 ? (english[Math.floor(rand() * english.length)] as string) : (words[Math.floor(rand() * words.length)] as string);
    const cap = rand() < 0.05 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    const piece = cap + (seps[Math.floor(rand() * seps.length)] as string);
    parts.push(piece);
    size += Buffer.byteLength(piece);
  }
  return parts.join('').normalize(form);
}

export function randomToneOf(vowel: BaseVowel, tone: Tone): string {
  return toneVowel(vowel, tone);
}
