import type { TonePlacement } from './data.js';

/** RRF weights of the view branches (query-time only; not part of the signature). */
export interface ViewWeights {
  norm: number;
  fold: number;
  /** Weight of the seg view branch (used only with `segment`). */
  seg: number;
}

/** Parameters of `restore.ts` (query-time only). */
export interface RestoreParams {
  /** Most accented variants kept per syllable (PRD 10.3: 5). */
  maxVariants: number;
  /** Longest query (in syllables) that is restored; longer queries skip restoration. */
  maxSyllables: number;
  /** Weight of the bigram (adjacent-pair) log-probability against the unigram one. */
  bigramWeight: number;
  /** Additive smoothing of unigram document counts. */
  unigramSmoothing: number;
  /** Additive smoothing of bigram (phrase) document counts. */
  bigramSmoothing: number;
  /** Most `phraseDocs` lookups per query (bounds the cost on a real index). */
  maxPhraseLookups: number;
  /** Beam width of the k-best Viterbi search. */
  beamWidth: number;
  /** Extra variants of a syllable whose marginal probability reaches this go into the norm query too. */
  alternativeThreshold: number;
}

/** Parameters of `rescore.ts` (query-time only). */
export interface RescoreWeights {
  /** Bonus when the whole target phrase occurs in the title or snippet. */
  phrase: number;
  /** Bonus scaled by the share of target bigrams that occur. */
  bigram: number;
  /** Bonus scaled by the share of target syllables that occur (accent-exact). */
  coverage: number;
  /** Bonus for appearing in the norm view branch, scaled by 1 / rank. */
  normRank: number;
  /** One unit of bonus, on the RRF scale (about one first-place branch hit). */
  unit: number;
  /**
   * Extra RRF weight given back to the vector branch (`weight / (60 + rank)`),
   * so the lexical view branches the pack adds do not drown semantic matches.
   */
  semantic: number;
}

export interface PackOptions {
  /** Tone-mark position used by the norm view (index-affecting). */
  tonePlacement: TonePlacement;
  /** Merge syllable-final y into i in the fold view (index-affecting). */
  foldIY: boolean;
  /** Restore diacritics of unaccented queries from the vault vocabulary. */
  restore: boolean;
  /** Send the restored query to the embedder (M4; off until measured). */
  restoreForEmbedding: boolean;
  /** Minimum probability of the best restoration for restoreForEmbedding. */
  embedMinConfidence: number;
  /**
   * A query counts as accented (typed with diacritics on purpose) when more
   * than this share of its Vietnamese syllables carry a diacritic. Unaccented
   * syllables of an accented query are then taken literally, not restored.
   */
  accentedRatio: number;
  /**
   * The views are used only when at least this share of the query tokens are
   * Vietnamese syllables (accented or possible unaccented ones). Below it the
   * query is something else (English, Telex keystrokes) and the pack is inert.
   */
  minSyllableShare: number;
  /**
   * Search the norm branch for an accented query. Off by default: upstream
   * BM25 already matches accented words and rescore checks exact accents, while
   * one more lexical branch drowns purely semantic matches (vi-semantic).
   */
  accentedNorm: boolean;
  /**
   * Search the fold branch for an accented query: 'always', 'never', or
   * 'auto' (only when the vault literally contains the query's words written
   * without diacritics, i.e. there are notes typed unaccented to find).
   */
  accentedFold: 'always' | 'auto' | 'never';
  /**
   * Add the `seg` view: compound words joined with `_` (index-affecting).
   * Its branch searches the compound words of the query only.
   */
  segment: boolean;
  viewWeights: ViewWeights;
  restoreParams: RestoreParams;
  rescore: boolean;
  rescoreWeights: RescoreWeights;
}

export const DEFAULT_OPTIONS: PackOptions = {
  tonePlacement: 'modern',
  foldIY: false,
  restore: true,
  restoreForEmbedding: false,
  embedMinConfidence: 0.8,
  accentedRatio: 0.5,
  minSyllableShare: 0.5,
  accentedNorm: false,
  accentedFold: 'auto',
  segment: false,
  viewWeights: { norm: 1.5, fold: 0.75, seg: 1 },
  restoreParams: {
    maxVariants: 5,
    maxSyllables: 12,
    bigramWeight: 3,
    unigramSmoothing: 0.5,
    bigramSmoothing: 0.1,
    maxPhraseLookups: 96,
    beamWidth: 16,
    alternativeThreshold: 0.15,
  },
  rescore: true,
  rescoreWeights: { phrase: 4, bigram: 1, coverage: 0.5, normRank: 0, unit: 1 / 61, semantic: 0 },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeNumbers<T extends object>(base: T, input: unknown, label: string): T {
  if (input === undefined) return { ...base };
  if (!isRecord(input)) throw new TypeError(`ohs-lang-vi: option "${label}" must be an object`);
  const out: Record<string, number> = { ...(base as Record<string, number>) };
  for (const [key, value] of Object.entries(input)) {
    if (!(key in out)) throw new TypeError(`ohs-lang-vi: unknown option "${label}.${key}"`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      throw new TypeError(`ohs-lang-vi: option "${label}.${key}" must be a non-negative number`);
    out[key] = value;
  }
  return out as T;
}

function bool(input: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new TypeError(`ohs-lang-vi: option "${key}" must be a boolean`);
  return value;
}

function oneOf<T extends string>(input: Record<string, unknown>, key: string, allowed: readonly T[], fallback: T): T {
  const value = input[key];
  if (value === undefined) return fallback;
  if (!allowed.includes(value as T))
    throw new TypeError(`ohs-lang-vi: option "${key}" must be one of ${allowed.map((a) => `"${a}"`).join(', ')}`);
  return value as T;
}

function ratio(input: Record<string, unknown>, key: string, fallback: number): number {
  const value = input[key];
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !(value >= 0 && value <= 1))
    throw new TypeError(`ohs-lang-vi: option "${key}" must be a number in [0, 1]`);
  return value;
}

/**
 * Validate `OHS_LANGUAGE_PACK_OPTIONS` and fill defaults. Options that later
 * milestones own (telex, typo, lexiconPath) are accepted and ignored
 * here so a config written for a newer pack does not break this one.
 */
export function resolveOptions(input: unknown = {}): PackOptions {
  if (input === null || input === undefined) input = {};
  if (!isRecord(input)) throw new TypeError('ohs-lang-vi: options must be a JSON object');
  const tonePlacement = input.tonePlacement ?? DEFAULT_OPTIONS.tonePlacement;
  if (tonePlacement !== 'modern' && tonePlacement !== 'classic')
    throw new TypeError('ohs-lang-vi: option "tonePlacement" must be "modern" or "classic"');
  return {
    tonePlacement,
    foldIY: bool(input, 'foldIY', DEFAULT_OPTIONS.foldIY),
    restore: bool(input, 'restore', DEFAULT_OPTIONS.restore),
    restoreForEmbedding: bool(input, 'restoreForEmbedding', DEFAULT_OPTIONS.restoreForEmbedding),
    embedMinConfidence: ratio(input, 'embedMinConfidence', DEFAULT_OPTIONS.embedMinConfidence),
    accentedRatio: ratio(input, 'accentedRatio', DEFAULT_OPTIONS.accentedRatio),
    minSyllableShare: ratio(input, 'minSyllableShare', DEFAULT_OPTIONS.minSyllableShare),
    accentedNorm: bool(input, 'accentedNorm', DEFAULT_OPTIONS.accentedNorm),
    accentedFold: oneOf(input, 'accentedFold', ['always', 'auto', 'never'] as const, DEFAULT_OPTIONS.accentedFold),
    segment: bool(input, 'segment', DEFAULT_OPTIONS.segment),
    viewWeights: mergeNumbers(DEFAULT_OPTIONS.viewWeights, input.viewWeights, 'viewWeights'),
    restoreParams: mergeNumbers(DEFAULT_OPTIONS.restoreParams, input.restoreParams, 'restoreParams'),
    rescore: bool(input, 'rescore', DEFAULT_OPTIONS.rescore),
    rescoreWeights: mergeNumbers(DEFAULT_OPTIONS.rescoreWeights, input.rescoreWeights, 'rescoreWeights'),
  };
}
