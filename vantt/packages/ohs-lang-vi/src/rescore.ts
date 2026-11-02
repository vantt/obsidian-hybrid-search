/**
 * Re-score fused candidates: a candidate whose original title or snippet
 * contains the target words written exactly (accent-exact, after
 * normalization) gets a bonus; more for adjacent pairs and the whole phrase.
 * For unaccented queries the target is the best restoration and the bonus is
 * scaled by its probability. Candidates are never dropped or added.
 */
import type { Candidate, QueryAnalysis, RescoredCandidate } from './contract.js';
import { normalize } from './normalize.js';
import type { PackOptions } from './options.js';
import type { ViAnalysisData } from './query.js';
import { tokenize } from './views.js';

/** RRF constant of the core (`rrfFusion(..., 60)`). */
const RRF_K = 60;

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
  return Array.isArray(data.target) && Array.isArray(data.targets) && typeof data.confidence === 'number';
}

function containsSequence(words: readonly string[], target: readonly string[]): boolean {
  outer: for (let i = 0; i + target.length <= words.length; i++) {
    for (let j = 0; j < target.length; j++) if (words[i + j] !== target[j]) continue outer;
    return true;
  }
  return false;
}

/** Accent-exact evidence of `target` (norm words) in some original text. */
export function evidenceIn(text: string, target: readonly string[], options: PackOptions): Evidence {
  if (target.length === 0) return { coverage: 0, bigrams: 0, phrase: 0 };
  const words = tokenize(normalize(text, { tonePlacement: options.tonePlacement }));
  const present = new Set(words);
  const pairs = new Set<string>();
  for (let i = 1; i < words.length; i++) pairs.add(`${words[i - 1]} ${words[i]}`);
  const coverage = target.filter((w) => present.has(w)).length / target.length;
  let bigrams = coverage;
  if (target.length > 1) {
    let hits = 0;
    for (let i = 1; i < target.length; i++) if (pairs.has(`${target[i - 1]} ${target[i]}`)) hits++;
    bigrams = hits / (target.length - 1);
  }
  const phrase = target.length > 1 ? (containsSequence(words, target) ? 1 : 0) : coverage;
  return { coverage, bigrams, phrase };
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
  return candidates.map((c) => {
    const text = `${c.title}\n${c.snippet}`;
    // Expected evidence over the k-best restorations (one literal target for accented queries).
    let evidence = 0;
    for (const t of data.targets) {
      const e = evidenceIn(text, t.words, options);
      evidence += t.p * (w.phrase * e.phrase + w.bigram * e.bigrams + w.coverage * e.coverage);
    }
    const normRank = c.rank['view:norm'];
    const rankBonus = typeof normRank === 'number' && normRank > 0 ? w.normRank / normRank : 0;
    const semanticRank = c.rank.semantic;
    const semantic = typeof semanticRank === 'number' && semanticRank > 0 ? w.semantic / (RRF_K + semanticRank) : 0;
    return { path: c.path, score: c.score + w.unit * (evidence + rankBonus) + semantic };
  });
}
