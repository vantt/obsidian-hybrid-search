/**
 * One-character typo correction against the vault vocabulary.
 *
 * Works on unaccented text: for a word that the vault does not contain, the
 * candidates are the edit-distance-1 neighbours (insert, delete, substitute,
 * swap two adjacent letters) that are possible Vietnamese syllables and occur
 * in the fold view. Candidate generation is driven by the typed word (a few
 * hundred strings), never by scanning the vocabulary, and the lookups are the
 * cached ones `restore.ts` uses.
 */
import type { QueryContext } from './contract.js';
import type { VocabularyCache } from './restore.js';
import { isPossibleFoldedSyllable } from './syllable.js';

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** Shortest word that is corrected. */
export const MIN_TYPO_LENGTH = 3;
/** Most candidates kept per word. */
export const MAX_TYPO_CANDIDATES = 3;
/** Weight of phrase evidence (adjacent words that really occur together) against document frequency. */
const CONTEXT_WEIGHT = 3;

/** Every string one edit away from `word` (not `word` itself), deduplicated. */
export function editNeighbours(word: string): string[] {
  const out = new Set<string>();
  for (let i = 0; i <= word.length; i++) {
    for (const c of LETTERS) out.add(word.slice(0, i) + c + word.slice(i));
  }
  for (let i = 0; i < word.length; i++) {
    out.add(word.slice(0, i) + word.slice(i + 1));
    for (const c of LETTERS) out.add(word.slice(0, i) + c + word.slice(i + 1));
    if (i + 1 < word.length && word[i] !== word[i + 1])
      out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }
  out.delete(word);
  return [...out];
}

export interface TypoInput {
  /** Fold-view form of the word. */
  folded: string;
  /** Eligible for correction (not in the vault, plain letters, long enough, not rewritten already). */
  unknown: boolean;
}

interface Scored {
  word: string;
  docs: number;
}

/** Known words of the fold vocabulary one edit from `word`, most frequent first. */
function candidatesOf(word: string, ctx: QueryContext, cache: VocabularyCache): Scored[] {
  const found: Scored[] = [];
  for (const neighbour of editNeighbours(word)) {
    if (!isPossibleFoldedSyllable(neighbour)) continue;
    const docs = cache.termDocs(ctx, 'fold', neighbour);
    if (docs > 0) found.push({ word: neighbour, docs });
  }
  return found.sort((a, b) => b.docs - a.docs || (a.word < b.word ? -1 : 1));
}

/**
 * Corrections for the unknown words of one query: index -> candidates, best
 * first (at most `MAX_TYPO_CANDIDATES`). Words without a candidate are absent.
 * Adjacent words vote: a candidate that forms a real phrase with a neighbour
 * (the neighbour itself, or one of its candidates) beats a more frequent one.
 */
export function correctTypos(
  inputs: readonly TypoInput[],
  ctx: QueryContext,
  cache: VocabularyCache,
): Map<number, string[]> {
  const options = new Map<number, Scored[]>();
  inputs.forEach((input, i) => {
    if (input.unknown && input.folded.length >= MIN_TYPO_LENGTH) {
      const found = candidatesOf(input.folded, ctx, cache);
      if (found.length > 0) options.set(i, found.slice(0, 2 * MAX_TYPO_CANDIDATES + 3));
    }
  });
  const neighbourWords = (i: number): string[] => {
    const alternatives = options.get(i);
    if (alternatives) return alternatives.map((a) => a.word);
    const input = inputs[i];
    return input ? [input.folded] : [];
  };
  const out = new Map<number, string[]>();
  for (const [i, found] of options) {
    const scored = found.map((candidate) => {
      let context = 0;
      for (const [offset, before] of [[-1, true], [1, false]] as const) {
        let best = 0;
        for (const other of neighbourWords(i + offset)) {
          const phrase = before ? `${other} ${candidate.word}` : `${candidate.word} ${other}`;
          best = Math.max(best, cache.phraseDocs(ctx, 'fold', phrase));
        }
        context += Math.log1p(best);
      }
      return { word: candidate.word, score: Math.log1p(candidate.docs) + CONTEXT_WEIGHT * context };
    });
    scored.sort((a, b) => b.score - a.score || (a.word < b.word ? -1 : 1));
    out.set(i, scored.slice(0, MAX_TYPO_CANDIDATES).map((s) => s.word));
  }
  return out;
}
