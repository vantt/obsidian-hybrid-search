/**
 * The core's hybrid fusion, mirrored here (the only place in the pack):
 * `HYBRID_FUSION` of the patched core, used by `rrfFusion(lists, k, weights)`
 * in `searchByQuery` (`src/search/searcher.ts`). P01 does not pass these values
 * to `rescore`; `test/core-fusion.test.ts` checks them against
 * `test/fixtures/core-fusion.json`, which the core's patch test checks too.
 */

/** RRF constant of the core. */
export const RRF_K = 60;

/** RRF weights of the core's own hybrid branches. */
export const CORE_WEIGHTS: Readonly<Record<string, number>> = {
  semantic: 1.5,
  bm25: 1.5,
  alias: 2.0,
  title: 0.25,
};
