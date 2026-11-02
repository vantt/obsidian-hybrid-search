/**
 * ohs-lang-vi: Vietnamese language pack for obsidian-hybrid-search (P01 API v1).
 *
 * The default export is the pack factory: the core calls it with the parsed
 * `OHS_LANGUAGE_PACK_OPTIONS` JSON. The M1 primitives stay exported for
 * standalone use and tests.
 */
import type { LanguagePackV1 } from './contract.js';
import { resolveOptions, type PackOptions } from './options.js';
import { analyzeQuery, type QueryEnvironment } from './query.js';
import { accentedForms, VocabularyCache } from './restore.js';
import { rescoreCandidates } from './rescore.js';
import { CompoundSource, projectSegmented, SEG_TOKENIZER } from './segment.js';
import { SEG_VIEW } from './segment-query.js';
import { createProjector, createTokenProjector, VIEW_TOKENIZER } from './views.js';

export const PACK_ID = 'vi';
export const PACK_VERSION = '0.2.0';

/**
 * Index-affecting configuration. Anything that changes `project()` output must
 * be listed here: with `segment`, the digest of the compound dictionary
 * (bundled plus lexicon compounds).
 */
export function packSignature(options: PackOptions, compoundDigest?: string): string {
  const base = `${PACK_VERSION};tone=${options.tonePlacement};iy=${options.foldIY ? 1 : 0}`;
  return options.segment && compoundDigest ? `${base};seg=${compoundDigest}` : base;
}

/** Compound words of the user lexicon (`## Từ ghép`), wired to the lexicon reader (V18). */
const lexiconCompounds = (): ReadonlyArray<readonly string[]> => [];

export function createPack(rawOptions?: unknown): LanguagePackV1 {
  const options = resolveOptions(rawOptions);
  const env: QueryEnvironment = {
    options,
    cache: new VocabularyCache(),
    forms: accentedForms(options.tonePlacement, options.foldIY),
  };
  const projector = createProjector(options);
  const compounds = options.segment ? new CompoundSource(options.tonePlacement, lexiconCompounds) : null;
  if (compounds) env.compounds = () => compounds.current();
  const normToken = createTokenProjector(options);
  const segToken = (token: string) => normToken('norm', token);
  const pack: LanguagePackV1 = {
    apiVersion: 1,
    id: PACK_ID,
    version: PACK_VERSION,
    signature: () => packSignature(options, compounds?.refresh().digest),
    views: [
      { name: 'norm', weight: options.viewWeights.norm, tokenizer: VIEW_TOKENIZER },
      { name: 'fold', weight: options.viewWeights.fold, tokenizer: VIEW_TOKENIZER },
      ...(compounds ? [{ name: SEG_VIEW, weight: options.viewWeights.seg, tokenizer: SEG_TOKENIZER }] : []),
    ],
    project: (view, _field, text) =>
      compounds && view === SEG_VIEW ? projectSegmented(text, segToken, compounds.current()) : projector(view, text),
    analyzeQuery: (query, ctx) => analyzeQuery(query, ctx, env),
    // aliasViews (V19) and queryCacheKey (V18, lexicon hash) are added here.
  };
  if (options.rescore) pack.rescore = (candidates, analysis) => rescoreCandidates(candidates, analysis, options);
  return pack;
}

export default createPack;

export type * from './contract.js';
export * from './data.js';
export { fold, type FoldOptions } from './fold.js';
export { normalize, type NormalizeOptions } from './normalize.js';
export { DEFAULT_OPTIONS, resolveOptions, type PackOptions, type RescoreWeights, type RestoreParams, type ViewWeights } from './options.js';
export { analyzeQuery, type ViAnalysisData } from './query.js';
export { accentedForms, restoreTokens, VocabularyCache, type RestoreResult } from './restore.js';
export { evidenceIn, rescoreCandidates } from './rescore.js';
export {
  composeSyllable,
  isPossibleFoldedSyllable,
  isVietnameseSyllable,
  parseSyllable,
  toneIndex,
  type Syllable,
} from './syllable.js';
export {
  buildDictionary,
  bundledCompounds,
  CompoundSource,
  compoundsOf,
  projectSegmented,
  SEG_JOINER,
  SEG_TOKENIZER,
  segmentWords,
  type CompoundDictionary,
} from './segment.js';
export { segQuery, SEG_VIEW } from './segment-query.js';
export { createProjector, createTokenProjector, projectView, tokenize, VIEW_TOKENIZER } from './views.js';
