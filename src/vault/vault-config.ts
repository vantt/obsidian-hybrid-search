import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../runtime/config.js';
import { isSameVaultPath, readVaultLocator } from '../storage/vault-locator.js';

export function validateVaultPath(vaultPath: string | undefined): asserts vaultPath is string {
  if (vaultPath === undefined) {
    throw new Error('OBSIDIAN_VAULT_PATH environment variable is required');
  }
  if (vaultPath.trim().length === 0) {
    throw new Error('OBSIDIAN_VAULT_PATH must name an existing directory (received an empty path)');
  }
  let isDirectory = false;
  try {
    isDirectory = statSync(vaultPath).isDirectory();
  } catch {
    // Convert missing/unreadable paths to a stable startup diagnostic below.
  }
  if (!isDirectory) {
    throw new Error(`OBSIDIAN_VAULT_PATH must name an existing directory: ${vaultPath}`);
  }
}

/** Walk up from cwd looking for a file/dir with the given name. Returns the containing dir or undefined. */
function walkUpFind(name: string): string | undefined {
  let dir = process.cwd();
  while (true) {
    if (existsSync(path.join(dir, name))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const DEFAULT_DB_NAME = '.obsidian-hybrid-search.db';

/** Read the vault a database file belongs to; undefined when it is missing, unreadable or unlabeled. */
function readLocatorQuietly(dbFile: string): string | undefined {
  try {
    return readVaultLocator(dbFile) || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Route the process to an index database outside the default location. The storage
 * layer and the daemon it spawns read OBSIDIAN_DB_PATH, so setting it here makes
 * every transport resolve the same file.
 */
function useExternalDatabase(dbFile: string, vaultPath: string): void {
  if (path.resolve(dbFile) !== path.join(path.resolve(vaultPath), DEFAULT_DB_NAME)) {
    process.env.OBSIDIAN_DB_PATH = path.resolve(dbFile);
  }
}

/** Select the vault; defaults are restored later from its actual database connection. */
export function discoverConfig(dbPathOpt?: string): void {
  const configuredDb = config.dbPathOverride;
  const explicitVault = process.env.OBSIDIAN_VAULT_PATH;
  if (explicitVault !== undefined) {
    validateVaultPath(explicitVault);
    // An explicit vault keeps its own database unless --db names an existing database
    // that records this very vault. A database of another vault is never adopted.
    if (dbPathOpt) {
      const stored = readLocatorQuietly(dbPathOpt);
      if (stored && isSameVaultPath(stored, explicitVault)) {
        useExternalDatabase(dbPathOpt, explicitVault);
      }
    }
    return;
  }

  let dbFile: string | undefined = dbPathOpt;
  if (!dbFile && configuredDb && existsSync(configuredDb)) dbFile = configuredDb;
  if (!dbFile && !configuredDb) {
    const vaultDir = walkUpFind(DEFAULT_DB_NAME);
    if (vaultDir) dbFile = path.join(vaultDir, DEFAULT_DB_NAME);
  }

  if (!dbFile) {
    const inferredVault = walkUpFind('.obsidian');
    if (inferredVault) {
      process.env.OBSIDIAN_VAULT_PATH = inferredVault;
      return;
    }
    throw new Error(
      'Could not find .obsidian-hybrid-search.db\n' +
        'Run this command from inside your Obsidian vault, use --db <path>, or set OBSIDIAN_VAULT_PATH.',
    );
  }

  try {
    // A locator supplies only the target vault, never its provider, ignore defaults or
    // database location; OBSIDIAN_DB_PATH (already in the environment) names those.
    process.env.OBSIDIAN_VAULT_PATH = readVaultLocator(dbFile) || path.dirname(dbFile);
  } catch {
    // DB unreadable — let normal startup errors surface without inventing a target.
  }
}
