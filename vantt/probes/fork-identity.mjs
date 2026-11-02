// Probe for patch P00 fork-identity (PRD 9.2).
// Usage: node vantt/probes/fork-identity.mjs --ohs <built OHS directory>
// Exit codes: 0 the CLI reports a fork version (`<tag>-vantt.<N>`), 1 it does not
// (pristine upstream), 2 the probe could not run. Uses only the public CLI and package.json.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const flag = process.argv.indexOf('--ohs');
const root = flag >= 0 ? process.argv[flag + 1] : undefined;
if (!root) {
  console.error('usage: node vantt/probes/fork-identity.mjs --ohs <built OHS directory>');
  process.exit(2);
}

try {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.ohs;
  if (!bin) throw new Error('package.json has no ohs bin entry');
  const out = execFileSync(process.execPath, [path.join(root, bin), '--version'], {
    encoding: 'utf8',
  }).trim();
  console.log(out);
  process.exit(out.includes('-vantt.') ? 0 : 1);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}
