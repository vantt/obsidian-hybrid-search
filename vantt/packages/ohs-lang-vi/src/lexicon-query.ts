/**
 * Applies lexicon rewrites (synonyms, abbreviations) to a query analysis:
 * the other forms of a matched group join the view queries (OR, so they only
 * add candidates) and become extra `rescore` targets with `lexiconWeight`
 * probability. The `embedQuery` is untouched.
 */
import type { QueryAnalysis, QueryContext } from './contract.js';
import { expandQuery, type Form } from './lexicon.js';
import type { PackOptions } from './options.js';
import type { LexiconStore } from './lexicon.js';
import type { QueryState, ViAnalysisData } from './query.js';
import { foldToken, tokenize } from './views.js';

function extend(current: string | null | undefined, extra: readonly string[]): string | null {
  const have = new Set(current ? tokenize(current) : []);
  const add = extra.filter((w) => !have.has(w));
  if (add.length === 0) return current ?? null;
  return current ? `${current} ${add.join(' ')}` : add.join(' ');
}

export function applyLexicon(
  analysis: QueryAnalysis,
  state: QueryState,
  ctx: QueryContext,
  store: LexiconStore,
  options: PackOptions,
): void {
  const lexicon = store.load(ctx.vaultPath);
  if (lexicon.synonyms.length === 0 && lexicon.abbreviations.length === 0) return;
  const foldWord = (w: string) => foldToken(w, options);
  const substitutions = expandQuery(lexicon, state.tokens, foldWord);
  if (substitutions.length === 0) return;

  const words: string[] = [];
  for (const s of substitutions) for (const w of s.words) if (!words.includes(w)) words.push(w);
  analysis.viewQueries.norm = extend(analysis.viewQueries.norm, words);
  analysis.viewQueries.fold = extend(analysis.viewQueries.fold, words.map(foldWord));

  const data = analysis.data as ViAnalysisData | undefined;
  const rewrites: Array<{ from: string; to: string }> = [];
  for (const s of substitutions) {
    const base: Form = data && data.target.length === state.tokens.length ? data.target : state.tokens.map((t) => t.norm);
    const replaced = [...base.slice(0, s.start), ...s.words, ...base.slice(s.end)];
    data?.targets.push({ words: replaced, p: options.lexiconWeight });
    rewrites.push({ from: base.slice(s.start, s.end).join(' '), to: s.words.join(' ') });
  }
  if (analysis.debug) analysis.debug.lexicon = rewrites;
}
