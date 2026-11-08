/**
 * Token arithmetic for mapping matches in a projected view back to original text.
 *
 * FTS5's unicode61 tokenizer is emulated in JS: a token is a run of letters,
 * numbers, combining marks and private-use characters plus any `tokenchars`.
 * Original text is tokenized with the view's rules minus `_` and the continuation
 * mark; a view token that contains `_` stands for as many original tokens as it has
 * non-empty parts, and one that starts with the continuation mark stands for none
 * (it belongs to the original token before it).
 */
import { VIEW_CONTINUATION } from './types.js';

export interface TokenSpan {
  start: number;
  end: number;
}

export interface TokenizerRules {
  ascii: boolean;
  tokenChars: ReadonlySet<string>;
  separators: ReadonlySet<string>;
}

const UNICODE_TOKEN_CHAR = /[\p{L}\p{N}\p{M}\p{Co}]/u;
const ASCII_TOKEN_CHAR = /[A-Za-z0-9]/;

function tokenizerArgs(spec: string): string[] {
  const args: string[] = [];
  for (const match of spec.matchAll(/'((?:[^']|'')*)'|"((?:[^"]|"")*)"|(\S+)/g)) {
    args.push(match[1]?.replaceAll("''", "'") ?? match[2]?.replaceAll('""', '"') ?? match[3]!);
  }
  return args;
}

/** Boundary rules of an FTS5 tokenizer spec, or null when they cannot be emulated. */
export function parseTokenizerRules(spec: string): TokenizerRules | null {
  let args = tokenizerArgs(spec);
  if (args[0] === 'porter') args = args.slice(1);
  if (args.length === 0) args = ['unicode61'];
  const [name, ...options] = args;
  if (name !== 'unicode61' && name !== 'ascii') return null;
  let tokenChars = '';
  let separators = '';
  for (let i = 0; i + 1 < options.length; i += 2) {
    const key = options[i];
    const value = options[i + 1]!;
    if (key === 'tokenchars') tokenChars += value;
    else if (key === 'separators') separators += value;
    else if (key === 'categories') return null;
  }
  return {
    ascii: name === 'ascii',
    tokenChars: new Set(Array.from(tokenChars)),
    separators: new Set(Array.from(separators)),
  };
}

function isTokenChar(char: string, rules: TokenizerRules): boolean {
  if (rules.separators.has(char)) return false;
  if (rules.tokenChars.has(char)) return true;
  if (rules.ascii) return char.codePointAt(0)! >= 0x80 || ASCII_TOKEN_CHAR.test(char);
  return UNICODE_TOKEN_CHAR.test(char);
}

export function tokenize(text: string, rules: TokenizerRules): TokenSpan[] {
  const tokens: TokenSpan[] = [];
  let start = -1;
  let index = 0;
  for (const char of text) {
    if (isTokenChar(char, rules)) {
      if (start < 0) start = index;
    } else if (start >= 0) {
      tokens.push({ start, end: index });
      start = -1;
    }
    index += char.length;
  }
  if (start >= 0) tokens.push({ start, end: index });
  return tokens;
}

/** Rules for original text: the view's rules without `_`, the join character. */
function sourceRules(rules: TokenizerRules): TokenizerRules {
  const tokenChars = new Set(rules.tokenChars);
  tokenChars.delete('_');
  tokenChars.delete(VIEW_CONTINUATION);
  return { ...rules, tokenChars };
}

function viewTokenWeight(token: string): number {
  if (token.startsWith(VIEW_CONTINUATION)) return 0;
  if (!token.includes('_')) return 1;
  return token.split('_').filter(Boolean).length;
}

/**
 * Map tokens highlighted in a projected view (between `markStart` and `markEnd`)
 * to original token indexes. Returns null when the projection broke the token
 * invariant, i.e. the weighted view token count differs from the original count.
 */
export function mapHighlightedTokens(
  original: string,
  highlighted: string,
  rules: TokenizerRules,
  markStart: string,
  markEnd: string,
): { tokens: TokenSpan[]; matched: Set<number> } | null {
  const tokens = tokenize(original, sourceRules(rules));
  const matched = new Set<number>();
  let position = 0;
  let inside = false;
  let cursor = 0;
  for (const token of tokenize(highlighted, rules)) {
    for (; cursor < token.start; cursor++) {
      const char = highlighted[cursor];
      if (char === markStart) inside = true;
      else if (char === markEnd) inside = false;
    }
    cursor = token.end;
    const weight = viewTokenWeight(highlighted.slice(token.start, token.end));
    if (inside) {
      for (let k = 0; k < weight; k++) matched.add(position + k);
      if (weight === 0 && position > 0) matched.add(position - 1);
    }
    position += weight;
  }
  if (position !== tokens.length) return null;
  return { tokens, matched };
}

/**
 * Cut a snippet of `windowSize` original tokens around the densest group of
 * matches, marking each matched token, with FTS5-style ellipses.
 */
export function buildMarkedSnippet(
  original: string,
  tokens: readonly TokenSpan[],
  matched: ReadonlySet<number>,
  windowSize: number,
  markStart: string,
  markEnd: string,
): string {
  if (tokens.length === 0 || matched.size === 0) return '';
  const hits = [...matched].sort((a, b) => a - b);
  let best = { first: hits[0]!, last: hits[0]!, count: 0 };
  for (let i = 0, j = 0; i < hits.length; i++) {
    while (hits[i]! - hits[j]! >= windowSize) j++;
    // j trails i: hits[j..i] fit in one window.
    if (i - j + 1 > best.count) best = { first: hits[j]!, last: hits[i]!, count: i - j + 1 };
  }
  const spare = windowSize - (best.last - best.first + 1);
  let start = Math.max(0, best.first - Math.floor(spare / 2));
  start = Math.max(0, Math.min(start, tokens.length - windowSize));
  const end = Math.min(tokens.length, start + windowSize);
  let text = start === 0 ? '' : '...';
  let offset = start === 0 ? 0 : tokens[start]!.start;
  for (let i = start; i < end; i++) {
    const token = tokens[i]!;
    text += original.slice(offset, token.start);
    const word = original.slice(token.start, token.end);
    text += matched.has(i) ? `${markStart}${word}${markEnd}` : word;
    offset = token.end;
  }
  text += end === tokens.length ? original.slice(offset) : '...';
  return text;
}

/** Original words of the matched tokens, unique, in order of appearance. */
export function matchedWords(
  original: string,
  tokens: readonly TokenSpan[],
  matched: ReadonlySet<number>,
): string[] {
  const words: string[] = [];
  for (const index of [...matched].sort((a, b) => a - b)) {
    const token = tokens[index];
    if (!token) continue;
    const word = original.slice(token.start, token.end);
    if (!words.includes(word)) words.push(word);
  }
  return words;
}
