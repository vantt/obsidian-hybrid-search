import { disableLanguagePack, getLanguagePack, loadLanguagePack } from '../language/loader.js';
import type { LoadedLanguagePack } from '../language/types.js';
import {
  readLanguageLayout,
  replaceLanguageViews,
  type NoteLexical,
} from '../storage/language-queries.js';
import type { IndexRunContext } from './index-owner.js';
import { retryIndexWrite } from './index-write.js';

/** A failure inside the pack's own code, as opposed to storage or lease errors. */
class LanguagePackProjectionError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'LanguagePackProjectionError';
  }
}

interface LexicalNote {
  title: string;
  aliases?: readonly string[];
  content: string;
}

function project(loaded: LoadedLanguagePack, view: string, field: string, text: string): string {
  const value = loaded.pack.project(view, field as 'title' | 'aliases' | 'content', text);
  if (typeof value !== 'string') throw new Error(`project(${view}, ${field}) returned no string`);
  return value;
}

/** Project one note into every view. Throws LanguagePackProjectionError. */
function projectNote(loaded: LoadedLanguagePack, note: LexicalNote): NoteLexical {
  try {
    const aliases = (note.aliases ?? []).filter((alias) => typeof alias === 'string');
    const views: NoteLexical['views'] = {};
    for (const { name } of loaded.views) {
      views[name] = {
        title: project(loaded, name, 'title', note.title),
        aliases: project(loaded, name, 'aliases', aliases.join('\n')),
        content: project(loaded, name, 'content', note.content),
      };
    }
    const aliasKeys: NoteLexical['aliasKeys'] = {};
    for (const name of loaded.aliasViews) {
      aliasKeys[name] = [
        ...aliases.map((alias) => project(loaded, name, 'aliases', alias)),
        project(loaded, name, 'title', note.title),
      ].filter(Boolean);
    }
    return { layout: loaded.layout, views, aliasKeys };
  } catch (error) {
    throw new LanguagePackProjectionError(error);
  }
}

function isPackFailure(error: unknown): boolean {
  if (error instanceof LanguagePackProjectionError) return true;
  // An unusable tokenizer is the pack's fault too; SQLite reports it at CREATE time.
  const text = error instanceof Error ? error.message : '';
  return /tokenize|tokenizer/i.test(text);
}

async function dropViews(run: IndexRunContext): Promise<void> {
  await retryIndexWrite(run, () =>
    replaceLanguageViews(run.lease, null, () => {
      throw new Error('No views to project');
    }),
  );
}

/**
 * View text for a note about to be committed, or undefined when the index has no
 * views for the loaded pack. A pack that fails here is disabled and its views are
 * dropped, so indexing continues exactly as without a pack.
 */
export async function lexicalForNote(
  run: IndexRunContext,
  note: LexicalNote,
): Promise<NoteLexical | undefined> {
  const loaded = getLanguagePack();
  if (!loaded || readLanguageLayout() !== loaded.layout) return undefined;
  try {
    return projectNote(loaded, note);
  } catch (error) {
    disableLanguagePack(error);
    await dropViews(run);
    return undefined;
  }
}

/** True when the view tables do not match the loaded pack (or its absence). */
export function languageViewsOutOfDate(): boolean {
  return readLanguageLayout() !== (getLanguagePack()?.layout ?? null);
}

/**
 * Make the view tables match the configured pack: build, rebuild or drop them from
 * the active notes. Embeddings and chunks are never touched. Only an owner allowed
 * to change index configuration may transition; others report the mismatch.
 */
export async function syncLanguageViews(
  run: IndexRunContext,
  allowTransition: boolean,
): Promise<void> {
  const loaded = await loadLanguagePack();
  const desired = loaded?.layout ?? null;
  if (readLanguageLayout() === desired) return;
  if (!allowTransition)
    throw new Error(
      'Language pack changed in another process. Search remains available; restart with matching settings or reindex to apply this configuration.',
    );
  try {
    await retryIndexWrite(run, () =>
      replaceLanguageViews(run.lease, desired, (note) => projectNote(loaded!, note)),
    );
  } catch (error) {
    if (!loaded || !isPackFailure(error)) throw error;
    disableLanguagePack(error instanceof Error && error.cause ? error.cause : error);
    await dropViews(run);
  }
}
