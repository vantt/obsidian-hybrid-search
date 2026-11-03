/**
 * User lexicon: synonyms, abbreviations and compound words declared in one
 * Markdown file of the vault (default `_ohs/lexicon.md`, PRD Q8).
 *
 *   ## Đồng nghĩa      one group per line, forms joined by " = " (symmetric)
 *   ## Viết tắt        `KH = khách hàng`: abbreviation first, expansions after (one way)
 *   ## Từ ghép         one compound word per line (consumed by the segmenter)
 *   ## Chờ duyệt       proposals of `learn-abbr`; never used
 *
 * Synonyms and abbreviations only widen the query, so they belong to
 * `queryCacheKey()`. Compound words change what `project()` emits, so they
 * belong to `signature()`.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { fold } from './fold.js';
import { normalize } from './normalize.js';
import type { PackOptions } from './options.js';
import { tokenize } from './views.js';

export const DEFAULT_LEXICON_PATH = '_ohs/lexicon.md';

export const SECTION_SYNONYMS = 'Đồng nghĩa';
export const SECTION_ABBREVIATIONS = 'Viết tắt';
export const SECTION_COMPOUNDS = 'Từ ghép';
export const SECTION_PENDING = 'Chờ duyệt';

type SectionKind = 'synonyms' | 'abbreviations' | 'compounds';

/** A form of a group: its normalized words. */
export type Form = readonly string[];

export interface Lexicon {
  /** Groups of equivalent forms. */
  synonyms: Form[][];
  /** `[abbreviation, ...expansions]`; the abbreviation expands, not the reverse. */
  abbreviations: Form[][];
  /** Compound words (normalized words, at least two), for the segmenter. */
  compounds: Form[];
}

export const EMPTY_LEXICON: Lexicon = { synonyms: [], abbreviations: [], compounds: [] };

/** Headings are compared without case and diacritics. */
export function headingKey(text: string): string {
  return fold(normalize(text)).replace(/\s+/g, ' ').trim();
}

const SECTION_KINDS: ReadonlyMap<string, SectionKind> = new Map([
  [headingKey(SECTION_SYNONYMS), 'synonyms'],
  [headingKey(SECTION_ABBREVIATIONS), 'abbreviations'],
  [headingKey(SECTION_COMPOUNDS), 'compounds'],
]);

/** The section a heading opens, or null for any other heading (`Chờ duyệt` included). */
export function sectionKind(heading: string): SectionKind | null {
  return SECTION_KINDS.get(headingKey(heading)) ?? null;
}

/** `## Heading` (level 2) line. */
export const HEADING_RE = /^\s{0,3}##\s+(.*?)\s*#*\s*$/;
const BULLET_RE = /^\s*[-*+]\s+/;

function toForm(text: string): Form {
  return tokenize(normalize(text));
}

function sameForm(a: Form, b: Form): boolean {
  return a.length === b.length && a.every((w, i) => w === b[i]);
}

/** Parse the lexicon text; anything outside the three sections is ignored. */
export function parseLexicon(text: string): Lexicon {
  const lexicon: Lexicon = { synonyms: [], abbreviations: [], compounds: [] };
  let kind: SectionKind | null = null;
  for (const raw of text.replace(/^﻿/, '').split(/\r\n|\r|\n/)) {
    const heading = HEADING_RE.exec(raw);
    if (heading) {
      kind = sectionKind(heading[1] ?? '');
      continue;
    }
    if (!kind) continue;
    const line = raw.replace(BULLET_RE, '').trim();
    if (line === '' || line.startsWith('#') || line.startsWith('<!--')) continue;
    if (kind === 'compounds') {
      const form = toForm(line);
      if (form.length >= 2 && !lexicon.compounds.some((c) => sameForm(c, form)))
        lexicon.compounds.push(form);
      continue;
    }
    const forms: Form[] = [];
    for (const part of line.split('=')) {
      const form = toForm(part);
      if (form.length > 0 && !forms.some((f) => sameForm(f, form))) forms.push(form);
    }
    if (forms.length >= 2) lexicon[kind].push(forms);
  }
  return lexicon;
}

const digest = (text: string): string =>
  createHash('sha256').update(text).digest('hex').slice(0, 16);

const joinGroups = (groups: readonly Form[][]): string =>
  groups.map((g) => g.map((f) => f.join(' ')).join('=')).join('\n');

/** Digest of what widens queries (synonyms and abbreviations); empty when there are none. */
export function queryDigest(lexicon: Lexicon): string {
  if (lexicon.synonyms.length === 0 && lexicon.abbreviations.length === 0) return '';
  return digest(`syn\n${joinGroups(lexicon.synonyms)}\nabbr\n${joinGroups(lexicon.abbreviations)}`);
}

/** Digest of the compound words (index-affecting); empty when there are none. */
export function compoundDigest(lexicon: Lexicon): string {
  if (lexicon.compounds.length === 0) return '';
  return digest(
    lexicon.compounds
      .map((c) => c.join(' '))
      .sort()
      .join('\n'),
  );
}

/** One way to rewrite a span of the query. */
export interface Substitution {
  /** Query token range replaced: [start, end). */
  start: number;
  end: number;
  /** Replacement words (norm). */
  words: Form;
  /** An abbreviation expanded (one way), not a synonym. */
  abbreviation?: boolean;
}

export interface QueryTokenForms {
  /** Normalized token as typed. */
  norm: string;
  /** Token as the fold view stores it. */
  folded: string;
  /** Typed with a diacritic: it must then match the lexicon word exactly (`lượng` is not `lương`). */
  marked: boolean;
}

/**
 * Find lexicon forms in the query (contiguous words; an unmarked query word
 * matches regardless of diacritics, a marked one exactly) and return, for each match, the other forms of its group. Not transitive:
 * expansions are not expanded again.
 */
export function expandQuery(
  lexicon: Lexicon,
  tokens: readonly QueryTokenForms[],
  foldWord: (word: string) => string,
): Substitution[] {
  const substitutions: Substitution[] = [];
  if (tokens.length === 0) return substitutions;
  const seen = new Set<string>();
  const add = (start: number, end: number, words: Form, abbreviation = false) => {
    const key = `${start}:${end}:${words.join(' ')}`;
    if (seen.has(key)) return;
    seen.add(key);
    substitutions.push(abbreviation ? { start, end, words, abbreviation } : { start, end, words });
  };
  const find = (form: Form): number[] => {
    const starts: number[] = [];
    for (let i = 0; i + form.length <= tokens.length; i++)
      if (
        form.every((w, j) =>
          tokens[i + j]!.marked ? tokens[i + j]!.norm === w : tokens[i + j]!.folded === foldWord(w),
        )
      )
        starts.push(i);
    return starts;
  };
  for (const group of lexicon.synonyms) {
    for (const [index, form] of group.entries()) {
      for (const start of find(form))
        for (const [other, words] of group.entries())
          if (other !== index) add(start, start + form.length, words);
    }
  }
  for (const group of lexicon.abbreviations) {
    const abbreviation = group[0]!;
    for (const start of find(abbreviation))
      for (const words of group.slice(1)) add(start, start + abbreviation.length, words, true);
  }
  return substitutions;
}

/**
 * Reads the lexicon file. `signature()` and `queryCacheKey()` get no
 * `QueryContext`, so the vault is the one last reported by `analyzeQuery`,
 * else `OBSIDIAN_VAULT_PATH`. The file is read on every call (it is small) and
 * parsed again only when its text changed.
 */
export class LexiconStore {
  private lastVault: string | undefined;
  private parsed: { text: string; lexicon: Lexicon } | null = null;

  constructor(private readonly options: PackOptions) {}

  /** Path of the lexicon file, or null when the vault is unknown. */
  filePath(vaultPath?: string): string | null {
    const file = this.options.lexiconPath;
    if (isAbsolute(file)) return file;
    const base = vaultPath ?? this.lastVault ?? process.env.OBSIDIAN_VAULT_PATH;
    return base ? join(base, file) : null;
  }

  load(vaultPath?: string): Lexicon {
    if (vaultPath) this.lastVault = vaultPath;
    const file = this.filePath(vaultPath);
    if (!file) return EMPTY_LEXICON;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return EMPTY_LEXICON;
    }
    if (this.parsed?.text !== text) this.parsed = { text, lexicon: parseLexicon(text) };
    return this.parsed.lexicon;
  }

  /**
   * Words the user wrote in synonym and abbreviation forms, folded: the query
   * rewriter treats them as known words (so "phone" is not "corrected").
   */
  knownWords(foldWord: (word: string) => string, vaultPath?: string): ReadonlySet<string> {
    const lexicon = this.load(vaultPath);
    const words = new Set<string>();
    for (const group of [...lexicon.synonyms, ...lexicon.abbreviations])
      for (const form of group) for (const w of form) words.add(foldWord(w));
    return words;
  }

  /** `queryCacheKey()` component. */
  queryKey(): string {
    return queryDigest(this.load());
  }

  /** `signature()` component. */
  compoundKey(): string {
    return compoundDigest(this.load());
  }
}
