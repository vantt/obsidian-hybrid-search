import { foldWord, transliterateWord } from './fold.js';
import { LEXICON } from './lexicon.js';

/** One lexicon entry in the two folded spellings; both are emitted for a part. */
interface Entry {
  fold: string;
  trans: string;
}

export interface Splitter {
  /** Components of a compound in order, as lexicon entries; empty when `word` is not a compound. */
  split(word: string): Entry[];
}

/** Linking elements ("Fugenelemente") that may follow a component inside a compound. */
const LINKS = ['', 's', 'es', 'n', 'en', 'e', 'er', 'ns', 'ens'];
const MIN_PART = 3;
const MIN_WORD = 6;

export function createSplitter(extraWords: ReadonlyArray<string> = []): Splitter {
  const byForm = new Map<string, Entry>();
  for (const word of [...LEXICON, ...extraWords]) {
    const entry = { fold: foldWord(word), trans: transliterateWord(word) };
    if (entry.fold.length < MIN_PART) continue;
    byForm.set(entry.fold, entry);
    byForm.set(entry.trans, entry);
  }

  /** Fewest-parts segmentation of word[from..]; ties keep the longest first part. */
  function segment(word: string, from: number, memo: Map<number, Entry[] | null>): Entry[] | null {
    if (from === word.length) return [];
    const cached = memo.get(from);
    if (cached !== undefined) return cached;
    let best: Entry[] | null = null;
    for (let end = word.length; end >= from + MIN_PART; end--) {
      const entry = byForm.get(word.slice(from, end));
      if (!entry) continue;
      for (const link of LINKS) {
        const next = end + link.length;
        if (next > word.length || word.slice(end, next) !== link) continue;
        if (link !== '' && next === word.length) continue;
        const rest = segment(word, next, memo);
        if (rest && (best === null || rest.length + 1 < best.length)) best = [entry, ...rest];
      }
    }
    memo.set(from, best);
    return best;
  }

  return {
    split(word) {
      const key = foldWord(word);
      if (key.length < MIN_WORD) return [];
      const raw = transliterateWord(word);
      // Try the spelling that keeps umlaut digraphs first, then the folded one.
      for (const candidate of new Set([raw, key])) {
        const parts = segment(candidate, 0, new Map());
        if (parts && parts.length >= 2) return parts;
      }
      return [];
    },
  };
}
