import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const vault = mkdtempSync(path.join(tmpdir(), 'ohs-vector-export-'));
process.env.OBSIDIAN_VAULT_PATH = vault;

const KEYWORDS = ['alpha', 'beta', 'gamma', 'delta'];
/** Counts of four keywords: a hand-computable 4-dimensional embedding. */
function keywordVector(text: string): Float32Array {
  const words = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const vector = new Float32Array(4);
  KEYWORDS.forEach((keyword, i) => {
    vector[i] = words.filter((word) => word === keyword).length;
  });
  return vector;
}

vi.mock('../../src/inference/embedder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/inference/embedder.js')>();
  return {
    ...actual,
    activeModelName: () => 'keyword-model',
    getEmbeddingDim: () => Promise.resolve(4),
    getContextLength: () => Promise.resolve(512),
    getDocumentTokenPolicy: () =>
      Promise.resolve({ limit: 508, count: (text: string) => text.length / 4 }),
    embedDetailed: vi.fn((texts: string[]) =>
      Promise.resolve(texts.map((text) => ({ ok: true as const, embedding: keywordVector(text) }))),
    ),
    embed: vi.fn((texts: string[]) => Promise.resolve(texts.map(keywordVector))),
  };
});

const { openIndexDatabase, createIndexService } =
  await import('../../src/indexing/index-service.js');
const { closeDb, getDb } = await import('../../src/storage/db.js');
const { exportNoteVectors, findNoteNeighbors, poolVectors, VectorExportError } =
  await import('../../src/search/note-vectors.js');

const FILLER = 'lorem ipsum dolor sit amet '.repeat(70);
const NOTES: Record<string, string> = {
  'a.md': 'alpha alpha beta\n',
  'b.md': 'alpha beta\n',
  'e.md': 'alpha and a link to [[a]]\n',
  'sub/c.md': 'gamma\n',
  'sub/d.md': 'gamma delta\n',
  // Two chunks: the first is alpha only, the second gamma only.
  'g.md': `alpha alpha alpha ${FILLER}\n\ngamma gamma ${FILLER}\n`,
};

const unit = (v: number[]) => v.map((x) => x / Math.hypot(...v));

function rawChunkVectors(notePath: string): Float32Array[] {
  const rows = getDb()
    .prepare(
      `SELECT vc.embedding AS embedding FROM vec_chunks vc
       JOIN chunks c ON c.id = vc.chunk_id JOIN notes n ON n.id = c.note_id
       WHERE n.path = ? ORDER BY c.chunk_index`,
    )
    .all(notePath) as Array<{ embedding: Buffer }>;
  return rows.map((row) => {
    const bytes = new Uint8Array(row.embedding);
    return new Float32Array(bytes.buffer, 0, bytes.byteLength / 4);
  });
}

beforeAll(async () => {
  for (const [name, text] of Object.entries(NOTES)) {
    const file = path.join(vault, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  await openIndexDatabase();
  const service = createIndexService();
  try {
    expect((await service.reindex()).errors).toEqual([]);
  } finally {
    await service.close();
  }
});

afterAll(() => {
  closeDb();
  rmSync(vault, { recursive: true, force: true });
});

describe('exportNoteVectors', () => {
  it('emits meta plus the normalised mean vector of every note', () => {
    const { meta, records } = exportNoteVectors({ ohsVersion: 'test' });
    expect(meta).toEqual({
      model: 'keyword-model',
      dim: 4,
      pooling: 'mean',
      note_count: 6,
      ohs_version: 'test',
    });
    const notes = [...records];
    expect(notes.map((n) => n.path)).toEqual(Object.keys(NOTES).sort((x, y) => x.localeCompare(y)));
    const a = notes.find((n) => n.path === 'a.md') as { vector: number[]; chunks: number };
    expect(a.chunks).toBe(1);
    a.vector.forEach((x, i) => expect(x).toBeCloseTo(unit([2, 1, 0, 0])[i]!, 6));
  });

  it('pools several chunks by mean and by max, against the stored chunk vectors', () => {
    const chunks = rawChunkVectors('g.md').map((v) => [...v]);
    expect(chunks.length).toBeGreaterThan(1);
    const meanRaw = [0, 1, 2, 3].map(
      (d) => chunks.reduce((sum, c) => sum + c[d]!, 0) / chunks.length,
    );
    const maxRaw = [0, 1, 2, 3].map((d) => Math.max(...chunks.map((c) => c[d]!)));
    expect(meanRaw[0]).toBeGreaterThan(0);
    expect(meanRaw[2]).toBeGreaterThan(0);

    const mean = [...exportNoteVectors({ paths: ['g.md'], ohsVersion: 't' }).records][0] as {
      vector: number[];
      chunks: number;
    };
    expect(mean.chunks).toBe(chunks.length);
    unit(meanRaw).forEach((x, i) => expect(mean.vector[i]).toBeCloseTo(x, 6));

    const max = [
      ...exportNoteVectors({ paths: ['g.md'], pooling: 'max', ohsVersion: 't' }).records,
    ][0] as { vector: number[] };
    unit(maxRaw).forEach((x, i) => expect(max.vector[i]).toBeCloseTo(x, 6));
    expect(max.vector).not.toEqual(mean.vector);

    const raw = [
      ...exportNoteVectors({ paths: ['g.md'], normalize: false, ohsVersion: 't' }).records,
    ][0] as { vector: number[] };
    meanRaw.forEach((x, i) => expect(raw.vector[i]).toBeCloseTo(x, 6));
  });

  it('reports unknown notes per path instead of inventing vectors', () => {
    const records = [...exportNoteVectors({ paths: ['nope.md', 'b.md'], ohsVersion: 't' }).records];
    expect(records).toContainEqual({ path: 'nope.md', error: 'note not found in the index' });
    expect(records.some((r) => 'vector' in r && r.path === 'b.md')).toBe(true);
  });

  it('refuses to export when the dimension or the model does not match the vectors', () => {
    const db = getDb();
    db.prepare("UPDATE settings SET value = '3' WHERE key = 'embedding_dim'").run();
    expect(() => [...exportNoteVectors({ ohsVersion: 't' }).records]).toThrow(VectorExportError);
    db.prepare("UPDATE settings SET value = '4' WHERE key = 'embedding_dim'").run();

    const model = db
      .prepare("SELECT value FROM settings WHERE key='embedding_model'")
      .pluck()
      .get();
    db.prepare("DELETE FROM settings WHERE key = 'embedding_model'").run();
    expect(() => [...exportNoteVectors({ ohsVersion: 't' }).records]).toThrow(/unknown/);
    db.prepare("INSERT INTO settings(key, value) VALUES ('embedding_model', ?)").run(model);
  });

  it('is read-only', () => {
    const db = getDb();
    const before = db.prepare("SELECT value FROM settings WHERE key='db_version'").pluck().get();
    expect([...exportNoteVectors({ ohsVersion: 't' }).records]).not.toHaveLength(0);
    expect([...findNoteNeighbors({ ohsVersion: 't' }).records]).not.toHaveLength(0);
    expect(db.prepare("SELECT value FROM settings WHERE key='db_version'").pluck().get()).toBe(
      before,
    );
  });
});

describe('findNoteNeighbors', () => {
  const neighborsOf = (options: Parameters<typeof findNoteNeighbors>[0], notePath: string) =>
    [...findNoteNeighbors(options).records].find((r) => r.path === notePath) as {
      neighbors: Array<{ path: string; score: number }>;
    };

  it('ranks by cosine over the pooled vectors', () => {
    const { neighbors } = neighborsOf({ paths: ['a.md'], k: 3, ohsVersion: 't' }, 'a.md');
    expect(neighbors.map((n) => n.path)).toEqual(['b.md', 'e.md', 'g.md']);
    expect(neighbors[0]!.score).toBeCloseTo(3 / Math.sqrt(10), 6);
    expect(neighbors[1]!.score).toBeCloseTo(2 / Math.sqrt(5), 6);
    expect(neighbors[2]!.score).toBeLessThan(neighbors[1]!.score);
  });

  it('answers every note when no path is given, and counts them in meta', () => {
    const { meta, records } = findNoteNeighbors({ k: 2, ohsVersion: 't' });
    expect(meta.note_count).toBe(6);
    const all = [...records];
    expect(all).toHaveLength(6);
    for (const record of all) {
      expect((record as { neighbors: unknown[] }).neighbors.length).toBeLessThanOrEqual(2);
    }
  });

  it('applies min-score, exclude-linked and scope', () => {
    expect(
      neighborsOf({ paths: ['a.md'], minScore: 0.9, ohsVersion: 't' }, 'a.md').neighbors.map(
        (n) => n.path,
      ),
    ).toEqual(['b.md']);

    const linked = neighborsOf({ paths: ['a.md'], excludeLinked: true, ohsVersion: 't' }, 'a.md');
    expect(linked.neighbors.map((n) => n.path)).not.toContain('e.md');
    const backlink = neighborsOf({ paths: ['e.md'], excludeLinked: true, ohsVersion: 't' }, 'e.md');
    expect(backlink.neighbors.map((n) => n.path)).not.toContain('a.md');

    const scoped = neighborsOf({ paths: ['a.md'], scope: 'sub', ohsVersion: 't' }, 'a.md');
    expect(scoped.neighbors.map((n) => n.path).sort((x, y) => x.localeCompare(y))).toEqual([
      'sub/c.md',
      'sub/d.md',
    ]);
  });

  it('never lists the note itself and reports unknown notes', () => {
    const records = [...findNoteNeighbors({ paths: ['b.md', 'zzz.md'], ohsVersion: 't' }).records];
    const b = records.find((r) => r.path === 'b.md') as { neighbors: Array<{ path: string }> };
    expect(b.neighbors.map((n) => n.path)).not.toContain('b.md');
    expect(records).toContainEqual({ path: 'zzz.md', error: 'note not found in the index' });
  });
});

describe('poolVectors', () => {
  it('leaves a zero vector at zero when normalising', () => {
    expect([...poolVectors([new Float32Array(3)], 'mean', true)]).toEqual([0, 0, 0]);
  });
});
