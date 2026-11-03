// Pure parts of the upstream review (PRD 12): tag handling, probe verdicts, quality tables,
// blind side-by-side pairs and their tally. No I/O here, so the tests need no repository.

/** Files where the language pack hooks live (PRD 10.2); changes there always matter. */
export const HOOK_FILES = [
  'src/search/searcher.ts',
  'src/storage/db.ts',
  'src/storage/search-queries.ts',
  'src/content/chunker.ts',
  'src/inference/embedder.ts',
  'src/runtime/config.ts',
];

export const METRICS = ['ndcg_5', 'mrr', 'hit_1', 'hit_5', 'recall_k'];
export const QUALITY_THRESHOLD = 0.02;

const SEMVER = /^v(\d+)\.(\d+)\.(\d+)$/;
const FORK_TAG = /^(v\d+\.\d+\.\d+)-vantt\.\d+$/;

/** `v0.17.2-vantt.1` -> `v0.17.2`; an upstream tag stays; anything else -> null. */
export function upstreamTagOf(ref) {
  if (SEMVER.test(ref)) return ref;
  const m = FORK_TAG.exec(ref);
  return m ? m[1] : null;
}

/** Highest stable `v<semver>` tag, or null. */
export function highestStableTag(tags) {
  const sorted = tags
    .filter((t) => SEMVER.test(t))
    .sort((a, b) => {
      const x = SEMVER.exec(a).slice(1).map(Number);
      const y = SEMVER.exec(b).slice(1).map(Number);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
  return sorted.at(-1) ?? null;
}

/** Fork release branch that catchup builds for an upstream tag. */
export const forkBranchOf = (upstreamTag) => `vantt/${upstreamTag}`;

/** Probe exit code (PRD 9.2) -> verdict. 0 = problem gone, 1 = problem still there, else = could not test. */
export function probeVerdict(status) {
  if (status === 0) return 'solved';
  if (status === 1) return 'present';
  return 'error';
}

/**
 * Machine hint for one patch; the agent writes the recommendation after reading the spec invariants.
 * `upstream` is the verdict on pristine upstream, `apply` is 'applies' | 'already_present' | 'conflict' | ...
 */
export function suggestPatch({ upstream, apply, upstreamStatus }) {
  if (upstreamStatus === 'merged') return 'drop (marked merged in series.toml)';
  if (upstream === 'solved')
    return 'drop candidate: check spec invariants against upstream behaviour';
  if (upstream === 'present') {
    return apply === 'conflict' ? 'rewrite: still needed, does not apply on the new tag' : 'keep';
  }
  return 'unknown: probe could not run';
}

const round = (x) => Math.round(x * 1000) / 1000;

/**
 * Rows of the quality table for one eval set. `sides` maps a side name to an eval result
 * ({summary, by_category}); the table always compares up_new, fork_prev and fork_new, and
 * `delta` is fork_new - up_new. Missing sides give null cells.
 */
export function buildQualityRows(sides, metrics = METRICS) {
  const get = (side, cat, m) => {
    const r = sides[side];
    const block = cat === 'ALL' ? r?.summary : r?.by_category?.[cat];
    const v = block?.[m];
    return typeof v === 'number' ? v : null;
  };
  const cats = new Set(['ALL']);
  for (const r of Object.values(sides))
    for (const c of Object.keys(r?.by_category ?? {})) cats.add(c);
  const rows = [];
  for (const category of cats) {
    for (const metric of metrics) {
      const up = get('up_new', category, metric);
      const prev = get('fork_prev', category, metric);
      const fork = get('fork_new', category, metric);
      rows.push({
        category,
        metric,
        up_new: up,
        fork_prev: prev,
        fork_new: fork,
        delta: up !== null && fork !== null ? round(fork - up) : null,
        delta_vs_prev: prev !== null && fork !== null ? round(fork - prev) : null,
      });
    }
  }
  return rows;
}

/** nDCG@5 cells that need a human look (PRD 12.3 step 4 and the skill, step 4). */
export function flagQuality(rows, threshold = QUALITY_THRESHOLD) {
  const flags = [];
  for (const r of rows) {
    if (r.metric !== 'ndcg_5') continue;
    if (r.delta !== null && r.delta < -threshold)
      flags.push({ kind: 'upstream_better', category: r.category, delta: r.delta });
    if (r.delta_vs_prev !== null && r.delta_vs_prev < -threshold)
      flags.push({ kind: 'fork_regressed', category: r.category, delta: r.delta_vs_prev });
  }
  return flags;
}

// ---------------------------------------------------------------- blind comparison

/** Small deterministic PRNG (mulberry32) so a run can be reproduced from its seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Choose up to `max` query ids spread over all categories: one random query per category that
 * has any difference (so no category is missed and extremes do not dominate), then more random
 * ones round-robin over the categories. Queries whose top 5 are identical on both sides are
 * never chosen (nothing to judge). `diff` is kept in the result of `blindCandidates` for reports.
 */
export function pickBlindQueries(perA, perB, { max = 20, seed = 1 } = {}) {
  const random = rng(seed);
  const byCat = new Map();
  for (const c of blindCandidates(perA, perB)) {
    if (!byCat.has(c.category)) byCat.set(c.category, []);
    byCat.get(c.category).push(c.id);
  }
  const pools = [...byCat.keys()].sort().map((cat) => shuffle(byCat.get(cat), random));
  const chosen = [];
  for (let round = 0; chosen.length < max; round++) {
    let any = false;
    for (const pool of pools) {
      if (round < pool.length && chosen.length < max) {
        chosen.push(pool[round]);
        any = true;
      }
    }
    if (!any) break;
  }
  return chosen;
}

/** Queries whose top 5 differ between the two sides: [{id, category, diff}] where diff = |ndcg_5 difference|. */
export function blindCandidates(perA, perB) {
  const b = new Map(perB.map((q) => [q.id, q]));
  const top5 = (q) => (q.top_paths ?? []).slice(0, 5);
  const out = [];
  for (const qa of perA) {
    const qb = b.get(qa.id);
    if (!qb) continue;
    const x = top5(qa);
    const y = top5(qb);
    if (x.length === y.length && x.every((p, i) => p === y[i])) continue;
    out.push({
      id: qa.id,
      category: qa.category,
      diff: Math.abs((qa.ndcg_5 ?? 0) - (qb.ndcg_5 ?? 0)),
    });
  }
  return out;
}

/**
 * Pairs for the blind judge. `view(side, id)` returns [{title, snippet}] for the top 5 of a side.
 * Returns {pairs, key}: `pairs` has only A/B lists (what the judge reads); `key` maps pair id to
 * which side is A (kept apart until the tally).
 */
export function makeBlindPairs(
  ids,
  queries,
  view,
  { seed = 1, sides = ['upstream', 'fork'] } = {},
) {
  const random = rng(seed + 7919);
  const pairs = [];
  const key = {};
  ids.forEach((id, i) => {
    const pid = `p${String(i + 1).padStart(2, '0')}`;
    const [first, second] = random() < 0.5 ? sides : [sides[1], sides[0]];
    pairs.push({ id: pid, query: queries[id], A: view(first, id), B: view(second, id) });
    key[pid] = { A: first, B: second, query_id: id };
  });
  return { pairs, key };
}

export const VERDICTS = ['A++', 'A+', 'tie', 'B+', 'B++'];

/**
 * Count wins for the fork. `verdicts` maps pair id to one of VERDICTS (A++ = A clearly better,
 * A+ = A slightly better, ...). `key` is from makeBlindPairs.
 */
export function tallyVerdicts(verdicts, key, forkSide = 'fork') {
  const t = {
    fork_clear: 0,
    fork_slight: 0,
    tie: 0,
    other_slight: 0,
    other_clear: 0,
    judged: 0,
    missing: [],
  };
  for (const [pid, k] of Object.entries(key)) {
    const v = verdicts[pid];
    if (!VERDICTS.includes(v)) {
      t.missing.push(pid);
      continue;
    }
    t.judged++;
    if (v === 'tie') {
      t.tie++;
      continue;
    }
    const letter = v[0];
    const forkWins = k[letter] === forkSide;
    const clear = v.endsWith('++');
    if (forkWins) t[clear ? 'fork_clear' : 'fork_slight']++;
    else t[clear ? 'other_clear' : 'other_slight']++;
  }
  return {
    ...t,
    fork_wins: t.fork_clear + t.fork_slight,
    fork_losses: t.other_clear + t.other_slight,
  };
}

const fold = (s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();

/** Readable excerpt of a note around the first query word it contains (accent-insensitive), else its start. */
export function makeSnippet(text, query, max = 200) {
  const body = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/\s+/g, ' ')
    .trim();
  const words = fold(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1);
  const folded = fold(body);
  // fold() keeps length for precomposed text; fall back to the start if it does not.
  let at = -1;
  if (folded.length === body.length)
    for (const w of words) {
      const i = folded.indexOf(w);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
  const start = at > 40 ? at - 40 : 0;
  const cut = body.slice(start, start + max);
  return `${start > 0 ? '…' : ''}${cut}${start + max < body.length ? '…' : ''}`;
}

// ---------------------------------------------------------------- private eval

/** Aggregate-only view of an eval result: no query text, no paths, no per-query data. */
export function scrubPrivate(result) {
  return {
    summary: result.summary,
    by_category: result.by_category,
    queries: result.per_query?.length ?? null,
  };
}

// ---------------------------------------------------------------- timing

/**
 * Index and per-query time of one eval run from timestamped output lines [{t (ms), line}] of
 * upstream's eval: index = "Reindexing vault" to "[eval] indexed", queries = from there to the
 * summary rule, divided by the number of "[eval] running" lines. Null when the markers are missing.
 */
export function extractTiming(events) {
  const find = (re) => events.find((e) => re.test(e.line));
  const start = find(/^Reindexing vault/);
  const indexed = find(/^\[eval\] indexed:/);
  const queries = events.filter((e) => /^\[eval\] running /.test(e.line)).length;
  const end = find(/^─{5,}/) ?? events.at(-1);
  if (!start || !indexed || !end || !queries) return null;
  const round = (x) => Math.round(x * 1000) / 1000;
  const indexS = (indexed.t - start.t) / 1000;
  const queryS = (end.t - indexed.t) / 1000;
  return {
    index_s: round(indexS),
    query_s: round(queryS),
    queries,
    per_query_ms: round((queryS * 1000) / queries),
  };
}
