import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Candidate, QueryAnalysis } from '../../src/language/types.js';
import { writeLanguagePackVault } from './fixtures/language-pack-vault.js';
import { sameUpToTies } from './fixtures/tie-aware.js';

const vault = mkdtempSync(path.join(tmpdir(), 'ohs-lang-pack-'));
process.env.OBSIDIAN_VAULT_PATH = vault;
const PACK_DIR = path.resolve(import.meta.dirname, 'fixtures/lang-upper');

const embedCalls = vi.hoisted(() => ({ documents: 0 }));
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
    embedDetailed: vi.fn((texts: string[]) => {
      embedCalls.documents += texts.length;
      return Promise.resolve(
        texts.map((text) => ({ ok: true as const, embedding: fixtureVector(text) })),
      );
    }),
    embed: vi.fn((texts: string[]) => Promise.resolve(texts.map((t) => fixtureVector(t)))),
  };
});

const { openIndexDatabase, createIndexService } =
  await import('../../src/indexing/index-service.js');
const { search } = await import('../../src/search/searcher.js');
const { closeDb, getDb, getDbVersion } = await import('../../src/storage/db.js');
const { buildStatusPayload } = await import('../../src/transports/status-payload.js');
const { handleStdioLine } = await import('../../src/transports/stdio-server.js');
const { SearchToolArgumentsSchema } = await import('../../src/contracts/boundary-validation.js');
const { readViewTermsWithPrefix } = await import('../../src/storage/language-queries.js');

type Hooks = {
  __langUpperSynonyms?: Record<string, string>;
  __langUpperQueryKey?: string;
  __langUpperAnalysis?: Partial<QueryAnalysis>;
  __langUpperContexts?: Array<{ hook: string; ctx: { vaultPath: string } | undefined }>;
  __langUpperCandidates?: Candidate[];
};
const hooks = globalThis as Hooks;

function lexTables(): string[] {
  return (
    getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'notes%lex%'")
      .all() as Array<{ name: string }>
  )
    .map((r) => r.name)
    .sort((a, b) => a.localeCompare(b));
}

function languageSetting(): string | undefined {
  return (
    getDb().prepare("SELECT value FROM settings WHERE key='language_pack'").get() as
      { value: string } | undefined
  )?.value;
}

function status() {
  const payload = buildStatusPayload({ contextLength: 512, version: 'test' });
  return payload as typeof payload & {
    language_pack?: { loaded: boolean; error?: string; [key: string]: unknown };
  };
}

/** Reopen the index with a pack configuration (null = no pack) and reindex. */
async function configure(options: Record<string, unknown> | null): Promise<void> {
  closeDb();
  if (options === null) {
    delete process.env.OHS_LANGUAGE_PACK;
    delete process.env.OHS_LANGUAGE_PACK_OPTIONS;
  } else {
    process.env.OHS_LANGUAGE_PACK = PACK_DIR;
    process.env.OHS_LANGUAGE_PACK_OPTIONS = JSON.stringify(options);
  }
  await openIndexDatabase();
  const service = createIndexService();
  try {
    const result = await service.reindex();
    expect(result.errors).toEqual([]);
  } finally {
    await service.close();
  }
}

beforeAll(async () => {
  writeLanguagePackVault(vault, {
    'streets/bridge.md': '---\ntitle: Fußgängerbrücke\n---\nA bridge for walkers.\n',
  });
  await configure(null);
});

afterEach(() => {
  delete hooks.__langUpperSynonyms;
  delete hooks.__langUpperQueryKey;
  delete hooks.__langUpperAnalysis;
  delete hooks.__langUpperContexts;
  delete hooks.__langUpperCandidates;
  vi.restoreAllMocks();
});

afterAll(() => {
  closeDb();
  delete process.env.OHS_LANGUAGE_PACK;
  delete process.env.OHS_LANGUAGE_PACK_OPTIONS;
  rmSync(vault, { recursive: true, force: true });
});

describe('without a pack', () => {
  it('has no view tables, no status field, and upstream branches only', async () => {
    await configure(null);
    expect(lexTables()).toEqual([]);
    expect(status()).not.toHaveProperty('language_pack');
    const [hit] = await search('bread', { explain: true });
    expect(Object.keys(hit!.explain!.ranks)).toEqual(['semantic', 'bm25', 'alias', 'title']);
    expect(hit!.explain!.debug).toBeUndefined();
    expect(hit).not.toHaveProperty('matchedTerms');
  });

  it('finds nothing for a query only the view can match', async () => {
    await configure(null);
    expect(await search('grosse strasse', { mode: 'fulltext' })).toEqual([]);
  });
});

describe('with the fake upper-case pack', () => {
  it('creates view, FTS, vocabulary and alias tables and reports status', async () => {
    await configure({ aliasViews: true });
    expect(lexTables()).toEqual([
      'notes_alias_lex_upper',
      'notes_fts_lex_upper',
      'notes_fts_lex_upper_config',
      'notes_fts_lex_upper_data',
      'notes_fts_lex_upper_docsize',
      'notes_fts_lex_upper_idx',
      'notes_fts_lex_upper_vocab',
      'notes_lex_upper',
    ]);
    const row = getDb()
      .prepare(
        "SELECT l.content FROM notes_lex_upper l JOIN notes n ON n.id = l.note_id WHERE n.path = 'kitchen/bread.md'",
      )
      .get() as { content: string };
    expect(row.content).toContain('MIX FLOUR');
    expect(
      getDb().prepare('SELECT content FROM notes WHERE path = ?').get('kitchen/bread.md'),
    ).toMatchObject({ content: expect.stringContaining('Mix flour') as string });
    expect(JSON.parse(languageSetting()!)).toMatchObject({
      id: 'upper',
      version: '1.0.0',
      views: [{ name: 'upper' }],
      aliasViews: ['upper'],
    });
    expect(status().language_pack).toMatchObject({
      loaded: true,
      id: 'upper',
      version: '1.0.0',
      views: ['upper'],
    });
  });

  it('adds the view branch to RRF and explains it', async () => {
    await configure({});
    const results = await search('strasse', { explain: true });
    const main = results.find((r) => r.path === 'streets/main-street.md')!;
    expect(Object.keys(main.explain!.ranks)).toEqual([
      'semantic',
      'bm25',
      'alias',
      'title',
      'view:upper',
    ]);
    expect(main.explain!.ranks['view:upper']).toBe(1);
    expect(main.explain!.ranks.bm25).toBeNull();
    expect(main.matchedBy).toContain('view:upper');
    expect(main.explain!.debug).toMatchObject({
      upper: 'STRASSE',
      notes: 9,
      vaultPathKnown: true,
    });
    expect(main.explain!.debug!.dbVersion).toBeGreaterThan(0);
    expect(main.explain!.debug!.firstTermDocs).toBeGreaterThanOrEqual(2);
    expect(main.explain!.debug!.prefixTerms).toContain('strasse');
    expect(main.explain!.debug!.phraseDocs).toBe(2);
  });

  it('searches the title field of each view in title mode', async () => {
    await configure({});
    const results = await search('fussgängerbrücke', { mode: 'title', explain: true });
    const bridge = results.find((r) => r.path === 'streets/bridge.md')!;
    expect(bridge.explain!.ranks['view:upper']).toBe(1);
    expect(bridge.matchedTerms).toEqual(['Fußgängerbrücke']);
  });

  it('maps view matches back to an original-text snippet and matched terms', async () => {
    await configure({ joinWords: [['große', 'straße']] });
    const [hit] = await search('grosse strasse', {
      mode: 'fulltext',
      anchors: true,
      snippetLength: 120,
    });
    expect(hit!.path).toBe('streets/grand-street.md');
    expect(hit!.snippet).toMatch(/^\.\.\.words .*Die Große Straße am Ende/s);
    expect(hit!.snippet).not.toMatch(/GROSSE|STRASSE|_/);
    expect(hit!.matchedTerms).toEqual(['Große', 'Straße']);
    // Anchors use the original line holding the match, cut like upstream BM25 anchors.
    expect(hit!.previewAnchors?.[0]).toMatchObject({ kind: 'bm25' });
    expect(hit!.previewAnchors?.[0]?.matchText).toContain('Die Groß');

    const [single] = await search('strasse', { mode: 'fulltext' });
    expect(single!.matchedTerms).toContain('Straße');
  });

  it('falls back to the note start when a pack breaks the token invariant', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await configure({ fail: 'invariant' });
    const results = await search('stone', { mode: 'fulltext' });
    const main = results.find((r) => r.path === 'streets/main-street.md')!;
    expect(main).toBeDefined();
    const hits = await search('grosse', { mode: 'fulltext', explain: true });
    const grand = hits.find((r) => r.path === 'streets/grand-street.md');
    expect(grand?.snippet.startsWith('# Big avenue')).toBe(true);
    expect(stderr.mock.calls.map(([text]) => String(text)).join('')).toContain(
      'broke the token invariant',
    );
  });

  it('matches projected aliases in the exact-alias branch', async () => {
    await configure({ aliasViews: true });
    const [hit] = await search('fussweg', { explain: true });
    expect(hit!.path).toBe('streets/main-street.md');
    expect(hit!.explain!.ranks.alias).toBe(1);
    expect(hit!.scores.fuzzy_title).toBe(1);
    const titleHits = await search('FUSSWEG', { mode: 'title' });
    expect(titleHits[0]!.path).toBe('streets/main-street.md');
  });

  it('applies rescore without dropping candidates or admitting unknown paths', async () => {
    await configure({});
    const plain = await search('bread', { limit: 0 });
    await configure({ rescore: 'reverse' });
    const rescored = await search('bread', { limit: 0 });
    expect(new Set(rescored.map((r) => r.path))).toEqual(new Set(plain.map((r) => r.path)));
    expect(rescored.map((r) => r.path)).not.toContain('not-a-candidate.md');
    for (const r of rescored) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.scores.hybrid).toBe(r.score);
    }
    // The pack reversed every candidate but the last, which kept its fused score.
    const kept = plain.slice(0, -1).map((r) => r.path);
    expect(rescored.slice(0, kept.length).map((r) => r.path)).toEqual([...kept].reverse());
    expect(rescored.at(-1)!.path).toBe(plain.at(-1)!.path);

    const multi = await search('bread', { queries: ['bread', 'garden'], limit: 0 });
    expect(multi.map((r) => r.path)).not.toContain('not-a-candidate.md');
  });

  it('serves fresh results when queryCacheKey changes, without reindexing', async () => {
    await configure({});
    hooks.__langUpperQueryKey = 'k1';
    hooks.__langUpperSynonyms = { zebra: 'straße' };
    const before = embedCalls.documents;
    const layout = languageSetting();
    const version = getDbVersion();
    const first = await search('zebra', { mode: 'fulltext' });
    expect(first.map((r) => r.path)).toContain('streets/main-street.md');
    hooks.__langUpperSynonyms = { zebra: 'canyon' };
    expect(await search('zebra', { mode: 'fulltext' })).toEqual(first);
    hooks.__langUpperQueryKey = 'k2';
    const second = await search('zebra', { mode: 'fulltext' });
    expect(second.map((r) => r.path)).toEqual(['nature/canyon.md']);
    expect(languageSetting()).toBe(layout);
    expect(getDbVersion()).toBe(version);
    expect(embedCalls.documents).toBe(before);
  });

  it('rebuilds only the views when the pack signature changes', async () => {
    await configure({ variant: 'a' });
    const versionBefore = getDbVersion();
    const embedded = embedCalls.documents;
    const chunks = getDb().prepare('SELECT count(*) AS n FROM vec_chunks').get();
    await configure({ variant: 'b', joinWords: [['grand', 'canyon']] });
    expect(embedCalls.documents).toBe(embedded);
    expect(getDb().prepare('SELECT count(*) AS n FROM vec_chunks').get()).toEqual(chunks);
    expect(getDbVersion()).toBeGreaterThan(versionBefore);
    expect((JSON.parse(languageSetting()!) as { signature: string }).signature).toContain(':b:');
    const row = getDb()
      .prepare(
        "SELECT l.content FROM notes_lex_upper l JOIN notes n ON n.id = l.note_id WHERE n.path = 'nature/canyon.md'",
      )
      .get() as { content: string };
    expect(row.content).toContain('GRAND_CANYON');

    // Removing the pack drops every view table, again without embedding.
    await configure(null);
    expect(lexTables()).toEqual([]);
    expect(languageSetting()).toBeUndefined();
    expect(embedCalls.documents).toBe(embedded);
  });

  it('keeps view rows in step with incremental note changes', async () => {
    await configure({});
    const service = createIndexService();
    try {
      writeFileSync(path.join(vault, 'notes/new.md'), '# Neue Straße\n\nEine Fußgängerzone.\n');
      await service.reindex({ path: 'notes/new.md' });
      expect(await search('fussgangerzone', { mode: 'fulltext' })).toHaveLength(0);
      expect((await search('strasse', { mode: 'fulltext' })).map((r) => r.path)).toContain(
        'notes/new.md',
      );
      rmSync(path.join(vault, 'notes/new.md'));
      await service.reindex({ path: 'notes/new.md' });
      expect((await search('strasse', { mode: 'fulltext' })).map((r) => r.path)).not.toContain(
        'notes/new.md',
      );
      getDb().exec(
        "INSERT INTO notes_fts_lex_upper(notes_fts_lex_upper) VALUES('integrity-check')",
      );
    } finally {
      await service.close();
    }
  });

  it('rebuilds views after a forced full reindex', async () => {
    await configure({});
    const service = createIndexService();
    try {
      await service.reindex({ force: true });
    } finally {
      await service.close();
    }
    expect(lexTables()).toContain('notes_lex_upper');
    expect((await search('grosse', { mode: 'fulltext' })).map((r) => r.path)).toContain(
      'streets/grand-street.md',
    );
  });
});

describe('broken packs', () => {
  const baseline = async () => {
    await configure(null);
    return search('bread');
  };

  it.each([
    ['load', 'lang-upper refused to load'],
    ['apiVersion', 'API version 2 is not supported'],
    ['project', 'lang-upper project failed'],
  ])('keeps running like upstream when the pack fails at %s', async (fail, message) => {
    const expected = await baseline();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await configure({ fail });
    expect(lexTables()).toEqual([]);
    expect(status().language_pack).toMatchObject({ loaded: false });
    expect(String(status().language_pack?.error)).toContain(message);
    expect(sameUpToTies(await search('bread'), expected)).toBe(true);
  });

  it('disables a pack whose projection fails while building views', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    writeFileSync(path.join(vault, 'notes/explode.md'), '# Boom\n\nThis note will explode.\n');
    try {
      await configure(null);
      await configure({ fail: 'project-on-explode' });
      expect(lexTables()).toEqual([]);
      expect(String(status().language_pack?.error)).toContain('cannot project EXPLODE');
      expect((await search('bread')).length).toBeGreaterThan(0);
    } finally {
      rmSync(path.join(vault, 'notes/explode.md'));
    }
  });

  it('reports invalid options JSON', async () => {
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    closeDb();
    process.env.OHS_LANGUAGE_PACK = PACK_DIR;
    process.env.OHS_LANGUAGE_PACK_OPTIONS = '{not json';
    await openIndexDatabase();
    expect(String(status().language_pack?.error)).toContain('not valid JSON');
  });

  it('degrades a failing analyzeQuery to upstream behavior for that query', async () => {
    const expected = await baseline();
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await configure({ fail: 'analyze' });
    expect(lexTables()).toContain('notes_lex_upper');
    const results = await search('bread');
    const pairs = (rs: typeof results) => rs.map(({ path, score }) => ({ path, score }));
    expect(sameUpToTies(pairs(results), pairs(expected))).toBe(true);
  });
});

describe('contract additions', () => {
  /** Search with extra analysis fields; a fresh query cache key per call. */
  let call = 0;
  async function searchWith(
    analysis: Partial<QueryAnalysis> | undefined,
    query: string,
    mode: 'hybrid' | 'fulltext' | 'title' = 'fulltext',
  ) {
    hooks.__langUpperAnalysis = analysis;
    hooks.__langUpperQueryKey = `contract-${++call}`;
    return search(query, { mode, explain: true });
  }
  const viewRank = (results: Awaited<ReturnType<typeof search>>, notePath: string) =>
    results.find((r) => r.path === notePath)?.explain?.ranks['view:upper'] ?? null;

  it('matches structured view terms exactly unless they ask for a prefix', async () => {
    await configure({});
    const canyon = 'nature/canyon.md';
    // Plain viewQueries stay prefix terms: "gran" finds GRAND.
    expect(viewRank(await searchWith(undefined, 'gran'), canyon)).not.toBeNull();
    expect(
      viewRank(await searchWith({ viewTerms: { upper: ['GRAN'] } }, 'gran'), canyon),
    ).toBeNull();
    expect(
      viewRank(
        await searchWith({ viewTerms: { upper: [{ text: 'GRAN', prefix: true }] } }, 'gran'),
        canyon,
      ),
    ).not.toBeNull();
    expect(
      viewRank(await searchWith({ viewTerms: { upper: ['GRAND'] } }, 'gran'), canyon),
    ).not.toBeNull();
    // A multi-token term is an exact phrase.
    expect(
      viewRank(await searchWith({ viewTerms: { upper: ['GRAND CANYON'] } }, 'canyon'), canyon),
    ).not.toBeNull();
    expect(
      viewRank(await searchWith({ viewTerms: { upper: ['CANYON GRAND'] } }, 'canyon'), canyon),
    ).toBeNull();
    // Terms are ORed; quotes cannot break out of the FTS string.
    const ored = await searchWith({ viewTerms: { upper: ['NOPE"', 'STRASSE'] } }, 'x');
    expect(viewRank(ored, 'streets/main-street.md')).not.toBeNull();
    // An empty list, null or blank terms fall back to viewQueries.
    for (const viewTerms of [{ upper: [] }, { upper: null }, { upper: ['  '] }])
      expect(viewRank(await searchWith({ viewTerms }, 'gran'), canyon)).not.toBeNull();
    // Structured terms also feed title mode.
    const titled = await searchWith({ viewTerms: { upper: ['CANYON'] } }, 'zzz', 'title');
    expect(viewRank(titled, canyon)).not.toBeNull();
  });

  it('applies a per-query view weight and keeps the declared weight otherwise', async () => {
    await configure({});
    const main = 'streets/main-street.md';
    const score = async (analysis?: Partial<QueryAnalysis>) =>
      (await searchWith(analysis, 'strasse', 'hybrid')).find((r) => r.path === main)!.score;
    const declared = await score();
    expect(await score({ viewWeights: { upper: 4 } })).toBeGreaterThan(declared);
    expect(await score({ viewWeights: { upper: 0.1 } })).toBeLessThan(declared);
    for (const upper of [null, -1, Number.NaN])
      expect(await score({ viewWeights: { upper } })).toBe(declared);
    expect(await score({ viewWeights: { other: 4 } })).toBe(declared);
  });

  it('passes original-text matched terms to rescore', async () => {
    await configure({ rescore: 'record' });
    await search('strasse', { mode: 'hybrid' });
    const candidates = hooks.__langUpperCandidates!;
    const main = candidates.find((c) => c.path === 'streets/main-street.md')!;
    expect(main.matchedViews).toEqual(['upper']);
    expect(main.matchedTerms).toContain('Straße');
    const unmatched = candidates.filter((c) => c.matchedViews.length === 0);
    expect(unmatched.length).toBeGreaterThan(0);
    for (const c of unmatched) expect(c.matchedTerms).toEqual([]);
  });

  it('passes the vault path to signature() and queryCacheKey()', async () => {
    hooks.__langUpperContexts = [];
    await configure({ variant: 'context' });
    await search('bread');
    const hooksSeen = hooks.__langUpperContexts.map(({ hook }) => hook);
    expect(hooksSeen).toContain('signature');
    expect(hooksSeen).toContain('queryCacheKey');
    for (const { ctx } of hooks.__langUpperContexts) expect(ctx).toEqual({ vaultPath: vault });
  });

  it('bounds prefix lookups to terms that start with the prefix', async () => {
    await configure({});
    const terms = (prefix: string) =>
      readViewTermsWithPrefix('upper', prefix, 50).map((t) => t.term);
    expect(terms('gran')).toEqual(['grand']);
    expect(terms('stra').every((t) => t.startsWith('stra'))).toBe(true);
    expect(terms('stra')).toContain('strasse');
    expect(terms('cr')).toEqual(expect.arrayContaining(['crème']));
    expect(terms('zzz')).toEqual([]);
    expect(terms('').length).toBeGreaterThan(10);
  });
});

describe('transports', () => {
  it('passes explain through the stdio protocol and the MCP schema', async () => {
    await configure({});
    const lines: string[] = [];
    await handleStdioLine(
      JSON.stringify({ id: '1', query: 'strasse', options: { explain: true } }),
      search,
      (line) => lines.push(line),
    );
    const response = JSON.parse(lines[0]!) as {
      results: Array<{ explain?: { ranks: Record<string, number | null> } }>;
    };
    expect(response.results[0]!.explain!.ranks).toHaveProperty('view:upper');
    expect(SearchToolArgumentsSchema.parse({ query: 'x', explain: true }).explain).toBe(true);
  });
});
