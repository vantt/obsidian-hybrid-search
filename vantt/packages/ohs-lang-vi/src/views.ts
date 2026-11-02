import { fold } from './fold.js';
import { normalize } from './normalize.js';
import type { PackOptions } from './options.js';

/** Field of a note the core projects (mirrors `LanguagePackField` of P01). */
export type Field = 'title' | 'aliases' | 'content';

export type ViewName = 'norm' | 'fold';

/**
 * FTS5 tokenizer of every view: the P01 default. Diacritics are kept (the norm
 * view needs them; the fold view has none left), `+` and `#` stay token
 * characters like in the upstream BM25 table (c++, c#).
 */
export const VIEW_TOKENIZER = "unicode61 remove_diacritics 0 tokenchars '+#'";

/**
 * Token characters of `VIEW_TOKENIZER`, as seen from JavaScript: letters,
 * numbers, private-use characters, combining marks, plus the tokenchars.
 */
export const TOKEN_RE = /[\p{L}\p{N}\p{Co}\p{M}+#]+/gu;

/** Split text the way the view tokenizer does (case kept). */
export function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

const WHOLE_TOKEN_RE = /^[\p{L}\p{N}\p{Co}\p{M}+#]+$/u;
const ASCII_TOKEN_RE = /^[\x00-\x7f]+$/;

function projectToken(view: string, token: string, options: PackOptions): string {
  if (ASCII_TOKEN_RE.test(token)) return token.toLowerCase();
  const normalized = normalize(token, { tonePlacement: options.tonePlacement });
  const out = view === 'norm' ? normalized : fold(normalized, { foldIY: options.foldIY });
  // A token made only of combining marks folds to nothing; keep one token.
  return WHOLE_TOKEN_RE.test(out) ? out : token;
}

/**
 * The two lexical views:
 * - `norm`: accent-preserving normalization (NFC, lowercase, one tone-mark
 *   position). Matches what the user typed with diacritics, exactly.
 * - `fold`: normalized then folded (no diacritics, đ -> d, optional i/y merge).
 *   Matches unaccented and partially accented queries.
 *
 * Projection is done token by token and separators are copied unchanged, so
 * the P01 token invariant holds by construction: Unicode normalization of a
 * separator can never create a token (NFC splits a few symbols into a base
 * and a combining mark, which the tokenizer counts as a token character), and
 * folding can never delete one. Pure and deterministic.
 */
export function projectView(view: string, text: string, options: PackOptions): string {
  return createProjector(options)(view, text);
}

const TOKEN_CACHE_MAX = 65_536;

const unknownView = (view: string) => new Error(`ohs-lang-vi: unknown view "${view}"`);

/** Per-token projection to `norm` or `fold`, with a per-view token cache. */
export function createTokenProjector(options: PackOptions): (view: string, token: string) => string {
  const caches: Record<string, Map<string, string>> = { norm: new Map(), fold: new Map() };
  return (view, token) => {
    const cache = caches[view];
    if (!cache) throw unknownView(view);
    if (ASCII_TOKEN_RE.test(token)) return token.toLowerCase();
    let out = cache.get(token);
    if (out === undefined) {
      out = projectToken(view, token, options);
      if (cache.size >= TOKEN_CACHE_MAX) cache.clear();
      cache.set(token, out);
    }
    return out;
  };
}

/** `projectView` bound to one options object, with a per-view token cache. */
export function createProjector(options: PackOptions): (view: string, text: string) => string {
  const projectOne = createTokenProjector(options);
  return (view, text) => {
    if (view !== 'norm' && view !== 'fold') throw unknownView(view);
    return text.replace(TOKEN_RE, (token) => projectOne(view, token));
  };
}

/** Fold one already-normalized token the way the fold view does. */
export function foldToken(token: string, options: PackOptions): string {
  return fold(token, { foldIY: options.foldIY });
}
