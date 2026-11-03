import {
  BASE_VOWELS,
  CODAS,
  IY_ONSETS,
  MODIFIED_VOWELS,
  NUCLEI,
  ONSETS,
  ONSET_SPELLING,
  STYLE_DEPENDENT_RIMES,
  TONE_MARKS,
  toneVowel,
  type BaseVowel,
  type NucleusEntry,
  type Tone,
  type TonePlacement,
} from './data.js';
import { fold } from './fold.js';

/** A Vietnamese syllable split into its parts (all lowercase, tone removed). */
export interface Syllable {
  /** Initial consonant (phụ âm đầu); '' when absent. `qu` and `gi` are single onsets. */
  onset: string;
  /** Glide (âm đệm): 'o' or 'u' before the main vowel; '' when absent. */
  glide: '' | 'o' | 'u';
  /** Main vowel (âm chính), without the glide: "a", "ê", "iê", "ươ", "ai", "yê"... */
  nucleus: string;
  /** Final consonant (âm cuối); '' when absent. */
  coda: string;
  /** Tone (thanh), 0..5. */
  tone: Tone;
}

const NUCLEI_BY_LENGTH: readonly NucleusEntry[] = [...NUCLEI].sort(
  (a, b) => b.text.length - a.text.length,
);
const ONSET_CANDIDATES: readonly string[] = ['', ...ONSETS];

/** Does this onset + vowel cluster + coda follow the orthography? */
function fits(onset: string, entry: NucleusEntry, coda: string): boolean {
  if (!entry.codas.includes(coda)) return false;
  switch (entry.onset) {
    case 'some':
      if (onset === '') return false;
      break;
    case 'none-or-qu':
      if (onset !== '' && onset !== 'qu') return false;
      break;
    case 'no-qu':
      if (onset === 'qu') return false;
      break;
    case 'gi':
      if (onset !== 'gi') return false;
      break;
    case 'iy':
      if (!IY_ONSETS.includes(onset) || onset === 'qu') return false;
      break;
  }
  const first = entry.text[0] as string;
  if (onset === 'qu' && first === 'u') return false;
  if (onset === 'gi' && (first === 'i' || first === 'y')) return false;
  const allowed = ONSET_SPELLING[onset];
  if (allowed !== undefined && !allowed.includes(first)) return false;
  return true;
}

/** Find the (nucleus, coda) split of `rest`; null when none fits. */
function matchRime(onset: string, rest: string): { entry: NucleusEntry; coda: string } | null {
  for (const entry of NUCLEI_BY_LENGTH) {
    if (!rest.startsWith(entry.text)) continue;
    const coda = rest.slice(entry.text.length);
    if (coda !== '' && !CODAS.includes(coda)) continue;
    if (fits(onset, entry, coda)) return { entry, coda };
  }
  return null;
}

/** Extract the single tone mark (if any) and return the toneless NFC form. */
function splitTone(word: string): { bare: string; tone: Tone } | null {
  const decomposed = word.normalize('NFD');
  let tone: Tone = 0;
  let bare = '';
  for (const ch of decomposed) {
    const t = TONE_MARKS.indexOf(ch);
    if (t > 0) {
      if (tone !== 0) return null; // two tone marks: not one syllable
      tone = t as Tone;
    } else {
      bare += ch;
    }
  }
  return { bare: bare.normalize('NFC'), tone };
}

const SYLLABLE_CACHE_MAX = 8192;
const parseCache = new Map<string, Syllable | null>();

/**
 * Split a word into onset, glide, nucleus, coda and tone. Case-insensitive;
 * accepts NFC or NFD input, and a tone mark that sits on the wrong letter.
 * Returns null when the word is not a well-formed Vietnamese syllable (English
 * words such as "online" or "team" are rejected).
 */
export function parseSyllable(word: string): Syllable | null {
  const cached = parseCache.get(word);
  if (cached !== undefined) return cached;
  const result = parseUncached(word);
  if (parseCache.size >= SYLLABLE_CACHE_MAX) parseCache.clear();
  parseCache.set(word, result);
  return result;
}

function parseUncached(word: string): Syllable | null {
  if (word === '' || word.length > 12) return null;
  const split = splitTone(word.toLowerCase());
  if (split === null) return null;
  const { bare, tone } = split;
  for (const onset of ONSET_CANDIDATES) {
    if (!bare.startsWith(onset)) continue;
    const rime = matchRime(onset, bare.slice(onset.length));
    if (rime === null) continue;
    const { entry, coda } = rime;
    const glide = entry.glide === 1 ? (entry.text[0] as 'o' | 'u') : '';
    return { onset, glide, nucleus: entry.text.slice(entry.glide), coda, tone };
  }
  return null;
}

/** True when `word` is a well-formed Vietnamese syllable (any tone, any case). */
export function isVietnameseSyllable(word: string): boolean {
  return parseSyllable(word) !== null;
}

/** Index (in the glide + nucleus cluster) of the letter that carries the tone. */
export function toneIndex(cluster: string, hasCoda: boolean, style: TonePlacement): number {
  let modified = -1;
  for (let i = 0; i < cluster.length; i++) {
    if (MODIFIED_VOWELS.includes(cluster[i] as string)) modified = i;
  }
  if (modified >= 0) return modified;
  if (cluster.length === 3) return 1;
  if (cluster.length === 2 && STYLE_DEPENDENT_RIMES.includes(cluster)) {
    return hasCoda || style === 'modern' ? 1 : 0;
  }
  return 0;
}

/** Build the NFC text of a syllable with the tone placed per `style`. */
export function composeSyllable(syllable: Syllable, style: TonePlacement = 'modern'): string {
  const cluster = syllable.glide + syllable.nucleus;
  const at = syllable.tone === 0 ? -1 : toneIndex(cluster, syllable.coda !== '', style);
  let out = syllable.onset;
  for (let i = 0; i < cluster.length; i++) {
    const letter = cluster[i] as BaseVowel;
    out += i === at ? toneVowel(letter, syllable.tone) : letter;
  }
  return (out + syllable.coda).normalize('NFC');
}

// ---------------------------------------------------------------------------
// Folded (unaccented) syllables
// ---------------------------------------------------------------------------

let foldedSyllables: Set<string> | null = null;

function buildFoldedSyllables(): Set<string> {
  const set = new Set<string>();
  for (const onset of ONSET_CANDIDATES) {
    for (const entry of NUCLEI) {
      for (const coda of entry.codas) {
        if (fits(onset, entry, coda)) set.add(fold(onset + entry.text + coda));
      }
    }
  }
  return set;
}

/**
 * True when some Vietnamese syllable folds to `word`: "ban", "hang", "tieng"
 * are possible, "online", "team", "seen" are not. Case-insensitive. Only
 * meaningful for already-unaccented input; use `isVietnameseSyllable` for
 * accented words.
 */
export function isPossibleFoldedSyllable(word: string): boolean {
  foldedSyllables ??= buildFoldedSyllables();
  return foldedSyllables.has(fold(word.toLowerCase()));
}

/** The 12 base vowels, re-exported for callers that build their own tables. */
export { BASE_VOWELS };
