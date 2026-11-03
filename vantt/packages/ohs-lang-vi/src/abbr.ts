/**
 * Abbreviation learning (`ohs-lang-vi learn-abbr`). Scans the Markdown of a
 * vault and proposes `ABBR = expansion` lines. Proposals go under the
 * `## Chờ duyệt` section of the lexicon; only lines the user moves to
 * `## Viết tắt` are ever used. Runs by hand, never at index time.
 *
 * Evidence, strongest first:
 *   1. definitions: `khách hàng (KH)`, `KH: khách hàng`, `KH = khách hàng`
 *   2. a frequent multi-syllable phrase whose initial letters spell an
 *      abbreviation that occurs in the vault (KH -> khách hàng)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fold } from './fold.js';
import {
  DEFAULT_LEXICON_PATH,
  HEADING_RE,
  headingKey,
  parseLexicon,
  SECTION_ABBREVIATIONS,
  SECTION_COMPOUNDS,
  SECTION_PENDING,
  SECTION_SYNONYMS,
} from './lexicon.js';
import { normalize } from './normalize.js';
import { isPossibleFoldedSyllable, isVietnameseSyllable } from './syllable.js';
import { tokenize } from './views.js';

export interface AbbrProposal {
  /** As written in the vault (`KH`, `TP.HCM`). */
  abbr: string;
  /** Expansion as written (definitions) or lowercase (frequent phrases). */
  expansion: string;
  source: 'definition' | 'frequent';
  /** Occurrences of the evidence in the vault. */
  count: number;
}

export interface LearnOptions {
  /** A frequent phrase needs at least this many occurrences (default 3). */
  minPhraseCount?: number;
  /** An abbreviation must occur at least this many times to be matched against phrases (default 2). */
  minAbbrCount?: number;
  /** Longest expansion, in words (default 6). */
  maxWords?: number;
}

const LETTER = '\\p{L}';
const WORD = `${LETTER}+`;
/** All-capital token, dots allowed inside (`KH`, `TMĐT`, `TP.HCM`). */
const ABBR = '\\p{Lu}[\\p{Lu}.]{1,9}';
const ABBR_TOKEN_RE = new RegExp(`(?<![\\p{L}\\p{N}.])(${ABBR})(?![\\p{L}\\p{N}])`, 'gu');
const DEFINED_AFTER_RE = new RegExp(
  `(?<![\\p{L}\\p{N}.])(${ABBR})(?<!\\.)\\s*[:=\\-–—]\\s*((?:${WORD}[ \\t]+){0,7}${WORD})`,
  'gu',
);
const DEFINED_BEFORE_RE = new RegExp(
  `((?:${WORD}[ \\t]+){1,7}${WORD})[ \\t]*\\([ \\t]*(${ABBR})(?<!\\.)[ \\t]*\\)`,
  'gu',
);

/** Letters of an abbreviation, folded and uppercase: `TP.HCM` -> `TPHCM`, `ĐKKD` -> `DKKD`. */
export function abbrLetters(abbr: string): string {
  return fold(abbr.replace(/\./g, '')).toUpperCase();
}

/** Initial letters of words, folded and uppercase. */
export function initials(words: readonly string[]): string {
  return words.map((w) => fold(w).charAt(0).toUpperCase()).join('');
}

function isSyllable(token: string): boolean {
  const word = normalize(token);
  return fold(word) !== word ? isVietnameseSyllable(word) : isPossibleFoldedSyllable(word);
}

const wordsOf = (text: string): string[] => text.match(new RegExp(WORD, 'gu')) ?? [];

/** Words of `candidate` (a run before `(`) whose initials spell `letters`: the longest matching suffix. */
function suffixWithInitials(candidate: readonly string[], letters: string): string[] | null {
  const n = letters.length;
  if (n < 2 || candidate.length < n) return null;
  const words = candidate.slice(candidate.length - n);
  return initials(words) === letters && words.every(isSyllable) ? [...words] : null;
}

function prefixWithInitials(candidate: readonly string[], letters: string): string[] | null {
  const n = letters.length;
  if (n < 2 || candidate.length < n) return null;
  const words = candidate.slice(0, n);
  return initials(words) === letters && words.every(isSyllable) ? [...words] : null;
}

/** Definition patterns in one text. */
export function findDefinitions(text: string): Array<{ abbr: string; expansion: string }> {
  const found: Array<{ abbr: string; expansion: string }> = [];
  for (const m of text.matchAll(DEFINED_BEFORE_RE)) {
    const abbr = m[2]!;
    const words = suffixWithInitials(wordsOf(m[1]!), abbrLetters(abbr));
    if (words) found.push({ abbr, expansion: words.join(' ') });
  }
  for (const m of text.matchAll(DEFINED_AFTER_RE)) {
    const abbr = m[1]!;
    const words = prefixWithInitials(wordsOf(m[2]!), abbrLetters(abbr));
    if (words) found.push({ abbr, expansion: words.join(' ') });
  }
  return found;
}

const SEGMENT_SPLIT_RE = /[.,;:!?()[\]{}"“”<>|\n\r]+/;

/** Keys that identify an abbreviation or a proposal, ignoring case, dots and diacritics. */
const abbrKey = (abbr: string): string => abbrLetters(abbr);
const pairKey = (abbr: string, expansion: string): string =>
  `${abbrKey(abbr)}=${fold(normalize(expansion))}`;

export interface KnownEntries {
  /** Abbreviations the user already decided on (the `## Viết tắt` section). */
  abbreviations: Set<string>;
  /** `abbr=expansion` pairs already proposed. */
  pending: Set<string>;
}

/** Entries of an existing lexicon: main abbreviations and pending proposals. */
export function knownEntries(lexiconText: string | null): KnownEntries {
  const known: KnownEntries = { abbreviations: new Set(), pending: new Set() };
  if (lexiconText === null) return known;
  for (const group of parseLexicon(lexiconText).abbreviations)
    known.abbreviations.add(abbrKey(group[0]!.join(' ')));
  let pending = false;
  for (const raw of lexiconText.split(/\r\n|\r|\n/)) {
    const heading = HEADING_RE.exec(raw);
    if (heading) {
      pending = headingKey(heading[1] ?? '') === headingKey(SECTION_PENDING);
      continue;
    }
    if (!pending) continue;
    const parts = raw.replace(/^\s*[-*+]\s+/, '').split('=');
    if (parts.length >= 2 && parts[0]!.trim())
      for (const p of parts.slice(1)) known.pending.add(pairKey(parts[0]!.trim(), p.trim()));
  }
  return known;
}

/** Propose abbreviations from the texts of a vault. */
export function learnAbbreviations(
  texts: Iterable<string>,
  known: KnownEntries,
  options: LearnOptions = {},
): AbbrProposal[] {
  const minPhrase = options.minPhraseCount ?? 3;
  const minAbbr = options.minAbbrCount ?? 2;
  const maxWords = options.maxWords ?? 6;
  const docs = [...texts];

  const proposals = new Map<string, AbbrProposal>();
  const skip = (abbr: string, expansion: string) =>
    known.abbreviations.has(abbrKey(abbr)) || known.pending.has(pairKey(abbr, expansion));

  // 1. definitions
  for (const text of docs) {
    for (const { abbr, expansion } of findDefinitions(text)) {
      if (skip(abbr, expansion)) continue;
      const key = pairKey(abbr, expansion);
      const have = proposals.get(key);
      if (have) have.count++;
      else proposals.set(key, { abbr, expansion, source: 'definition', count: 1 });
    }
  }

  // 2. frequent phrases matching an abbreviation seen in the vault
  const abbrCount = new Map<string, { abbr: string; count: number }>();
  for (const text of docs)
    for (const m of text.matchAll(ABBR_TOKEN_RE)) {
      const abbr = m[1]!.replace(/\.+$/, '');
      const letters = abbrLetters(abbr);
      if (letters.length < 2 || letters.length > maxWords) continue;
      const entry = abbrCount.get(letters) ?? { abbr, count: 0 };
      entry.count++;
      abbrCount.set(letters, entry);
    }
  const wanted = new Map([...abbrCount].filter(([, v]) => v.count >= minAbbr));
  const lengths = new Set([...wanted.keys()].map((l) => l.length));
  const phrases = new Map<string, Map<string, number>>();
  if (wanted.size > 0)
    for (const text of docs)
      for (const segment of text.split(SEGMENT_SPLIT_RE)) {
        const words = tokenize(normalize(segment));
        for (let i = 0; i < words.length; i++)
          for (const n of lengths) {
            if (i + n > words.length) continue;
            const run = words.slice(i, i + n);
            const letters = initials(run);
            if (!wanted.has(letters) || !run.every(isSyllable)) continue;
            const byPhrase = phrases.get(letters) ?? new Map<string, number>();
            const phrase = run.join(' ');
            byPhrase.set(phrase, (byPhrase.get(phrase) ?? 0) + 1);
            phrases.set(letters, byPhrase);
          }
      }
  for (const [letters, byPhrase] of phrases) {
    const ranked = [...byPhrase].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    const [phrase, count] = ranked[0]!;
    const second = ranked[1]?.[1] ?? 0;
    if (count < minPhrase || second * 2 > count) continue;
    const abbr = wanted.get(letters)!.abbr;
    if (skip(abbr, phrase)) continue;
    if ([...proposals.values()].some((p) => abbrKey(p.abbr) === letters)) continue;
    proposals.set(pairKey(abbr, phrase), { abbr, expansion: phrase, source: 'frequent', count });
  }

  return [...proposals.values()].sort(
    (a, b) =>
      (a.source === b.source ? 0 : a.source === 'definition' ? -1 : 1) ||
      a.abbr.localeCompare(b.abbr) ||
      a.expansion.localeCompare(b.expansion),
  );
}

const SKELETON = [
  '# Từ điển',
  '',
  `## ${SECTION_SYNONYMS}`,
  '',
  `## ${SECTION_ABBREVIATIONS}`,
  '',
  `## ${SECTION_COMPOUNDS}`,
  '',
  `## ${SECTION_PENDING}`,
  '',
].join('\n');

/**
 * Add proposal lines to the end of the `## Chờ duyệt` section (created when
 * missing; a whole skeleton when there is no file). Nothing outside that
 * section changes.
 */
export function addPending(lexiconText: string | null, proposals: readonly AbbrProposal[]): string {
  const text = lexiconText ?? SKELETON;
  if (proposals.length === 0) return text;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r\n|\r|\n/);
  const entries = proposals.map((p) => `${p.abbr} = ${p.expansion}`);
  const start = lines.findIndex((l) => {
    const h = HEADING_RE.exec(l);
    return h !== null && headingKey(h[1] ?? '') === headingKey(SECTION_PENDING);
  });
  if (start < 0) {
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    lines.push('', `## ${SECTION_PENDING}`, '', ...entries, '');
    return lines.join(eol);
  }
  let end = lines.findIndex((l, i) => i > start && HEADING_RE.test(l));
  if (end < 0) end = lines.length;
  let last = end;
  while (last > start + 1 && lines[last - 1]!.trim() === '') last--;
  const insert = last === start + 1 ? ['', ...entries] : entries;
  lines.splice(last, 0, ...insert);
  if (lines[lines.length - 1] !== '') lines.push('');
  return lines.join(eol);
}

const SKIP_DIRS = new Set(['node_modules']);

/** Markdown files of the vault, skipping hidden folders, `_ohs` and `node_modules`. */
export function listMarkdown(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '_ohs' || SKIP_DIRS.has(entry.name))
        continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

export interface LearnResult {
  lexiconFile: string;
  notes: number;
  proposals: AbbrProposal[];
  written: boolean;
}

/** Scan `vault` and (unless `dryRun`) write new proposals under `## Chờ duyệt`. */
export function learnFromVault(
  vault: string,
  options: LearnOptions & { lexiconPath?: string; dryRun?: boolean } = {},
): LearnResult {
  const lexiconFile = join(vault, options.lexiconPath ?? DEFAULT_LEXICON_PATH);
  const existing = existsSync(lexiconFile) ? readFileSync(lexiconFile, 'utf8') : null;
  const files = listMarkdown(vault);
  const proposals = learnAbbreviations(
    (function* () {
      for (const file of files) yield readFileSync(file, 'utf8');
    })(),
    knownEntries(existing),
    options,
  );
  let written = false;
  if (proposals.length > 0 && !options.dryRun) {
    mkdirSync(dirname(lexiconFile), { recursive: true });
    writeFileSync(lexiconFile, addPending(existing, proposals));
    written = true;
  }
  return { lexiconFile, notes: files.length, proposals, written };
}
