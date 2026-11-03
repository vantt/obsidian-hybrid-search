import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  drainInFlight,
  handleStdioLine,
  type StdioActionHandlers,
} from '../../src/transports/stdio-server.js';

const search = vi.fn(() => Promise.resolve([]));

async function ask(
  request: Record<string, unknown>,
  actions?: StdioActionHandlers,
): Promise<Record<string, unknown>> {
  const lines: string[] = [];
  await handleStdioLine(
    JSON.stringify({ id: 'q', ...request }),
    search,
    (line) => lines.push(line),
    undefined,
    actions,
  );
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0]!) as Record<string, unknown>;
}

describe('stdio actions: validation and dispatch', () => {
  it('answers "not available" when the server supplies no handler', async () => {
    for (const request of [
      { action: 'read', paths: ['a.md'] },
      { action: 'vectors' },
      { action: 'neighbors' },
      { action: 'reindex' },
    ]) {
      expect(await ask(request)).toEqual({
        id: 'q',
        error: `${request.action} is not available on this server`,
      });
    }
  });

  it('keeps unknown actions unknown and never touches a handler', async () => {
    const read = vi.fn(() => []);
    expect(await ask({ action: 'delete' }, { read })).toEqual({
      id: 'q',
      error: 'unknown action: delete',
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('reports schema errors as {id, error} without calling the handler', async () => {
    const handlers = {
      read: vi.fn(() => []),
      vectors: vi.fn(() => ({ meta: {} as never, records: [] })),
      neighbors: vi.fn(() => ({ meta: {} as never, records: [] })),
      reindex: vi.fn(() => Promise.resolve({})),
    };
    const bad = [
      { action: 'read', paths: 7 },
      { action: 'read', paths: [] },
      { action: 'read', paths: ['a.md'], snippetLength: -1 },
      { action: 'vectors', pooling: 'median' },
      { action: 'vectors', paths: 'a.md' },
      { action: 'neighbors', k: 0 },
      { action: 'neighbors', minScore: 2 },
      { action: 'neighbors', scope: 5 },
      { action: 'reindex', force: 'yes' },
      { action: 'reindex', path: 3 },
    ];
    for (const request of bad) {
      const response = await ask(request, handlers);
      expect(response.id).toBe('q');
      expect(typeof response.error).toBe('string');
      expect(Object.keys(response)).toHaveLength(2);
    }
    for (const handler of Object.values(handlers)) expect(handler).not.toHaveBeenCalled();
  });

  it('passes parsed parameters through and shapes the responses', async () => {
    const handlers: StdioActionHandlers = {
      read: vi.fn(() => [{ path: 'a.md', found: true }]),
      vectors: vi.fn(() => ({
        meta: { model: 'm' } as never,
        records: new Set([{ path: 'a.md' }]),
      })),
      neighbors: vi.fn(() => ({ meta: { model: 'm' } as never, records: [] })),
      reindex: vi.fn(() => Promise.resolve({ indexed: 1, skipped: 0, errors: [] })),
    };
    expect(await ask({ action: 'read', paths: 'a.md', related: false }, handlers)).toEqual({
      id: 'q',
      notes: [{ path: 'a.md', found: true }],
    });
    expect(handlers.read).toHaveBeenCalledWith(['a.md'], {
      snippetLength: undefined,
      related: false,
    });
    expect(await ask({ action: 'vectors', paths: ['a.md'], pooling: 'max' }, handlers)).toEqual({
      id: 'q',
      meta: { model: 'm' },
      records: [{ path: 'a.md' }],
    });
    expect(handlers.vectors).toHaveBeenCalledWith({
      paths: ['a.md'],
      pooling: 'max',
      normalize: undefined,
    });
    await ask(
      { action: 'neighbors', k: 3, minScore: 0.5, excludeLinked: true, scope: ['x', '-y'] },
      handlers,
    );
    expect(handlers.neighbors).toHaveBeenCalledWith({
      paths: undefined,
      k: 3,
      minScore: 0.5,
      excludeLinked: true,
      scope: ['x', '-y'],
      pooling: undefined,
    });
    expect(await ask({ action: 'reindex', path: 'a.md', force: true }, handlers)).toEqual({
      id: 'q',
      result: { indexed: 1, skipped: 0, errors: [] },
    });
    expect(handlers.reindex).toHaveBeenCalledWith({ path: 'a.md', force: true });
  });

  it('turns a handler exception into {id, error}', async () => {
    const vectors = vi.fn(() => {
      throw new Error('model mismatch');
    });
    expect(await ask({ action: 'vectors' }, { vectors })).toEqual({
      id: 'q',
      error: 'model mismatch',
    });
  });
});

describe('drainInFlight', () => {
  it('returns at once when nothing is running', async () => {
    expect(await drainInFlight(new Set(), 1000)).toBe(true);
  });

  it('waits for running work, including work added while waiting', async () => {
    const inFlight = new Set<Promise<void>>();
    let finished = 0;
    const track = (ms: number) => {
      const p: Promise<void> = new Promise<void>((resolve) => setTimeout(resolve, ms)).then(() => {
        finished++;
        inFlight.delete(p);
      });
      inFlight.add(p);
    };
    track(30);
    setTimeout(() => track(30), 10);
    expect(await drainInFlight(inFlight, 2000)).toBe(true);
    expect(finished).toBe(2);
  });

  it('gives up after the timeout', async () => {
    const never = new Promise<void>(() => undefined);
    expect(await drainInFlight(new Set([never]), 20)).toBe(false);
  });
});

// ─── Process level: the real `serve --stdio` ─────────────────────────────────

const root = path.resolve(import.meta.dirname, '../..');
const DIM = 8;
const vault = mkdtempSync(path.join(tmpdir(), 'ohs-stdio-parity-'));
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
  writeFileSync(path.join(vault, 'apples.md'), 'Apples and pears grow in the orchard.\n');
  writeFileSync(path.join(vault, 'pears.md'), 'Pears and apples ripen in autumn.\n');
  writeFileSync(path.join(vault, 'rockets.md'), 'Rockets burn fuel to reach orbit.\n');
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
  rmSync(vault, { recursive: true, force: true });
});

interface Session {
  responses: Array<Record<string, unknown>>;
  exit: Promise<number | null>;
  send(request: Record<string, unknown>): void;
  closeStdin(): void;
  waitFor(id: string): Promise<Record<string, unknown>>;
}

function startServer(): Session {
  const child = spawn(process.execPath, [path.join(root, 'dist/src/cli.js'), 'serve', '--stdio'], {
    cwd: vault,
    env: {
      ...process.env,
      OBSIDIAN_VAULT_PATH: vault,
      OPENAI_API_KEY: 'test',
      OPENAI_BASE_URL: `http://127.0.0.1:${embedPort}/v1`,
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
      OHS_DISABLE_UPDATE_CHECK: '1',
      NO_COLOR: '1',
    },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const responses: Array<Record<string, unknown>> = [];
  const waiters = new Map<string, (value: Record<string, unknown>) => void>();
  let buffered = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString();
    let newline = buffered.indexOf('\n');
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      newline = buffered.indexOf('\n');
      if (!line.trim()) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      responses.push(message);
      const id = typeof message.id === 'string' ? message.id : message.ready ? 'ready' : '';
      waiters.get(id)?.(message);
    }
  });
  const exit = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  return {
    responses,
    exit,
    send: (request) => child.stdin.write(JSON.stringify(request) + '\n'),
    closeStdin: () => child.stdin.end(),
    waitFor: (id) =>
      new Promise((resolve) => {
        const existing = responses.find((r) => r.id === id || (id === 'ready' && r.ready));
        if (existing) resolve(existing);
        else waiters.set(id, resolve);
      }),
  };
}

describe('serve --stdio process', () => {
  it('answers every in-flight request when stdin closes', async () => {
    const session = startServer();
    await session.waitFor('ready');
    const total = 25;
    for (let i = 0; i < total; i++) {
      session.send({ id: `s${i}`, query: 'apples', options: { mode: 'fulltext' } });
    }
    session.closeStdin();
    expect(await session.exit).toBe(0);
    const ids = session.responses.map((r) => r.id).filter((id) => typeof id === 'string');
    expect(new Set(ids)).toEqual(new Set(Array.from({ length: total }, (_, i) => `s${i}`)));
    expect(ids).toHaveLength(total);
    expect(session.responses.filter((r) => 'error' in r)).toEqual([]);
  }, 60_000);

  it('serves read, vectors, neighbors and reindex, then drains a slow reindex on close', async () => {
    const session = startServer();
    await session.waitFor('ready');

    session.send({ id: 'index', action: 'reindex' });
    const indexed = await session.waitFor('index');
    expect(indexed.error).toBeUndefined();
    expect(indexed.result).toMatchObject({ errors: [] });

    session.send({ id: 'one', action: 'reindex', path: 'apples.md', force: true });
    expect((await session.waitFor('one')).result).toMatchObject({ indexed: 1, errors: [] });

    session.send({ id: 'read', action: 'read', paths: ['apples.md', 'nope.md'], related: false });
    const read = (await session.waitFor('read')).notes as Array<Record<string, unknown>>;
    expect(read[0]).toMatchObject({ path: 'apples.md', found: true });
    expect(read[1]).toMatchObject({ path: 'nope.md', found: false });

    session.send({ id: 'vec', action: 'vectors', paths: ['apples.md'] });
    const vec = await session.waitFor('vec');
    expect(vec.meta).toMatchObject({ dim: DIM, pooling: 'mean', note_count: 1 });
    const [note] = vec.records as Array<{ path: string; dim: number; vector: number[] }>;
    expect(note).toMatchObject({ path: 'apples.md', dim: DIM });
    expect(note?.vector).toHaveLength(DIM);

    session.send({ id: 'nn', action: 'neighbors', paths: ['apples.md'], k: 2 });
    const nn = await session.waitFor('nn');
    const [neighbors] = nn.records as Array<{ neighbors: Array<{ path: string }> }>;
    expect(neighbors?.neighbors[0]?.path).toBe('pears.md');

    session.send({ id: 'bad', action: 'neighbors', k: 0 });
    expect(await session.waitFor('bad')).toMatchObject({
      id: 'bad',
      error: expect.any(String) as unknown,
    });
    session.send({ id: 'who', action: 'nope' });
    expect(await session.waitFor('who')).toEqual({ id: 'who', error: 'unknown action: nope' });

    // A full reindex followed at once by EOF: the answer must still arrive.
    session.send({ id: 'last', action: 'reindex', force: true });
    session.closeStdin();
    expect(await session.exit).toBe(0);
    const last = session.responses.find((r) => r.id === 'last');
    expect(last?.result).toMatchObject({ errors: [] });
  }, 120_000);
});
