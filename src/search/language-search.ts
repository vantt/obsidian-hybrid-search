import type { FilterPredicate } from '../contracts/filter-predicate.js';
import { getLanguagePack, warnLanguagePackOnce } from '../language/loader.js';
import { noopAnalysis } from '../language/noop.js';
import {
  buildMarkedSnippet,
  mapHighlightedTokens,
  matchedWords,
  parseTokenizerRules,
  type TokenizerRules,
} from '../language/tokens.js';
import type {
  Candidate,
  LoadedLanguagePack,
  QueryAnalysis,
  QueryContext,
} from '../language/types.js';
import { config } from '../runtime/config.js';
import { getDbVersion } from '../storage/db.js';
import {
  countNotes,
  countViewPhraseDocs,
  findViewAliasRows,
  readLanguageLayout,
  readViewMatches,
  readViewTermStats,
  readViewTermsWithPrefix,
} from '../storage/language-queries.js';

/** The loaded pack, but only when the index holds views built for it. */
export function activeLanguagePack(): LoadedLanguagePack | null {
  const loaded = getLanguagePack();
  if (!loaded) return null;
  try {
    return readLanguageLayout() === loaded.layout ? loaded : null;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Cache-key component: pack layout plus its query-time data version. */
export function languageCacheKey(loaded: LoadedLanguagePack): string {
  let queryKey = '';
  try {
    queryKey = String(loaded.pack.queryCacheKey?.({ vaultPath: config.vaultPath }) ?? '');
  } catch (error) {
    warnLanguagePackOnce(`queryCacheKey() failed: ${errorText(error)}`);
  }
  return `${loaded.generation}\0${loaded.layout}\0${queryKey}`;
}

const queryContext: QueryContext = {
  termStats: readViewTermStats,
  termsWithPrefix: readViewTermsWithPrefix,
  phraseDocs: countViewPhraseDocs,
  noteCount: countNotes,
  dbVersion: getDbVersion,
  get vaultPath() {
    return config.vaultPath;
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Run the pack's query analysis; a failing pack degrades this query to upstream behavior. */
export async function analyzeLanguageQuery(
  loaded: LoadedLanguagePack,
  query: string,
): Promise<QueryAnalysis> {
  try {
    const analysis = (await loaded.pack.analyzeQuery(query, queryContext)) as unknown;
    if (!isRecord(analysis) || !isRecord(analysis.viewQueries))
      throw new Error('analyzeQuery() must return an object with viewQueries');
    if (process.env.LOG_LEVEL === 'debug' && analysis.debug)
      console.error('[language] analyzeQuery', JSON.stringify({ query, debug: analysis.debug }));
    return analysis as unknown as QueryAnalysis;
  } catch (error) {
    warnLanguagePackOnce(`analyzeQuery() failed; searching without the pack: ${errorText(error)}`);
    return noopAnalysis();
  }
}

/** FTS5 string literal: the text quoted, embedded quotes doubled. */
function quoteFts(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

/** FTS expression of a structured view query, or null when it holds no usable term. */
function structuredFtsQuery(terms: unknown): string | null {
  if (!Array.isArray(terms)) return null;
  const parts = (terms as unknown[]).flatMap((term) => {
    const record = typeof term === 'string' ? { text: term } : term;
    if (!isRecord(record) || typeof record.text !== 'string' || !record.text.trim()) return [];
    return [quoteFts(record.text.trim()) + (record.prefix === true ? '*' : '')];
  });
  return parts.length > 0 ? parts.join(' OR ') : null;
}

function queryWeight(analysis: QueryAnalysis, view: string, declared: number): number {
  const weight = isRecord(analysis.viewWeights) ? analysis.viewWeights[view] : undefined;
  return typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 ? weight : declared;
}

/**
 * FTS expressions of the view branches the pack asked for, in view declaration
 * order. `viewTerms` wins over `viewQueries`, which `toFtsQuery` turns into prefix terms.
 */
export function viewQueriesFor(
  loaded: LoadedLanguagePack,
  analysis: QueryAnalysis,
  toFtsQuery: (query: string) => string,
): Array<{ view: string; weight: number; ftsQuery: string }> {
  return loaded.views.flatMap((view) => {
    const weight = queryWeight(analysis, view.name, view.weight);
    const structured = structuredFtsQuery(analysis.viewTerms?.[view.name]);
    if (structured !== null) return [{ view: view.name, weight, ftsQuery: structured }];
    const query = analysis.viewQueries[view.name];
    return typeof query === 'string' && query.trim()
      ? [{ view: view.name, weight, ftsQuery: toFtsQuery(query) }]
      : [];
  });
}

export interface ViewHit {
  path: string;
  title: string;
  tags: string;
  aliases: string | null;
  score: number;
  /** Original-text snippet with match markers; empty when the match cannot be mapped. */
  markedSnippet: string;
  matchedTerms: string[];
}

const rulesCache = new Map<string, TokenizerRules | null>();
function rulesFor(tokenizer: string): TokenizerRules | null {
  if (!rulesCache.has(tokenizer)) rulesCache.set(tokenizer, parseTokenizerRules(tokenizer));
  return rulesCache.get(tokenizer)!;
}

/**
 * One BM25 branch over a view. Matches are found in projected text but reported
 * on the original: highlighted view tokens are mapped back through the token
 * invariant and the snippet is cut from `notes.content`.
 */
export function searchLanguageView(
  loaded: LoadedLanguagePack,
  view: string,
  ftsQuery: string,
  limit: number,
  snippetLength: number,
  markStart: string,
  markEnd: string,
  predicate?: FilterPredicate,
): ViewHit[] {
  const definition = loaded.views.find((v) => v.name === view);
  if (!definition) return [];
  let rows;
  try {
    rows = readViewMatches(view, ftsQuery, limit, markStart, markEnd, predicate);
  } catch {
    return [];
  }
  const rules = rulesFor(definition.tokenizer);
  const windowSize = Math.max(10, Math.ceil(snippetLength / 4));
  return rows.map((row) => {
    const score = Math.max(0, Math.abs(row.rank) / (1 + Math.abs(row.rank)));
    const hit: ViewHit = {
      path: row.path,
      title: row.title ?? '',
      tags: row.tags ?? '[]',
      aliases: row.aliases,
      score,
      markedSnippet: '',
      matchedTerms: [],
    };
    if (!rules) return hit;
    const title = mapHighlightedTokens(
      row.title ?? '',
      row.hl_title ?? '',
      rules,
      markStart,
      markEnd,
    );
    const content = mapHighlightedTokens(
      row.content ?? '',
      row.hl_content ?? '',
      rules,
      markStart,
      markEnd,
    );
    if (!title || !content) {
      warnLanguagePackOnce(
        `view "${view}" broke the token invariant (e.g. in ${row.path}); falling back to the note start for snippets`,
      );
    }
    if (title) hit.matchedTerms.push(...matchedWords(row.title ?? '', title.tokens, title.matched));
    if (content) {
      for (const word of matchedWords(row.content ?? '', content.tokens, content.matched))
        if (!hit.matchedTerms.includes(word)) hit.matchedTerms.push(word);
      hit.markedSnippet = buildMarkedSnippet(
        row.content ?? '',
        content.tokens,
        content.matched,
        windowSize,
        markStart,
        markEnd,
      );
    }
    return hit;
  });
}

/** Exact-alias hits from the alias views, for keys the pack derived from the query. */
export function findLanguageAliasMatches(
  loaded: LoadedLanguagePack,
  analysis: QueryAnalysis,
  limit: number,
  predicate?: FilterPredicate,
) {
  const rows: ReturnType<typeof findViewAliasRows> = [];
  for (const view of loaded.aliasViews) {
    const key = analysis.aliasKeys?.[view];
    if (typeof key !== 'string' || !key) continue;
    try {
      rows.push(...findViewAliasRows(view, key, limit, predicate));
    } catch {
      // A missing alias table means the views are being rebuilt; skip quietly.
    }
  }
  return rows;
}

/**
 * Apply the pack's rescore: unknown paths are ignored, missing paths keep their
 * score, non-finite scores are ignored, and scores outside [0, 1] are min-max
 * normalized over the whole set. The candidate set never changes.
 */
export async function rescoreCandidates<T extends { path: string; score: number }>(
  loaded: LoadedLanguagePack,
  results: T[],
  candidates: Candidate[],
  analysis: QueryAnalysis,
): Promise<T[]> {
  if (!loaded.pack.rescore || results.length === 0) return results;
  let returned;
  try {
    returned = await loaded.pack.rescore(candidates, analysis, queryContext);
    if (!Array.isArray(returned)) throw new Error('rescore() must return an array');
  } catch (error) {
    warnLanguagePackOnce(`rescore() failed; keeping fused scores: ${errorText(error)}`);
    return results;
  }
  const scores = new Map(results.map((r) => [r.path, r.score]));
  for (const entry of returned as Array<{ path?: unknown; score?: unknown }>) {
    if (typeof entry?.path !== 'string' || !scores.has(entry.path)) continue;
    if (typeof entry.score !== 'number' || !Number.isFinite(entry.score)) continue;
    scores.set(entry.path, entry.score);
  }
  const values = [...scores.values()];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const normalize =
    min < 0 || max > 1
      ? (v: number) => (max === min ? 1 : (v - min) / (max - min))
      : (v: number) => v;
  return results
    .map((r, index) => ({ r, index, score: normalize(scores.get(r.path)!) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ r, score }) => ({ ...r, score }));
}
