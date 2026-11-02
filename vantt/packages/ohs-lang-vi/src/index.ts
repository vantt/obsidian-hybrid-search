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
import { createProjector, VIEW_TOKENIZER } from './views.js';

export const PACK_ID = 'vi';
export const PACK_VERSION = '0.2.0';

/**
 * Index-affecting configuration. Anything that changes `project()` output must
 * be listed here (a word-segmentation dictionary hash joins it with V20).
 */
export function packSignature(options: PackOptions): string {
  return `${PACK_VERSION};tone=${options.tonePlacement};iy=${options.foldIY ? 1 : 0}`;
}

export function createPack(rawOptions?: unknown): LanguagePackV1 {
  const options = resolveOptions(rawOptions);
  const env: QueryEnvironment = {
    options,
    cache: new VocabularyCache(),
    forms: accentedForms(options.tonePlacement, options.foldIY),
  };
  const projector = createProjector(options);
  const pack: LanguagePackV1 = {
    apiVersion: 1,
    id: PACK_ID,
    version: PACK_VERSION,
    signature: () => packSignature(options),
    views: [
      { name: 'norm', weight: options.viewWeights.norm, tokenizer: VIEW_TOKENIZER },
      { name: 'fold', weight: options.viewWeights.fold, tokenizer: VIEW_TOKENIZER },
    ],
    project: (view, _field, text) => projector(view, text),
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
export { decodeKeystrokes, decodeTelex, decodeVni, telexForms, vniForms } from './telex.js';
export { correctTypos, editNeighbours } from './typo.js';
export { evidenceIn, rescoreCandidates } from './rescore.js';
export {
  composeSyllable,
  isPossibleFoldedSyllable,
  isVietnameseSyllable,
  parseSyllable,
  toneIndex,
  type Syllable,
} from './syllable.js';
export { createProjector, projectView, tokenize, VIEW_TOKENIZER } from './views.js';
