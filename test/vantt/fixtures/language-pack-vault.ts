import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** A small multilingual vault shared by the language-pack tests. */
export const LANGUAGE_PACK_VAULT: Record<string, string> = {
  'streets/main-street.md': [
    '---',
    'aliases: [Fußweg, Hauptweg]',
    'tags: [city]',
    '---',
    '# Straße',
    '',
    'Intro paragraph about the city plan and the people who walk here every day.',
    '',
    '## Details',
    '',
    'Long before the market opened, the old Straße was paved with stone. ' +
      'Traders came from the river and the hills to sell bread and fish.',
    '',
  ].join('\n'),
  'streets/grand-street.md': [
    '# Big avenue',
    '',
    'Filler words come first so that the match sits in the middle of the note body. '.repeat(
      3,
    ) + 'Die Große Straße am Ende der Stadt ist breit. Then more filler text follows here.',
    '',
  ].join('\n'),
  'nature/canyon.md': [
    '---',
    'tags: [travel, nature]',
    '---',
    '# Grand Canyon',
    '',
    'The Grand Canyon is a steep-sided canyon carved by the Colorado River.',
    '',
  ].join('\n'),
  'kitchen/bread.md': [
    '---',
    'aliases: [Sourdough]',
    'tags: [recipe]',
    '---',
    '# Bread recipe',
    '',
    'Mix flour, water and salt. Let the dough rise overnight, then bake the bread.',
    '',
  ].join('\n'),
  'kitchen/garden.md': [
    '# Kitchen garden',
    '',
    'Herbs for the kitchen: basil, thyme and parsley grow well next to the bread oven.',
    '',
  ].join('\n'),
  'notes/c-plus-plus.md': [
    '# C++ notes',
    '',
    'Templates in C++ and generics in C# solve similar problems; a+b is an expression.',
    '',
  ].join('\n'),
  'notes/unicode.md': [
    '# Café menu',
    '',
    'Crème brûlée, naïve façade, and the word été written with combining marks: été.',
    '',
  ].join('\n'),
  'notes/empty-title.md': 'Just a body line about rivers and stone bridges.\n',
};

export function writeLanguagePackVault(vault: string, extra: Record<string, string> = {}): void {
  for (const [name, text] of Object.entries({ ...LANGUAGE_PACK_VAULT, ...extra })) {
    const file = path.join(vault, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
}

/** Deterministic 8-dimensional bag-of-words vector, so ranking is reproducible. */
export function fixtureVector(text: string): Float32Array {
  const vector = new Float32Array(8);
  for (const word of text.toLowerCase().match(/\p{L}+/gu) ?? []) {
    let hash = 0;
    for (const char of word) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
    vector[hash % 8]! += 1;
  }
  const norm = Math.hypot(...vector);
  if (norm === 0) vector[0] = 1;
  else for (let i = 0; i < 8; i++) vector[i]! /= norm;
  return vector;
}

/** Queries covering every mode, filters, anchors and multi-query fan-out. */
export const BASELINE_QUERIES: Array<{
  query: string;
  options: Record<string, unknown>;
}> = [
  { query: 'bread', options: {} },
  { query: 'stone river', options: {} },
  { query: 'strasse', options: {} },
  { query: 'Straße', options: { mode: 'fulltext' } },
  { query: 'grosse strasse', options: { mode: 'fulltext' } },
  { query: 'canyon', options: { mode: 'fulltext', anchors: true } },
  { query: 'Bread', options: { mode: 'title' } },
  { query: 'fussweg', options: {} },
  { query: 'Fußweg', options: {} },
  { query: 'sourdough', options: { mode: 'title' } },
  { query: 'kitchen herbs', options: { mode: 'semantic' } },
  { query: 'C++', options: { mode: 'fulltext' } },
  { query: 'ete', options: { mode: 'fulltext' } },
  { query: 'bread', options: { tag: 'recipe' } },
  { query: 'stone', options: { scope: 'streets' } },
  { query: 'bread', options: { queries: ['bread', 'garden herbs'] } },
  { query: 'river', options: { snippetLength: 80, anchors: true } },
];
