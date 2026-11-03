import type { QueryAnalysis } from './types.js';

/**
 * The analysis of a query when no pack contributes: no view branches and the
 * original query for BM25 and the embedder. Used when a pack's analyzeQuery fails,
 * so that query runs exactly like upstream search.
 */
export function noopAnalysis(): QueryAnalysis {
  return { viewQueries: {} };
}
