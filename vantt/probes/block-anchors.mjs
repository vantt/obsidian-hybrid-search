#!/usr/bin/env node
// Probe for patch block-anchors.
//
// Problem: search results cannot point at the exact block of a note. An Obsidian
// block id (`paragraph text ^probe-block`) and highlighted text (`==text==`) are
// stored nowhere, so a client cannot build `note#^probe-block` or prefer passages
// the user highlighted. The probe indexes a note whose last paragraph carries a
// block id and a highlight, searches with `--anchors --json` through the public CLI
// and looks for the block id and highlight flag in the result anchors.
//
// Usage: node vantt/probes/block-anchors.mjs --ohs <built OHS checkout>
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
  console.error(`block-anchors probe: cannot check: ${message}`);
  process.exit(2);
}

const ohsIndex = process.argv.indexOf('--ohs');
const ohs = ohsIndex > 0 ? process.argv[ohsIndex + 1] : undefined;
if (!ohs) exitCannotCheck('usage: block-anchors.mjs --ohs <built OHS directory>');
const cli = path.resolve(ohs, 'dist/src/cli.js');
if (!existsSync(cli)) exitCannotCheck(`${cli} not found; build OHS first`);

const root = mkdtempSync(path.join(tmpdir(), 'ohs-probe-block-anchors-'));
const vault = path.join(root, 'vault');
mkdirSync(vault);
writeFileSync(
  path.join(vault, 'garden.md'),
  '# Garden\n\nTomatoes need steady watering. Remember ==the compost heap== needs turning. ^probe-block\n',
);
writeFileSync(path.join(vault, 'bakery.md'), '# Bakery\n\nBread, flour and water.\n');

// Deterministic fake embeddings: the probe only needs indexing to succeed.
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
    let inputs = [];
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

let exitCode = 2;
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
  delete env.OBSIDIAN_CHUNK_TOKENS;
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
      [cli, 'search', 'steady watering', '--mode', 'fulltext', '--anchors', '--snippet-length', '60', '--json'],
      options,
    );
    results = JSON.parse(stdout);
  } catch (error) {
    cannotCheck(`search failed: ${error.stderr || error.message}`);
  }
  if (!Array.isArray(results)) cannotCheck('search returned no result array');
  const hit = results.find((result) => result.path === 'garden.md');
  if (!hit) cannotCheck('search did not return garden.md');
  const anchors = Array.isArray(hit.previewAnchors) ? hit.previewAnchors : [];
  const found = anchors.some((a) => a.blockId === '^probe-block' && a.hasHighlight === true);
  console.log(
    found
      ? 'block-anchors probe: result anchors carry the block id and highlight flag (problem gone)'
      : 'block-anchors probe: result anchors carry no block id or highlight flag (problem present)',
  );
  exitCode = found ? 0 : 1;
} catch (error) {
  console.error(
    `block-anchors probe: cannot check: ${error instanceof CannotCheck ? error.message : error}`,
  );
  exitCode = 2;
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);
