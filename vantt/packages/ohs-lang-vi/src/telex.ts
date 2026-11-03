/**
 * Decode Telex and VNI keystroke strings that were typed without a Vietnamese
 * input method ("tieengs", "tie6ng" for "tiếng"), including unfinished words.
 *
 * Pure: the decoders only answer "what would this keystroke string compose
 * to". Whether to trust the answer is decided against the vault vocabulary
 * (`rewrite.ts`), which is what keeps English words such as "team" untouched.
 */
import {
  TELEX_LETTER_KEYS,
  TELEX_TONE_KEYS,
  VNI_TONE_KEYS,
  type Tone,
  type TonePlacement,
} from './data.js';
import { composeSyllable, parseSyllable } from './syllable.js';

const TELEX_RE = /^[a-z]+$/;
const VNI_RE = /^[a-z0-9]+$/;

const LETTER_KEYS: ReadonlyArray<[string, string]> = Object.entries(TELEX_LETTER_KEYS).map(
  ([letter, keys]): [string, string] => [keys, letter],
);
/** "uow" is "ươ" in most editors but "uơ" in "thuở", "huơ": both are tried. */
const TELEX_READINGS: ReadonlyArray<ReadonlyArray<[string, string]>> = [
  [['uwow', 'ươ'], ['uow', 'ươ'], ['uwo', 'ươ'], ...LETTER_KEYS],
  [['uwow', 'ươ'], ...LETTER_KEYS],
];

function compose(bare: string, tone: number, style: TonePlacement): string | null {
  const syllable = parseSyllable(bare);
  if (syllable === null || syllable.tone !== 0) return null;
  return composeSyllable({ ...syllable, tone: tone as Tone }, style);
}

/**
 * Telex: the tone key (s f r x j) ends the word; letter keys (aa ee oo dd aw
 * ow uw, uow) may sit anywhere. Returns every NFC syllable the keystrokes can
 * compose (usually one), best reading first.
 */
export function telexForms(token: string, style: TonePlacement = 'modern'): string[] {
  const typed = token.toLowerCase();
  if (!TELEX_RE.test(typed)) return [];
  let tone = 0;
  let rest = typed;
  const toneAt = typed.length > 1 ? TELEX_TONE_KEYS.indexOf(typed.slice(-1)) : -1;
  if (toneAt > 0) {
    tone = toneAt;
    rest = typed.slice(0, -1);
  }
  const out: string[] = [];
  for (const reading of TELEX_READINGS) {
    let letters = rest;
    for (const [keys, letter] of reading) letters = letters.split(keys).join(letter);
    if (letters.includes('w')) continue;
    const form = compose(letters, tone, style);
    if (form !== null && !out.includes(form)) out.push(form);
  }
  return out;
}

export function decodeTelex(token: string, style: TonePlacement = 'modern'): string | null {
  return telexForms(token, style)[0] ?? null;
}

const VNI_MODIFIERS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  '6': { a: 'â', e: 'ê', o: 'ô' },
  '7': { o: 'ơ', u: 'ư' },
  '8': { a: 'ă' },
  '9': { d: 'đ' },
};

function decodeVniReading(typed: string, style: TonePlacement, pairUo: boolean): string | null {
  const letters: string[] = [];
  let tone = 0;
  for (const ch of typed) {
    if (ch >= '0' && ch <= '5') {
      tone = VNI_TONE_KEYS.indexOf(ch);
      continue;
    }
    const modifier = VNI_MODIFIERS[ch];
    if (modifier === undefined) {
      letters.push(ch);
      continue;
    }
    // The key modifies the nearest preceding letter it can modify.
    let at = letters.length - 1;
    while (at >= 0 && modifier[letters[at]!] === undefined) at--;
    if (at < 0 || letters.length - at > 3) return null;
    letters[at] = modifier[letters[at]!]!;
    if (pairUo && ch === '7' && letters[at] === 'ơ' && letters[at - 1] === 'u')
      letters[at - 1] = 'ư';
  }
  const bare = letters.join('').replace(/ưo/g, 'ươ');
  return /\d/.test(bare) ? null : compose(bare, tone, style);
}

/**
 * VNI: digits 1-5 are tones (0 removes), 6-9 modify the nearest preceding
 * letter (a6 â, o7 ơ, a8 ă, d9 đ) and may come before the final consonant.
 * "uo7" reads as "ươ" first, then as "uơ" ("thuở").
 */
export function vniForms(token: string, style: TonePlacement = 'modern'): string[] {
  const typed = token.toLowerCase();
  if (!VNI_RE.test(typed) || !/\d/.test(typed)) return [];
  const out: string[] = [];
  for (const pairUo of [true, false]) {
    const form = decodeVniReading(typed, style, pairUo);
    if (form !== null && !out.includes(form)) out.push(form);
  }
  return out;
}

export function decodeVni(token: string, style: TonePlacement = 'modern'): string | null {
  return vniForms(token, style)[0] ?? null;
}

/** Every distinct decoding of one keystroke string (Telex first, then VNI). */
export function decodeKeystrokes(token: string, style: TonePlacement = 'modern'): string[] {
  const out: string[] = [];
  for (const form of [...telexForms(token, style), ...vniForms(token, style)]) {
    if (form !== token.toLowerCase() && !out.includes(form)) out.push(form);
  }
  return out;
}
