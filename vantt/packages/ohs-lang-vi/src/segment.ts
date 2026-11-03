/**
 * Word segmentation for the `seg` view (PRD 10.4).
 *
 * Syllables of a compound word are joined with `_` ("khách hàng" ->
 * "khách_hàng"), so a query for "khách hàng" matches the compound and not a
 * note that only has "hàng hoá" or "khách" somewhere. The P01 token invariant
 * counts a view token with `_` as that many source tokens.
 *
 * Compounds come from the bundled dictionary (`data/compounds.txt`, two
 * syllables each, see `data/README.md`) plus the user's lexicon (`## Từ ghép`,
 * any length), which is injected: this module does not read the lexicon.
 *
 * Segmentation of a run of syllables is a shortest path: fewest words, ties
 * broken by taking the longer word first. It depends on the words only, never
 * on vault statistics, so `project()` stays pure; the query side uses the same
 * function, then may add compounds the vault actually has (`query.ts`).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { byCodeUnit } from './chars.js';
import type { TonePlacement } from './data.js';
import { normalize } from './normalize.js';
import { TOKEN_RE, tokenize } from './views.js';

/** Join character between the syllables of a compound in the seg view. */
export const SEG_JOINER = '_';

/** The seg view tokenizer: the P01 default plus `_` as a token character. */
export const SEG_TOKENIZER = "unicode61 remove_diacritics 0 tokenchars '+#_'";

/** Separators that may sit inside a compound: spaces and tabs only (no line breaks, no punctuation). */
const JOINABLE_SEPARATOR_RE = /^[ \t\u00a0\u2007\u202f]+$/;

const DICTIONARY_URL = new URL('../data/compounds.txt', import.meta.url);

export interface CompoundDictionary {
  /** Compounds as space-joined normalized words. */
  entries: ReadonlySet<string>;
  /** Most words in one entry. */
  maxWords: number;
  /** Short digest of the entries (goes into `signature()`). */
  digest: string;
}

const digestOf = (sortedEntries: readonly string[]): string =>
  createHash('sha256').update(sortedEntries.join('\n')).digest('hex').slice(0, 12);

/**
 * Build a dictionary from compound words (each a list of words, or a
 * space-separated string), on top of `base` when given. Entries are
 * normalized with `tonePlacement`; entries with fewer than two words are
 * ignored.
 */
export function buildDictionary(
  compounds: Iterable<string | readonly string[]>,
  tonePlacement: TonePlacement = 'modern',
  base?: CompoundDictionary,
): CompoundDictionary {
  const entries = new Set<string>(base?.entries);
  let maxWords = base?.maxWords ?? 0;
  for (const compound of compounds) {
    const text = typeof compound === 'string' ? compound : compound.join(' ');
    const words = tokenize(normalize(text, { tonePlacement }));
    if (words.length < 2) continue;
    entries.add(words.join(' '));
    maxWords = Math.max(maxWords, words.length);
  }
  return { entries, maxWords, digest: digestOf([...entries].sort(byCodeUnit)) };
}

/**
 * Read a compound list file, one compound per line (`#` starts a comment).
 * Throws when the file is missing or has no entry: a pack installed without
 * its `data/` directory must fail to load (P01 then reports the error in
 * `status`), never run quietly without its dictionary.
 */
export function readCompoundList(url: URL): string[] {
  let text: string;
  try {
    text = readFileSync(url, 'utf8');
  } catch (e) {
    throw new Error(
      `ohs-lang-vi: cannot read the bundled compound dictionary ${fileURLToPath(url)} (${(e as Error).message}); ` +
        'the package was installed without its data/ directory',
      { cause: e },
    );
  }
  const entries = text.split('\n').filter((line) => line !== '' && !line.startsWith('#'));
  if (entries.length === 0)
    throw new Error(`ohs-lang-vi: the bundled compound dictionary ${fileURLToPath(url)} is empty`);
  return entries;
}

let bundledEntries: string[] | null = null;

/** The bundled two-syllable compounds (read once per process). */
export function bundledCompounds(): string[] {
  bundledEntries ??= readCompoundList(DICTIONARY_URL);
  return bundledEntries;
}

const bundledDictionaries = new Map<TonePlacement, CompoundDictionary>();

/** The bundled dictionary for one tone placement (built once per process). */
export function bundledDictionary(tonePlacement: TonePlacement): CompoundDictionary {
  let dictionary = bundledDictionaries.get(tonePlacement);
  if (!dictionary) {
    dictionary = buildDictionary(bundledCompounds(), tonePlacement);
    bundledDictionaries.set(tonePlacement, dictionary);
  }
  return dictionary;
}

/**
 * Segment one run of normalized words. Returns the length (in words) of each
 * segment, in order; the lengths sum to `words.length`.
 */
export function segmentWords(words: readonly string[], dictionary: CompoundDictionary): number[] {
  const n = words.length;
  if (n < 2 || dictionary.maxWords < 2) return words.map(() => 1);
  // best[i]: fewest words covering words[i..n); step[i]: length of the first one.
  const best = new Array<number>(n + 1).fill(0);
  const step = new Array<number>(n + 1).fill(1);
  for (let i = n - 1; i >= 0; i--) {
    best[i] = best[i + 1]! + 1;
    step[i] = 1;
    let key = words[i]!;
    for (let len = 2; len <= dictionary.maxWords && i + len <= n; len++) {
      key += ` ${words[i + len - 1]}`;
      if (!dictionary.entries.has(key)) continue;
      const cost = best[i + len]! + 1;
      // `<=`: on a tie the longer first word wins (left-to-right longest match).
      if (cost <= best[i]!) {
        best[i] = cost;
        step[i] = len;
      }
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i += step[i]!) out.push(step[i]!);
  return out;
}

/** Compound words (space-joined) of a segmentation of `words`. */
export function compoundsOf(words: readonly string[], dictionary: CompoundDictionary): string[] {
  const out: string[] = [];
  let i = 0;
  for (const len of segmentWords(words, dictionary)) {
    if (len > 1) out.push(words.slice(i, i + len).join(' '));
    i += len;
  }
  return out;
}

/**
 * Seg view projection of text whose tokens were already projected to the norm
 * view by `normToken`. Separators are copied unchanged except the ones inside
 * a compound, which become `_`; so the view has one token per compound and
 * one per other source token.
 */
export function projectSegmented(
  text: string,
  normToken: (token: string) => string,
  dictionary: CompoundDictionary,
): string {
  const tokens: string[] = [];
  const separators: string[] = []; // separators[k] precedes tokens[k]; the last one trails
  let last = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    separators.push(text.slice(last, match.index));
    tokens.push(normToken(match[0]));
    last = match.index + match[0].length;
  }
  separators.push(text.slice(last));
  if (tokens.length < 2) return separators[0]! + (tokens[0] ?? '') + (separators[1] ?? '');

  let out = separators[0]!;
  // Runs of tokens separated only by joinable whitespace are segmented together.
  let start = 0;
  const flush = (end: number) => {
    const run = tokens.slice(start, end);
    let k = start;
    for (const len of segmentWords(run, dictionary)) {
      for (let j = 0; j < len; j++) {
        const t = k + j;
        if (t > 0) out += j === 0 ? separators[t]! : SEG_JOINER;
        out += tokens[t]!;
      }
      k += len;
    }
  };
  for (let k = 1; k <= tokens.length; k++) {
    if (k < tokens.length && JOINABLE_SEPARATOR_RE.test(separators[k]!)) continue;
    flush(k);
    if (k < tokens.length) start = k;
  }
  return out + separators[tokens.length]!;
}

/**
 * The dictionary in use: bundled compounds plus extra ones (the user lexicon).
 * `project()` must see the same dictionary that `signature()` reported, so the
 * extra list is read again only by `refresh()` (called from `signature()`),
 * and the dictionary is rebuilt only when that list changed.
 */
export class CompoundSource {
  private extra: ReadonlyArray<readonly string[]> | null = null;
  private dictionary: CompoundDictionary | null = null;

  constructor(
    private readonly tonePlacement: TonePlacement,
    private readonly readExtra: () => ReadonlyArray<readonly string[]> = () => [],
  ) {}

  current(): CompoundDictionary {
    return this.dictionary ?? this.refresh();
  }

  refresh(): CompoundDictionary {
    const extra = this.readExtra();
    if (!this.dictionary || extra !== this.extra) {
      const bundled = bundledDictionary(this.tonePlacement);
      this.dictionary =
        extra.length === 0 ? bundled : buildDictionary(extra, this.tonePlacement, bundled);
      this.extra = extra;
    }
    return this.dictionary;
  }
}
