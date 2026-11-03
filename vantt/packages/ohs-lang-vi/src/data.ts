/**
 * Data tables for the Vietnamese pack (PRD 10.3, "Bảng dữ liệu cần soạn").
 * Pure constants and tables derived from them. No behaviour lives here except
 * table generation.
 */

/** Tone index: 0 ngang, 1 huyền, 2 sắc, 3 hỏi, 4 ngã, 5 nặng. */
export type Tone = 0 | 1 | 2 | 3 | 4 | 5;

export const TONES: readonly Tone[] = [0, 1, 2, 3, 4, 5];

export const TONE_NAMES = ['ngang', 'huyen', 'sac', 'hoi', 'nga', 'nang'] as const;

/** Combining tone marks by tone index; tone 0 has no mark. */
export const TONE_MARKS: readonly string[] = [
  '',
  '̀', // huyền
  '́', // sắc
  '̉', // hỏi
  '̃', // ngã
  '̣', // nặng
];

/** Matches any of the five combining tone marks. */
export const TONE_MARK_RE = /[̣̀́̃̉]/;

export type TonePlacement = 'modern' | 'classic';

/** The 12 basic Vietnamese vowels. */
export const BASE_VOWELS = ['a', 'ă', 'â', 'e', 'ê', 'i', 'o', 'ô', 'ơ', 'u', 'ư', 'y'] as const;
export type BaseVowel = (typeof BASE_VOWELS)[number];

/**
 * 12 vowels x 6 tones in NFC, typed out literally (tone order: ngang, huyền,
 * sắc, hỏi, ngã, nặng). The tests cross-check each cell against an
 * independent Unicode composition.
 */
export const VOWEL_TONE_TABLE: Readonly<
  Record<BaseVowel, readonly [string, string, string, string, string, string]>
> = {
  a: ['a', 'à', 'á', 'ả', 'ã', 'ạ'],
  ă: ['ă', 'ằ', 'ắ', 'ẳ', 'ẵ', 'ặ'],
  â: ['â', 'ầ', 'ấ', 'ẩ', 'ẫ', 'ậ'],
  e: ['e', 'è', 'é', 'ẻ', 'ẽ', 'ẹ'],
  ê: ['ê', 'ề', 'ế', 'ể', 'ễ', 'ệ'],
  i: ['i', 'ì', 'í', 'ỉ', 'ĩ', 'ị'],
  o: ['o', 'ò', 'ó', 'ỏ', 'õ', 'ọ'],
  ô: ['ô', 'ồ', 'ố', 'ổ', 'ỗ', 'ộ'],
  ơ: ['ơ', 'ờ', 'ớ', 'ở', 'ỡ', 'ợ'],
  u: ['u', 'ù', 'ú', 'ủ', 'ũ', 'ụ'],
  ư: ['ư', 'ừ', 'ứ', 'ử', 'ữ', 'ự'],
  y: ['y', 'ỳ', 'ý', 'ỷ', 'ỹ', 'ỵ'],
};

/** Vowels that carry their own diacritic (breve, circumflex, horn). */
export const MODIFIED_VOWELS = 'ăâêôơư';

/** Toned vowel in NFC, lowercase. */
export function toneVowel(vowel: BaseVowel, tone: Tone): string {
  return VOWEL_TONE_TABLE[vowel][tone];
}

/** Toned vowel in NFD (base letter, vowel diacritic, tone mark). */
export function toneVowelNfd(vowel: BaseVowel, tone: Tone): string {
  return toneVowel(vowel, tone).normalize('NFD');
}

// ---------------------------------------------------------------------------
// Initial consonants (phụ âm đầu)
// ---------------------------------------------------------------------------

/**
 * Initial consonants, longest first. `qu` is written as one onset: the `u` is
 * part of the onset, so tone placement never lands on it. `gi` is handled
 * specially by the parser (see syllable.ts): "gì", "gin" are `g` + `i`.
 */
export const ONSETS: readonly string[] = [
  'ngh',
  'gh',
  'ng',
  'nh',
  'ph',
  'th',
  'tr',
  'kh',
  'ch',
  'gi',
  'qu',
  'b',
  'c',
  'd',
  'đ',
  'g',
  'h',
  'k',
  'l',
  'm',
  'n',
  'r',
  's',
  't',
  'v',
  'x',
];

const FRONT_VOWELS = 'eêiy';
const BACK_VOWELS = 'aăâoôơuư';

/**
 * Spelling rules: which initial letters of the rime each onset accepts.
 * c/k, g/gh, ng/ngh are complementary; unlisted onsets accept anything.
 */
export const ONSET_SPELLING: Readonly<Record<string, string>> = {
  c: BACK_VOWELS,
  k: FRONT_VOWELS,
  g: BACK_VOWELS + 'i', // gì, gin: the i doubles as part of the gi onset
  gh: 'eêi',
  ng: BACK_VOWELS,
  ngh: 'eêi',
};

// ---------------------------------------------------------------------------
// Rimes (âm đệm + âm chính), with allowed codas
// ---------------------------------------------------------------------------

export const CODAS: readonly string[] = ['ch', 'ng', 'nh', 'c', 'm', 'n', 'p', 't'];

export interface NucleusEntry {
  /** Vowel cluster including the glide (âm đệm), e.g. "oa", "uyê", "ươ". */
  text: string;
  /** 1 when the first letter is a glide (âm đệm): o/u before a, ă, e, y, ê, â, ơ. */
  glide: 0 | 1;
  /** Allowed codas; empty string means an open syllable is allowed. */
  codas: readonly string[];
  /**
   * Onset constraint: 'any'; 'some' (needs a non-empty onset); 'none-or-qu'
   * (y-initial clusters: no onset, or the `qu` onset); 'no-qu' (glide-initial
   * clusters, which cannot follow `qu` because its `u` is the glide); 'gi'
   * (only after the `gi` onset); 'iy' (open `y` after the onsets that also
   * spell it `i`: kỹ, lý, mỹ, tý, sỹ, hy, vy, dy; see `IY_ONSETS`).
   */
  onset: 'any' | 'some' | 'none-or-qu' | 'no-qu' | 'gi' | 'iy';
}

const OPEN = [''];
const C_STOP_NASAL_ALL = ['c', 'ch', 'm', 'n', 'ng', 'nh', 'p', 't'];

function n(
  text: string,
  glide: 0 | 1,
  codas: readonly string[],
  onset: NucleusEntry['onset'] = 'any',
): NucleusEntry {
  return { text, glide, codas, onset };
}

/**
 * Valid vowel clusters. Triple and diphthong entries first within each group
 * is not required: the parser tries every entry and keeps those that fit.
 * Coda rules: `ch`/`nh` only after a, ê, i, y; `ng` not after i, ê, ơ, y.
 */
export const NUCLEI: readonly NucleusEntry[] = [
  // monophthongs
  n('a', 0, ['', ...C_STOP_NASAL_ALL]),
  n('ă', 0, ['c', 'm', 'n', 'ng', 'p', 't']),
  n('â', 0, ['c', 'm', 'n', 'ng', 'p', 't']),
  n('e', 0, ['', 'c', 'm', 'n', 'ng', 'p', 't']),
  n('ê', 0, ['', 'ch', 'm', 'n', 'nh', 'p', 't']),
  n('ê', 0, ['ng'], 'gi'), // giêng, giếng: the only ê + ng, after the gi onset
  n('i', 0, ['', 'ch', 'm', 'n', 'nh', 'p', 't']),
  n('o', 0, ['', 'c', 'm', 'n', 'ng', 'p', 't']),
  n('ô', 0, ['', 'c', 'm', 'n', 'ng', 'p', 't']),
  n('ơ', 0, ['', 'm', 'n', 'p', 't']),
  n('u', 0, ['', 'c', 'm', 'n', 'ng', 'p', 't']),
  n('ư', 0, ['', 'c', 'ng', 'm']),
  n('y', 0, ['', 't', 'nh', 'ch'], 'none-or-qu'),
  n('y', 0, OPEN, 'iy'), // kỹ, lý, mỹ, hy: open y after a consonant
  n('oo', 0, ['ng', 'c']),
  // descending diphthongs and open clusters (no coda)
  ...[
    'ai',
    'ao',
    'au',
    'ay',
    'âu',
    'ây',
    'eo',
    'êu',
    'iu',
    'oi',
    'ôi',
    'ơi',
    'ui',
    'ưi',
    'ưu',
    'ia',
    'ua',
    'ưa',
  ].map((t) => n(t, 0, OPEN)),
  // centring diphthongs (need a coda, except in the triphthongs below)
  n('iê', 0, ['c', 'm', 'n', 'ng', 'p', 't'], 'some'),
  n('yê', 0, ['m', 'n', 'ng', 't'], 'none-or-qu'),
  n('uô', 0, ['c', 'm', 'n', 'ng', 't']),
  n('ươ', 0, ['c', 'm', 'n', 'ng', 'p', 't']),
  // triphthongs without glide
  n('iêu', 0, OPEN, 'some'),
  n('yêu', 0, OPEN, 'none-or-qu'),
  n('uôi', 0, OPEN),
  n('ươi', 0, OPEN),
  n('ươu', 0, OPEN),
  // glide + vowel
  n('oa', 1, ['', ...C_STOP_NASAL_ALL], 'no-qu'),
  n('oă', 1, ['c', 'm', 'n', 'ng', 't'], 'no-qu'),
  n('oe', 1, ['', 'n', 't'], 'no-qu'),
  n('uy', 1, ['', 't', 'nh', 'ch'], 'no-qu'),
  n('uê', 1, ['', 'nh', 'ch'], 'no-qu'),
  n('uâ', 1, ['n', 'ng', 't'], 'no-qu'),
  n('uơ', 1, OPEN, 'no-qu'),
  // glide + diphthong / triphthong
  n('oai', 1, OPEN, 'no-qu'),
  n('oay', 1, OPEN, 'no-qu'),
  n('oeo', 1, OPEN, 'no-qu'),
  n('uai', 1, OPEN, 'no-qu'),
  n('uay', 1, OPEN, 'no-qu'),
  n('uây', 1, OPEN, 'no-qu'),
  n('uya', 1, OPEN, 'no-qu'),
  n('uyu', 1, OPEN, 'no-qu'),
  n('uyê', 1, ['n', 't'], 'no-qu'),
];

/**
 * Tone-mark placement for vowel clusters with no modified vowel (â ê ô ơ ư ă):
 * - three letters: the middle one (oai, oay, uai, uay, oeo, uyu, uya);
 * - glide clusters oa, oe, uy: second letter in the "modern" style, first
 *   letter in the "classic" style, but only for open syllables; with a coda
 *   the tone always goes on the second letter;
 * - other two-letter clusters: the first letter.
 * Clusters containing a modified vowel take the tone on the last modified
 * vowel (ươ -> ơ, iê -> ê, uyê -> ê).
 * This table lists the glide clusters that differ between styles.
 */
export const STYLE_DEPENDENT_RIMES: readonly string[] = ['oa', 'oe', 'uy', 'oo'];

// ---------------------------------------------------------------------------
// i/y folding
// ---------------------------------------------------------------------------

/**
 * Onsets after which a syllable-final `y` folds to `i` when `foldIY` is on:
 * kĩ/kỹ, lí/lý, mĩ/mỹ, tí/tý, sĩ/sỹ, hi/hy, vi/vy, di/dy, qui/quy.
 * `ng` is omitted because `ngi`/`ngy` is not Vietnamese spelling (`ngh` + i);
 * `qu` is included because qui/quy are interchangeable spellings of the same
 * words (quy tắc / qui tắc). A bare `i`/`y` (no onset) and vowel-final
 * syllables (tai/tay, mai/may) are never merged.
 */
export const IY_ONSETS: readonly string[] = ['k', 'l', 'm', 't', 's', 'h', 'v', 'd', 'qu'];

// ---------------------------------------------------------------------------
// Telex and VNI
// ---------------------------------------------------------------------------

export type TypingMethod = 'telex' | 'vni';

/** Tone key per tone index (tone 0 is typed with the "remove tone" key). */
export const TELEX_TONE_KEYS: readonly string[] = ['z', 'f', 's', 'r', 'x', 'j'];
export const VNI_TONE_KEYS: readonly string[] = ['0', '2', '1', '3', '4', '5'];

/** Keys that type each modified letter (đ included), in the order typed. */
export const TELEX_LETTER_KEYS: Readonly<Record<string, string>> = {
  â: 'aa',
  ă: 'aw',
  ê: 'ee',
  ô: 'oo',
  ơ: 'ow',
  ư: 'uw',
  đ: 'dd',
};
export const VNI_LETTER_KEYS: Readonly<Record<string, string>> = {
  â: 'a6',
  ă: 'a8',
  ê: 'e6',
  ô: 'o6',
  ơ: 'o7',
  ư: 'u7',
  đ: 'd9',
};

/** Letter-typing keys for a plain vowel (a, e, i, o, u, y have none). */
function letterKeys(method: TypingMethod, letter: string): string {
  const table = method === 'telex' ? TELEX_LETTER_KEYS : VNI_LETTER_KEYS;
  return table[letter] ?? letter;
}

/**
 * Every vowel x tone combination: the typed key sequence -> the NFC letter.
 * Tone 0 is omitted for plain keys (typing "a" gives "a"); the "remove tone"
 * key is only meaningful after a toned letter, so tone 0 entries for modified
 * vowels are kept without the z/0 key (typing "aa" gives "â").
 */
export function buildTypingTable(method: TypingMethod): Map<string, string> {
  const toneKeys = method === 'telex' ? TELEX_TONE_KEYS : VNI_TONE_KEYS;
  const table = new Map<string, string>();
  for (const vowel of BASE_VOWELS) {
    for (const tone of TONES) {
      const typed = letterKeys(method, vowel) + (tone === 0 ? '' : toneKeys[tone]);
      table.set(typed, toneVowel(vowel, tone));
    }
  }
  const dKeys = letterKeys(method, 'đ');
  table.set(dKeys, 'đ');
  return table;
}

export const TELEX_TABLE: ReadonlyMap<string, string> = buildTypingTable('telex');
export const VNI_TABLE: ReadonlyMap<string, string> = buildTypingTable('vni');
