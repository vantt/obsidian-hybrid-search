/**
 * The seg view query (PRD 10.4): the compound words of the query, joined with
 * `_` the way `project()` joins them in notes. Single words are left out, so
 * the branch rewards notes that have the query's compounds and nothing else
 * (the norm, fold and upstream branches already match single words).
 */
import type { QueryContext } from './contract.js';
import type { PackOptions } from './options.js';
import { isVietnameseQuery, type QueryState, type ViAnalysisData } from './query.js';
import { compoundsOf, SEG_JOINER, type CompoundDictionary } from './segment.js';

export const SEG_VIEW = 'seg';

/**
 * Compounds of the target words (the literal query when accented, else the
 * likely restorations), segmented like notes are. Vault statistics are used
 * at query time only: any other dictionary compound spanning query words
 * that the seg view of the vault contains is added too, so a query whose
 * segmentation differs from the one in a note still finds that note.
 */
export function segQuery(
  state: QueryState,
  data: ViAnalysisData,
  ctx: QueryContext,
  dictionary: CompoundDictionary,
  options: PackOptions,
): string | null {
  if (!isVietnameseQuery(state, options)) return null;
  const threshold = options.restoreParams.alternativeThreshold;
  const wordLists = data.accented
    ? [data.target]
    : data.targets.filter((t, i) => i === 0 || t.p >= threshold).map((t) => t.words);
  const compounds = new Set<string>();
  for (const words of wordLists) {
    for (const compound of compoundsOf(words, dictionary)) compounds.add(compound);
    for (let i = 0; i + 1 < words.length; i++) {
      let key = words[i]!;
      for (let len = 2; len <= dictionary.maxWords && i + len <= words.length; len++) {
        key += ` ${words[i + len - 1]}`;
        if (compounds.has(key) || !dictionary.entries.has(key)) continue;
        if (ctx.termStats(SEG_VIEW, key.replaceAll(' ', SEG_JOINER)).docs > 0) compounds.add(key);
      }
    }
  }
  if (compounds.size === 0) return null;
  return [...compounds].map((c) => c.replaceAll(' ', SEG_JOINER)).join(' ');
}
