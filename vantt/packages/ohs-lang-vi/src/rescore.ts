/**
 * Re-score fused candidates: a candidate whose original title or snippet
 * contains the target words written exactly (accent-exact, after
 * normalization) gets a bonus; more for adjacent pairs and the whole phrase.
 * For unaccented queries the target is the best restoration and the bonus is
 * scaled by its probability. Candidates are never dropped or added.
 */
import type { Candidate, QueryAnalysis, RescoredCandidate } from './contract.js';
import { iyCanonical } from './fold.js';
import { normalize } from './normalize.js';
import type { PackOptions } from './options.js';
import type { ViAnalysisData } from './query.js';
import { tokenize } from './views.js';

/** RRF constant of the core (`rrfFusion(..., 60)`). */
const RRF_K = 60;

/** RRF weights of the core's own hybrid branches (`rrfFusion` in `searchByQuery`). */
const CORE_WEIGHTS: Readonly<Record<string, number>> = {
  semantic: 1.5,
  bm25: 1.5,
  alias: 2.0,
  title: 0.25,
};

/** BM25 results whose agreement with the semantic branch is checked. */
export const AGREEMENT_BM25_TOP = 5;
/** How deep in the semantic branch a BM25 result counts as agreeing. */
export const AGREEMENT_SEMANTIC_TOP = 10;

export interface Evidence {
  /** Share of target words present. */
  coverage: number;
  /** Share of adjacent target pairs present as adjacent words. */
  bigrams: number;
  /** 1 when the whole target occurs as a contiguous sequence. */
  phrase: number;
}

function isAnalysisData(value: unknown): value is ViAnalysisData {
  if (typeof value !== 'object' || value === null) return false;
  const data = value as Partial<ViAnalysisData>;
  return (
    Array.isArray(data.target) && Array.isArray(data.targets) && typeof data.confidence === 'number'
  );
}

function containsSequence(words: readonly string[], target: readonly string[]): boolean {
  outer: for (let i = 0; i + target.length <= words.length; i++) {
    for (let j = 0; j < target.length; j++) if (words[i + j] !== target[j]) continue outer;
    return true;
  }
  return false;
}

/** Words of an original text as the norm view stores them, i/y spellings merged. */
function evidenceWords(text: string, options: PackOptions): string[] {
  return tokenize(normalize(text, { tonePlacement: options.tonePlacement })).map(iyCanonical);
}

/**
 * Accent-exact evidence of `target` (norm words) in some original texts (the
 * title and the snippet): word coverage over all of them, pairs and the whole
 * phrase within one text (never across the title/snippet boundary). The two
 * i/y spellings of a syllable (kĩ/kỹ) count as the same word, so neither
 * spelling of the query is preferred.
 */
export function evidenceIn(
  text: string | readonly string[],
  target: readonly string[],
  options: PackOptions,
): Evidence {
  if (target.length === 0) return { coverage: 0, bigrams: 0, phrase: 0 };
  const fields = (typeof text === 'string' ? [text] : text).map((t) => evidenceWords(t, options));
  const goal = target.map(iyCanonical);
  const present = new Set(fields.flat());
  const pairs = new Set<string>();
  for (const words of fields)
    for (let i = 1; i < words.length; i++) pairs.add(`${words[i - 1]} ${words[i]}`);
  const coverage = goal.filter((w) => present.has(w)).length / goal.length;
  let bigrams = coverage;
  if (goal.length > 1) {
    let hits = 0;
    for (let i = 1; i < goal.length; i++) if (pairs.has(`${goal[i - 1]} ${goal[i]}`)) hits++;
    bigrams = hits / (goal.length - 1);
  }
  const phrase =
    goal.length > 1 ? (fields.some((words) => containsSequence(words, goal)) ? 1 : 0) : coverage;
  return { coverage, bigrams, phrase };
}

/** RRF weight a branch had in the core's hybrid fusion. */
function branchWeight(branch: string, analysis: QueryAnalysis, options: PackOptions): number {
  if (branch in CORE_WEIGHTS) return CORE_WEIGHTS[branch]!;
  if (!branch.startsWith('view:')) return 0;
  const view = branch.slice('view:'.length);
  const override = analysis.viewWeights?.[view];
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override;
  return (options.viewWeights as unknown as Record<string, number>)[view] ?? 0;
}

const isRank = (value: number | null | undefined): value is number =>
  typeof value === 'number' && value > 0;

/**
 * Share of the BM25 branch's top results that the semantic branch also ranks
 * near the top; null when the fusion was not hybrid or either branch is empty.
 */
export function bm25Agreement(candidates: ReadonlyArray<Candidate>): number | null {
  const top = candidates.filter((c) => isRank(c.rank.bm25) && c.rank.bm25 <= AGREEMENT_BM25_TOP);
  if (top.length === 0 || !candidates.some((c) => isRank(c.rank.semantic))) return null;
  return (
    top.filter((c) => isRank(c.rank.semantic) && c.rank.semantic <= AGREEMENT_SEMANTIC_TOP).length /
    top.length
  );
}

/**
 * Hybrid fusion of a Vietnamese query: RRF counts a BM25 vote by rank alone,
 * so when BM25 only matches scattered common words of an idea-style query its
 * top results still outvote the semantic answer. When the BM25 top results and
 * the semantic top results (nearly) disagree, the BM25 votes are scaled by
 * `agreement / minBm25Agreement`; the pack's own view branches keep theirs
 * (they carry the accent, compound and lexicon evidence the vectors miss).
 * Returns the score to subtract from each candidate, on the core's scale
 * (RRF sum divided by the best possible sum).
 */
export function weakBm25Penalty(
  candidates: ReadonlyArray<Candidate>,
  analysis: QueryAnalysis,
  options: PackOptions,
): number[] {
  const none = candidates.map(() => 0);
  const threshold = options.minBm25Agreement;
  const agreement = threshold > 0 ? bm25Agreement(candidates) : null;
  if (agreement === null || agreement >= threshold) return none;
  // Branches with at least one candidate were the non-empty lists of the fusion.
  const branches = new Set<string>();
  for (const c of candidates)
    for (const [b, r] of Object.entries(c.rank)) if (isRank(r)) branches.add(b);
  const maxScore =
    [...branches].reduce((sum, b) => sum + branchWeight(b, analysis, options), 0) / (RRF_K + 1);
  if (!(maxScore > 0)) return none;
  const lost = 1 - agreement / threshold;
  return candidates.map((c) =>
    isRank(c.rank.bm25) ? (lost * CORE_WEIGHTS.bm25!) / (RRF_K + c.rank.bm25) / maxScore : 0,
  );
}

export function rescoreCandidates(
  candidates: ReadonlyArray<Candidate>,
  analysis: QueryAnalysis,
  options: PackOptions,
): RescoredCandidate[] {
  const data = analysis.data;
  if (!isAnalysisData(data) || data.target.length === 0)
    return candidates.map((c) => ({ path: c.path, score: c.score }));
  const w = options.rescoreWeights;
  const penalty = data.vietnamese
    ? weakBm25Penalty(candidates, analysis, options)
    : candidates.map(() => 0);
  return candidates.map((c, index) => {
    const text = [c.title, c.snippet];
    // Expected evidence over the k-best restorations (one literal target for accented queries).
    let evidence = 0;
    for (const t of data.targets) {
      const e = evidenceIn(text, t.words, options);
      evidence += t.p * (w.phrase * e.phrase + w.bigram * e.bigrams + w.coverage * e.coverage);
    }
    const normRank = c.rank['view:norm'];
    const rankBonus = typeof normRank === 'number' && normRank > 0 ? w.normRank / normRank : 0;
    const semanticRank = c.rank.semantic;
    const semantic =
      typeof semanticRank === 'number' && semanticRank > 0
        ? w.semantic / (RRF_K + semanticRank)
        : 0;
    return {
      path: c.path,
      score: c.score - penalty[index]! + w.unit * (evidence + rankBonus) + semantic,
    };
  });
}
