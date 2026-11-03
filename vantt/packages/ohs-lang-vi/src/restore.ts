/**
 * Diacritic restoration from the vault's own vocabulary.
 *
 * For each unaccented syllable of a query, the accented forms that really
 * occur in the vault (norm view) are candidates, weighted by how many notes
 * contain them. Adjacent candidates that occur together as a phrase are
 * preferred. The best combinations come from a k-best Viterbi search over
 * unigram + bigram scores; their scores are turned into probabilities.
 *
 * Candidate generation is driven by the syllable tables (every syllable that
 * folds to the typed one), not by scanning the vault vocabulary: the cost per
 * query is a few point lookups per syllable, independent of vocabulary size.
 * Lookups are cached per `dbVersion`.
 */
import type { QueryContext } from './contract.js';
import { CODAS, NUCLEI, ONSETS, TONES, type TonePlacement } from './data.js';
import { fold } from './fold.js';
import type { RestoreParams } from './options.js';
import { composeSyllable, parseSyllable } from './syllable.js';

// ---------------------------------------------------------------------------
// Accented forms of a folded syllable
// ---------------------------------------------------------------------------

const inventories = new Map<string, Map<string, string[]>>();

/**
 * Map from a folded syllable ("ban") to every Vietnamese syllable that folds
 * to it ("ban", "bán", "bàn", "bản", "bãn", "bạn", "băn", ...), written with
 * the given tone placement. Built once per (style, foldIY).
 */
export function accentedForms(
  style: TonePlacement,
  foldIY: boolean,
): ReadonlyMap<string, readonly string[]> {
  const key = `${style}:${foldIY}`;
  let map = inventories.get(key);
  if (map) return map;
  map = new Map();
  const seen = new Set<string>();
  for (const onset of ['', ...ONSETS]) {
    for (const entry of NUCLEI) {
      for (const coda of ['', ...CODAS]) {
        const parsed = parseSyllable(onset + entry.text + coda);
        if (parsed === null) continue;
        for (const tone of TONES) {
          const word = composeSyllable({ ...parsed, tone }, style);
          if (seen.has(word)) continue;
          seen.add(word);
          const folded = fold(word, { foldIY });
          const list = map.get(folded);
          if (list) list.push(word);
          else map.set(folded, [word]);
        }
      }
    }
  }
  inventories.set(key, map);
  return map;
}

// ---------------------------------------------------------------------------
// Vocabulary statistics, cached per dbVersion
// ---------------------------------------------------------------------------

const MAX_CACHE_ENTRIES = 50_000;

/** Memoizes the context lookups restoration needs; resets when the index changes. */
export class VocabularyCache {
  private version: number | null = null;
  private readonly docs = new Map<string, number>();
  private readonly phrases = new Map<string, number>();

  /** Bind to the context's current db version, dropping stale entries. */
  sync(ctx: QueryContext): void {
    const version = ctx.dbVersion();
    if (version !== this.version || this.docs.size + this.phrases.size > MAX_CACHE_ENTRIES) {
      this.version = version;
      this.docs.clear();
      this.phrases.clear();
    }
  }

  termDocs(ctx: QueryContext, view: string, term: string): number {
    const key = `${view}\0${term}`;
    let n = this.docs.get(key);
    if (n === undefined) {
      n = ctx.termStats(view, term).docs;
      this.docs.set(key, n);
    }
    return n;
  }

  phraseDocs(ctx: QueryContext, view: string, phrase: string): number {
    const key = `${view}\0${phrase}`;
    let n = this.phrases.get(key);
    if (n === undefined) {
      n = ctx.phraseDocs(view, phrase);
      this.phrases.set(key, n);
    }
    return n;
  }
}

// ---------------------------------------------------------------------------
// Restoration
// ---------------------------------------------------------------------------

/** One query token as seen by restoration. */
export interface RestoreInput {
  /** Normalized (accent-preserving) token. */
  norm: string;
  /** Token folded the way the fold view folds. */
  folded: string;
  /** Taken literally: accented on purpose, or not a Vietnamese syllable. */
  pinned: boolean;
}

export interface Variant {
  form: string;
  docs: number;
  /** Probability that this position is written `form`, over the k-best list. */
  marginal: number;
}

export interface RestoredToken {
  norm: string;
  folded: string;
  pinned: boolean;
  /** Accented forms found in the vault, best first; `[norm]` when pinned or none found. */
  variants: Variant[];
  /** True when at least one accented form came from the vault. */
  restored: boolean;
  /** Notes containing the token exactly as typed (norm view); 0 for pinned tokens. */
  literalDocs: number;
}

export interface Restoration {
  forms: string[];
  probability: number;
}

export interface RestoreResult {
  tokens: RestoredToken[];
  /** Best combinations first; probabilities sum to 1 over this list. */
  candidates: Restoration[];
  /** Probability of the best combination. */
  confidence: number;
  /** `phraseDocs` lookups made (cache misses and hits). */
  phraseLookups: number;
}

interface Option {
  form: string;
  docs: number;
  logp: number;
}

interface Hypothesis {
  score: number;
  /** Variant index per position so far. */
  path: number[];
}

/** Per-state k for the k-best Viterbi. */
const K_PER_STATE = 4;

function emissionOptions(
  input: RestoreInput,
  restorable: boolean,
  forms: ReadonlyMap<string, readonly string[]>,
  cache: VocabularyCache,
  ctx: QueryContext,
  params: RestoreParams,
): Option[] {
  const literal = [{ form: input.norm, docs: 0, logp: 0 }];
  if (!restorable) return literal;
  const accented = forms.get(input.folded);
  if (!accented) return literal;
  // The fold view tells cheaply whether any form of this syllable exists at all.
  if (cache.termDocs(ctx, 'fold', input.folded) === 0) return literal;
  const found = accented
    .map((form) => ({ form, docs: cache.termDocs(ctx, 'norm', form) }))
    .filter((o) => o.docs > 0)
    .sort((a, b) => b.docs - a.docs || (a.form < b.form ? -1 : 1))
    .slice(0, params.maxVariants);
  if (found.length === 0) return literal;
  const total = found.reduce((sum, o) => sum + o.docs, 0);
  const denominator = total + params.unigramSmoothing * found.length;
  return found.map((o) => ({
    ...o,
    logp: Math.log((o.docs + params.unigramSmoothing) / denominator),
  }));
}

/**
 * Restore diacritics of `inputs` (one query, in order). Pinned tokens keep
 * their form; the first `maxSyllables` unpinned tokens are restored, the rest
 * are kept as typed.
 */
export function restoreTokens(
  inputs: readonly RestoreInput[],
  ctx: QueryContext,
  cache: VocabularyCache,
  params: RestoreParams,
  forms: ReadonlyMap<string, readonly string[]>,
): RestoreResult {
  cache.sync(ctx);
  let budget = params.maxSyllables;
  const options = inputs.map((input) => {
    const restorable = !input.pinned && budget > 0;
    if (restorable) budget--;
    return emissionOptions(input, restorable, forms, cache, ctx, params);
  });

  // Bigram evidence: phrase document counts of adjacent candidates, most
  // probable pairs first, bounded per pair and per query.
  const ambiguousPairs: number[] = [];
  for (let i = 1; i < options.length; i++) {
    const a = options[i - 1]!;
    const b = options[i]!;
    if ((a.length > 1 || b.length > 1) && a[0]!.docs > 0 && b[0]!.docs > 0) ambiguousPairs.push(i);
  }
  const perPair = ambiguousPairs.length
    ? Math.max(1, Math.floor(params.maxPhraseLookups / ambiguousPairs.length))
    : 0;
  const transitions = new Map<string, number>();
  let phraseLookups = 0;
  for (const i of ambiguousPairs) {
    const pairs: Array<{ a: number; b: number; p: number }> = [];
    options[i - 1]!.forEach((oa, a) =>
      options[i]!.forEach((ob, b) => pairs.push({ a, b, p: oa.logp + ob.logp })),
    );
    pairs.sort((x, y) => y.p - x.p);
    for (const { a, b } of pairs.slice(0, perPair)) {
      const phrase = `${options[i - 1]![a]!.form} ${options[i]![b]!.form}`;
      const n = cache.phraseDocs(ctx, 'norm', phrase);
      phraseLookups++;
      if (n > 0)
        transitions.set(
          `${i}:${a}:${b}`,
          params.bigramWeight * Math.log1p(n / params.bigramSmoothing),
        );
    }
  }

  // k-best Viterbi: keep the K best partial paths ending in each variant.
  let states: Hypothesis[][] = (options[0] ?? []).map((o, v) => [{ score: o.logp, path: [v] }]);
  for (let i = 1; i < options.length; i++) {
    states = options[i]!.map((o, v) => {
      const next: Hypothesis[] = [];
      states.forEach((list, u) => {
        const t = transitions.get(`${i}:${u}:${v}`) ?? 0;
        for (const h of list) next.push({ score: h.score + o.logp + t, path: [...h.path, v] });
      });
      next.sort((x, y) => y.score - x.score);
      return next.slice(0, K_PER_STATE);
    });
  }
  const finals = states
    .flat()
    .sort((x, y) => y.score - x.score)
    .slice(0, params.beamWidth);

  const top = finals[0]?.score ?? 0;
  const weights = finals.map((h) => Math.exp(h.score - top));
  const sum = weights.reduce((s, w) => s + w, 0) || 1;
  const candidates = finals.map((h, index) => ({
    forms: h.path.map((v, i) => options[i]![v]!.form),
    probability: weights[index]! / sum,
  }));

  const tokens: RestoredToken[] = inputs.map((input, i) => {
    const opts = options[i]!;
    const marginals = opts.map(() => 0);
    finals.forEach((h, index) => {
      marginals[h.path[i]!]! += weights[index]! / sum;
    });
    return {
      norm: input.norm,
      folded: input.folded,
      pinned: input.pinned,
      restored: opts[0]!.docs > 0,
      literalDocs: input.pinned ? 0 : cache.termDocs(ctx, 'norm', input.norm),
      variants: opts
        .map((o, v) => ({ form: o.form, docs: o.docs, marginal: marginals[v]! }))
        .sort((x, y) => y.marginal - x.marginal || y.docs - x.docs),
    };
  });

  return {
    tokens,
    candidates,
    confidence: candidates[0]?.probability ?? 1,
    phraseLookups,
  };
}
