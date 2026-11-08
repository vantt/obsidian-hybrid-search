#!/usr/bin/env node
// Probe for patch unicode-inline-tags.
//
// Problem: inline tags use an ASCII plus U+00C0-U+024F character class, so a
// Vietnamese tag such as "#kếhoạch" is cut at "ế" and the index stores "k".
// Searching with --tag kếhoạch then finds nothing.
//
// The probe builds a temporary vault with one note holding "#kếhoạch", indexes it
// with the public CLI and checks that --tag kếhoạch returns that note. It uses a
// fake OpenAI-compatible embedding server, as the language-pack probe does.
//
// Usage: node vantt/probes/unicode-inline-tags.mjs --ohs <built OHS checkout>
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
  console.error(`unicode-inline-tags probe: cannot check: ${message}`);
  process.exit(2);
}

const ohsIndex = process.argv.indexOf('--ohs');
const ohs = ohsIndex > 0 ? process.argv[ohsIndex + 1] : undefined;
if (!ohs) exitCannotCheck('usage: unicode-inline-tags.mjs --ohs <built OHS directory>');
const cli = path.resolve(ohs, 'dist/src/cli.js');
if (!existsSync(cli)) exitCannotCheck(`${cli} not found; build OHS first`);

const root = mkdtempSync(path.join(tmpdir(), 'ohs-probe-unicode-tags-'));
const vault = path.join(root, 'vault');
mkdirSync(vault);
writeFileSync(path.join(vault, 'plan.md'), '# Plan\n\nLịch trình cho #kếhoạch năm nay.\n');

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
    OHS_DISABLE_UPDATE_CHECK: '1',
    NO_COLOR: '1',
  };
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
      [cli, 'search', 'lịch trình', '--mode', 'fulltext', '--tag', 'kếhoạch', '--json'],
      options,
    );
    results = JSON.parse(stdout);
  } catch (error) {
    cannotCheck(`search failed: ${error.stderr || error.message}`);
  }
  if (!Array.isArray(results)) cannotCheck('search returned no result array');
  const found = results.some((result) => result.path === 'plan.md');
  console.log(
    found
      ? 'unicode-inline-tags probe: --tag kếhoạch finds the note with #kếhoạch (problem gone)'
      : 'unicode-inline-tags probe: --tag kếhoạch does not find the note with #kếhoạch (problem present)',
  );
  exitCode = found ? 0 : 1;
} catch (error) {
  console.error(
    `unicode-inline-tags probe: cannot check: ${error instanceof CannotCheck ? error.message : error}`,
  );
  exitCode = 2;
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);
