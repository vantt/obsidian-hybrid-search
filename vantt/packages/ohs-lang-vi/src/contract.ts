/**
 * Structural copy of the P01 language-pack contract (`src/language/types.ts`
 * of the patched core, API version 1). The pack has no runtime dependency on
 * OHS, so the types are duplicated here; keep them in sync with the patch.
 */

export type LanguagePackField = 'title' | 'aliases' | 'content';

export interface LanguagePackView {
  name: string;
  weight: number;
  tokenizer?: string;
}

/** One term of a structured view query (P01 contract addition). */
export interface ViewQueryTerm {
  text: string;
  /** Prefix match; default false (exact token or phrase). */
  prefix?: boolean;
}

export interface QueryAnalysis {
  viewQueries: Record<string, string | null>;
  /**
   * Structured query per view, ORed: a string is an exact term or phrase. A
   * non-empty array replaces `viewQueries[view]`.
   */
  viewTerms?: Record<string, ReadonlyArray<string | ViewQueryTerm> | null>;
  /**
   * RRF weight per view for this query only; a finite number >= 0 replaces the
   * declared `views[].weight`, null or a missing entry keeps it.
   */
  viewWeights?: Record<string, number | null>;
  baseQuery?: string;
  embedQuery?: string;
  aliasKeys?: Record<string, string | null>;
  data?: unknown;
  debug?: Record<string, unknown>;
}

export interface QueryContext {
  termStats(view: string, term: string): { docs: number; hits: number };
  termsWithPrefix(view: string, prefix: string, limit: number): Array<{ term: string; docs: number }>;
  phraseDocs(view: string, phrase: string): number;
  noteCount(): number;
  dbVersion(): number;
  vaultPath: string;
}

export interface Candidate {
  path: string;
  score: number;
  title: string;
  snippet: string;
  matchedViews: string[];
  /** Original-text words matched through the views (whole title and content); empty when no view matched. */
  matchedTerms?: string[];
  rank: Record<string, number | null>;
}

export interface RescoredCandidate {
  path: string;
  score: number;
}

export interface LanguagePackV1 {
  apiVersion: 1;
  id: string;
  version: string;
  signature(): string;
  views: ReadonlyArray<LanguagePackView>;
  project(view: string, field: LanguagePackField, text: string): string;
  analyzeQuery(query: string, ctx: QueryContext): QueryAnalysis | Promise<QueryAnalysis>;
  aliasViews?: ReadonlyArray<string>;
  queryCacheKey?(): string;
  rescore?(
    candidates: ReadonlyArray<Candidate>,
    analysis: QueryAnalysis,
    ctx: QueryContext,
  ): ReadonlyArray<RescoredCandidate> | Promise<ReadonlyArray<RescoredCandidate>>;
}
