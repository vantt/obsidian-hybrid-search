/**
 * The seg view query (PRD 10.4): the compound words of the query, joined with
 * `_` the way `project()` joins them in notes. Single words are left out, so
 * the branch rewards notes that have the query's compounds and nothing else
 * (the norm, fold and upstream branches already match single words).
 */
import type { QueryContext } from './contract.js';
import { iyVariant } from './fold.js';
import { isCommon, type PackOptions } from './options.js';
import { isVietnameseQuery, type QueryState, type ViAnalysisData } from './query.js';
import type { VocabularyCache } from './restore.js';
import { SEG_JOINER, segmentWords, type CompoundDictionary } from './segment.js';

export const SEG_VIEW = 'seg';

/**
 * Compounds of the target words (the literal query when accented, else the
 * likely restorations) of a wholly Vietnamese query, segmented like notes are. Vault statistics are used
 * at query time only: any other dictionary compound spanning query words
 * that the seg view of the vault contains is added too, so a query whose
 * segmentation differs from the one in a note still finds that note.
 */
/**
 * Function words (particles, prepositions, conjunctions, auxiliaries,
 * pronoun-like words). A dictionary compound made only of these ("có thể",
 * "vì vậy", "cho nên") says nothing about a note's subject, so the seg branch
 * does not search it.
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set(
  (
    'à ạ ai ấy bị bởi các cái cả càng cho chỉ chưa chứ có còn cùng của cũng đã đang đây để đến đều đi điều do đó ' +
    'được gì hay hoặc hơn khi không là lại lắm lên mà mỗi một mọi nào nay này nên nếu nhé như nhưng những nữa ' +
    'ở qua quá ra rằng rất rồi sao sau sẽ tại thì theo thế trên trong từ tới vẫn vào vậy về vì với xuống'
  ).split(' '),
);

export interface SegQuery {
  /** View query: the compounds joined with `_`, separated by spaces. */
  query: string;
  /** Share of the words the searched compounds cover, in the best-covered target (0 to 1). */
  coverage: number;
}

/**
 * Compounds of the target words (the literal query when accented, else the
 * likely restorations) of a wholly Vietnamese query, segmented like notes are. Vault statistics are used
 * at query time only: any other dictionary compound spanning query words
 * that the seg view of the vault contains is added too, so a query whose
 * segmentation differs from the one in a note still finds that note.
 * Compounds made only of function words, and compounds in more than
 * `segMaxDocShare` of the notes (`isCommon`), are left out: they match notes by their
 * common phrasing, not their subject.
 */
export function segQuery(
  state: QueryState,
  data: ViAnalysisData,
  ctx: QueryContext,
  cache: VocabularyCache,
  dictionary: CompoundDictionary,
  options: PackOptions,
): SegQuery | null {
  if (!isVietnameseQuery(state, options)) return null;
  // A query mixing other words (English) leans on the vector branch; one more
  // lexical branch would drown it (vi-mixed-en).
  if (state.tokens.some((t) => !t.syllable)) return null;
  const threshold = options.restoreParams.alternativeThreshold;
  const wordLists = data.accented
    ? [data.target]
    : data.targets.filter((t, i) => i === 0 || t.p >= threshold).map((t) => t.words);
  const notes = cache.noteCount(ctx);
  const docs = (key: string) => cache.termDocs(ctx, SEG_VIEW, key.replaceAll(' ', SEG_JOINER));
  const useful = (key: string) =>
    !key.split(' ').every((w) => FUNCTION_WORDS.has(w)) &&
    !isCommon(docs(key), notes, options.segMaxDocShare);
  const compounds = new Set<string>();
  // Spans of the searched compounds per word list, credited once the vault has them.
  const spans = new Map<string, Array<[number, number, number]>>();
  for (const [listIndex, words] of wordLists.entries()) {
    const add = (key: string, start: number, length: number) => {
      if (!compounds.has(key) && !useful(key)) return;
      compounds.add(key);
      spans.set(key, [...(spans.get(key) ?? []), [listIndex, start, length]]);
    };
    let start = 0;
    for (const length of segmentWords(words, dictionary)) {
      if (length > 1) add(words.slice(start, start + length).join(' '), start, length);
      start += length;
    }
    for (let i = 0; i + 1 < words.length; i++) {
      let key = words[i]!;
      for (let len = 2; len <= dictionary.maxWords && i + len <= words.length; len++) {
        key += ` ${words[i + len - 1]}`;
        if (compounds.has(key) || !dictionary.entries.has(key)) continue;
        if (docs(key) > 0) add(key, i, len);
      }
    }
  }
  const covered = wordLists.map(() => new Set<number>());
  const credit = (key: string) => {
    for (const [list, start, length] of spans.get(key) ?? [])
      for (let k = start; k < start + length; k++) covered[list]!.add(k);
  };
  for (const compound of [...compounds]) {
    if (docs(compound) > 0) credit(compound);
    // The other i/y spelling of a compound (kĩ_năng for kỹ_năng), when the vault has it.
    const variant = compound
      .split(' ')
      .map((w) => iyVariant(w) ?? w)
      .join(' ');
    if (variant !== compound && docs(variant) > 0) {
      compounds.add(variant);
      credit(compound);
    }
  }
  // Only compounds the vault has cover the query (best over the restorations and lexicon
  // rewrites); with none the branch would search for nothing.
  const coverage = Math.max(
    ...wordLists.map((words, i) => covered[i]!.size / Math.max(1, words.length)),
  );
  if (compounds.size === 0 || coverage === 0) return null;
  return {
    query: [...compounds].map((c) => c.replaceAll(' ', SEG_JOINER)).join(' '),
    coverage,
  };
}
