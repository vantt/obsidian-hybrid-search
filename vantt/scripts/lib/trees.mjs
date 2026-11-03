// A pristine upstream tree at the target commit, next to the fork release build (PRD 11.4).
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { ensureNpm } from './npm.mjs';
import { git, sh } from './proc.mjs';

/** package-lock.json with the version stamp removed: what decides which dependencies get installed. */
export function lockFingerprint(text) {
  const lock = JSON.parse(text);
  delete lock.version;
  if (lock.packages?.['']) delete lock.packages[''].version;
  return JSON.stringify(lock);
}

/**
 * Check out `sha` as a detached worktree at `dir` and give it dependencies: the fork's
 * node_modules when the lock files agree (the series changes no dependency), otherwise
 * a fresh `npm ci`. Returns {dir, cleanup, deps: 'shared' | 'installed'}; throws on failure.
 */
export function createUpstreamTree(root, sha, dir, log) {
  rmSync(dir, { recursive: true, force: true });
  git(root, ['worktree', 'prune']);
  mkdirSync(path.dirname(dir), { recursive: true });
  git(root, ['worktree', 'add', '--detach', dir, sha]);
  const cleanup = () => {
    const nm = path.join(dir, 'node_modules');
    if (existsSync(nm) && lstatSync(nm).isSymbolicLink()) rmSync(nm); // never follow into the fork's modules
    git(root, ['worktree', 'remove', '--force', dir], { allowFail: true });
    rmSync(dir, { recursive: true, force: true });
    git(root, ['worktree', 'prune'], { allowFail: true });
  };
  try {
    const forkLock = path.join(root, 'package-lock.json');
    const same =
      existsSync(forkLock) &&
      existsSync(path.join(dir, 'package-lock.json')) &&
      existsSync(path.join(root, 'node_modules')) &&
      lockFingerprint(readFileSync(forkLock, 'utf8')) ===
        lockFingerprint(readFileSync(path.join(dir, 'package-lock.json'), 'utf8'));
    if (same) {
      log('  upstream tree shares the fork node_modules (same lock file)');
      symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
      return { dir, cleanup, deps: 'shared' };
    }
    log('  lock files differ: installing dependencies in the upstream tree');
    const npmErr = ensureNpm(dir, log);
    if (npmErr) throw new Error(npmErr);
    if (!sh(dir, 'npm ci --ignore-scripts').ok || !sh(dir, 'npm rebuild').ok)
      throw new Error('npm ci failed in the upstream tree');
    return { dir, cleanup, deps: 'installed' };
  } catch (e) {
    cleanup();
    throw e;
  }
}
