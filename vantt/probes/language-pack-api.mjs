#!/usr/bin/env node
// Probe for patch language-pack-api.
//
// Problem: the OHS core cannot be taught language-specific matching. A German
// note containing "Große Straße" is not found by the query "grosse strasse",
// because SQLite's unicode61 tokenizer never folds ß to ss, and there is no way to
// plug in a language pack that would.
//
// The probe builds a temporary vault, a minimal language pack (one view that
// upper-cases text, which turns ß into SS) and a fake OpenAI-compatible embedding
// server, then indexes and searches through the public CLI only.
//
// Usage: node vantt/probes/language-pack-api.mjs --ohs <built OHS checkout>
// Exit codes: 0 problem gone, 1 problem still present, 2 cannot check.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

class CannotCheck extends Error {}
function cannotCheck(message) {
  throw new CannotCheck(message);
}
function exitCannotCheck(message) {
  console.error(`language-pack-api probe: cannot check: ${message}`);
  process.exit(2);
}

const ohsIndex = process.argv.indexOf('--ohs');
const ohs = ohsIndex > 0 ? process.argv[ohsIndex + 1] : undefined;
if (!ohs) exitCannotCheck('usage: language-pack-api.mjs --ohs <built OHS directory>');
const cli = path.resolve(ohs, 'dist/src/cli.js');
if (!existsSync(cli)) exitCannotCheck(`${cli} not found; build OHS first`);

const root = mkdtempSync(path.join(tmpdir(), 'ohs-probe-language-pack-'));
const vault = path.join(root, 'vault');
const pack = path.join(root, 'pack');
mkdirSync(vault);
mkdirSync(pack);
writeFileSync(path.join(vault, 'avenue.md'), '# Avenue\n\nDie Große Straße am Ende der Stadt.\n');
writeFileSync(path.join(vault, 'bakery.md'), '# Bakery\n\nBread, flour and water.\n');
writeFileSync(
  path.join(pack, 'package.json'),
  JSON.stringify({ name: 'probe-upper', type: 'module', main: 'index.js' }),
);
writeFileSync(
  path.join(pack, 'index.js'),
  `export default {
  apiVersion: 1,
  id: 'probe-upper',
  version: '1.0.0',
  signature: () => '1',
  views: [{ name: 'upper', weight: 1 }],
  project: (_view, _field, text) => text.toUpperCase(),
  analyzeQuery: (query) => ({ viewQueries: { upper: query.toUpperCase() } }),
};
`,
);

// Deterministic fake embeddings: the probe only needs indexing to succeed.
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let inputs;
    try {
      const parsed = JSON.parse(body || '{}');
      inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? ''];
    } catch {
      inputs = [''];
    }
    const data = inputs.map((text, index) => {
      const vector = Array.from({ length: 8 }, (_, i) => ((String(text).length + i) % 7) + 1);
      const norm = Math.hypot(...vector);
      return { object: 'embedding', index, embedding: vector.map((v) => v / norm) };
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data, model: 'text-embedding-3-small' }));
  });
});

let exitCode;
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const env = {
    ...process.env,
    OBSIDIAN_VAULT_PATH: vault,
    OPENAI_API_KEY: 'probe',
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    OHS_LANGUAGE_PACK: pack,
    OHS_DISABLE_UPDATE_CHECK: '1',
    NO_COLOR: '1',
  };
  delete env.OHS_LANGUAGE_PACK_OPTIONS;
  const options = { cwd: vault, env, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 };
  try {
    await run(process.execPath, [cli, 'reindex'], options);
  } catch (error) {
    cannotCheck(`reindex failed: ${error.stderr || error.message}`);
  }
  let results;
  try {
    const { stdout } = await run(
      process.execPath,
      [cli, 'search', 'grosse strasse', '--mode', 'fulltext', '--json'],
      options,
    );
    results = JSON.parse(stdout);
  } catch (error) {
    cannotCheck(`search failed: ${error.stderr || error.message}`);
  }
  if (!Array.isArray(results)) cannotCheck('search returned no result array');
  const found = results.some((result) => result.path === 'avenue.md');
  console.log(
    found
      ? 'language-pack-api probe: a language pack makes "grosse strasse" find "Große Straße" (problem gone)'
      : 'language-pack-api probe: "grosse strasse" does not find "Große Straße"; no language pack support (problem present)',
  );
  exitCode = found ? 0 : 1;
} catch (error) {
  console.error(
    `language-pack-api probe: cannot check: ${error instanceof CannotCheck ? error.message : error}`,
  );
  exitCode = 2;
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);
