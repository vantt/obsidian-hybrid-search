#!/usr/bin/env node
// Probe for patch restrict-paths.
//
// Problem: there is no way to search inside a given set of notes. A vault of 60
// notes that all repeat "alpha" plus 3 notes that mention it once: `--limit 3` over
// the whole vault returns only the strong 60, and filtering those results afterwards
// would return nothing. Restricting the search to the 3 notes must still return them,
// which only works when the restriction reaches the retrieval queries.
//
// The probe indexes a temporary vault (with a fake OpenAI-compatible embedding
// server) and searches through the public CLI only, with `--paths-file`.
//
// Usage: node vantt/probes/restrict-paths.mjs --ohs <built OHS checkout>
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
  console.error(`restrict-paths probe: cannot check: ${message}`);
  process.exit(2);
}

const ohsIndex = process.argv.indexOf('--ohs');
const ohs = ohsIndex > 0 ? process.argv[ohsIndex + 1] : undefined;
if (!ohs) exitCannotCheck('usage: restrict-paths.mjs --ohs <built OHS directory>');
const cli = path.resolve(ohs, 'dist/src/cli.js');
if (!existsSync(cli)) exitCannotCheck(`${cli} not found; build OHS first`);

const root = mkdtempSync(path.join(tmpdir(), 'ohs-probe-restrict-paths-'));
const vault = path.join(root, 'vault');
mkdirSync(path.join(vault, 'strong'), { recursive: true });
mkdirSync(path.join(vault, 'weak'), { recursive: true });
const weak = ['weak/one.md', 'weak/two.md', 'weak/three.md'];
for (let i = 0; i < 60; i++) {
  writeFileSync(
    path.join(vault, 'strong', `s-${i}.md`),
    `# Alpha strong ${i}\n\n${'alpha '.repeat(12)}strong${i}\n`,
  );
}
weak.forEach((file, i) => {
  writeFileSync(
    path.join(vault, file),
    `# Weak note ${i}\n\nSome long text about gardens and rivers where alpha appears once, number${i}.\n`,
  );
});
const pathsFile = path.join(root, 'paths.txt');
writeFileSync(pathsFile, weak.join('\n') + '\n');

// Deterministic fake embeddings: only indexing and querying need to succeed.
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
    OHS_DISABLE_UPDATE_CHECK: '1',
    NO_COLOR: '1',
  };
  delete env.OHS_LANGUAGE_PACK;
  const options = { cwd: vault, env, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 };
  const search = async (...args) => {
    const { stdout } = await run(
      process.execPath,
      [cli, 'search', 'alpha', '--limit', '3', '--json', ...args],
      options,
    );
    return JSON.parse(stdout);
  };
  try {
    await run(process.execPath, [cli, 'reindex'], options);
  } catch (error) {
    cannotCheck(`reindex failed: ${error.stderr || error.message}`);
  }
  // Baseline: an ordinary search must work, otherwise the environment is broken.
  try {
    const plain = await search('--mode', 'fulltext');
    if (!Array.isArray(plain) || plain.length !== 3) cannotCheck('baseline search is unusable');
  } catch (error) {
    if (error instanceof CannotCheck) throw error;
    cannotCheck(`baseline search failed: ${error.stderr || error.message}`);
  }
  let present = false;
  for (const mode of ['fulltext', 'hybrid']) {
    let results;
    try {
      results = await search('--mode', mode, '--paths-file', pathsFile);
    } catch {
      // The option is unknown (or the search failed): no way to restrict the search.
      present = true;
      break;
    }
    const got = Array.isArray(results) ? results.map((r) => r.path).sort() : [];
    if (JSON.stringify(got) !== JSON.stringify([...weak].sort())) {
      present = true;
      break;
    }
  }
  console.log(
    present
      ? 'restrict-paths probe: a search cannot be restricted to a set of notes (problem present)'
      : 'restrict-paths probe: a search restricted to 3 notes returns them despite 60 stronger matches (problem gone)',
  );
  exitCode = present ? 1 : 0;
} catch (error) {
  console.error(
    `restrict-paths probe: cannot check: ${error instanceof CannotCheck ? error.message : error}`,
  );
  exitCode = 2;
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);
