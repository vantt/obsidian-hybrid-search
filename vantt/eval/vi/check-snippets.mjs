// vi-snippet criterion (PRD 10.2 snippets, 10.3 pack): through real OHS with the pack, every vi-snippet query must return,
// for its expected note, a snippet that is original text (a verbatim piece of the note, diacritics intact, never the
// projected fold/norm text) and contains the match (`snippet_contains`). `matchedTerms` must be original words of the
// note that fold to (a prefix match of) words of the query (reported, not part of the 100% criterion).
//
//   cd <built OHS tree> && node --import tsx <this file> --lang-pack <pack dir> --vault <dir> [--lang-options <json>] [--json <out>]
// --vault is a scratch COPY of the fixture-generated vi-search vault without .db files: the index is written into it.
// Exit code 0 only when every query passes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const value = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const need = (n) => value(n) ?? (console.error(`missing ${n}`), process.exit(2));
const pack = path.resolve(need('--lang-pack'));
const vault = path.resolve(need('--vault'));
const golden = JSON.parse(fs.readFileSync(path.join(here, 'golden-set.json'), 'utf8')).filter(
  (q) => q.category === 'vi-snippet',
);

process.env.OBSIDIAN_VAULT_PATH = vault;
process.env.OBSIDIAN_IGNORE_PATTERNS = '.obsidian/**,templates/**,*.canvas,_ohs/**';
for (const v of [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_EMBEDDING_MODEL',
  'LOCAL_EMBEDDING_MODEL',
])
  delete process.env[v];
process.env.OHS_LANGUAGE_PACK = pack;
if (value('--lang-options')) process.env.OHS_LANGUAGE_PACK_OPTIONS = value('--lang-options');
else delete process.env.OHS_LANGUAGE_PACK_OPTIONS;

const root = process.cwd();
// import() needs a file URL for an absolute path on Windows (`C:` reads as a URL scheme).
const load = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { openIndexDatabase, createIndexService } = await load('src/indexing/index-service.ts');
const { search } = await load('src/search/searcher.ts');
const { loadLanguagePack } = await load('src/language/loader.ts');
await openIndexDatabase();
const indexing = createIndexService();
const r = await indexing.reindex({ force: false }).finally(() => indexing.close());
console.error(`indexed ${r.indexed}, skipped ${r.skipped}, errors ${r.errors.length}`);
await loadLanguagePack();

const fold = (s) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const nfc = (s) => s.normalize('NFC');
// Whitespace is normalized in both texts before comparing; any leftover marker characters are stripped.
const clean = (s) =>
  nfc(s)
    // eslint-disable-next-line no-control-regex, sonarjs/no-control-regex -- U+0001/U+0002 are the OHS match markers
    .replace(/[\u0001\u0002]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
// Fixture paths are NFD on disk; the index may report either form.
const body = (p) => {
  for (const form of [p, p.normalize('NFD'), p.normalize('NFC')])
    if (fs.existsSync(path.join(vault, form)))
      return fs.readFileSync(path.join(vault, form), 'utf8');
  throw new Error(`note not found: ${p}`);
};
const pieces = (snippet) =>
  clean(snippet)
    .split('...')
    .map((x) => x.trim())
    .filter(Boolean);

const rows = [];
for (const q of golden) {
  const results = await search(q.query, { mode: 'hybrid', limit: 10 });
  const want = new Set(q.relevant_paths.map(nfc));
  const hit = results.find((x) => want.has(nfc(x.path)));
  const row = {
    id: q.id,
    query: q.query,
    found: Boolean(hit),
    original: false,
    contains: false,
    terms: false,
    snippet: hit?.snippet ?? null,
    matchedTerms: hit?.matchedTerms ?? null,
  };
  if (hit) {
    const text = clean(body(hit.path));
    row.original = pieces(hit.snippet).every((piece) => text.includes(piece));
    row.contains = clean(hit.snippet).toLowerCase().includes(nfc(q.snippet_contains).toLowerCase());
    const queryWords = new Set(q.query.split(/\s+/).map(fold));
    const terms = hit.matchedTerms ?? [];
    row.terms =
      terms.length > 0 &&
      terms.every(
        (t) =>
          text.toLowerCase().includes(nfc(t).toLowerCase()) &&
          [...queryWords].some((w) => fold(t).startsWith(w)),
      );
  }
  rows.push(row);
}
const pass = (x) => x.found && x.original && x.contains;
const summary = {
  queries: rows.length,
  found: rows.filter((x) => x.found).length,
  originalText: rows.filter((x) => x.original).length,
  containsMatch: rows.filter((x) => x.contains).length,
  matchedTermsOk: rows.filter((x) => x.terms).length,
  snippetCriterion: rows.filter(pass).length,
};
for (const x of rows.filter((y) => !pass(y) || !y.terms)) console.log('NOTE', JSON.stringify(x));
console.log(JSON.stringify(summary));
console.log(
  `vi-snippet: ${summary.snippetCriterion}/${summary.queries} (${((100 * summary.snippetCriterion) / summary.queries).toFixed(1)}%) original text and contains the match`,
);
if (value('--json')) fs.writeFileSync(value('--json'), JSON.stringify({ summary, rows }, null, 2));
process.exit(summary.snippetCriterion === summary.queries ? 0 : 1);
