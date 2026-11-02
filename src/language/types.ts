/**
 * Language pack contract (API version 1).
 *
 * A language pack is a separately installed ES module that adds language-specific
 * lexical "views" of every note. Each view is indexed in its own FTS5 table and
 * searched as one extra RRF branch. The core never rewrites the original text:
 * notes, snippets and reads always return what the vault contains.
 *
 * The module's default export (or its `createPack` export) is either a
 * `LanguagePackV1` object or a factory `(options) => LanguagePackV1 | Promise<…>`,
 * where `options` is the parsed `OHS_LANGUAGE_PACK_OPTIONS` JSON.
 */

export type LanguagePackField = 'title' | 'aliases' | 'content';

export interface LanguagePackView {
  /** `[a-z][a-z0-9_]{0,15}`; becomes part of table names. */
  name: string;
  /** RRF weight of this view's branch. */
  weight: number;
  /** FTS5 tokenizer; defaults to `DEFAULT_VIEW_TOKENIZER`. */
  tokenizer?: string;
}

export interface LanguagePackV1 {
  apiVersion: 1;
  id: string;
  version: string;
  /**
   * Changes whenever anything that affects indexed view text changes. Called once
   * per load, with the vault the pack was loaded for.
   */
  signature(ctx?: PackContext): string;
  /** At most three views. */
  views: ReadonlyArray<LanguagePackView>;
  /**
   * Pure, deterministic projection of one field into one view. It must keep the
   * token invariant: tokenizing the result with the view tokenizer yields the same
   * token sequence as tokenizing `text` with the same rules (`tokenchars` minus
   * `_` and VIEW_CONTINUATION), with two exceptions. A view token may join adjacent
   * source tokens with `_` and then counts as that many source tokens (word
   * segmentation). A view token that starts with VIEW_CONTINUATION counts as no
   * source token and belongs to the source token before it (compound splitting).
   * Both characters must be in the view tokenizer's `tokenchars` to be used.
   */
  project(view: string, field: LanguagePackField, text: string): string;
  /** Called once per query (and once per entry of `queries[]`). */
  analyzeQuery(query: string, ctx: QueryContext): QueryAnalysis | Promise<QueryAnalysis>;
  /** Views (subset of `views`) whose projected title/aliases feed the exact-alias branch. */
  aliasViews?: ReadonlyArray<string>;
  /** Query-time-only data version (synonyms, abbreviations). Never triggers a rebuild. */
  queryCacheKey?(ctx?: PackContext): string;
  /** Re-score fused candidates before reranking. May not drop candidates. */
  rescore?(
    candidates: ReadonlyArray<Candidate>,
    analysis: QueryAnalysis,
    ctx: QueryContext,
  ): ReadonlyArray<RescoredCandidate> | Promise<ReadonlyArray<RescoredCandidate>>;
}

/** One term of a structured view query. */
export interface ViewQueryTerm {
  /** View text of one token, or of a phrase when it holds several tokens. */
  text: string;
  /** Match tokens that start with the (last) token of `text`. Default false: exact match. */
  prefix?: boolean;
}

export interface QueryAnalysis {
  /**
   * Raw query text per view; the core sanitizes it and ORs every word as a prefix
   * term (`"w"*`). null skips the branch unless `viewTerms` gives terms for the view.
   */
  viewQueries: Record<string, string | null>;
  /**
   * Structured query per view, ORed together. A string is an exact term or phrase;
   * use `{ text, prefix: true }` for a prefix match. A non-empty array replaces
   * `viewQueries[view]`; null or an empty array falls back to it.
   */
  viewTerms?: Record<string, ReadonlyArray<string | ViewQueryTerm> | null>;
  /**
   * RRF weight per view for this query only; a finite number >= 0 replaces the
   * declared `views[].weight`. null or a missing entry keeps the declared weight.
   * To drop a branch, set `viewQueries[view]` to null.
   */
  viewWeights?: Record<string, number | null>;
  /** Query for the upstream BM25 branch; defaults to the original query. */
  baseQuery?: string;
  /** Query sent to the embedder; defaults to the original query. */
  embedQuery?: string;
  /** Exact-alias lookup key per alias view; null skips it. */
  aliasKeys?: Record<string, string | null>;
  /** Pack-private data passed to `rescore`. */
  data?: unknown;
  /** Diagnostics, returned with `explain` and logged with LOG_LEVEL=debug. */
  debug?: Record<string, unknown>;
}

/** Context passed to `signature()` and `queryCacheKey()`. */
export interface PackContext {
  /** Absolute vault path, read-only, for user-maintained pack files. */
  vaultPath: string;
}

export interface QueryContext extends PackContext {
  /** Notes containing `term` and total occurrences, from the view's fts5vocab table. */
  termStats(view: string, term: string): { docs: number; hits: number };
  /** View terms starting with `prefix`, most frequent first. */
  termsWithPrefix(
    view: string,
    prefix: string,
    limit: number,
  ): Array<{ term: string; docs: number }>;
  /** Notes containing `phrase` as an exact phrase in the view. */
  phraseDocs(view: string, phrase: string): number;
  noteCount(): number;
  /** Index data version; changes whenever any note is written. Key in-memory vocabulary caches on it. */
  dbVersion(): number;
}

export interface Candidate {
  path: string;
  /** Hybrid score after RRF. */
  score: number;
  title: string;
  /** Original-text snippet. */
  snippet: string;
  matchedViews: string[];
  /** Original-text words matched through the views; empty when no view matched. */
  matchedTerms: string[];
  /** 1-based rank of this path in each branch; null when the branch missed it. */
  rank: Record<string, number | null>;
}

export interface RescoredCandidate {
  path: string;
  score: number;
}

export const LANGUAGE_PACK_API_VERSION = 1;
export const MAX_LANGUAGE_VIEWS = 3;
export const VIEW_NAME_PATTERN = /^[a-z][a-z0-9_]{0,15}$/;
export const DEFAULT_VIEW_TOKENIZER = "unicode61 remove_diacritics 0 tokenchars '+#'";
/** WORD JOINER: prefix of extra view tokens split out of one source token. */
export const VIEW_CONTINUATION = '\u2060';

/** A validated pack plus the layout that defines its index tables. */
export interface LoadedLanguagePack {
  pack: LanguagePackV1;
  views: ReadonlyArray<Required<LanguagePackView>>;
  aliasViews: ReadonlyArray<string>;
  /**
   * Canonical JSON of everything that shapes the indexed view tables. Stored in
   * `settings.language_pack`; a different value means the views must be rebuilt.
   */
  layout: string;
  /** Distinct per load, so search caches never mix results of two pack instances. */
  generation: number;
}

export interface LanguagePackStatus {
  requested: string;
  loaded: boolean;
  id?: string;
  version?: string;
  signature?: string;
  views?: string[];
  error?: string;
}
