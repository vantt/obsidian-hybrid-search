/**
 * Fake language pack for core tests. One view, `upper`: the text upper-cased.
 * Upper-casing folds `ß` to `SS`, which SQLite's unicode61 tokenizer never does,
 * so "strasse" finds "Straße" only through the view branch.
 *
 * Options (OHS_LANGUAGE_PACK_OPTIONS):
 * - variant: string mixed into signature() to force a view rebuild
 * - joinWords: [[a, b], ...] adjacent words joined with `_` into one view token
 * - aliasViews: true to feed the exact-alias branch
 * - rescore: 'reverse' to reverse fused order, add an unknown path and omit one path
 * - fail: 'load' | 'apiVersion' | 'project' | 'project-on-explode' | 'invariant' | 'analyze'
 *
 * Test hooks on globalThis: __langUpperSynonyms (query → replacement view query),
 * __langUpperQueryKey (returned by queryCacheKey()), __langUpperAnalysis (fields
 * merged into every analysis), __langUpperContexts (receives the contexts passed
 * to signature() and queryCacheKey()) and __langUpperCandidates (receives the
 * candidates passed to rescore()).
 */
import type {
  Candidate,
  LanguagePackV1,
  PackContext,
  QueryAnalysis,
  QueryContext,
} from '../../../../src/language/types.js';

interface Options {
  variant?: string;
  joinWords?: Array<[string, string]>;
  aliasViews?: boolean;
  rescore?: 'reverse' | 'record';
  fail?: string;
}

interface Hooks {
  __langUpperSynonyms?: Record<string, string>;
  __langUpperQueryKey?: string;
  __langUpperAnalysis?: Partial<QueryAnalysis>;
  __langUpperContexts?: Array<{ hook: string; ctx: PackContext | undefined }>;
  __langUpperCandidates?: Candidate[];
}

const hooks = globalThis as Hooks;

function escape(word: string): string {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function createPack(options: Options = {}): LanguagePackV1 {
  if (options.fail === 'load') throw new Error('lang-upper refused to load');
  const joins = (options.joinWords ?? []).map(([a, b]) => ({
    pattern: new RegExp(`(?<![\\p{L}\\p{N}])${escape(a.toUpperCase())}\\s+${escape(b.toUpperCase())}(?![\\p{L}\\p{N}])`, 'gu'),
    joined: `${a.toUpperCase()}_${b.toUpperCase()}`,
  }));

  function upper(text: string): string {
    let out = text.toUpperCase();
    for (const { pattern, joined } of joins) out = out.replace(pattern, joined);
    return out;
  }

  return {
    apiVersion: (options.fail === 'apiVersion' ? 2 : 1) as 1,
    id: 'upper',
    version: '1.0.0',
    signature(ctx?: PackContext) {
      hooks.__langUpperContexts?.push({ hook: 'signature', ctx });
      return `1.0.0:${options.variant ?? ''}:${JSON.stringify(options.joinWords ?? [])}`;
    },
    views: [
      {
        name: 'upper',
        weight: 1.0,
        ...(joins.length > 0 ? { tokenizer: "unicode61 remove_diacritics 0 tokenchars '+#_'" } : {}),
      },
    ],
    aliasViews: options.aliasViews ? ['upper'] : undefined,
    project(_view, _field, text) {
      if (options.fail === 'project') throw new Error('lang-upper project failed');
      if (options.fail === 'project-on-explode' && /explode/i.test(text))
        throw new Error('lang-upper cannot project EXPLODE');
      // Dropping the first word breaks the token invariant on purpose.
      if (options.fail === 'invariant') return upper(text).replace(/^[^\p{L}\p{N}]*[\p{L}\p{N}]+/u, '');
      return upper(text);
    },
    analyzeQuery(query: string, ctx: QueryContext): QueryAnalysis {
      if (options.fail === 'analyze') throw new Error('lang-upper analyzeQuery failed');
      const replacement = hooks.__langUpperSynonyms?.[query.toLowerCase()];
      const viewQuery = upper(replacement ?? query);
      const firstTerm = viewQuery.split(/\s+/)[0]?.toLowerCase() ?? '';
      return {
        viewQueries: { upper: viewQuery },
        ...(options.aliasViews ? { aliasKeys: { upper: upper(query) } } : {}),
        data: { query },
        debug: {
          upper: viewQuery,
          firstTermDocs: ctx.termStats('upper', firstTerm).docs,
          prefixTerms: ctx.termsWithPrefix('upper', firstTerm.slice(0, 3), 5).map((t) => t.term),
          phraseDocs: ctx.phraseDocs('upper', viewQuery),
          notes: ctx.noteCount(),
          dbVersion: ctx.dbVersion(),
          vaultPathKnown: ctx.vaultPath.length > 0,
        },
        ...hooks.__langUpperAnalysis,
      };
    },
    queryCacheKey(ctx?: PackContext) {
      hooks.__langUpperContexts?.push({ hook: 'queryCacheKey', ctx });
      return hooks.__langUpperQueryKey ?? '';
    },
    ...(options.rescore === 'reverse'
      ? {
          rescore(candidates: ReadonlyArray<Candidate>) {
            const kept = candidates.slice(0, -1);
            return [
              ...kept.map((c, i) => ({ path: c.path, score: 10 + i })),
              { path: 'not-a-candidate.md', score: 1000 },
              { path: kept[0]?.path ?? 'x', score: Number.NaN },
            ];
          },
        }
      : {}),
    ...(options.rescore === 'record'
      ? {
          rescore(candidates: ReadonlyArray<Candidate>) {
            hooks.__langUpperCandidates = [...candidates];
            return [];
          },
        }
      : {}),
  };
}
