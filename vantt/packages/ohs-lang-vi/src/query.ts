/**
 * Query analysis: turns one search query into a view query per view.
 *
 * Pipeline (each stage reads and extends `QueryState`):
 *   1. tokenizeQuery     normalize, split into view tokens, classify each token
 *      (hook) telex/typo token rewriting goes here, before classification is used (V17)
 *   2. classifyAccents   is the query typed with diacritics on purpose?
 *   3. restoreAccents    k-best diacritic restoration of unaccented syllables
 *      findUnaccentedSpelling  (accented queries) notes typed without diacritics?
 *      (hook) lexicon synonyms/abbreviations expand the view queries here (V18)
 *   4. buildAnalysis     view queries, embed query, rescore data, debug
 *      (hook) alias keys for aliasViews (V19) and the seg view query (V20) go here
 */
import type { QueryAnalysis, QueryContext } from './contract.js';
import { fold } from './fold.js';
import { normalize } from './normalize.js';
import type { PackOptions } from './options.js';
import { restoreTokens, type RestoreResult, type VocabularyCache } from './restore.js';
import { isPossibleFoldedSyllable, isVietnameseSyllable } from './syllable.js';
import { TOKEN_RE, foldToken, tokenize } from './views.js';

/** What analyzeQuery needs besides the query and the core context. */
export interface QueryEnvironment {
  options: PackOptions;
  cache: VocabularyCache;
  forms: ReadonlyMap<string, readonly string[]>;
}

export interface QueryToken {
  /** Normalized (accent-preserving, lowercase) token. */
  norm: string;
  /** Token as the fold view stores it. */
  folded: string;
  /** Carries a diacritic (tone mark, modified vowel or đ). */
  marked: boolean;
  /** A Vietnamese syllable (accented) or a possible unaccented one. */
  syllable: boolean;
}

export interface QueryState {
  query: string;
  normalized: string;
  tokens: QueryToken[];
  /** Typed with diacritics on purpose: tokens are taken literally. */
  accented: boolean;
  restoration: RestoreResult | null;
  /** Accented query whose words the vault also contains written without diacritics. */
  unaccentedInVault: boolean;
}

/** Pack-private data handed to `rescore` through `QueryAnalysis.data`. */
export interface ViAnalysisData {
  /** Target words in norm form (literal for accented queries, best restoration otherwise). */
  target: string[];
  /** Best restorations with their probabilities (just `target` with 1 for accented queries). */
  targets: Array<{ words: string[]; p: number }>;
  /** Target words in fold form. */
  targetFolded: string[];
  /** Probability that `target` is what the user meant (1 for accented queries). */
  confidence: number;
  accented: boolean;
}

/** Restorations handed to rescore (most probable first). */
const MAX_RESCORE_TARGETS = 5;

// 1. -------------------------------------------------------------------------

export function tokenizeQuery(query: string, options: PackOptions): QueryState {
  const normalized = normalize(query, { tonePlacement: options.tonePlacement });
  const tokens = tokenize(normalized).map((norm) => {
    const marked = fold(norm) !== norm;
    return {
      norm,
      folded: foldToken(norm, options),
      marked,
      syllable: marked ? isVietnameseSyllable(norm) : isPossibleFoldedSyllable(norm),
    };
  });
  return { query, normalized, tokens, accented: false, restoration: null, unaccentedInVault: false };
}

// 2. -------------------------------------------------------------------------

export function classifyAccents(state: QueryState, options: PackOptions): void {
  const syllables = state.tokens.filter((t) => t.syllable);
  const marked = syllables.filter((t) => t.marked).length;
  state.accented = syllables.length > 0 && marked / syllables.length > options.accentedRatio;
}

// 3. -------------------------------------------------------------------------

export function restoreAccents(state: QueryState, ctx: QueryContext, env: QueryEnvironment): void {
  if (!env.options.restore || state.accented) return;
  const inputs = state.tokens.map((t) => ({
    norm: t.norm,
    folded: t.folded,
    pinned: t.marked || !t.syllable,
  }));
  if (inputs.every((t) => t.pinned)) return;
  state.restoration = restoreTokens(inputs, ctx, env.cache, env.options.restoreParams, env.forms);
}

/**
 * For an accented query: does the vault contain its words typed without
 * diacritics? Adjacent marked words folded and found as a phrase in the norm
 * view (or the single marked word, for a one-word query) are the evidence.
 */
export function findUnaccentedSpelling(state: QueryState, ctx: QueryContext, env: QueryEnvironment): void {
  if (!state.accented || env.options.accentedFold !== 'auto') return;
  env.cache.sync(ctx);
  const plain = (t: QueryToken) => fold(t.norm, { foldIY: false });
  const marked = state.tokens.filter((t) => t.marked && t.syllable);
  if (state.tokens.length === 1 && marked.length === 1) {
    state.unaccentedInVault = env.cache.termDocs(ctx, 'norm', plain(marked[0]!)) > 0;
    return;
  }
  for (let i = 1; i < state.tokens.length; i++) {
    const a = state.tokens[i - 1]!;
    const b = state.tokens[i]!;
    if (!(a.marked || b.marked) || !a.syllable || !b.syllable) continue;
    if (env.cache.phraseDocs(ctx, 'norm', `${plain(a)} ${plain(b)}`) > 0) {
      state.unaccentedInVault = true;
      return;
    }
  }
}

// 4. -------------------------------------------------------------------------

/** Norm-view words: the best restoration plus close alternatives. */
function normQueryWords(state: QueryState, options: PackOptions): string[] | null {
  if (state.accented) return state.tokens.map((t) => t.norm);
  const restoration = state.restoration;
  const anyMarked = state.tokens.some((t) => t.marked);
  if (!restoration || !restoration.tokens.some((t) => t.restored))
    return anyMarked ? state.tokens.map((t) => t.norm) : null;
  const words: string[] = [];
  for (const token of restoration.tokens) {
    for (const [index, variant] of token.variants.entries()) {
      if (index === 0 || (token.restored && variant.marginal >= options.restoreParams.alternativeThreshold))
        words.push(variant.form);
    }
  }
  return words;
}

/**
 * Vietnamese evidence: enough syllable tokens (`minSyllableShare`), and then a diacritic in the query, or an unaccented syllable
 * whose accented form exists in the vault. Without restoration, any token that
 * could be an unaccented Vietnamese syllable counts.
 */
export function isVietnameseQuery(state: QueryState, options: PackOptions): boolean {
  const syllables = state.tokens.filter((t) => t.syllable).length;
  if (syllables === 0 || syllables < options.minSyllableShare * state.tokens.length) return false;
  if (state.tokens.some((t) => t.marked)) return true;
  if (!options.restore) return state.tokens.some((t) => t.syllable);
  return state.restoration?.tokens.some((t) => t.variants.some((v) => v.form !== t.norm)) ?? false;
}

/** Rewrite the normalized query with the best restoration, keeping punctuation. */
function restoredText(state: QueryState): string {
  const best = state.restoration?.candidates[0]?.forms;
  if (!best) return state.normalized;
  let index = 0;
  return state.normalized.replace(TOKEN_RE, (token) => best[index++] ?? token);
}

export function buildAnalysis(state: QueryState, options: PackOptions): QueryAnalysis {
  const restoration = state.restoration;
  const target =
    !state.accented && restoration?.candidates[0]
      ? restoration.candidates[0].forms
      : state.tokens.map((t) => t.norm);
  const confidence = state.accented || !restoration ? 1 : restoration.confidence;
  const normWords = normQueryWords(state, options);
  // A query with no Vietnamese evidence (an English query, say) leaves the pack
  // inert: the views would only repeat the upstream BM25 branch.
  const vietnamese = isVietnameseQuery(state, options);
  const useNorm = vietnamese && (!state.accented || options.accentedNorm);
  const foldAccented =
    options.accentedFold === 'always' || (options.accentedFold === 'auto' && state.unaccentedInVault);
  const useFold = vietnamese && (!state.accented || foldAccented);
  const viewQueries: Record<string, string | null> = {
    norm: useNorm && normWords && normWords.length > 0 ? normWords.join(' ') : null,
    fold: useFold && state.tokens.length > 0 ? state.tokens.map((t) => t.folded).join(' ') : null,
  };
  const analysis: QueryAnalysis = { viewQueries };
  const restoredAny = restoration?.tokens.some((t) => t.restored) ?? false;
  if (options.restoreForEmbedding && restoredAny && confidence >= options.embedMinConfidence)
    analysis.embedQuery = restoredText(state);
  const targets =
    !state.accented && restoration && restoration.candidates.length > 0
      ? restoration.candidates.slice(0, MAX_RESCORE_TARGETS).map((c) => ({ words: c.forms, p: c.probability }))
      : [{ words: target, p: 1 }];
  const data: ViAnalysisData = {
    target,
    targets,
    targetFolded: target.map((w) => foldToken(w, options)),
    confidence,
    accented: state.accented,
  };
  analysis.data = data;
  analysis.debug = {
    normalized: state.normalized,
    accented: state.accented,
    ...(state.accented ? { unaccentedInVault: state.unaccentedInVault } : {}),
    viewQueries,
    ...(analysis.embedQuery ? { embedQuery: analysis.embedQuery } : {}),
    ...(restoration
      ? {
          restore: {
            confidence: restoration.confidence,
            candidates: restoration.candidates.slice(0, 3).map((c) => ({
              text: c.forms.join(' '),
              p: Number(c.probability.toFixed(4)),
            })),
            variants: restoration.tokens.map((t) =>
              t.variants.map((v) => `${v.form}:${v.docs}:${v.marginal.toFixed(3)}`),
            ),
            phraseLookups: restoration.phraseLookups,
          },
        }
      : {}),
  };
  return analysis;
}

/** Analyze one query (P01 `analyzeQuery`). */
export function analyzeQuery(query: string, ctx: QueryContext, env: QueryEnvironment): QueryAnalysis {
  const state = tokenizeQuery(query, env.options);
  classifyAccents(state, env.options);
  restoreAccents(state, ctx, env);
  findUnaccentedSpelling(state, ctx, env);
  return buildAnalysis(state, env.options);
}
