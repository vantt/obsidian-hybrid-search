#!/usr/bin/env node
/**
 * Build data/compounds.txt from syllable-pair statistics over permissively
 * licensed Vietnamese text (sources, licenses and method: data/README.md).
 *
 *   npm run build
 *   node --max-old-space-size=12000 scripts/build-compounds.mjs --work <dir> [--count-only] [--reference <words.txt>]
 *
 * Downloads about 1 GB; counting takes 5 to 25 minutes and a few GB of memory.
 *
 * Stages (each cached in <work>, delete a file to redo its stage):
 *   1. download the pinned parquet files to <work>/corpus and check their sha256;
 *   2. extract plain text and count syllables and adjacent syllable pairs
 *      (<work>/counts.tsv);
 *   3. score every pair and write the pairs that pass the fixed thresholds
 *      below to data/compounds.txt.
 *
 * The output depends only on the corpus and the constants in this file.
 * `--reference` (development only) prints precision and recall of the
 * output, and of other thresholds, against a word list; it never changes
 * what is written. See data/README.md for how a reference list may be used.
 */
import { asyncBufferFromFile, parquetMetadataAsync, parquetRead } from 'hyparquet';
import { compressors } from 'hyparquet-compressors';
import { createHash } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { normalize, parseSyllable } from '../build/index.js';

const HF = 'https://huggingface.co/datasets';

/** Pinned sources: dataset revision, file, sha256, and the text columns read. */
export const SOURCES = [
  {
    name: 'alt',
    dataset: 'mutiyama/alt',
    revision: 'afbd92e198bbcf17f660e03076fd2938f5a4bbb2',
    files: [
      {
        path: 'alt-parallel/train-00000-of-00001.parquet',
        sha256: 'e2d95c41b90c0fe94226f9b424e63f476b6027015df4beba3e5d7e19092a3a44',
      },
    ],
    columns: ['translation'],
    text: (row) => [row.translation?.vi],
  },
  {
    name: 'personas',
    dataset: 'nvidia/Nemotron-Personas-Vietnam',
    revision: '950724d49b7b41eee7925ae035a2059286c890ff',
    files: [
      {
        path: 'data/train-00000-of-00011.parquet',
        sha256: '7ba73013539e2edb61dc748086edfe52e0107adf124620f17364c5ec0b244ae4',
      },
    ],
    columns: [
      'professional_persona',
      'sports_persona',
      'arts_persona',
      'travel_persona',
      'culinary_persona',
      'persona',
      'cultural_background',
      'skills_and_expertise',
      'hobbies_and_interests',
      'career_goals_and_ambitions',
    ],
    text: (row) => Object.values(row),
  },
  {
    name: 'legal',
    dataset: 'th1nhng0/vietnamese-legal-documents',
    revision: '8977887f17be2defae4c5171d55562e1cde7d695',
    files: [
      {
        path: 'data/content.parquet',
        sha256: '69c5b99c7e22bd14075ebc60e8d216e9eb35c4f1ab28bfc4c0bc38a87de45aab',
      },
    ],
    columns: ['content_html'],
    text: (row) => [htmlToText(row.content_html ?? '')],
  },
];

/**
 * Selection thresholds. Set by hand during development (data/README.md), then
 * fixed here; changing one changes the shipped list.
 */
export const THRESHOLDS = {
  /** Least number of times the pair occurs (all sources). */
  minCount: 10,
  /** Least normalized PMI of the pair, taking the best source (a source counts once the pair occurs 3 times there). */
  minNpmi: 0.2,
  /** Least share of occurrences, on each side, where the pair binds tighter than the overlapping pair (best source). */
  minWinRate: 0.75,
  /** Least count of each syllable in the clean sources (drops OCR and typing errors of the legal text). */
  minCleanSyllable: 5,
  /** Largest share of occurrences with both words in title case: a pair almost always written so ("Ngọc Anh") is a name. */
  maxTitleShare: 0.8,
};

/** Sources written by hand or generated in clean standard Vietnamese (no OCR, no text typed without marks). */
const CLEAN_SOURCES = ['alt', 'personas'];

// ---- text ------------------------------------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Plain text of an HTML document: block tags become line breaks, other tags spaces. */
export function htmlToText(html) {
  return html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(p|div|br|tr|td|th|li|h[1-6]|table|ul|ol)\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#')
        return String.fromCodePoint(
          e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
        );
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

/** A word written in title case ("Ngọc"): a capital, then lower case only. */
const TITLE_RE = /^\p{Lu}[\p{Ll}\p{M}]+$/u;

/** Runs of words separated by blanks only; anything else (punctuation, digits, line breaks) ends a run. */
const RUN_RE = /[\p{L}\p{M}]+(?:[ \t\u00a0]+[\p{L}\p{M}]+)*/gu;

// ---- stage 1: download -----------------------------------------------------------------------------------------

async function sha256Of(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

export async function download(work) {
  const dir = path.join(work, 'corpus');
  mkdirSync(dir, { recursive: true });
  const local = [];
  for (const source of SOURCES) {
    for (const file of source.files) {
      const target = path.join(dir, `${source.name}-${path.basename(file.path)}`);
      if (!existsSync(target)) {
        const url = `${HF}/${source.dataset}/resolve/${source.revision}/${file.path}`;
        console.log(`download ${url}`);
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
        await pipeline(res.body, createWriteStream(`${target}.part`));
        renameSync(`${target}.part`, target);
      }
      const sum = await sha256Of(target);
      if (sum !== file.sha256) throw new Error(`${target}: sha256 ${sum}, expected ${file.sha256}`);
      local.push({ source, file: target });
    }
  }
  return local;
}

// ---- stage 2: count --------------------------------------------------------------------------------------------

class Counter {
  syllables = []; // id -> normalized syllable
  ids = new Map(); // normalized syllable -> id
  raw = new Map(); // raw word -> id, or -1 when not a Vietnamese syllable
  unigram = []; // id -> count per source
  pairs = new Map(); // a * 2^16 + b -> count per source
  triples = new Map(); // ((a, b, c) packed, times 4, plus source) -> count, only to compute win rates
  runs = 0;
  words = 0;
  source = 0; // index into SOURCES of the text being added

  idOf(word) {
    let id = this.raw.get(word);
    if (id !== undefined) return id;
    const norm = normalize(word, { tonePlacement: 'modern' });
    id = -1;
    if (parseSyllable(norm) !== null) {
      id = this.ids.get(norm);
      if (id === undefined) {
        id = this.syllables.length;
        this.syllables.push(norm);
        this.ids.set(norm, id);
        this.unigram.push(SOURCES.map(() => 0));
      }
    }
    if (this.raw.size < 2_000_000) this.raw.set(word, id);
    return id;
  }

  addText(text) {
    if (typeof text !== 'string' || text === '') return;
    for (const match of text.matchAll(RUN_RE)) {
      let prev2 = -1;
      let prev = -1;
      let prevTitle = false;
      for (const word of match[0].split(/[ \t\u00a0]+/)) {
        const id = this.idOf(word);
        if (id < 0) {
          prev2 = prev = -1;
          continue;
        }
        const title = TITLE_RE.test(word);
        this.words++;
        this.unigram[id][this.source]++;
        if (prev >= 0) {
          const key = prev * 65536 + id;
          let n = this.pairs.get(key);
          if (n === undefined) this.pairs.set(key, (n = [...SOURCES.map(() => 0), 0]));
          n[this.source]++;
          if (prevTitle && title) n[SOURCES.length]++;
          if (prev2 >= 0) {
            const tkey = (prev2 * 4294967296 + key) * 4 + this.source; // < 2^50, exact in a double
            this.triples.set(tkey, (this.triples.get(tkey) ?? 0) + 1);
          }
        }
        prev2 = prev;
        prev = id;
        prevTitle = title;
      }
      this.runs++;
    }
  }
}

async function count(work, local) {
  const out = path.join(work, 'counts.tsv');
  if (existsSync(out)) return out;
  const counter = new Counter();
  for (const { source, file } of local) {
    counter.source = SOURCES.indexOf(source);
    const buffer = await asyncBufferFromFile(file);
    const metadata = await parquetMetadataAsync(buffer);
    let rowStart = 0;
    for (const group of metadata.row_groups) {
      const rowEnd = rowStart + Number(group.num_rows);
      await parquetRead({
        file: buffer,
        metadata,
        compressors,
        columns: source.columns,
        rowStart,
        rowEnd,
        rowFormat: 'object',
        onComplete: (rows) => {
          for (const row of rows) for (const text of source.text(row)) counter.addText(text);
        },
      });
      rowStart = rowEnd;
      process.stdout.write(
        `\r${source.name}: ${rowStart}/${metadata.num_rows} rows, ${counter.words} syllables`,
      );
    }
    process.stdout.write('\n');
  }
  // counts.tsv: "u<TAB>syllable<TAB>count per source",
  // "p<TAB>a<TAB>b<TAB>count per source<TAB>count with both words in title case",
  // "t<TAB>a<TAB>b<TAB>c<TAB>source<TAB>count"; counts per source in SOURCES order.
  const lines = [`# words ${counter.words} runs ${counter.runs}`];
  counter.syllables.forEach((s, i) => lines.push(`u\t${s}\t${counter.unigram[i].join('\t')}`));
  const stream = createWriteStream(`${out}.part`);
  const write = (line) =>
    stream.write(`${line}\n`) ? null : new Promise((r) => stream.once('drain', r));
  for (const line of lines) await write(line);
  for (const [key, n] of counter.pairs)
    await write(`p\t${Math.floor(key / 65536)}\t${key % 65536}\t${n.join('\t')}`);
  for (const [packed, n] of counter.triples) {
    if (n < 2) continue; // a single triple cannot change a win rate much
    const source = packed % 4;
    const key = (packed - source) / 4;
    const a = Math.floor(key / 4294967296);
    const rest = key % 4294967296;
    await write(`t\t${a}\t${Math.floor(rest / 65536)}\t${rest % 65536}\t${source}\t${n}`);
  }
  await new Promise((resolve) => stream.end(resolve));
  renameSync(`${out}.part`, out);
  return out;
}

async function readCounts(file) {
  const syllables = [];
  const unigram = [];
  const pairs = new Map();
  const titled = new Map();
  const triples = [];
  let words = 0;
  for await (const line of createInterface({
    input: createReadStream(file),
    crlfDelay: Infinity,
  })) {
    const f = line.split('\t');
    if (line.startsWith('# words ')) words = Number(line.split(' ')[2]);
    else if (f[0] === 'u') {
      syllables.push(f[1]);
      unigram.push(f.slice(2).map(Number));
    } else if (f[0] === 'p') {
      const key = Number(f[1]) * 65536 + Number(f[2]);
      pairs.set(key, f.slice(3, -1).map(Number));
      titled.set(key, Number(f.at(-1)));
    } else if (f[0] === 't')
      triples.push([Number(f[1]), Number(f[2]), Number(f[3]), Number(f[4]), Number(f[5])]);
  }
  return { syllables, unigram, pairs, titled, triples, words };
}

// ---- stage 3: score and select -------------------------------------------------------------------------------

/** Normalized PMI of a pair in one source, or -1 when the pair occurs fewer than 3 times there. */
function npmi(n, ca, cb, words) {
  if (n < 3) return -1;
  return Math.log((n * words) / (ca * cb)) / -Math.log(n / words);
}

const ASCII_WORD_RE = /^[a-z]+$/;

/**
 * Score every pair. Each source is one register (news, everyday prose, legal
 * text), so association and competition are measured inside each source and
 * a pair is judged in the source where it does best:
 * - `n`: occurrences in all sources;
 * - `npmi`: normalized PMI, the best of the sources where the pair occurs at
 *   least 3 times;
 * - `win`: the best, over the sources where the pair occurs at least
 *   `minCount / 2` times, of the lower of two shares: occurrences in
 *   three-syllable windows where the pair has a higher `npmi` than the pair
 *   overlapping it on the right ("a b" against "b c"), and the same on the left
 *   ("w a" against "a b"); windows without a scored neighbour count as wins. A
 *   pair that is the tail of one word and the head of the next ("về sân" in
 *   "về sân bay") loses most windows;
 * - `clean`: occurrences in the clean sources;
 * - `cleanSyllables`: least clean-source count of its two syllables;
 * - `ascii`: both syllables are plain ASCII letters (a pair without any mark);
 * - `title`: share of occurrences with both words in title case (names of
 *   people and places: "Ngọc Anh", "Hà Nội").
 */
export function scorePairs({ syllables, unigram, pairs, titled, triples }, t = THRESHOLDS) {
  const sources = SOURCES.length;
  const clean = SOURCES.map((s) => CLEAN_SOURCES.includes(s.name));
  const words = SOURCES.map((_, s) => unigram.reduce((sum, u) => sum + u[s], 0));
  const cleanCount = (counts) => counts.reduce((sum, c, s) => sum + (clean[s] ? c : 0), 0);
  const scores = new Map(); // pair -> npmi per source
  for (const [key, n] of pairs) {
    const a = Math.floor(key / 65536);
    const b = key % 65536;
    scores.set(
      key,
      n.map((c, s) => npmi(c, unigram[a][s], unigram[b][s], words[s])),
    );
  }
  // Losses per source: index key * 4 + source.
  const lostLeft = new Map(); // the pair lost to the pair on its right
  const lostRight = new Map(); // the pair lost to the pair on its left
  const add = (map, key, n) => map.set(key, (map.get(key) ?? 0) + n);
  for (const [a, b, c, s, n] of triples) {
    const left = a * 65536 + b;
    const right = b * 65536 + c;
    const l = scores.get(left)?.[s];
    const r = scores.get(right)?.[s];
    if (l === undefined || r === undefined) continue;
    if (l < r) add(lostLeft, left * 4 + s, n);
    else if (r < l) add(lostRight, right * 4 + s, n);
  }
  const scored = [];
  for (const [key, counts] of pairs) {
    const a = Math.floor(key / 65536);
    const b = key % 65536;
    let win = -1;
    counts.forEach((n, s) => {
      if (n < Math.max(3, t.minCount / 2)) return;
      const left = 1 - (lostLeft.get(key * 4 + s) ?? 0) / n;
      const right = 1 - (lostRight.get(key * 4 + s) ?? 0) / n;
      win = Math.max(win, Math.min(left, right));
    });
    const n = counts.reduce((x, y) => x + y, 0);
    scored.push({
      a,
      b,
      n,
      npmi: Math.max(...scores.get(key)),
      win,
      clean: cleanCount(counts),
      cleanSyllables: Math.min(cleanCount(unigram[a]), cleanCount(unigram[b])),
      ascii: ASCII_WORD_RE.test(syllables[a]) && ASCII_WORD_RE.test(syllables[b]),
      title: (titled.get(key) ?? 0) / n,
    });
  }
  return scored;
}

/**
 * Whether a scored pair is a compound. Names are left out (a name in the
 * dictionary makes "Ngọc Anh" and "Ngọc Ánh" look alike to the seg view). A
 * pair without any mark (`ascii`) is most often English ("in the") or
 * Vietnamese typed without marks in the legal text, so it needs `minCount`
 * occurrences in the clean sources.
 */
export const passes = (p, t = THRESHOLDS) =>
  p.n >= t.minCount &&
  p.npmi >= t.minNpmi &&
  p.win >= t.minWinRate &&
  p.cleanSyllables >= t.minCleanSyllable &&
  p.title <= t.maxTitleShare &&
  (!p.ascii || p.clean >= t.minCount);

// ---- reference (development only) ------------------------------------------------------------------------------

function readReference(file) {
  const ref = new Set();
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const entry = line.trim();
    if (!/^[\p{L}\p{M}]+ [\p{L}\p{M}]+$/u.test(entry)) continue;
    const words = normalize(entry, { tonePlacement: 'modern' }).split(' ');
    if (words.every((w) => parseSyllable(w) !== null)) ref.add(words.join(' '));
  }
  return ref;
}

function report(name, chosen, ref, reachable) {
  let hit = 0;
  for (const e of chosen) if (ref.has(e)) hit++;
  const p = hit / chosen.length;
  const r = hit / ref.size;
  const rr = hit / reachable;
  const f = (2 * p * r) / (p + r);
  console.log(
    `${name.padEnd(34)} n=${String(chosen.length).padStart(6)} P=${p.toFixed(3)} R=${r.toFixed(3)} R(seen)=${rr.toFixed(3)} F1=${f.toFixed(3)}`,
  );
}

function compare(scored, counts, refFile) {
  const { syllables } = counts;
  const ref = readReference(refFile);
  const text = (p) => `${syllables[p.a]} ${syllables[p.b]}`;
  const seen = scored.filter((p) => ref.has(text(p))).length;
  console.log(`reference: ${ref.size} two-syllable entries, ${seen} occur in the corpus`);
  report('shipped thresholds', scored.filter((p) => passes(p)).map(text), ref, seen);
  for (const minCount of [5, 10, 20])
    for (const minNpmi of [0.15, 0.2, 0.25, 0.3])
      for (const minWinRate of [0.6, 0.7, 0.75, 0.8, 0.9]) {
        const t = { ...THRESHOLDS, minCount, minNpmi, minWinRate };
        // The win rate depends on minCount (sources with too few occurrences are skipped).
        const rescored = minCount === THRESHOLDS.minCount ? scored : scorePairs(counts, t);
        report(
          JSON.stringify({ minCount, minNpmi, minWinRate }),
          rescored.filter((p) => passes(p, t)).map(text),
          ref,
          seen,
        );
      }
}

// ---- main ------------------------------------------------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      work: { type: 'string' },
      reference: { type: 'string' },
      'count-only': { type: 'boolean' },
    },
  });
  if (!values.work) {
    console.error('usage: node scripts/build-compounds.mjs --work <dir> [--reference <words.txt>]');
    process.exit(2);
  }
  const work = path.resolve(values.work);
  const local = await download(work);
  const countsFile = await count(work, local);
  if (values['count-only']) return;
  const counts = await readCounts(countsFile);
  const scored = scorePairs(counts);
  const text = (p) => `${counts.syllables[p.a]} ${counts.syllables[p.b]}`;
  const out = [...new Set(scored.filter((p) => passes(p)).map(text))].sort();
  const target = fileURLToPath(new URL('../data/compounds.txt', import.meta.url));
  writeFileSync(target, `${out.join('\n')}\n`);
  console.log(
    `${counts.words} syllables, ${counts.pairs.size} pairs -> ${out.length} compounds in ${target}`,
  );
  if (values.reference) compare(scored, counts, values.reference);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
  await main();
