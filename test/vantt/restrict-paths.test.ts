import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const vault = mkdtempSync(path.join(tmpdir(), 'ohs-restrict-paths-'));
process.env.OBSIDIAN_VAULT_PATH = vault;
const PACK_DIR = path.resolve(import.meta.dirname, 'fixtures/lang-upper');

vi.mock('../../src/inference/embedder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/inference/embedder.js')>();
  const { fixtureVector } = await import('./fixtures/language-pack-vault.js');
  return {
    ...actual,
    activeModelName: () => 'fixture-model',
    getEmbeddingDim: () => Promise.resolve(8),
    getContextLength: () => Promise.resolve(512),
    getDocumentTokenPolicy: () =>
      Promise.resolve({ limit: 508, count: (text: string) => text.length / 4 }),
    embedDetailed: vi.fn((texts: string[]) =>
      Promise.resolve(texts.map((text) => ({ ok: true as const, embedding: fixtureVector(text) }))),
    ),
    embed: vi.fn((texts: string[]) => Promise.resolve(texts.map((t) => fixtureVector(t)))),
  };
});

const { openIndexDatabase, createIndexService } =
  await import('../../src/indexing/index-service.js');
const { search } = await import('../../src/search/searcher.js');
const { closeDb } = await import('../../src/storage/db.js');
const { buildFilterPredicate } = await import('../../src/contracts/filter-predicate.js');
const { handleStdioLine } = await import('../../src/transports/stdio-server.js');
const { SearchToolArgumentsSchema, SearchOptionsBoundarySchema } =
  await import('../../src/contracts/boundary-validation.js');

const REGION_SIZE = 30;
const NOISE_SIZE = 120;
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const region = Array.from({ length: REGION_SIZE }, (_, i) => `region/r-${i}.md`);
const noise = Array.from({ length: NOISE_SIZE }, (_, i) => `noise/n-${i}.md`);

function write(file: string, text: string): void {
  const full = path.join(vault, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

function writeNotes(): void {
  // Noise notes repeat the query terms far more often than region notes, so without
  // pushdown they fill every top-K and the region notes are unreachable.
  noise.forEach((file, i) => {
    write(
      file,
      `# Große Straße noise ${i}\n\n${'Die Große Straße, grosse strasse und die Straße. '.repeat(4)}noise${i}\n`,
    );
  });
  region.forEach((file, i) => {
    write(
      file,
      `# Straße region ${i}\n\nDie Große Straße, grosse strasse ${'filler '.repeat(i % 7)} region${i}${' extra'.repeat(i)}\n`,
    );
  });
}

async function reopen(pack: boolean): Promise<void> {
  closeDb();
  if (pack) {
    process.env.OHS_LANGUAGE_PACK = PACK_DIR;
    process.env.OHS_LANGUAGE_PACK_OPTIONS = '{}';
  } else {
    delete process.env.OHS_LANGUAGE_PACK;
    delete process.env.OHS_LANGUAGE_PACK_OPTIONS;
  }
  await openIndexDatabase();
  const service = createIndexService();
  try {
    const result = await service.reindex();
    expect(result.errors).toEqual([]);
  } finally {
    await service.close();
  }
}

const QUERIES = ['grosse strasse', 'Straße', 'region'];
const MODES = ['fulltext', 'title', 'semantic', 'hybrid'] as const;

async function pathsFor(
  query: string,
  mode: (typeof MODES)[number],
  paths?: string[],
): Promise<string[]> {
  const results = await search(query, { mode, limit: REGION_SIZE, ...(paths ? { paths } : {}) });
  return results.map((r) => r.path);
}

afterAll(() => {
  closeDb();
  delete process.env.OHS_LANGUAGE_PACK;
  delete process.env.OHS_LANGUAGE_PACK_OPTIONS;
  rmSync(vault, { recursive: true, force: true });
});

beforeAll(() => {
  writeNotes();
});

describe.each([[false], [true]])('restricting to a set of 30 notes (language pack: %s)', (pack) => {
  it('returns what a vault holding only those 30 notes returns, in every mode', async () => {
    writeNotes();
    await reopen(pack);

    // Precondition: unrestricted, noise crowds the region out of the top-10, so the
    // restricted run below can only succeed if the filter reached the retrieval queries.
    const crowded = await search('grosse strasse', { mode: 'fulltext', limit: 10 });
    expect(crowded.every((r) => !r.path.startsWith('region/'))).toBe(true);

    const restricted = new Map<string, string[]>();
    for (const query of QUERIES) {
      for (const mode of MODES) {
        restricted.set(`${mode}|${query}`, await pathsFor(query, mode, region));
      }
    }

    for (const file of noise) rmSync(path.join(vault, file));
    await reopen(pack);

    for (const query of QUERIES) {
      for (const mode of MODES) {
        const alone = await pathsFor(query, mode);
        const got = restricted.get(`${mode}|${query}`)!;
        expect(alone.every((p) => p.startsWith('region/'))).toBe(true);
        expect(got, `${mode} "${query}"`).toEqual(alone);
      }
    }
    expect(restricted.get('fulltext|grosse strasse')!).toHaveLength(REGION_SIZE);
    writeNotes();
  });
});

describe('paths option semantics', () => {
  beforeAll(async () => {
    writeNotes();
    await reopen(false);
  });

  it('restricts to exactly the listed notes and ignores unknown paths', async () => {
    const results = await search('strasse', {
      mode: 'fulltext',
      paths: ['noise/n-3.md', 'region/r-1.md', 'missing/none.md'],
    });
    expect(results.map((r) => r.path).sort(byCodeUnit)).toEqual(['noise/n-3.md', 'region/r-1.md']);
  });

  it('an empty list matches nothing', async () => {
    expect(await search('strasse', { paths: [] })).toEqual([]);
    expect(await search('', { paths: [] })).toEqual([]);
  });

  it('combines with the other filters', async () => {
    const results = await search('strasse', {
      mode: 'fulltext',
      paths: [...region, ...noise],
      scope: 'region',
      limit: 0,
    });
    expect(results).toHaveLength(REGION_SIZE);
  });

  it('lists exactly the given notes when no query is given', async () => {
    const results = await search('', { paths: region.slice(0, 5), limit: 0 });
    expect(results.map((r) => r.path).sort(byCodeUnit)).toEqual(
      region.slice(0, 5).sort(byCodeUnit),
    );
  });

  it('restricts a similar-notes lookup', async () => {
    const results = await search('', {
      notePath: 'region/r-0.md',
      paths: region.slice(0, 6),
      limit: 20,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => region.slice(1, 6).includes(r.path))).toBe(true);
  });

  it('is not served from a cache entry of a different restriction', async () => {
    const a = await search('strasse', { mode: 'fulltext', paths: ['region/r-1.md'] });
    const b = await search('strasse', { mode: 'fulltext', paths: ['region/r-2.md'] });
    expect(a.map((r) => r.path)).toEqual(['region/r-1.md']);
    expect(b.map((r) => r.path)).toEqual(['region/r-2.md']);
  });

  it('leaves results unchanged when not set', async () => {
    const plain = await pathsFor('strasse', 'hybrid');
    const withUndefined = (
      await search('strasse', { mode: 'hybrid', limit: REGION_SIZE, paths: undefined })
    ).map((r) => r.path);
    expect(withUndefined).toEqual(plain);
  });

  it('builds no clause when unset and one JSON parameter when set', () => {
    expect(buildFilterPredicate({}).isEmpty).toBe(true);
    const predicate = buildFilterPredicate({ paths: ['a.md', 'a.md', 'b/c.md'] });
    expect(predicate.isEmpty).toBe(false);
    expect(predicate.params).toHaveLength(1);
    expect(JSON.parse(String(predicate.params[0]))).toEqual(['a.md', 'b/c.md']);
  });

  it('handles a restriction far larger than the bound-variable limit', () => {
    const many = Array.from({ length: 50_000 }, (_, i) => `bulk/${i}.md`);
    expect(buildFilterPredicate({ paths: many }).params).toHaveLength(1);
  });

  it('is accepted by the MCP and stdio boundaries', async () => {
    expect(SearchToolArgumentsSchema.safeParse({ query: 'x', paths: ['a.md'] }).success).toBe(true);
    expect(SearchToolArgumentsSchema.safeParse({ query: 'x', paths: 'a.md' }).success).toBe(false);
    expect(SearchOptionsBoundarySchema.safeParse({ paths: ['a.md'] }).success).toBe(true);
    const lines: string[] = [];
    await handleStdioLine(
      JSON.stringify({
        id: '1',
        query: 'strasse',
        options: { mode: 'fulltext', paths: ['region/r-4.md'] },
      }),
      search,
      (line) => lines.push(line),
    );
    const response = JSON.parse(lines[0]!) as { results: Array<{ path: string }> };
    expect(response.results.map((r) => r.path)).toEqual(['region/r-4.md']);
  });
});
