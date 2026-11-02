#!/usr/bin/env node
// Probe for patch vector-export.
//
// Problem: OHS has no official way to get the vector of a note or the K nearest
// notes. Projects read vec_chunks, chunks and notes straight from SQLite and break
// whenever upstream changes the schema.
//
// The probe builds a temporary vault and a fake OpenAI-compatible embedding server,
// indexes through the public CLI, then asks the CLI for `vectors` and `neighbors`
// (JSON Lines). If the commands are missing the problem is present. If they exist,
// the output must carry the fields a consumer needs.
//
// Usage: node vantt/probes/vector-export.mjs --ohs <built OHS checkout>
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
  console.error(`vector-export probe: cannot check: ${message}`);
  process.exit(2);
}

const ohsIndex = process.argv.indexOf('--ohs');
const ohs = ohsIndex > 0 ? process.argv[ohsIndex + 1] : undefined;
if (!ohs) exitCannotCheck('usage: vector-export.mjs --ohs <built OHS directory>');
const cli = path.resolve(ohs, 'dist/src/cli.js');
if (!existsSync(cli)) exitCannotCheck(`${cli} not found; build OHS first`);

const DIM = 8;
const root = mkdtempSync(path.join(tmpdir(), 'ohs-probe-vector-export-'));
const vault = path.join(root, 'vault');
mkdirSync(vault);
const NOTES = {
  'apples.md': 'Apples and pears grow in the orchard.\n',
  'pears.md': 'Pears and apples ripen in autumn.\n',
  'rockets.md': 'Rockets burn fuel to reach orbit.\n',
};
for (const [name, text] of Object.entries(NOTES)) writeFileSync(path.join(vault, name), text);

// Deterministic embeddings from word hashes: similar texts get similar vectors.
function embedText(text) {
  const vector = new Array(DIM).fill(0);
  for (const word of String(text).toLowerCase().match(/[a-z]+/g) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % DIM] += 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}
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
    const data = inputs.map((text, index) => ({
      object: 'embedding',
      index,
      embedding: embedText(text),
    }));
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data, model: 'text-embedding-3-small' }));
  });
});

function jsonLines(stdout) {
  return stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line));
}

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
  const options = { cwd: vault, env, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 };

  // 1. Is there a command at all? Upstream treats unknown words as a search query, so
  //    look for the command's own usage line.
  let help = '';
  try {
    help = (await run(process.execPath, [cli, 'vectors', '--help'], options)).stdout;
  } catch {
    help = '';
  }
  if (!/Usage:.*\bvectors\b/.test(help)) {
    console.log('vector-export probe: no `vectors` command (problem present)');
    exitCode = 1;
  } else {
    try {
      await run(process.execPath, [cli, 'reindex'], options);
    } catch (error) {
      cannotCheck(`reindex failed: ${error.stderr || error.message}`);
    }
    let vectors;
    let neighbors;
    try {
      const v = await run(process.execPath, [cli, 'vectors', '--path', 'apples.md'], options);
      vectors = jsonLines(v.stdout);
      const n = await run(
        process.execPath,
        [cli, 'neighbors', '--path', 'apples.md', '--k', '2'],
        options,
      );
      neighbors = jsonLines(n.stdout);
    } catch (error) {
      console.log(
        `vector-export probe: the commands exist but failed: ${error.stderr || error.message}`,
      );
      exitCode = 1;
    }
    if (vectors && neighbors) {
      const note = vectors.find((line) => line.path === 'apples.md');
      const neighborLine = neighbors.find((line) => line.path === 'apples.md');
      const ok =
        vectors[0]?.meta?.dim === DIM &&
        note?.dim === DIM &&
        Array.isArray(note.vector) &&
        note.vector.length === DIM &&
        typeof note.model === 'string' &&
        Number.isInteger(note.chunks) &&
        neighbors[0]?.meta !== undefined &&
        Array.isArray(neighborLine?.neighbors) &&
        neighborLine.neighbors[0]?.path === 'pears.md' &&
        typeof neighborLine.neighbors[0]?.score === 'number';
      console.log(
        ok
          ? 'vector-export probe: `vectors` and `neighbors` return per-note vectors and nearest notes (problem gone)'
          : `vector-export probe: the commands exist but the output lacks the required fields (problem present)`,
      );
      exitCode = ok ? 0 : 1;
    }
  }
} catch (error) {
  console.error(
    `vector-export probe: cannot check: ${error instanceof CannotCheck ? error.message : error}`,
  );
  exitCode = 2;
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);
