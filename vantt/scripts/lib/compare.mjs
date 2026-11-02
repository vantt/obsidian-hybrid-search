// Per-query comparison of two upstream eval results (PRD 11.4): `top_paths` must agree in
// order, scores within a tolerance.
export const SCORE_FIELDS = ['ndcg_5', 'ndcg_k', 'mrr', 'recall_k'];
export const SCORE_TOLERANCE = 1e-6;

/**
 * Compare `a` (upstream) with `b` (fork) result files. Returns
 * {queries, identical, mismatches: [{id, kind, ...}]}; a query present on one side only counts as a mismatch.
 */
export function compareResults(a, b, tolerance = SCORE_TOLERANCE) {
  const byId = (r) => new Map((r.per_query ?? []).map((q) => [q.id, q]));
  const qa = byId(a);
  const qb = byId(b);
  const mismatches = [];
  for (const [id, x] of qa) {
    const y = qb.get(id);
    if (!y) {
      mismatches.push({ id, kind: 'missing_in_fork' });
      continue;
    }
    const xp = x.top_paths ?? [];
    const yp = y.top_paths ?? [];
    if (xp.length !== yp.length || xp.some((p, i) => p !== yp[i])) {
      mismatches.push({ id, kind: 'top_paths', upstream: xp, fork: yp });
      continue;
    }
    for (const f of SCORE_FIELDS) {
      if (!(Math.abs((x[f] ?? 0) - (y[f] ?? 0)) <= tolerance)) {
        mismatches.push({ id, kind: 'score', field: f, upstream: x[f], fork: y[f] });
        break;
      }
    }
  }
  for (const id of qb.keys()) if (!qa.has(id)) mismatches.push({ id, kind: 'missing_in_upstream' });
  const queries = new Set([...qa.keys(), ...qb.keys()]).size;
  const bad = new Set(mismatches.map((m) => m.id)).size;
  return { queries, identical: queries - bad, mismatches };
}
