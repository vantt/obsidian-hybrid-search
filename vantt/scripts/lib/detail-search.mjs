// Per-query search detail for private mode (V15b). Run by lib/eval-run.mjs `runDetail` with
// `node --import tsx detail-search.mjs --tree <ohs tree> --vault <copy> --queries <json> --output <json> --k <n>`
// inside the OHS tree, with the same environment as the eval run. It indexes the vault copy the
// way eval/evaluate.ts does, then searches every query with `explain` and records, per query,
// the ranked results with their per-branch ranks and the pack's analysis (explain.debug).
// The output is private content: the caller writes it only to a file outside the repository.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const a = process.argv;
const get = (f) => a[a.indexOf(f) + 1];
const tree = path.resolve(get('--tree'));
const k = Number(get('--k') ?? 10);
process.env.OBSIDIAN_VAULT_PATH = path.resolve(get('--vault'));

const load = (rel) => import(pathToFileURL(path.join(tree, rel)).href);
const { openIndexDatabase, createIndexService } = await load('src/indexing/index-service.js');
const { search } = await load('src/search/searcher.js');

const queries = JSON.parse(readFileSync(get('--queries'), 'utf8'));
await openIndexDatabase();
const indexing = createIndexService();
await indexing.reindex({ force: true }).finally(() => indexing.close());

const rows = [];
for (const q of queries) {
  const results = await search(q.query, {
    mode: 'hybrid',
    limit: k,
    scope: q.scope,
    explain: true,
  });
  rows.push({
    id: q.id,
    results: results.slice(0, k).map((r) => ({
      path: r.path,
      score: r.score,
      scores: r.scores ?? null,
      matched_by: r.matchedBy ?? null,
      matched_terms: r.matchedTerms ?? null,
      ranks: r.explain?.ranks ?? null,
    })),
    // The analysis is per query, identical on every result: keep one copy.
    analysis: results[0]?.explain?.debug ?? null,
  });
}
writeFileSync(get('--output'), JSON.stringify(rows));
