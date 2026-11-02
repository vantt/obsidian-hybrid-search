#!/usr/bin/env node
// Probe for patch index-events.
//
// Problem: `ohs serve --stdio` never tells the client that a note was (re)indexed or
// removed, so a client that mirrors the index must re-read the whole vault on a timer.
//
// The probe builds a temporary vault and a fake OpenAI-compatible embedding server,
// starts `serve --stdio` through the public CLI with the opt-in `OHS_STDIO_EVENTS=1`,
// edits one note and deletes another. Exit 0 when the server pushes an `indexed` line
// for the edited note and a `removed` line for the deleted one (lines carry no `id`);
// 1 when it stays silent.
//
// Usage: node vantt/probes/index-events.mjs --ohs <built OHS checkout>
// Exit codes: 0 problem gone, 1 problem still present, 2 cannot check.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

class CannotCheck extends Error {}

function exitCannotCheck(message) {
  console.error(`index-events probe: cannot check: ${message}`);
  process.exit(2);
}

const ohsIndex = process.argv.indexOf('--ohs');
const ohs = ohsIndex > 0 ? process.argv[ohsIndex + 1] : undefined;
if (!ohs) exitCannotCheck('usage: index-events.mjs --ohs <built OHS directory>');
const cli = path.resolve(ohs, 'dist/src/cli.js');
if (!existsSync(cli)) exitCannotCheck(`${cli} not found; build OHS first`);

const DIM = 8;
const root = mkdtempSync(path.join(tmpdir(), 'ohs-probe-index-events-'));
const vault = path.join(root, 'vault');
mkdirSync(vault);
writeFileSync(path.join(vault, 'apples.md'), 'Apples and pears grow in the orchard.\n');
writeFileSync(path.join(vault, 'pears.md'), 'Pears and apples ripen in autumn.\n');

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
    let inputs = [''];
    try {
      const parsed = JSON.parse(body || '{}');
      inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? ''];
    } catch {
      // keep the empty input
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        object: 'list',
        data: inputs.map((text, index) => ({
          object: 'embedding',
          index,
          embedding: embedText(text),
        })),
        model: 'text-embedding-3-small',
      }),
    );
  });
});

/** Start `serve --stdio`; `until` resolves with the first output line matching a predicate. */
function startServe(env) {
  const child = spawn(process.execPath, [cli, 'serve', '--stdio'], {
    cwd: vault,
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = [];
  const waiters = [];
  let buffered = '';
  child.stdout.on('data', (chunk) => {
    buffered += chunk.toString();
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (!line) continue;
      try {
        lines.push(JSON.parse(line));
      } catch {
        // ignore non-JSON output
      }
      for (const waiter of waiters.splice(0)) waiter();
    }
  });
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  const until = (predicate, ms) =>
    new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), ms);
      const check = () => {
        const hit = lines.find(predicate);
        if (hit) {
          clearTimeout(timer);
          resolve(hit);
        } else waiters.push(check);
      };
      check();
    });
  return {
    child,
    lines,
    exited,
    until,
    send: (request) => child.stdin.write(`${JSON.stringify(request)}\n`),
  };
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
    OHS_STDIO_EVENTS: '1',
    OBSIDIAN_WATCH_DEBOUNCE_MS: '250',
    NO_COLOR: '1',
  };
  const session = startServe(env);
  if (!(await session.until((line) => line.ready === true, 120_000))) {
    session.child.kill();
    throw new CannotCheck('serve --stdio did not become ready');
  }
  // Let the first full index finish, then change the vault. The watcher debounces
  // each file (5 s by default; the probe sets 250 ms), so allow for that.
  await new Promise((resolve) => setTimeout(resolve, 3000));
  session.lines.length = 0; // ignore events of the first full index
  writeFileSync(path.join(vault, 'apples.md'), 'Apples and quinces grow in the orchard.\n');
  unlinkSync(path.join(vault, 'pears.md'));
  const has = (name, file) => (line) =>
    line.event === name && Array.isArray(line.paths) && line.paths.includes(file);
  const indexed = await session.until(has('indexed', 'apples.md'), 15_000);
  const removed = await session.until(has('removed', 'pears.md'), 15_000);
  session.child.kill();
  await session.exited;
  const wellFormed = [indexed, removed].every(
    (line) => line && !('id' in line) && typeof line.db_version === 'number',
  );
  if (indexed && removed && wellFormed) {
    console.log('index-events probe: indexed and removed events received (problem gone)');
    exitCode = 0;
  } else {
    console.log(
      `index-events probe: problem present (indexed: ${indexed ? 'ok' : 'missing'}, removed: ${removed ? 'ok' : 'missing'})`,
    );
    exitCode = 1;
  }
} catch (error) {
  console.error(
    `index-events probe: cannot check: ${error instanceof CannotCheck ? error.message : error}`,
  );
  exitCode = 2;
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);
