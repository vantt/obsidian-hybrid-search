import type { FilterPredicate } from '../contracts/filter-predicate.js';
import { bumpDbVersion, getDb, withIndexMutation } from './db.js';
import type { IndexLease } from './index-ownership.js';
import {
  parseLayout,
  readLayoutRaw,
  rebuildLanguageTables,
  viewTables,
  type LexicalSourceNote,
  type NoteLexical,
} from './language-tables.js';

export type { NoteLexical } from './language-tables.js';

/** The layout the view tables were built for, or null when no pack is indexed. */
export function readLanguageLayout(): string | null {
  return readLayoutRaw(getDb());
}

/**
 * Rebuild only the language views from the active notes in one transaction:
 * no vault scan and no embedding. A throwing projector leaves the previous
 * tables untouched.
 */
export function replaceLanguageViews(
  lease: IndexLease,
  layout: string | null,
  project: (note: LexicalSourceNote) => NoteLexical,
): number {
  return withIndexMutation(lease, () => {
    const db = getDb();
    if (layout === null && readLayoutRaw(db) === null) return 0;
    const rebuild = db.transaction(() => {
      const count = rebuildLanguageTables(db, layout, project);
      bumpDbVersion();
      return count;
    });
    return rebuild.immediate();
  });
}

function filterClause(predicate: FilterPredicate | undefined) {
  if (predicate === undefined || predicate.isEmpty) return { clause: '', params: [] };
  return { clause: ` AND ${predicate.sql}`, params: predicate.params };
}

export interface ViewMatchRow {
  path: string;
  title: string;
  tags: string;
  aliases: string | null;
  content: string;
  rank: number;
  hl_title: string;
  hl_content: string;
}

/** BM25 over one view, with full-column highlights for mapping matches back. */
export function readViewMatches(
  view: string,
  ftsQuery: string,
  limit: number,
  markStart: string,
  markEnd: string,
  predicate?: FilterPredicate,
): ViewMatchRow[] {
  const { fts } = viewTables(view);
  const filter = filterClause(predicate);
  return getDb()
    .prepare(
      `SELECT n.path, n.title, n.tags, n.aliases, n.content,
              bm25(${fts}, 10.0, 5.0, 1.0) AS rank,
              highlight(${fts}, 0, ?, ?) AS hl_title,
              highlight(${fts}, 2, ?, ?) AS hl_content
       FROM ${fts}
       JOIN notes n ON n.id = ${fts}.rowid
       WHERE ${fts} MATCH ?${filter.clause}
       ORDER BY rank
       LIMIT ?`,
    )
    .all(
      markStart,
      markEnd,
      markStart,
      markEnd,
      ftsQuery,
      ...filter.params,
      limit,
    ) as ViewMatchRow[];
}

export function findViewAliasRows(
  view: string,
  key: string,
  limit: number,
  predicate?: FilterPredicate,
) {
  const { alias } = viewTables(view);
  const filter = filterClause(predicate);
  return getDb()
    .prepare(
      `SELECT DISTINCT n.path, n.title, n.tags, n.aliases
       FROM ${alias} a
       JOIN notes n ON n.id = a.note_id
       WHERE a.key = ?${filter.clause}
       LIMIT ?`,
    )
    .all(key, ...filter.params, limit) as Array<{
    path: string;
    title: string;
    tags: string;
    aliases: string | null;
  }>;
}

function layoutHasView(view: string): boolean {
  const raw = readLayoutRaw(getDb());
  return raw !== null && parseLayout(raw).views.some((v) => v.name === view);
}

export function readViewTermStats(view: string, term: string): { docs: number; hits: number } {
  if (!layoutHasView(view)) return { docs: 0, hits: 0 };
  const row = getDb()
    .prepare(`SELECT doc, cnt FROM ${viewTables(view).vocab} WHERE term = ?`)
    .get(term) as { doc: number; cnt: number } | undefined;
  return { docs: row?.doc ?? 0, hits: row?.cnt ?? 0 };
}

export function readViewTermsWithPrefix(
  view: string,
  prefix: string,
  limit: number,
): Array<{ term: string; docs: number }> {
  if (!layoutHasView(view) || limit <= 0) return [];
  return (
    getDb()
      .prepare(
        `SELECT term, doc AS docs FROM ${viewTables(view).vocab}
       WHERE term >= ? AND term <= ? AND substr(term, 1, ?) = ?
       ORDER BY doc DESC, term ASC LIMIT ?`,
      )
      // Both bounds let fts5vocab scan only the prefix range. U+10FFFF has the
      // largest UTF-8 encoding, so every term with this prefix sorts below the bound.
      .all(prefix, `${prefix}\u{10FFFF}`, prefix.length, prefix, limit) as Array<{
      term: string;
      docs: number;
    }>
  );
}

export function countViewPhraseDocs(view: string, phrase: string): number {
  if (!layoutHasView(view)) return 0;
  const quoted = `"${phrase.replaceAll('"', '""')}"`;
  try {
    const row = getDb()
      .prepare(
        `SELECT count(*) AS n FROM ${viewTables(view).fts} WHERE ${viewTables(view).fts} MATCH ?`,
      )
      .get(quoted) as { n: number };
    return row.n;
  } catch {
    return 0;
  }
}

export function countNotes(): number {
  return (getDb().prepare('SELECT count(*) AS n FROM notes').get() as { n: number }).n;
}
