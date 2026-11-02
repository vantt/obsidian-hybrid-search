import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { extractChunkAnchors } from '../../src/content/block-anchors.js';
import { effectiveChunkTokens } from '../../src/content/chunker.js';
import { fixtureVector } from './fixtures/language-pack-vault.js';

const vault = mkdtempSync(path.join(tmpdir(), 'ohs-block-anchors-'));
process.env.OBSIDIAN_VAULT_PATH = vault;
delete process.env.OBSIDIAN_CHUNK_TOKENS;

vi.mock('../../src/inference/embedder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/inference/embedder.js')>();
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
const { closeDb, getDb } = await import('../../src/storage/db.js');

describe('extractChunkAnchors', () => {
  it('reads a trailing block id at the end of a paragraph', () => {
    expect(extractChunkAnchors('A paragraph of text. ^abc-12').blockId).toBe('^abc-12');
    expect(extractChunkAnchors('- item one\n- item two\n\n^list-1\n').blockId).toBe('^list-1');
  });

  it('ignores carets that are not trailing block ids', () => {
    expect(extractChunkAnchors('2^10 is large').blockId).toBeNull();
    expect(extractChunkAnchors('first ^abc line\nand more text').blockId).toBeNull();
    expect(extractChunkAnchors('no anchor here').blockId).toBeNull();
  });

  it('does not treat a caret inside a code fence as an anchor', () => {
    expect(extractChunkAnchors('Text\n\n```\ncode ^notanchor\n').blockId).toBeNull();
    expect(extractChunkAnchors('```\ncode\n```\n\nafter fence ^real').blockId).toBe('^real');
  });

  it('detects highlights written as == == or <mark>', () => {
    expect(extractChunkAnchors('keep ==this part== in mind').hasHighlight).toBe(true);
    expect(extractChunkAnchors('keep <mark>this</mark> in mind').hasHighlight).toBe(true);
    expect(extractChunkAnchors('a == b == c').hasHighlight).toBe(false);
    expect(extractChunkAnchors('`==code==` only').hasHighlight).toBe(false);
    expect(extractChunkAnchors('```\n==code==\n```').hasHighlight).toBe(false);
    expect(extractChunkAnchors('plain text').hasHighlight).toBe(false);
  });
});

describe('effectiveChunkTokens', () => {
  it('is the model limit when OBSIDIAN_CHUNK_TOKENS is unset or invalid', () => {
    delete process.env.OBSIDIAN_CHUNK_TOKENS;
    expect(effectiveChunkTokens(8192)).toBe(8192);
    process.env.OBSIDIAN_CHUNK_TOKENS = 'abc';
    expect(effectiveChunkTokens(8192)).toBe(8192);
    process.env.OBSIDIAN_CHUNK_TOKENS = '0';
    expect(effectiveChunkTokens(8192)).toBe(8192);
    delete process.env.OBSIDIAN_CHUNK_TOKENS;
  });

  it('is the smaller of the model limit and the setting', () => {
    process.env.OBSIDIAN_CHUNK_TOKENS = '1024';
    expect(effectiveChunkTokens(8192)).toBe(1024);
    expect(effectiveChunkTokens(512)).toBe(512);
    delete process.env.OBSIDIAN_CHUNK_TOKENS;
  });
});

const NOTE = [
  '# Garden',
  '',
  'Notes from the back yard, written down so that nothing is forgotten when the season turns.',
  '',
  '## Tomatoes',
  '',
  'Every summer the gardeners learn again that tomatoes need steady watering and plenty of sun during long weeks. ^tomato-1',
  '',
  '## Compost',
  '',
  'The compost heap works best when turned often, so ==remember to turn the compost== weekly.',
  '',
].join('\n');

function chunkRows() {
  return getDb()
    .prepare(
      `SELECT c.block_id, c.has_highlight, c.heading_path FROM chunks c
       JOIN notes n ON n.id = c.note_id WHERE n.path = 'garden.md' ORDER BY c.chunk_index`,
    )
    .all() as Array<{
    block_id: string | null;
    has_highlight: number;
    heading_path: string | null;
  }>;
}

function policy(): string {
  return (
    (
      getDb().prepare("SELECT value FROM settings WHERE key='content_policy'").get() as
        { value: string } | undefined
    )?.value ?? 'none'
  );
}

async function reindex(chunkTokens: string | null): Promise<void> {
  closeDb();
  if (chunkTokens === null) delete process.env.OBSIDIAN_CHUNK_TOKENS;
  else process.env.OBSIDIAN_CHUNK_TOKENS = chunkTokens;
  await openIndexDatabase();
  const service = createIndexService();
  try {
    expect((await service.reindex()).errors).toEqual([]);
  } finally {
    await service.close();
  }
}

beforeAll(() => {
  mkdirSync(vault, { recursive: true });
  writeFileSync(path.join(vault, 'garden.md'), NOTE);
});

afterAll(() => {
  delete process.env.OBSIDIAN_CHUNK_TOKENS;
  closeDb();
  rmSync(vault, { recursive: true, force: true });
});

describe('block anchors in the index', () => {
  it('without OBSIDIAN_CHUNK_TOKENS the note stays one chunk and the policy is upstream', async () => {
    await reindex(null);
    expect(chunkRows()).toHaveLength(1);
    expect(policy()).toBe('none');
    const anchors = (
      await search('tomatoes', { mode: 'fulltext', anchors: true, snippetLength: 60 })
    )[0]?.previewAnchors;
    expect(anchors?.[0]).not.toHaveProperty('blockId');
  });

  it('OBSIDIAN_CHUNK_TOKENS splits the note and each chunk keeps its own anchors', async () => {
    await reindex('40');
    expect(policy()).toContain('chunk=40');
    expect(chunkRows()).toEqual([
      { block_id: null, has_highlight: 0, heading_path: '# Garden' },
      { block_id: '^tomato-1', has_highlight: 0, heading_path: '# Garden > ## Tomatoes' },
      { block_id: null, has_highlight: 1, heading_path: '# Garden > ## Compost' },
    ]);
  });

  it('exposes block_id and has_highlight on result anchors, only when present', async () => {
    const [tomato] = await search('steady watering', {
      mode: 'fulltext',
      anchors: true,
      snippetLength: 60,
    });
    expect(tomato?.previewAnchors?.[0]).toMatchObject({ blockId: '^tomato-1' });
    expect(tomato?.previewAnchors?.[0]).not.toHaveProperty('hasHighlight');
    const [compost] = await search('turn the compost', {
      mode: 'fulltext',
      anchors: true,
      snippetLength: 60,
    });
    expect(compost?.previewAnchors?.[0]).toMatchObject({ hasHighlight: true });
    expect(compost?.previewAnchors?.[0]).not.toHaveProperty('blockId');
    const [semantic] = await search('steady watering', { mode: 'semantic', anchors: true });
    expect(semantic?.previewAnchors?.[0]).toHaveProperty('kind', 'semantic');
  });

  it('changing the setting rebuilds; unsetting it restores the upstream chunking', async () => {
    await reindex('60');
    expect(policy()).toContain('chunk=60');
    await reindex(null);
    expect(policy()).toBe('none');
    expect(chunkRows()).toHaveLength(1);
  });

  it('migrates a schema-2 index by deriving anchors for existing chunks', async () => {
    await reindex('40');
    closeDb();
    const raw = new Database(path.join(vault, '.obsidian-hybrid-search.db'));
    raw.exec(
      'ALTER TABLE chunks DROP COLUMN block_id; ALTER TABLE chunks DROP COLUMN has_highlight',
    );
    raw.prepare("UPDATE settings SET value='2' WHERE key='index_schema_version'").run();
    raw.close();
    delete process.env.OBSIDIAN_CHUNK_TOKENS;
    process.env.OBSIDIAN_CHUNK_TOKENS = '40';
    await openIndexDatabase();
    expect(chunkRows().map((r) => [r.block_id, r.has_highlight])).toEqual([
      [null, 0],
      ['^tomato-1', 0],
      [null, 1],
    ]);
    expect(
      (
        getDb().prepare("SELECT value FROM settings WHERE key='index_schema_version'").get() as {
          value: string;
        }
      ).value,
    ).toBe('3');
  });
});
