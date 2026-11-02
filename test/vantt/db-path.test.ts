import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeLanguagePackVault } from './fixtures/language-pack-vault.js';

vi.mock('../../src/inference/embedder.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/inference/embedder.js')>();
  const { fixtureVector } = await import('./fixtures/language-pack-vault.js');
  return {
    ...actual,
    activeModelName: () => 'fixture-model',
    getEmbeddingDim: () => Promise.resolve(8),
    getContextLength: () => Promise.resolve(512),
    getDocumentTokenPolicy: () =>
      Promise.resolve({ limit: 508, count: (text: string) => text.length / 4 }),
    embedDetailed: vi.fn((texts: string[]) =>
      Promise.resolve(texts.map((text) => ({ ok: true as const, embedding: fixtureVector(text) }))),
    ),
    embed: vi.fn((texts: string[]) => Promise.resolve(texts.map((t) => fixtureVector(t)))),
  };
});

const { openIndexDatabase, createIndexService } =
  await import('../../src/indexing/index-service.js');
const { closeDb } = await import('../../src/storage/db.js');
const { config } = await import('../../src/runtime/config.js');
const { discoverConfig } = await import('../../src/vault/vault-config.js');
const { buildStatusPayload } = await import('../../src/transports/status-payload.js');

const root = mkdtempSync(path.join(tmpdir(), 'ohs-db-path-'));
const vaultA = path.join(root, 'vault-a');
const vaultB = path.join(root, 'vault-b');
const external = path.join(root, 'state', 'nested', 'a.db');
const DEFAULT_NAME = '.obsidian-hybrid-search.db';

async function indexVault(): Promise<void> {
  closeDb();
  await openIndexDatabase();
  const service = createIndexService();
  try {
    expect((await service.reindex()).errors).toEqual([]);
  } finally {
    await service.close();
  }
}

function dbFilesIn(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.startsWith(DEFAULT_NAME));
}

beforeEach(() => {
  rmSync(path.join(root, 'state'), { recursive: true, force: true });
  for (const vault of [vaultA, vaultB]) {
    rmSync(vault, { recursive: true, force: true });
    mkdirSync(vault, { recursive: true });
    writeLanguagePackVault(vault);
  }
  delete process.env.OBSIDIAN_DB_PATH;
  process.env.OBSIDIAN_VAULT_PATH = vaultA;
});

afterEach(() => {
  closeDb();
  delete process.env.OBSIDIAN_DB_PATH;
  vi.restoreAllMocks();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('db path resolution', () => {
  it('defaults to the vault location when nothing is configured', () => {
    expect(config.dbPath).toBe(path.join(vaultA, DEFAULT_NAME));
    process.env.OBSIDIAN_DB_PATH = '   ';
    expect(config.dbPath).toBe(path.join(vaultA, DEFAULT_NAME));
  });

  it('uses OBSIDIAN_DB_PATH and rejects a relative path', () => {
    process.env.OBSIDIAN_DB_PATH = external;
    expect(config.dbPath).toBe(external);
    process.env.OBSIDIAN_DB_PATH = 'relative/a.db';
    expect(() => config.dbPath).toThrow(/absolute/);
  });
});

describe('external database', () => {
  it('keeps every database file out of the vault and creates parent directories', async () => {
    process.env.OBSIDIAN_DB_PATH = external;
    await indexVault();
    expect(existsSync(external)).toBe(true);
    expect(dbFilesIn(vaultA)).toEqual([]);
    const payload = buildStatusPayload({ contextLength: 512, version: 'test' });
    expect(payload.db_path).toBe(external);
    expect(payload.total).toBeGreaterThan(0);
  });

  it('reports the default path in status when unconfigured', async () => {
    await indexVault();
    expect(buildStatusPayload({ contextLength: 512, version: 'test' }).db_path).toBe(
      path.join(vaultA, DEFAULT_NAME),
    );
    expect(dbFilesIn(vaultA)).toContain(DEFAULT_NAME);
  });

  it('refuses a database that belongs to another vault', async () => {
    process.env.OBSIDIAN_DB_PATH = external;
    await indexVault();
    closeDb();
    process.env.OBSIDIAN_VAULT_PATH = vaultB;
    await expect(openIndexDatabase()).rejects.toThrow(/belongs to vault .*vault-a/);
  });
});

describe('discoverConfig with --db', () => {
  it('adopts an existing database that records the active vault', async () => {
    process.env.OBSIDIAN_DB_PATH = external;
    await indexVault();
    closeDb();
    delete process.env.OBSIDIAN_DB_PATH;
    discoverConfig(external);
    expect(config.dbPath).toBe(external);
  });

  it('does not adopt another vault database or create one for an explicit vault', async () => {
    process.env.OBSIDIAN_DB_PATH = external;
    await indexVault();
    closeDb();
    delete process.env.OBSIDIAN_DB_PATH;
    process.env.OBSIDIAN_VAULT_PATH = vaultB;
    discoverConfig(external);
    discoverConfig(path.join(root, 'missing.db'));
    expect(config.dbPath).toBe(path.join(vaultB, DEFAULT_NAME));
  });

  it('uses --db only to find the vault when no vault is set', async () => {
    process.env.OBSIDIAN_DB_PATH = external;
    await indexVault();
    closeDb();
    delete process.env.OBSIDIAN_DB_PATH;
    delete process.env.OBSIDIAN_VAULT_PATH;
    discoverConfig(external);
    expect(process.env.OBSIDIAN_VAULT_PATH).toBe(vaultA);
    expect(process.env.OBSIDIAN_DB_PATH).toBeUndefined();
    expect(config.dbPath).toBe(path.join(vaultA, DEFAULT_NAME));
  });

  it('finds the vault from an existing OBSIDIAN_DB_PATH database', async () => {
    process.env.OBSIDIAN_DB_PATH = external;
    await indexVault();
    closeDb();
    delete process.env.OBSIDIAN_VAULT_PATH;
    vi.spyOn(process, 'cwd').mockReturnValue(root);
    discoverConfig();
    expect(process.env.OBSIDIAN_VAULT_PATH).toBe(vaultA);
    expect(config.dbPath).toBe(external);
  });

  it('leaves the default location alone for an in-vault --db', () => {
    const inVault = path.join(vaultA, DEFAULT_NAME);
    writeFileSync(inVault, '');
    delete process.env.OBSIDIAN_VAULT_PATH;
    discoverConfig(inVault);
    expect(process.env.OBSIDIAN_DB_PATH).toBeUndefined();
  });
});
