import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { exportNoteVectors, findNoteNeighbors } from '../src/search/note-vectors.js';
import type { SearchOptions, SearchResult } from '../src/search/searcher.js';
import { handleStdioLine, type StdioActionHandlers } from '../src/transports/stdio-server.js';

const root = path.resolve(import.meta.dirname, '..');
const vault = mkdtempSync(path.join(tmpdir(), 'ohs-transport-parity-'));
process.env.OBSIDIAN_VAULT_PATH = vault;
const {
  openDb,
  closeDb,
  initVecTable,
  upsertNote,
  upsertLinks,
  upsertMarkdownLinks,
  upsertNoteUrls,
} = await import('./helpers/owned-storage.js');
const { search, readNotes } = await import('../src/search/searcher.js');
const { populateMissingLinks, populateMissingMarkdownReferences } =
  await import('./helpers/owned-indexer.js');
afterAll(() => {
  closeDb();
  rmSync(vault, { recursive: true, force: true });
});

it('CLI JSON, MCP and line IPC preserve the same filtered Unicode result contract', async () => {
  openDb();
  initVecTable(4);
  const content =
    '# Alpha\nalpha café body with enough context for the matching anchor. [[target]] [target](target.md) https://example.com/a';
  for (const [name, tags] of [
    ['café/alpha.md', ['café', 'active']],
    ['café/excluded.md', ['café', 'blocked']],
    ['target.md', []],
  ] as const) {
    const normalized = name.normalize('NFD');
    mkdirSync(path.dirname(path.join(vault, normalized)), { recursive: true });
    writeFileSync(path.join(vault, normalized), content);
    upsertNote({
      path: normalized,
      title: name,
      tags: [...tags],
      aliases: ['identity'],
      frontmatter: { state: 'open' },
      content,
      mtime: 1,
      hash: name,
      chunks: [
        {
          text: content,
          headingPath: '# Alpha',
          charStart: 0,
          charEnd: content.length,
          embedding: new Float32Array([1, 0, 0, 0]),
        },
      ],
    });
  }
  await populateMissingLinks();
  await populateMissingMarkdownReferences();
  upsertLinks('café/alpha.md'.normalize('NFD'), ['target.md']);
  upsertMarkdownLinks('café/alpha.md'.normalize('NFD'), ['target.md']);
  upsertNoteUrls('café/alpha.md'.normalize('NFD'), ['https://example.com/a']);
  const options: SearchOptions = {
    mode: 'fulltext',
    scope: ['café'],
    tag: ['café', '-blocked'],
    frontmatter: ['state:open'],
    limit: 7,
    snippetLength: 80,
    anchors: true,
  };
  const expected = await search('alpha', options);
  expect(expected).toHaveLength(1);
  expect(expected[0]?.previewAnchors).toBeDefined();
  let line = '';
  await handleStdioLine(
    JSON.stringify({ id: 'parity', query: 'alpha', options }),
    search,
    (output) => {
      line = output;
    },
  );
  expect(JSON.parse(line)).toEqual({ id: 'parity', results: expected });

  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    OBSIDIAN_VAULT_PATH: vault,
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: '',
    OPENAI_EMBEDDING_MODEL: '',
    LOCAL_EMBEDDING_MODEL: 'Xenova/multilingual-e5-small',
  };
  const args = [
    '--import',
    pathToFileURL(path.join(root, 'dist/test/fixtures/vault-config-preload.js')).href,
    path.join(root, 'dist/src/cli.js'),
  ];
  const cli = spawnSync(
    process.execPath,
    [
      ...args,
      'search',
      'alpha',
      '--mode',
      'fulltext',
      '--scope',
      'café',
      '--tag',
      'café',
      '--tag=-blocked',
      '--frontmatter',
      'state:open',
      '--limit',
      '7',
      '--snippet-length',
      '80',
      '--anchors',
      '--json',
    ],
    { cwd: root, env, encoding: 'utf8', timeout: 15_000 },
  );
  expect(cli.status, cli.stderr).toBe(0);
  expect(JSON.parse(cli.stdout)).toEqual(expected);

  const client = new Client({ name: 'transport-parity', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...args, 'mcp'],
    cwd: root,
    env,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const response = await client.callTool({
      name: 'search',
      arguments: {
        query: 'alpha',
        mode: 'fulltext',
        scope: ['café'],
        tag: ['café', '-blocked'],
        frontmatter: ['state:open'],
        limit: 7,
        snippet_length: 80,
        anchors: true,
      },
    });
    expect(response.isError).not.toBe(true);
    const content = response.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0]!.text) as { results: SearchResult[] };
    expect(parsed.results).toEqual(expected);
  } finally {
    await client.close();
  }
}, 30_000);

it('read, vectors and neighbors give the same answer over line IPC, the CLI and MCP', async () => {
  const actions: StdioActionHandlers = {
    read: (paths, options) => readNotes(paths, options),
    vectors: (params) => exportNoteVectors({ ...params, ohsVersion: 'parity' }),
    neighbors: (params) => findNoteNeighbors({ ...params, ohsVersion: 'parity' }),
  };
  const ipc = async (request: Record<string, unknown>) => {
    let line = '';
    await handleStdioLine(
      JSON.stringify({ id: 'x', ...request }),
      search,
      (output) => {
        line = output;
      },
      undefined,
      actions,
    );
    return JSON.parse(line) as Record<string, unknown>;
  };

  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    OBSIDIAN_VAULT_PATH: vault,
    OPENAI_API_KEY: '',
    OPENAI_BASE_URL: '',
    OPENAI_EMBEDDING_MODEL: '',
    LOCAL_EMBEDDING_MODEL: 'Xenova/multilingual-e5-small',
    OHS_DISABLE_UPDATE_CHECK: '1',
  };
  const args = [
    '--import',
    pathToFileURL(path.join(root, 'dist/test/fixtures/vault-config-preload.js')).href,
    path.join(root, 'dist/src/cli.js'),
  ];
  const cli = (...cliArgs: string[]) => {
    const run = spawnSync(process.execPath, [...args, ...cliArgs], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(run.status, run.stderr).toBe(0);
    return run.stdout;
  };
  const notePath = 'café/alpha.md'.normalize('NFD');
  const asJson = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;

  // read
  const readRequest = { action: 'read', paths: [notePath, 'missing.md'], snippetLength: 40 };
  const read = await ipc(readRequest);
  const expectedRead = asJson(readNotes([notePath, 'missing.md'], { snippetLength: 40 }));
  expect(read).toEqual({ id: 'x', notes: expectedRead });
  expect(
    JSON.parse(cli('read', notePath, 'missing.md', '--snippet-length', '40', '--json')),
  ).toEqual(expectedRead);

  // vectors
  const vectors = await ipc({ action: 'vectors', paths: [notePath] });
  expect(vectors.error).toBeUndefined();
  const cliVectors = cli('vectors', '--path', notePath)
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(cliVectors[0]).toEqual({
    meta: { ...(vectors.meta as object), ohs_version: expect.any(String) as unknown },
  });
  expect(cliVectors.slice(1)).toEqual(vectors.records);
  expect(vectors.records).toHaveLength(1);
  const missing = await ipc({ action: 'vectors', paths: ['missing.md'] });
  expect(missing.records).toEqual([{ path: 'missing.md', error: 'note not found in the index' }]);

  // neighbors
  const neighbors = await ipc({ action: 'neighbors', paths: [notePath], k: 2 });
  expect(neighbors.error).toBeUndefined();
  const cliNeighbors = cli('neighbors', '--path', notePath, '--k', '2')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(cliNeighbors.slice(1)).toEqual(neighbors.records);

  // MCP read
  const client = new Client({ name: 'transport-parity', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [...args, 'mcp'],
    cwd: root,
    env,
    stderr: 'pipe',
  });
  try {
    await client.connect(transport);
    const response = await client.callTool({
      name: 'read',
      arguments: { paths: [notePath, 'missing.md'], snippet_length: 40 },
    });
    const content = response.content as Array<{ type: string; text: string }>;
    expect(JSON.parse(content[0]!.text)).toEqual({ results: expectedRead });
  } finally {
    await client.close();
  }
}, 60_000);
