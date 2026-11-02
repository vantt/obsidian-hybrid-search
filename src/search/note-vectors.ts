import { normalizeNotePath } from '../content/text-normalization.js';
import { buildFilterPredicate } from '../contracts/filter-predicate.js';
import { getBacklinksForPaths, getOutgoingLinksForPaths } from '../storage/db.js';
import {
  countNotesWithVectors,
  findExistingNotePaths,
  getStoredVectorSource,
  iterateNoteChunkVectors,
  listNotePathsMatching,
  type NoteChunkVectors,
} from '../storage/note-vectors.js';

/**
 * Note-level vectors derived from the stored chunk embeddings, and nearest-note search
 * over them. Read-only: nothing is written and no embedding model is called. Transports
 * (CLI today, stdio later) only format what these functions return.
 */

export type Pooling = 'mean' | 'max';

interface VectorMeta {
  model: string | null;
  dim: number | null;
  pooling: Pooling;
  note_count: number;
  ohs_version: string;
}

/** A requested note that cannot be answered; reported per note, never as a made-up vector. */
interface NoteVectorError {
  path: string;
  error: string;
}

export interface NoteVector {
  path: string;
  dim: number;
  model: string;
  chunks: number;
  vector: number[];
}

interface NeighborScore {
  path: string;
  score: number;
}

export interface NoteNeighbors {
  path: string;
  neighbors: NeighborScore[];
}

export interface NoteVectorsOptions {
  /** Vault-relative paths; omitted means every note that has vectors. */
  paths?: string[];
  pooling?: Pooling;
  /** L2-normalise the pooled vector. Default true. */
  normalize?: boolean;
  ohsVersion: string;
}

export interface NeighborsOptions {
  paths?: string[];
  /** Neighbours per note. Default 10. */
  k?: number;
  /** Drop neighbours with cosine below this value. */
  minScore?: number;
  /** Drop notes linked to or from the source note. */
  excludeLinked?: boolean;
  /** Same prefix semantics as the search `scope` filter; limits the candidate notes. */
  scope?: string | string[];
  pooling?: Pooling;
  ohsVersion: string;
}

export interface VectorExport<T> {
  meta: VectorMeta;
  /** One entry per requested or indexed note, produced lazily. */
  records: Iterable<T | NoteVectorError>;
}

export class VectorExportError extends Error {
  override name = 'VectorExportError';
}

const DEFAULT_K = 10;
const SOURCE_BLOCK = 500;

function l2Normalize(vector: Float64Array): void {
  let sum = 0;
  for (const value of vector) sum += value * value;
  const norm = Math.sqrt(sum);
  if (norm === 0) return;
  for (let i = 0; i < vector.length; i++) vector[i]! /= norm;
}

/** Combine chunk embeddings of one note into a single vector. */
export function poolVectors(
  vectors: readonly Float32Array[],
  pooling: Pooling,
  normalize: boolean,
): Float64Array {
  const dim = vectors[0]?.length ?? 0;
  const pooled = new Float64Array(dim);
  if (pooling === 'max') pooled.fill(-Infinity);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i++) {
      pooled[i] = pooling === 'max' ? Math.max(pooled[i]!, vector[i]!) : pooled[i]! + vector[i]!;
    }
  }
  if (pooling === 'mean') for (let i = 0; i < dim; i++) pooled[i]! /= vectors.length;
  if (normalize) l2Normalize(pooled);
  return pooled;
}

interface Provenance {
  model: string | null;
  dim: number | null;
}

/** Refuse to export when vector provenance is unknown or the vectors disagree with it. */
function assertConsistent(note: NoteChunkVectors, source: Provenance): void {
  if (source.model === null) {
    throw new VectorExportError(
      'Embedding model is unknown for the stored vectors. Use full reindex --force to rebuild with a configured model.',
    );
  }
  for (const vector of note.vectors) {
    if (source.dim !== null && vector.length !== source.dim) {
      throw new VectorExportError(
        `Embedding dimension mismatch for ${note.path}: stored ${String(source.dim)}, vector ${String(vector.length)}.`,
      );
    }
  }
}

function normalizePaths(paths: string[] | undefined): string[] | undefined {
  return paths === undefined || paths.length === 0
    ? undefined
    : [...new Set(paths.map(normalizeNotePath))];
}

/** Explain why a requested path has no vector. */
function missingNoteError(path: string, existing: Set<string>): NoteVectorError {
  return {
    path,
    error: existing.has(path) ? 'note has no stored embeddings' : 'note not found in the index',
  };
}

function* noteVectorRecords(
  requested: string[] | undefined,
  pooling: Pooling,
  normalize: boolean,
  source: Provenance,
): Generator<NoteVector | NoteVectorError> {
  const seen = new Set<string>();
  for (const note of iterateNoteChunkVectors(requested)) {
    assertConsistent(note, source);
    seen.add(note.path);
    const vector = poolVectors(note.vectors, pooling, normalize);
    yield {
      path: note.path,
      dim: vector.length,
      model: source.model!,
      chunks: note.vectors.length,
      vector: Array.from(vector),
    };
  }
  if (requested) {
    const missing = requested.filter((path) => !seen.has(path));
    const existing = findExistingNotePaths(missing);
    for (const path of missing) yield missingNoteError(path, existing);
  }
}

/** Pooled vector per note: every note with vectors, or just the requested paths. */
export function exportNoteVectors(options: NoteVectorsOptions): VectorExport<NoteVector> {
  const pooling = options.pooling ?? 'mean';
  const requested = normalizePaths(options.paths);
  const source = getStoredVectorSource();
  const meta: VectorMeta = {
    model: source.model,
    dim: source.dim,
    pooling,
    note_count: requested ? requested.length : countNotesWithVectors(),
    ohs_version: options.ohsVersion,
  };
  return {
    meta,
    records: noteVectorRecords(requested, pooling, options.normalize ?? true, source),
  };
}

interface Matrix {
  paths: string[];
  dim: number;
  /** Row-major, unit-length rows. */
  data: Float32Array;
}

/** Unit-length pooled vectors of every note with vectors, in one flat buffer. */
function loadMatrix(pooling: Pooling, source: Provenance): Matrix {
  const paths: string[] = [];
  const rows: Float32Array[] = [];
  let dim = 0;
  for (const note of iterateNoteChunkVectors()) {
    assertConsistent(note, source);
    const pooled = poolVectors(note.vectors, pooling, true);
    if (dim === 0) dim = pooled.length;
    else if (pooled.length !== dim) {
      throw new VectorExportError(
        `Embedding dimension mismatch for ${note.path}: expected ${String(dim)}, vector ${String(pooled.length)}.`,
      );
    }
    paths.push(note.path);
    rows.push(Float32Array.from(pooled));
  }
  const data = new Float32Array(rows.length * dim);
  rows.forEach((row, index) => data.set(row, index * dim));
  return { paths, dim, data };
}

function dot(data: Float32Array, a: number, b: number, dim: number): number {
  let sum = 0;
  for (let i = 0, x = a * dim, y = b * dim; i < dim; i++) sum += data[x + i]! * data[y + i]!;
  return sum;
}

/** Insert into a descending top-k list kept sorted; ties keep the earlier path first. */
function pushTop(top: NeighborScore[], item: NeighborScore, k: number): void {
  if (top.length === k && item.score <= top[k - 1]!.score) return;
  let at = top.length;
  while (at > 0 && top[at - 1]!.score < item.score) at--;
  top.splice(at, 0, item);
  if (top.length > k) top.pop();
}

function linkedPaths(paths: string[]): Map<string, Set<string>> {
  const outgoing = getOutgoingLinksForPaths(paths);
  const incoming = getBacklinksForPaths(paths);
  const linked = new Map<string, Set<string>>();
  for (const path of paths) {
    linked.set(path, new Set([...(outgoing.get(path) ?? []), ...(incoming.get(path) ?? [])]));
  }
  return linked;
}

function* neighborRecords(
  matrix: Matrix,
  requested: string[] | undefined,
  options: NeighborsOptions,
): Generator<NoteNeighbors | NoteVectorError> {
  const k = options.k ?? DEFAULT_K;
  const minScore = options.minScore ?? -Infinity;
  const index = new Map(matrix.paths.map((path, i) => [path, i]));

  const scope = buildFilterPredicate({ scope: options.scope });
  const allowed = scope.isEmpty ? undefined : listNotePathsMatching(scope);
  const candidates: number[] = [];
  matrix.paths.forEach((path, i) => {
    if (!allowed || allowed.has(path)) candidates.push(i);
  });

  const sources = requested ?? matrix.paths;
  for (let start = 0; start < sources.length; start += SOURCE_BLOCK) {
    const block = sources.slice(start, start + SOURCE_BLOCK);
    const linked = options.excludeLinked ? linkedPaths(block) : undefined;
    const unknown = requested
      ? findExistingNotePaths(block.filter((path) => !index.has(path)))
      : new Set<string>();
    for (const path of block) {
      const self = index.get(path);
      if (self === undefined) {
        yield missingNoteError(path, unknown);
        continue;
      }
      const skip = linked?.get(path);
      const top: NeighborScore[] = [];
      for (const other of candidates) {
        if (other === self) continue;
        const score = dot(matrix.data, self, other, matrix.dim);
        if (score < minScore) continue;
        const otherPath = matrix.paths[other]!;
        if (skip?.has(otherPath)) continue;
        pushTop(top, { path: otherPath, score }, k);
      }
      yield { path, neighbors: top };
    }
  }
}

/**
 * The K most similar notes per note, by cosine over pooled note vectors. Without
 * `paths`, every note with vectors is a source. `scope` limits the candidates only.
 */
export function findNoteNeighbors(options: NeighborsOptions): VectorExport<NoteNeighbors> {
  const pooling = options.pooling ?? 'mean';
  const requested = normalizePaths(options.paths);
  const source = getStoredVectorSource();
  const matrix = loadMatrix(pooling, source);
  return {
    meta: {
      model: source.model,
      dim: source.dim,
      pooling,
      note_count: requested ? requested.length : matrix.paths.length,
      ohs_version: options.ohsVersion,
    },
    records: neighborRecords(matrix, requested, options),
  };
}
