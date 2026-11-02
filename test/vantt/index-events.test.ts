import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// Real `serve --stdio` processes against a temp vault and a fake embedding server.
// The watcher debounces each file for 5 s, so the file-change tests wait for that.
const root = path.resolve(import.meta.dirname, '../..');
const DIM = 8;
const dirs: string[] = [];
let embedServer: Server;
let embedPort = 0;

function embedText(text: string): number[] {
  const vector = new Array<number>(DIM).fill(0);
  for (const word of text.toLowerCase().match(/[a-z]+/g) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % DIM] = (vector[hash % DIM] ?? 0) + 1;
  }
  const norm = Math.hypot(...vector) || 1;
  return vector.map((v) => v / norm);
}

beforeAll(async () => {
  embedServer = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}') as { input?: string | string[] };
      const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input ?? ''];
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
  await new Promise<void>((resolve) => embedServer.listen(0, '127.0.0.1', resolve));
  embedPort = (embedServer.address() as { port: number }).port;
});

afterAll(() => {
  embedServer.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

interface Session {
  vault: string;
  lines: Array<Record<string, unknown>>;
  exit: Promise<number | null>;
  closeStdin(): void;
  waitFor(
    match: (line: Record<string, unknown>) => boolean,
    ms: number,
  ): Promise<Record<string, unknown>>;
}

function startServer(events: boolean, debounceMs?: number): Session {
  const vault = mkdtempSync(path.join(tmpdir(), 'ohs-index-events-'));
  dirs.push(vault);
  writeFileSync(path.join(vault, 'apples.md'), 'Apples grow in the orchard.\n');
  mkdirSync(path.join(vault, 'sub'));
  writeFileSync(path.join(vault, 'sub', 'pears.md'), 'Pears ripen in autumn.\n');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OBSIDIAN_VAULT_PATH: vault,
    OPENAI_API_KEY: 'test',
    OPENAI_BASE_URL: `http://127.0.0.1:${embedPort}/v1`,
    OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
    OHS_DISABLE_UPDATE_CHECK: '1',
    NO_COLOR: '1',
  };
  if (debounceMs !== undefined) env.OBSIDIAN_WATCH_DEBOUNCE_MS = String(debounceMs);
  if (events) env.OHS_STDIO_EVENTS = '1';
  else delete env.OHS_STDIO_EVENTS;
  const child = spawn(process.execPath, [path.join(root, 'dist/src/cli.js'), 'serve', '--stdio'], {
    cwd: vault,
    env,
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines: Array<Record<string, unknown>> = [];
  const waiters: Array<() => void> = [];
  let buffered = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString();
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (line.trim()) lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    for (const wake of waiters.splice(0)) wake();
  });
  const exit = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return {
    vault,
    lines,
    exit,
    closeStdin: () => child.stdin.end(),
    waitFor: (match, ms) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timeout waiting for line; got ${JSON.stringify(lines)}`)),
          ms,
        );
        const check = () => {
          const found = lines.find(match);
          if (found) {
            clearTimeout(timer);
            resolve(found);
          } else waiters.push(check);
        };
        check();
      }),
  };
}

const isEvent = (name: string, file: string) => (line: Record<string, unknown>) =>
  line.event === name && Array.isArray(line.paths) && line.paths.includes(file);

describe('serve --stdio index events', () => {
  it('delivers an indexed event within 1 s of an edit with a low debounce', async () => {
    const session = startServer(true, 250);
    await session.waitFor((l) => l.ready === true, 30_000);
    await session.waitFor(isEvent('indexed', 'apples.md'), 30_000);
    await new Promise((r) => setTimeout(r, 1000));
    session.lines.length = 0;
    const started = Date.now();
    writeFileSync(path.join(session.vault, 'apples.md'), 'Apples and plums grow in the orchard.\n');
    await session.waitFor(isEvent('indexed', 'apples.md'), 5000);
    expect(Date.now() - started).toBeLessThan(1000);
    session.closeStdin();
    expect(await session.exit).toBe(0);
  }, 60_000);

  it('emits indexed and removed events without an id after note writes', async () => {
    const session = startServer(true);
    await session.waitFor((l) => l.ready === true, 30_000);
    // Let the initial index settle, then edit and delete.
    await session.waitFor(isEvent('indexed', 'apples.md'), 30_000);
    const edited = Date.now();
    writeFileSync(
      path.join(session.vault, 'apples.md'),
      'Apples and quinces grow in the orchard.\n',
    );
    session.lines.length = 0;
    const event = await session.waitFor(isEvent('indexed', 'apples.md'), 20_000);
    expect(event).toMatchObject({ event: 'indexed', paths: ['apples.md'] });
    expect(event).not.toHaveProperty('id');
    expect(typeof event.db_version).toBe('number');
    expect(Date.now() - edited).toBeLessThan(15_000);

    unlinkSync(path.join(session.vault, 'sub', 'pears.md'));
    const removed = await session.waitFor(isEvent('removed', 'sub/pears.md'), 20_000);
    expect(removed).toMatchObject({ event: 'removed', paths: ['sub/pears.md'] });
    expect(removed).not.toHaveProperty('id');

    session.closeStdin();
    expect(await session.exit).toBe(0);
  }, 90_000);

  it('stays silent without opt-in', async () => {
    const session = startServer(false);
    await session.waitFor((l) => l.ready === true, 30_000);
    await new Promise((r) => setTimeout(r, 2000));
    writeFileSync(path.join(session.vault, 'apples.md'), 'Apples and figs.\n');
    await new Promise((r) => setTimeout(r, 9000));
    session.closeStdin();
    expect(await session.exit).toBe(0);
    expect(session.lines.filter((l) => 'event' in l)).toEqual([]);
    expect(session.lines).toEqual([{ ready: true }]);
  }, 60_000);
});
