import type Database from 'better-sqlite3';

type DB = InstanceType<typeof Database>;

/**
 * Index tables of language-pack views. Storage only persists text a pack already
 * produced; it never calls a pack. Without a stored layout none of these tables
 * exist and every function here is a no-op.
 */

interface LanguageViewText {
  title: string;
  aliases: string;
  content: string;
}

/** Projected text of one note, tagged with the layout it was computed for. */
export interface NoteLexical {
  layout: string;
  views: Record<string, LanguageViewText>;
  aliasKeys: Record<string, string[]>;
}

export interface LanguageLayout {
  views: Array<{ name: string; tokenizer: string }>;
  aliasViews: string[];
}

const LAYOUT_KEY = 'language_pack';
const VIEW_NAME = /^[a-z][a-z0-9_]{0,15}$/;

export function viewTables(view: string) {
  if (!VIEW_NAME.test(view)) throw new Error(`Invalid language view name: ${view}`);
  return {
    lex: `notes_lex_${view}`,
    fts: `notes_fts_lex_${view}`,
    vocab: `notes_fts_lex_${view}_vocab`,
    alias: `notes_alias_lex_${view}`,
  };
}

export function readLayoutRaw(db: DB): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(LAYOUT_KEY) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function parseLayout(raw: string): LanguageLayout {
  const parsed = JSON.parse(raw) as Partial<LanguageLayout>;
  return { views: parsed.views ?? [], aliasViews: parsed.aliasViews ?? [] };
}

/** Drop every language-view table and forget the stored layout. */
export function dropLanguageTables(db: DB): void {
  const names = (pattern: string, virtual: boolean) =>
    (
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ? ESCAPE '\\'
             AND (sql LIKE 'CREATE VIRTUAL TABLE%') = ?`,
        )
        .all(pattern, virtual ? 1 : 0) as Array<{ name: string }>
    ).map((row) => row.name);
  // Vocabulary tables read the FTS tables, and FTS tables own their shadow tables,
  // so drop in that order and only then the plain tables.
  for (const name of names('notes\\_fts\\_lex\\_%\\_vocab', true))
    db.exec(`DROP TABLE IF EXISTS "${name}"`);
  for (const name of names('notes\\_fts\\_lex\\_%', true))
    db.exec(`DROP TABLE IF EXISTS "${name}"`);
  for (const name of [
    ...names('notes\\_lex\\_%', false),
    ...names('notes\\_alias\\_lex\\_%', false),
  ])
    db.exec(`DROP TABLE IF EXISTS "${name}"`);
  db.prepare('DELETE FROM settings WHERE key = ?').run(LAYOUT_KEY);
}

function insertViewRows(db: DB, layout: LanguageLayout, noteId: number, lexical: NoteLexical) {
  for (const { name } of layout.views) {
    const tables = viewTables(name);
    const text = lexical.views[name] ?? { title: '', aliases: '', content: '' };
    // Explicit DELETE + INSERT: REPLACE would skip the delete trigger and leave the
    // external-content FTS index out of sync.
    db.prepare(`DELETE FROM ${tables.lex} WHERE note_id = ?`).run(noteId);
    db.prepare(
      `INSERT INTO ${tables.lex}(note_id, title, aliases, content) VALUES (?, ?, ?, ?)`,
    ).run(noteId, text.title, text.aliases, text.content);
  }
  for (const name of layout.aliasViews) {
    const tables = viewTables(name);
    db.prepare(`DELETE FROM ${tables.alias} WHERE note_id = ?`).run(noteId);
    const insert = db.prepare(`INSERT INTO ${tables.alias}(note_id, key) VALUES (?, ?)`);
    for (const key of new Set(lexical.aliasKeys[name] ?? [])) if (key) insert.run(noteId, key);
  }
}

/**
 * Persist a note's projected text inside the caller's note transaction. Throws when
 * the writer's pack layout differs from the index's, like a content-policy mismatch.
 */
export function writeNoteLexical(db: DB, noteId: number, lexical: NoteLexical | undefined): void {
  const raw = readLayoutRaw(db);
  if (raw === null) return;
  if (!lexical || lexical.layout !== raw)
    throw new Error(
      'Language pack mismatch. Existing index preserved; restart with the language pack the index was built with, or reindex to apply this configuration.',
    );
  insertViewRows(db, parseLayout(raw), noteId, lexical);
}

export interface LexicalSourceNote {
  id: number;
  title: string;
  aliases: string[];
  content: string;
}

/**
 * Replace all view tables with `layout` and fill them from the active notes. The
 * caller owns the transaction; `project` must be synchronous and may throw.
 */
export function rebuildLanguageTables(
  db: DB,
  layoutRaw: string | null,
  project: (note: LexicalSourceNote) => NoteLexical,
): number {
  dropLanguageTables(db);
  if (layoutRaw === null) return 0;
  const layout = parseLayout(layoutRaw);
  for (const { name } of layout.views) {
    const t = viewTables(name);
    db.exec(`CREATE TABLE ${t.lex} (
      note_id INTEGER PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
      title TEXT, aliases TEXT, content TEXT)`);
  }
  for (const name of layout.aliasViews) {
    const t = viewTables(name);
    db.exec(`CREATE TABLE ${t.alias} (
        note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        key TEXT NOT NULL);
      CREATE INDEX idx_${t.alias}_key ON ${t.alias}(key);
      CREATE INDEX idx_${t.alias}_note ON ${t.alias}(note_id);`);
  }
  const page = db.prepare(
    'SELECT id, title, aliases, content FROM notes WHERE id > ? ORDER BY id LIMIT 500',
  );
  let count = 0;
  for (let last = 0; ;) {
    const rows = page.all(last) as Array<{
      id: number;
      title: string | null;
      aliases: string | null;
      content: string | null;
    }>;
    if (rows.length === 0) break;
    for (const row of rows) {
      let aliases: string[] = [];
      try {
        const parsed = JSON.parse(row.aliases ?? '[]') as unknown;
        if (Array.isArray(parsed))
          aliases = parsed.filter((a): a is string => typeof a === 'string');
      } catch {
        aliases = [];
      }
      const lexical = project({
        id: row.id,
        title: row.title ?? '',
        aliases,
        content: row.content ?? '',
      });
      insertViewRows(db, layout, row.id, lexical);
      count++;
    }
    last = rows[rows.length - 1]!.id;
  }
  for (const { name, tokenizer } of layout.views) {
    const t = viewTables(name);
    db.exec(`CREATE VIRTUAL TABLE ${t.fts} USING fts5(
        title, aliases, content,
        content='${t.lex}', content_rowid='note_id',
        tokenize = '${tokenizer.replaceAll("'", "''")}');
      CREATE TRIGGER ${t.lex}_ai AFTER INSERT ON ${t.lex} BEGIN
        INSERT INTO ${t.fts}(rowid, title, aliases, content)
          VALUES (new.note_id, new.title, new.aliases, new.content);
      END;
      CREATE TRIGGER ${t.lex}_ad AFTER DELETE ON ${t.lex} BEGIN
        INSERT INTO ${t.fts}(${t.fts}, rowid, title, aliases, content)
          VALUES ('delete', old.note_id, old.title, old.aliases, old.content);
      END;
      CREATE TRIGGER ${t.lex}_au AFTER UPDATE ON ${t.lex} BEGIN
        INSERT INTO ${t.fts}(${t.fts}, rowid, title, aliases, content)
          VALUES ('delete', old.note_id, old.title, old.aliases, old.content);
        INSERT INTO ${t.fts}(rowid, title, aliases, content)
          VALUES (new.note_id, new.title, new.aliases, new.content);
      END;
      INSERT INTO ${t.fts}(${t.fts}) VALUES ('rebuild');
      CREATE VIRTUAL TABLE ${t.vocab} USING fts5vocab(${t.fts}, 'row');`);
  }
  db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(
    LAYOUT_KEY,
    layoutRaw,
  );
  return count;
}
