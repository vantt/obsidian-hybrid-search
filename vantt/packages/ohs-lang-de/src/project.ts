import { foldWord, transliterateWord } from './fold.js';
import type { Splitter } from './compound.js';

/** WORD JOINER: marks a view token that belongs to the source token before it. */
export const CONTINUATION = '⁠';

/** Same token boundaries as the view tokenizer: letters, numbers, marks, private use, `+` and `#`. */
const TOKEN = /[\p{L}\p{N}\p{M}\p{Co}+#]+/gu;

export const VIEW_TOKENIZER = `unicode61 remove_diacritics 0 tokenchars '+#${CONTINUATION}'`;

/** View tokens of one source word: folded key first, extra spellings and components after. */
export function wordTokens(word: string, splitter: Splitter | null): string[] {
  // A token made only of combining marks folds to nothing; keep it so the count holds.
  const tokens = [foldWord(word) || word.normalize('NFC').toLowerCase()];
  const add = (token: string): void => {
    const marked = CONTINUATION + token;
    if (!tokens.includes(marked) && token !== tokens[0]) tokens.push(marked);
  };
  add(transliterateWord(word));
  for (const part of splitter?.split(word) ?? []) {
    add(part.fold);
    add(part.trans);
  }
  return tokens;
}

/**
 * Projection of a text: each source token becomes its view tokens, joined by single
 * spaces. Everything between tokens becomes a space, so the token count of the
 * original text is preserved (extra tokens are continuations).
 */
export function projectText(text: string, splitter: Splitter | null): string {
  const clean = text.replaceAll(CONTINUATION, ' ');
  const out: string[] = [];
  for (const match of clean.matchAll(TOKEN)) out.push(...wordTokens(match[0], splitter));
  return out.join(' ');
}

export function sourceWords(text: string): string[] {
  return Array.from(text.replaceAll(CONTINUATION, ' ').matchAll(TOKEN), (m) => m[0]);
}
