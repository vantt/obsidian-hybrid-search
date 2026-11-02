/** Folding of German letters. Pure functions on single words. */

const ESZETT = /[ßẞ]/g;

/** Lower-case NFC word with the eszett expanded; other letters untouched. */
function base(word: string): string {
  return word.normalize('NFC').toLowerCase().replace(ESZETT, 'ss');
}

function stripMarks(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

/**
 * Canonical key: `ä ö ü` lose the umlaut (`ä` becomes `a`), `ß` becomes `ss`, any other
 * diacritic is dropped. "Käse", "Kase" and "kase" share the key `kase`.
 */
export function foldWord(word: string): string {
  return stripMarks(base(word));
}

/**
 * Transliterated key: `ä ö ü` become `ae oe ue`. Differs from `foldWord` only for
 * words with an umlaut; "Käse" and "Kaese" share the key `kaese`.
 */
export function transliterateWord(word: string): string {
  return stripMarks(
    base(word).replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'),
  );
}
