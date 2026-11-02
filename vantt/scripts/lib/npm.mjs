// Pin npm to upstream's devEngines.packageManager version. Upstream refuses to
// run `npm ci`/`npm run`/`npx` with another npm (EBADDEVENGINES) and its CI
// installs that npm globally; catchup installs it into vantt/.work/tools instead
// and puts its .bin first on PATH, so test_command `npx ...` uses it too.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prependPath, sh } from './proc.mjs';

const EXACT = /^\d+\.\d+\.\d+$/;

/** Returns null on success or an error message. */
export function ensureNpm(root, log) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const want = pkg.devEngines?.packageManager;
  if (!want || want.name !== 'npm' || !EXACT.test(want.version ?? '')) return null;
  const have = sh(root, 'npm --version', { capture: true }).stdout.trim();
  if (have === want.version) return null;
  const dir = path.join(root, 'vantt', '.work', 'tools', `npm-${want.version}`);
  const bin = path.join(dir, 'node_modules', '.bin');
  if (!existsSync(path.join(bin, 'npm'))) {
    log(`npm ${have} found, upstream requires ${want.version}; installing it into vantt/.work/tools.`);
    mkdirSync(dir, { recursive: true });
    // Own package.json so this install is not checked against upstream's devEngines.
    writeFileSync(path.join(dir, 'package.json'), '{ "private": true }\n');
    const res = sh(dir, `npm install --no-audit --no-fund npm@${want.version}`);
    if (!res.ok) return `could not install npm@${want.version}`;
  }
  prependPath(bin);
  const now = sh(root, 'npm --version', { capture: true }).stdout.trim();
  return now === want.version ? null : `npm on PATH is ${now}, expected ${want.version}`;
}
