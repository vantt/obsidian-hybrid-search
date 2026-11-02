import type { FilterPredicate } from '../contracts/filter-predicate.js';
import { getDb, getStoredEmbeddingDim, getStoredModel, hasVecTable } from './db.js';

/** Read-only access to the stored chunk embeddings, grouped by note. */

export interface NoteChunkVectors {
  path: string;
  /** Chunk embeddings in chunk order. */
  vectors: Float32Array[];
}

export interface StoredVectorSource {
  /** `embedding_model` recorded when the vectors were written. */
  model: string | null;
  /** `embedding_dim` recorded when the vec table was created. */
  dim: number | null;
}

const PATH_BATCH = 500;

export function getStoredVectorSource(): StoredVectorSource {
  return { model: getStoredModel(), dim: getStoredEmbeddingDim() };
}

/** Number of notes that have at least one stored chunk embedding. */
export function countNotesWithVectors(): number {
  if (!hasVecTable()) return 0;
  return getDb()
    .prepare(
      `SELECT COUNT(DISTINCT c.note_id) FROM chunks c
       WHERE EXISTS (SELECT 1 FROM vec_chunks vc WHERE vc.chunk_id = c.id)`,
    )
    .pluck()
    .get() as number;
}

/** The subset of `paths` that are indexed notes. */
export function findExistingNotePaths(paths: string[]): Set<string> {
  const db = getDb();
  const found = new Set<string>();
  for (let i = 0; i < paths.length; i += PATH_BATCH) {
    const batch = paths.slice(i, i + PATH_BATCH);
    const rows = db
      .prepare(`SELECT path FROM notes WHERE path IN (${batch.map(() => '?').join(', ')})`)
      .pluck()
      .all(...batch) as string[];
    for (const row of rows) found.add(row);
  }
  return found;
}

/** Paths of the notes matching a filter predicate (alias `n` over `notes`). */
export function listNotePathsMatching(predicate: FilterPredicate): Set<string> {
  const where = predicate.isEmpty ? '' : ` WHERE ${predicate.sql}`;
  const rows = getDb()
    .prepare(`SELECT n.path FROM notes n${where}`)
    .pluck()
    .all(...predicate.params) as string[];
  return new Set(rows);
}

function* iterateRows(where: string, params: Array<string | number>): Generator<NoteChunkVectors> {
  const rows = getDb()
    .prepare(
      `SELECT n.path AS path, vc.embedding AS embedding
       FROM chunks c
       JOIN notes n ON n.id = c.note_id
       JOIN vec_chunks vc ON vc.chunk_id = c.id
       ${where}
       ORDER BY n.path, c.chunk_index`,
    )
    .iterate(...params) as IterableIterator<{ path: string; embedding: Buffer }>;
  let current: NoteChunkVectors | undefined;
  for (const row of rows) {
    if (current?.path !== row.path) {
      if (current) yield current;
      current = { path: row.path, vectors: [] };
    }
    // Copy: the row buffer is reused by SQLite after the next step.
    const bytes = new Uint8Array(row.embedding);
    current.vectors.push(new Float32Array(bytes.buffer, 0, bytes.byteLength / 4));
  }
  if (current) yield current;
}

/**
 * Chunk embeddings per note, ordered by path. With `paths`, only those notes that have
 * vectors are produced; without, every note that has vectors.
 */
export function* iterateNoteChunkVectors(paths?: string[]): Generator<NoteChunkVectors> {
  if (!hasVecTable()) return;
  if (paths === undefined) {
    yield* iterateRows('', []);
    return;
  }
  const sorted = [...new Set(paths)].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
  for (let i = 0; i < sorted.length; i += PATH_BATCH) {
    const batch = sorted.slice(i, i + PATH_BATCH);
    yield* iterateRows(`WHERE n.path IN (${batch.map(() => '?').join(', ')})`, batch);
  }
}
