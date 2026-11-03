/** Command line of the pack: `ohs-lang-vi learn-abbr --vault <dir>`. */
import { existsSync, statSync } from 'node:fs';
import { learnFromVault } from './abbr.js';

export interface CliIo {
  log(line: string): void;
  error(line: string): void;
}

const USAGE = `Usage: ohs-lang-vi learn-abbr --vault <dir> [--lexicon <path>] [--min-count <n>] [--dry-run]

Scans the Markdown notes of a vault for abbreviation definitions and frequent
phrases that spell an abbreviation, and writes proposals under "## Chờ duyệt"
of the lexicon (default _ohs/lexicon.md, relative to the vault). Move a line to
"## Viết tắt" to use it. Existing sections are never changed.`;

interface Parsed {
  vault?: string;
  lexicon?: string;
  minCount?: number;
  dryRun: boolean;
  help: boolean;
}

function parseArgs(args: readonly string[]): Parsed | { error: string } {
  const out: Parsed = { dryRun: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    const takesValue = arg === '--vault' || arg === '--lexicon' || arg === '--min-count';
    const value = takesValue ? args[++i] : undefined;
    if (takesValue && value === undefined) return { error: `${arg} needs a value` };
    if (arg === '--vault') out.vault = value;
    else if (arg === '--lexicon') out.lexicon = value;
    else if (arg === '--min-count') {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1) return { error: '--min-count must be a positive integer' };
      out.minCount = n;
    } else if (arg === '--dry-run') out.dryRun = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else return { error: `unknown argument ${arg}` };
  }
  return out;
}

/** Run the CLI; returns the exit code. */
export function runCli(argv: readonly string[], io: CliIo): number {
  const [command, ...rest] = argv;
  if (command === undefined || command === '--help' || command === '-h') {
    io.log(USAGE);
    return command === undefined ? 2 : 0;
  }
  if (command !== 'learn-abbr') {
    io.error(`ohs-lang-vi: unknown command ${command}\n${USAGE}`);
    return 2;
  }
  const parsed = parseArgs(rest);
  if ('error' in parsed) {
    io.error(`ohs-lang-vi: ${parsed.error}\n${USAGE}`);
    return 2;
  }
  if (parsed.help) {
    io.log(USAGE);
    return 0;
  }
  if (!parsed.vault) {
    io.error(`ohs-lang-vi: --vault is required\n${USAGE}`);
    return 2;
  }
  if (!existsSync(parsed.vault) || !statSync(parsed.vault).isDirectory()) {
    io.error(`ohs-lang-vi: vault not found: ${parsed.vault}`);
    return 1;
  }
  const result = learnFromVault(parsed.vault, {
    lexiconPath: parsed.lexicon,
    dryRun: parsed.dryRun,
    minPhraseCount: parsed.minCount,
  });
  io.log(`Scanned ${result.notes} notes.`);
  for (const p of result.proposals)
    io.log(`  ${p.abbr} = ${p.expansion}   (${p.source}, ${p.count}x)`);
  if (result.proposals.length === 0) io.log('No new abbreviations to propose.');
  else if (result.written)
    io.log(
      `Wrote ${result.proposals.length} proposal(s) under "## Chờ duyệt" in ${result.lexiconFile}`,
    );
  else io.log(`Dry run: ${result.lexiconFile} not changed.`);
  return 0;
}
