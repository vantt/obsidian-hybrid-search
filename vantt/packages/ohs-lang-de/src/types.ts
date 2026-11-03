/**
 * Structural copy of the OHS language pack contract (API version 1). The pack has
 * no dependency on OHS: it only has to match this shape.
 */
export type LanguagePackField = 'title' | 'aliases' | 'content';

export interface LanguagePackView {
  name: string;
  weight: number;
  tokenizer?: string;
}

export interface QueryAnalysis {
  viewQueries: Record<string, string | null>;
  baseQuery?: string;
  embedQuery?: string;
  aliasKeys?: Record<string, string | null>;
  data?: unknown;
  debug?: Record<string, unknown>;
}

export interface QueryContext {
  termStats(view: string, term: string): { docs: number; hits: number };
  termsWithPrefix(
    view: string,
    prefix: string,
    limit: number,
  ): Array<{ term: string; docs: number }>;
  phraseDocs(view: string, phrase: string): number;
  noteCount(): number;
  dbVersion(): number;
  vaultPath: string;
}

export interface LanguagePackV1 {
  apiVersion: 1;
  id: string;
  version: string;
  signature(): string;
  views: ReadonlyArray<LanguagePackView>;
  project(view: string, field: LanguagePackField, text: string): string;
  analyzeQuery(query: string, ctx: QueryContext): QueryAnalysis;
  aliasViews?: ReadonlyArray<string>;
  queryCacheKey?(): string;
}
