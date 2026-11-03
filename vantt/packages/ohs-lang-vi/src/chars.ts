/**
 * Small character-level helpers shared by normalize.ts and fold.ts.
 * All functions are pure.
 */

// eslint-disable-next-line no-control-regex -- ASCII range check; \x00 is its intended lower bound
export const ASCII_RE = /^[\x00-\x7f]*$/;

/**
 * Characters that are replaced before anything else:
 * - U+00D0 / U+00F0 (Ð, ð), commonly typed instead of Đ / đ;
 * - U+00A0, U+2007, U+202F: non-breaking spaces.
 */
export const ODD_CHARS_RE = /[\u00a0\u2007\u202fÐð]/g;

export function replaceOddChar(ch: string): string {
  switch (ch) {
    case 'Ð':
      return 'Đ';
    case 'ð':
      return 'đ';
    default:
      return ' ';
  }
}

/** Default `Array#sort` order (UTF-16 code units), spelled out where a digest or listing depends on it. */
export const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Replace look-alike and non-breaking characters. Case is preserved. */
export function cleanOddChars(text: string): string {
  return text.replace(ODD_CHARS_RE, replaceOddChar);
}
