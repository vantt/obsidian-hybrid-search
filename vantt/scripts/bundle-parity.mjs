#!/usr/bin/env node
// Search-quality parity of a platform whose bundle substitutes a dependency (PLATFORM_PINS in bundle.mjs)
// against a reference platform that runs the release tree as locked. Zero dependencies.
//
//   node vantt/scripts/bundle-parity.mjs run --tree <release tree, npm ci done> --out <dir>
//        [--pin name@version ...] [--lang-pack <built ohs-lang-vi dir>] [--otf <obsidian-test-fixture bin/otf.mjs>]
//        [--pins-of <platform>]   apply that platform's PLATFORM_PINS instead of this machine's
//   node vantt/scripts/bundle-parity.mjs compare --ref <dir> --other <dir> [--tolerance 0.01] [--accepted] [--out <report.json>]
//
// `run` applies the pins of the bundle (or of --pins-of) to the tree's node_modules, then runs upstream's eval
// (eval/evaluate.ts) on the obsidian-help corpus without a pack and on the vi-search corpus with the pack,
// and writes obsidian-help.json and vi.json. `compare` fails when any category's nDCG@5 differs by more
// than the tolerance (PRD 8.4, parity of the pinned build).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { applyPins, parsePins, PLATFORM_PINS } from './bundle.mjs';
import { evalEnv, goldenFile, prepareDataset, datasetDir, runEvaluate } from './lib/eval-run.mjs';

// Deltas of the darwin-x64 dependency pins that the user accepted (2026-11-02), per `corpus:category`. A category
// listed here passes while its delta stays within ACCEPTED_MARGIN of the accepted value; every other category must
// stay within the tolerance. Used by `compare --accepted`. Changing this list needs the user's decision.
export const ACCEPTED_DELTAS = { 'obsidian-help:multilingual': 0.063, 'vi:vi-synonym': -0.017 };
export const ACCEPTED_MARGIN = 0.005;

const here = path.dirname(fileURLToPath(import.meta.url));
const log = (m) => process.stderr.write(`[parity] ${m}\n`);

function run(values) {
  const tree = path.resolve(values.tree);
  const out = path.resolve(values.out);
  mkdirSync(out, { recursive: true });
  const platform = `${process.platform}-${process.arch}`;
  const pins = parsePins(PLATFORM_PINS[values['pins-of'] ?? platform] ?? {}, values.pin);
  // `--no-default-pins` is not offered on purpose: the reference platform has no default pins, the pinned one must use them.
  const substitutions = applyPins(path.join(tree, 'node_modules'), pins, path.join(out, 'pins'));
  const meta = { platform, substitutions, node: process.versions.node };

  prepareDataset(tree, 'obsidian-help', log);
  const help = runEvaluate({
    tree,
    vault: datasetDir(tree, 'obsidian-help'),
    golden: goldenFile(tree, 'obsidian-help'),
    scratch: path.join(out, 'scratch'),
    log,
  });
  writeFileSync(path.join(out, 'obsidian-help.json'), JSON.stringify({ ...help, parity: meta }, null, 2) + '\n');

  const viArgs = [path.join(here, '..', 'eval', 'vi', 'run-eval.mjs'), '--ohs', tree, '--out', path.join(out, 'vi.json')];
  if (values.otf) viArgs.push('--otf', path.resolve(values.otf));
  if (values['lang-pack']) viArgs.push('--lang-pack', path.resolve(values['lang-pack']));
  const res = spawnSync(process.execPath, viArgs, { stdio: ['ignore', 2, 2], env: evalEnv({ TMPDIR: out }) });
  if (res.status !== 0) throw new Error(`vi eval failed (exit ${res.status})`);
  const vi = JSON.parse(readFileSync(path.join(out, 'vi.json'), 'utf8'));
  writeFileSync(path.join(out, 'vi.json'), JSON.stringify({ ...vi, parity: meta }, null, 2) + '\n');
  log(`wrote ${out}`);
}

function compare(values) {
  const tol = Number(values.tolerance ?? '0.01');
  const rows = [];
  for (const corpus of ['obsidian-help', 'vi']) {
    const a = JSON.parse(readFileSync(path.join(values.ref, `${corpus}.json`), 'utf8'));
    const b = JSON.parse(readFileSync(path.join(values.other, `${corpus}.json`), 'utf8'));
    const cats = { ALL: [a.summary, b.summary], ...Object.fromEntries(Object.keys(a.by_category ?? {}).map((c) => [c, [a.by_category[c], b.by_category?.[c]]])) };
    for (const [cat, [x, y]] of Object.entries(cats)) {
      const delta = y ? y.ndcg_5 - x.ndcg_5 : NaN;
      const accepted = values.accepted ? ACCEPTED_DELTAS[`${corpus}:${cat}`] : undefined;
      const ok = accepted === undefined ? Math.abs(delta) <= tol + 1e-9 : Math.abs(delta - accepted) <= ACCEPTED_MARGIN + 1e-9;
      rows.push({ corpus, category: cat, ref: x.ndcg_5, other: y?.ndcg_5, delta, accepted, ok });
    }
  }
  const lines = ['| corpus | category | ref nDCG@5 | other nDCG@5 | delta | ok |', '|---|---|---|---|---|---|'];
  for (const r of rows)
    lines.push(`| ${r.corpus} | ${r.category} | ${r.ref.toFixed(3)} | ${r.other?.toFixed(3) ?? '-'} | ${r.delta >= 0 ? '+' : ''}${r.delta.toFixed(3)} | ${r.ok ? (r.accepted === undefined ? 'pass' : 'accepted') : 'FAIL'} |`);
  const ok = rows.every((r) => r.ok);
  lines.push('', `Tolerance ${tol}; parity ${ok ? 'PASS' : 'FAIL'}.`);
  if (values.accepted)
    lines.push('', `Accepted deltas (user chấp nhận 2026-11-02, margin ${ACCEPTED_MARGIN}): ${Object.entries(ACCEPTED_DELTAS).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v}`).join(', ')}.`);
  process.stdout.write(lines.join('\n') + '\n');
  if (values.out) writeFileSync(path.resolve(values.out), JSON.stringify({ tolerance: tol, ok, rows }, null, 2) + '\n');
  process.exit(ok ? 0 : 1);
}

const [cmd, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: {
    tree: { type: 'string' }, out: { type: 'string' }, pin: { type: 'string', multiple: true }, 'lang-pack': { type: 'string' }, otf: { type: 'string' }, 'pins-of': { type: 'string' },
    accepted: { type: 'boolean', default: false }, ref: { type: 'string' }, other: { type: 'string' }, tolerance: { type: 'string' },
  },
});
try {
  if (cmd === 'run') run(values);
  else if (cmd === 'compare') compare(values);
  else throw new Error('usage: bundle-parity.mjs run|compare ...');
} catch (e) {
  process.stderr.write(`[parity] ERROR: ${e.message}\n`);
  process.exit(1);
}
