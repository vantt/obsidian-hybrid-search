#!/usr/bin/env node
// Probe for patch stdio-parity.
//
// Problem 1: `ohs serve --stdio` only knows the actions `search` and `status`; a client
// that wants to read a note, get vectors or reindex must start a new process.
// Problem 2: when stdin closes the server exits at once and loses the answers of the
// requests still running.
//
// The probe builds a temporary vault and a fake OpenAI-compatible embedding server,
// starts `serve --stdio` through the public CLI and checks both problems.
// Exit 0 only when both are gone; 1 when either is still present.
//
// Usage: node vantt/probes/stdio-parity.mjs --ohs <built OHS checkout>
// Exit codes: 0 problem gone, 1 problem still present, 2 cannot check.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

class CannotCheck extends Error {}

function exitCannotCheck(message) {
  console.error(`stdio-parity probe: cannot check: ${message}`);
  process.exit(2);
}

const ohsIndex = process.argv.indexOf('--ohs');
const ohs = ohsIndex > 0 ? process.argv[ohsIndex + 1] : undefined;
if (!ohs) exitCannotCheck('usage: stdio-parity.mjs --ohs <built OHS directory>');
const cli = path.resolve(ohs, 'dist/src/cli.js');
if (!existsSync(cli)) exitCannotCheck(`${cli} not found; build OHS first`);

const DIM = 8;
const root = mkdtempSync(path.join(tmpdir(), 'ohs-probe-stdio-parity-'));
const vault = path.join(root, 'vault');
mkdirSync(vault);
writeFileSync(path.join(vault, 'apples.md'), 'Apples and pears grow in the orchard.\n');
writeFileSync(path.join(vault, 'pears.md'), 'Pears and apples ripen in autumn.\n');

function embedText(text) {
  const vector = new Array(DIM).fill(0);
  for (const word of String(text)
    .toLowerCase()
    .match(/[a-z]+/g) ?? []) {
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

  // 1. Actions beyond `search` and `status`.
  const first = startServe(env);
  if (!(await first.until((line) => line.ready === true, 120_000))) {
    first.child.kill();
    throw new CannotCheck('serve --stdio did not become ready');
  }
  first.send({ id: 'r', action: 'read', paths: ['apples.md'] });
  const read = await first.until((line) => line.id === 'r', 60_000);
  first.child.kill();
  await first.exited;
  if (!read) throw new CannotCheck('no response to the read request');
  const actionsGone = typeof read.error !== 'string' || !/unknown action/.test(read.error);

  // 2. Closing stdin must not lose running requests: send a burst of searches, close
  //    stdin at once, and every answer has to arrive before the process exits.
  const second = startServe(env);
  if (!(await second.until((line) => line.ready === true, 120_000))) {
    second.child.kill();
    throw new CannotCheck('serve --stdio did not become ready');
  }
  const total = 10;
  for (let i = 0; i < total; i++) {
    second.send({ id: `s${i}`, query: 'apples', options: { mode: 'hybrid' } });
  }
  second.child.stdin.end();
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), 90_000));
  const outcome = await Promise.race([second.exited, timeout]);
  if (outcome === 'timeout') {
    second.child.kill();
    throw new CannotCheck('serve --stdio did not exit after stdin closed');
  }
  const answered = new Set(second.lines.map((line) => line.id));
  const drainGone = Array.from({ length: total }, (_, i) => `s${i}`).every((id) =>
    answered.has(id),
  );

  if (actionsGone && drainGone) {
    console.log(
      'stdio-parity probe: new actions answered and stdin close drains requests (problem gone)',
    );
    exitCode = 0;
  } else {
    console.log(
      `stdio-parity probe: problem present (actions: ${actionsGone ? 'ok' : 'unknown action'}, drain: ${drainGone ? 'ok' : 'lost responses'})`,
    );
    exitCode = 1;
  }
} catch (error) {
  console.error(
    `stdio-parity probe: cannot check: ${error instanceof CannotCheck ? error.message : error}`,
  );
  exitCode = 2;
} finally {
  server.close();
  rmSync(root, { recursive: true, force: true });
}
process.exit(exitCode);
