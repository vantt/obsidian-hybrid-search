import Database from 'better-sqlite3';
import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Read a locator without acquiring the vault-bound singleton or provider defaults. */
export function readVaultLocator(dbFile: string): string | undefined {
  const db = new Database(dbFile, { readonly: true });
  try {
    const stored = db.prepare("SELECT value FROM settings WHERE key = 'vault_path'").get() as
      { value: string } | undefined;
    return stored?.value;
  } finally {
    db.close();
  }
}

function canonicalPath(p: string): string {
  const resolved = path.resolve(p);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

/** True when both spellings name the same directory (symlinks and trailing slashes ignored). */
export function isSameVaultPath(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b);
}
