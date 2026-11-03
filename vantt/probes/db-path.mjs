#!/usr/bin/env node
// Probe for patch db-path.
//
// Problem: the OHS index database always lives at <vault>/.obsidian-hybrid-search.db
// (plus -wal and -shm), so sync tools copy it and two machines can corrupt it. There
// is no setting that moves it elsewhere.
//
// The probe builds a temporary vault, asks OHS to keep its database in another
// directory through OBSIDIAN_DB_PATH, indexes through the public CLI, and checks
// where database files appear. Upstream ignores the variable and writes into the
// vault (problem present); a patched build writes to the requested file.
//
// Usage: node vantt/probes/db-path.mjs --ohs <built OHS checkout>
// Exit codes: 0 problem gone, 1 problem still present, 2 cannot check.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  console.error(`db-path probe: cannot check: ${message}`);
  process.exit(2);
}

const ohsIndex = process.argv.indexOf('--ohs');
const ohs = ohsIndex > 0 ? process.argv[ohsIndex + 1] : undefined;
if (!ohs) exitCannotCheck('usage: db-path.mjs --ohs <built OHS directory>');
const cli = path.resolve(ohs, 'dist/src/cli.js');
if (!existsSync(cli)) exitCannotCheck(`${cli} not found; build OHS first`);

const root = mkdtempSync(path.join(tmpdir(), 'ohs-probe-db-path-'));
const vault = path.join(root, 'vault');
const dbFile = path.join(root, 'state', 'index', 'ohs.db');
mkdirSync(vault);
writeFileSync(path.join(vault, 'note.md'), '# Note\n\nBread, flour and water.\n');

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
    OBSIDIAN_DB_PATH: dbFile,
    OPENAI_API_KEY: 'probe',
    OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    OHS_DISABLE_UPDATE_CHECK: '1',
    NO_COLOR: '1',
  };
  const options = { cwd: root, env, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 };
  try {
    await run(process.execPath, [cli, 'reindex'], options);
  } catch (error) {
    cannotCheck(`reindex failed: ${error.stderr || error.message}`);
  }
  const inVault = readdirSync(vault).filter((name) =>
    name.startsWith('.obsidian-hybrid-search.db'),
  );
  const moved = existsSync(dbFile);
  const gone = moved && inVault.length === 0;
  console.log(
    gone
      ? 'db-path probe: the database was written to OBSIDIAN_DB_PATH and not into the vault (problem gone)'
      : `db-path probe: OBSIDIAN_DB_PATH is not honored (database in vault: ${inVault.join(', ') || 'none'}; requested file exists: ${moved}) (problem present)`,
  );
  exitCode = gone ? 0 : 1;
} catch (error) {
  console.error(
    `db-path probe: cannot check: ${error instanceof CannotCheck ? error.message : error}`,
  );
  exitCode = 2;
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);
