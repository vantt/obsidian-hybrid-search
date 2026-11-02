import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface PackageIdentity {
  version: string;
  /** True when the release build stamped `"vanttFork": true` into package.json (PRD 4.3). */
  vanttFork: boolean;
}

/**
 * Read the nearest package.json at or above `startDir`. The depth differs between the
 * compiled and the source layout, so the file is located rather than assumed.
 */
export function readPackageIdentity(
  startDir: string = path.dirname(fileURLToPath(import.meta.url)),
): PackageIdentity {
  let dir = startDir;
  while (true) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf-8')) as {
        version: string;
        vanttFork?: unknown;
      };
      return { version: pkg.version, vanttFork: pkg.vanttFork === true };
    }
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error('Could not locate package.json');
    dir = parent;
  }
}

export const packageIdentity = readPackageIdentity();

/**
 * Update checks query the public npm registry, which describes upstream releases.
 * OHS_DISABLE_UPDATE_CHECK=1 turns them off; the fork installer always sets it.
 */
export function updateCheckDisabled(): boolean {
  return process.env.OHS_DISABLE_UPDATE_CHECK === '1';
}

/** `build` status field, present only on fork builds. Pristine builds get no field. */
export function buildStatusField(identity: PackageIdentity = packageIdentity): { build?: 'vantt' } {
  return identity.vanttFork ? { build: 'vantt' } : {};
}
