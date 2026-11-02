#!/usr/bin/env node
/**
 * Regenerate data/compounds.txt from the pyvi word list (see data/README.md).
 *
 *   npm run build
 *   node scripts/compounds.mjs --source <path to pyvi/models/words.txt>
 *
 * Keeps entries of exactly two space-separated syllables, each a well-formed
 * Vietnamese syllable; normalizes them (NFC, lowercase, modern tone position)
 * and writes them sorted and unique, one per line.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalize, parseSyllable } from '../build/index.js';

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
if (sourceIndex < 0 || !args[sourceIndex + 1]) {
  console.error('usage: node scripts/compounds.mjs --source <words.txt>');
  process.exit(2);
}
const source = readFileSync(args[sourceIndex + 1], 'utf8');
const out = new Set();
let total = 0;
for (const line of source.split(/\r?\n/)) {
  const entry = line.trim();
  if (!entry) continue;
  total++;
  // Only plain space-separated words: hyphenated loanwords and phrases with
  // punctuation are not compound words of the segmenter.
  if (!/^[\p{L}\p{M}]+( [\p{L}\p{M}]+)+$/u.test(entry)) continue;
  const words = normalize(entry, { tonePlacement: 'modern' }).split(' ');
  if (words.length !== 2) continue;
  if (!words.every((w) => parseSyllable(w) !== null)) continue;
  out.add(words.join(' '));
}
const sorted = [...out].sort();
const target = fileURLToPath(new URL('../data/compounds.txt', import.meta.url));
writeFileSync(target, `${sorted.join('\n')}\n`);
console.log(`${total} source entries -> ${sorted.length} compounds in ${target}`);
