/**
 * Query token rewriting (V17): Telex/VNI keystrokes and one-letter typos.
 *
 * Both rules only touch a token the vault does not contain, and only when the
 * rewritten form IS in the vault, so English words that happen to look like
 * keystrokes ("team", "seen", "online") are left alone.
 */
import type { QueryContext } from './contract.js';
import type { QueryEnvironment, QueryState, QueryToken } from './query.js';
import { decodeKeystrokes } from './telex.js';
import { correctTypos, MIN_TYPO_LENGTH } from './typo.js';
import { foldToken, TOKEN_RE } from './views.js';

const PLAIN_TOKEN = /^[a-z0-9]+$/;
const LETTER_TOKEN = /^[a-z]+$/;

export interface RewriteInfo {
  /** Token indexes decoded from Telex/VNI. */
  telex: number[];
  /** Token indexes replaced by a typo correction. */
  typo: number[];
}

/** The query text with the tokens replaced by the current `norm` forms. */
export function rewrittenText(state: QueryState): string {
  let index = 0;
  return state.normalized.replace(TOKEN_RE, (token) => state.tokens[index++]?.norm ?? token);
}

export function rewriteTokens(
  state: QueryState,
  ctx: QueryContext,
  env: QueryEnvironment,
  makeToken: (norm: string) => QueryToken,
): void {
  const { options, cache } = env;
  if (!options.telex && !options.typo) return;
  cache.sync(ctx);
  const info: RewriteInfo = { telex: [], typo: [] };
  // A token is known when the vault contains it as typed (either view).
  const lexiconWords = env.lexicon?.knownWords((w) => foldToken(w, options), ctx.vaultPath);
  const known = (t: QueryToken) =>
    !PLAIN_TOKEN.test(t.norm) ||
    lexiconWords?.has(t.folded) === true ||
    cache.termDocs(ctx, 'fold', t.folded) > 0 ||
    cache.termDocs(ctx, 'norm', t.norm) > 0;
  const unknown = state.tokens.map((t) => !known(t));

  if (options.telex) {
    state.tokens.forEach((token, i) => {
      if (!unknown[i]) return;
      let best: { form: string; docs: number } | null = null;
      for (const form of decodeKeystrokes(token.norm, options.tonePlacement)) {
        const docs = cache.termDocs(ctx, 'norm', form);
        if (docs > 0 && (best === null || docs > best.docs)) best = { form, docs };
      }
      if (best === null) return;
      state.tokens[i] = makeToken(best.form);
      info.telex.push(i);
    });
  }

  if (options.typo) {
    const decoded = new Set(info.telex);
    const corrections = correctTypos(
      state.tokens.map((t, i) => ({
        folded: t.folded,
        unknown:
          unknown[i]! &&
          !decoded.has(i) &&
          !t.marked &&
          LETTER_TOKEN.test(t.norm) &&
          t.norm.length >= MIN_TYPO_LENGTH,
      })),
      ctx,
      cache,
    );
    for (const [i, candidates] of corrections) {
      state.tokens[i] = makeToken(candidates[0]!);
      info.typo.push(i);
    }
  }
  if (info.telex.length > 0 || info.typo.length > 0) state.rewrite = info;
}
