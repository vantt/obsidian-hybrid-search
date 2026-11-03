/**
 * Applies lexicon rewrites (synonyms, abbreviations) to a query analysis:
 * the other forms of a matched group join the query (OR, so they only add
 * candidates) and become extra `rescore` targets with `lexiconWeight`
 * probability. Synonyms join both view queries; abbreviation expansions join
 * the upstream BM25 query and the views the query already searches. The
 * `embedQuery` is untouched.
 */
import type { QueryAnalysis, QueryContext } from './contract.js';
import type { LexiconStore } from './lexicon.js';
import { expandQuery, type Form } from './lexicon.js';
import { isCommon, type PackOptions } from './options.js';
import type { QueryState, ViAnalysisData } from './query.js';
import type { VocabularyCache } from './restore.js';
import { foldToken, tokenize } from './views.js';

function extend(current: string | null | undefined, extra: readonly string[]): string | null {
  const have = new Set(current ? tokenize(current) : []);
  const add = extra.filter((w) => !have.has(w));
  if (add.length === 0) return current ?? null;
  return current ? `${current} ${add.join(' ')}` : add.join(' ');
}

/**
 * An abbreviation is one word of a longer query ("quy trình chăm sóc KH"). A view the query
 * does not search (an accented query skips norm and fold) would search the expansion alone and
 * vote for every note dense in it, burying the note the rest of the query describes. So an
 * expansion joins only the views the query searches, and the upstream BM25 query, where it is
 * ranked together with the other query words. A synonym usually is the whole query ("phone",
 * "xe hơi"): its forms join both views.
 */
function addExpansions(
  analysis: QueryAnalysis,
  state: QueryState,
  abbreviationWords: readonly string[],
  synonymWords: readonly string[],
  foldWord: (w: string) => string,
): void {
  const { viewQueries } = analysis;
  if (abbreviationWords.length > 0) {
    if (viewQueries.norm) viewQueries.norm = extend(viewQueries.norm, abbreviationWords);
    if (viewQueries.fold)
      viewQueries.fold = extend(viewQueries.fold, abbreviationWords.map(foldWord));
    // The upstream tokenizer drops diacritics, and FTS5 adds the score of a repeated term: an
    // expansion word already in the query in any accent form ("khach hang KH") is left out.
    const base = analysis.baseQuery ?? state.normalized;
    const have = new Set(tokenize(base).map(foldWord));
    const add = abbreviationWords.filter((w) => !have.has(foldWord(w)));
    if (add.length > 0) analysis.baseQuery = `${base} ${add.join(' ')}`;
  }
  if (synonymWords.length > 0) {
    viewQueries.norm = extend(viewQueries.norm, synonymWords);
    viewQueries.fold = extend(viewQueries.fold, synonymWords.map(foldWord));
  }
}

export function applyLexicon(
  analysis: QueryAnalysis,
  state: QueryState,
  ctx: QueryContext,
  cache: VocabularyCache,
  store: LexiconStore,
  options: PackOptions,
): void {
  const lexicon = store.load(ctx.vaultPath);
  if (lexicon.synonyms.length === 0 && lexicon.abbreviations.length === 0) return;
  const foldWord = (w: string) => foldToken(w, options);
  // Match the query as typed as well as after telex/typo rewriting (token for token), so a
  // typo-corrected word ("hoi" -> "moi") never hides a lexicon form the user typed.
  const typed = tokenize(state.normalized).map((norm, i) => {
    const folded = foldWord(norm);
    return { norm, folded, marked: folded !== norm, acronym: state.tokens[i]?.acronym };
  });
  const substitutions = expandQuery(lexicon, state.tokens, foldWord);
  if (typed.length === state.tokens.length) {
    const seen = new Set(substitutions.map((s) => `${s.start}:${s.end}:${s.words.join(' ')}`));
    for (const s of expandQuery(lexicon, typed, foldWord))
      if (!seen.has(`${s.start}:${s.end}:${s.words.join(' ')}`)) substitutions.push(s);
  }
  if (substitutions.length === 0) return;

  // An abbreviation whose expansion is a common phrase of the vault would vote for every note that
  // uses the phrase; it stays a rescore target only.
  const common = (s: (typeof substitutions)[number]) => {
    if (!s.abbreviation || options.abbrMaxDocShare >= 1) return false;
    const folded = s.words.map(foldWord);
    const docs =
      folded.length === 1
        ? cache.termDocs(ctx, 'fold', folded[0]!)
        : cache.phraseDocs(ctx, 'fold', folded.join(' '));
    return isCommon(docs, cache.noteCount(ctx), options.abbrMaxDocShare);
  };
  const synonymWords: string[] = [];
  const abbreviationWords: string[] = [];
  for (const s of substitutions) {
    if (common(s)) continue;
    const list = s.abbreviation ? abbreviationWords : synonymWords;
    for (const w of s.words) if (!list.includes(w)) list.push(w);
  }
  addExpansions(analysis, state, abbreviationWords, synonymWords, foldWord);

  const data = analysis.data as ViAnalysisData | undefined;
  const rewrites: Array<{ from: string; to: string }> = [];
  for (const s of substitutions) {
    const base: Form =
      data && data.target.length === state.tokens.length
        ? data.target
        : state.tokens.map((t) => t.norm);
    const replaced = [...base.slice(0, s.start), ...s.words, ...base.slice(s.end)];
    data?.targets.push({ words: replaced, p: options.lexiconWeight });
    rewrites.push({ from: base.slice(s.start, s.end).join(' '), to: s.words.join(' ') });
  }
  if (analysis.debug) analysis.debug.lexicon = rewrites;
}
