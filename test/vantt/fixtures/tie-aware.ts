/**
 * Upstream breaks ties by indexing order, which differs between machines. Two
 * kinds of tie show up when comparing against an upstream snapshot:
 *
 * - results with exactly equal final scores swap places;
 * - results with exactly equal component scores (for example a semantic score
 *   that is the same float for two notes) swap places, and because the fused
 *   score is rank based the two notes also swap their fused scores.
 *
 * Both are the same situation: the notes are indistinguishable to the search
 * engine, so only which note sits where may differ. Everything else (paths,
 * scores, all other fields, the score table by position, the rank sequence) must
 * match exactly.
 */
export interface Hit {
  score: number;
  rank?: number;
  scores?: Record<string, unknown>;
  matchedBy?: unknown;
}

/** Consecutive equal-score runs compared as unordered groups of whole records. */
function equalScoreView(results: readonly Hit[]): unknown {
  const groups: Array<{ score: number; members: string[] }> = [];
  for (const { rank: _rank, ...rest } of results) {
    const member = JSON.stringify(rest);
    const last = groups[groups.length - 1];
    if (last && last.score === rest.score) last.members.push(member);
    else groups.push({ score: rest.score, members: [member] });
  }
  for (const group of groups) group.members.sort((a, b) => a.localeCompare(b));
  return { ranks: results.map((r) => r.rank), groups };
}

/**
 * The score table by position stays fixed; the note-specific part of each record
 * is compared as an unordered set among records that share identical component
 * scores and match sources.
 */
function equalComponentView(results: readonly Hit[]): unknown {
  const table: unknown[] = [];
  const notesBySignature = new Map<string, string[]>();
  for (const hit of results) {
    const { score, rank, scores, matchedBy, ...note } = hit;
    const { hybrid, ...components } = scores ?? {};
    const signature = JSON.stringify({ components, matchedBy });
    table.push({ score, rank, hybrid, signature });
    const notes = notesBySignature.get(signature) ?? [];
    notes.push(JSON.stringify(note));
    notesBySignature.set(signature, notes);
  }
  const notes = [...notesBySignature.entries()]
    .map(([signature, members]) => ({
      signature,
      members: members.sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.signature.localeCompare(b.signature));
  return { table, notes };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function sameUpToTies(actual: readonly Hit[], expected: readonly Hit[]): boolean {
  return (
    same(equalScoreView(actual), equalScoreView(expected)) ||
    same(equalComponentView(actual), equalComponentView(expected))
  );
}
