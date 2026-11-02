/**
 * Small character-level helpers shared by normalize.ts and fold.ts.
 * All functions are pure.
 */

export const ASCII_RE = /^[\x00-\x7f]*$/;

/**
 * Characters that are replaced before anything else:
 * - U+00D0 / U+00F0 (Ð, ð), commonly typed instead of Đ / đ;
 * - U+00A0, U+2007, U+202F: non-breaking spaces.
 */
export const ODD_CHARS_RE = /[   Ðð]/g;

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

/** Replace look-alike and non-breaking characters. Case is preserved. */
export function cleanOddChars(text: string): string {
  return text.replace(ODD_CHARS_RE, replaceOddChar);
}
