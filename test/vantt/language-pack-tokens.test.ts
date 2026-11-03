import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  buildMarkedSnippet,
  mapHighlightedTokens,
  matchedWords,
  parseTokenizerRules,
  tokenize,
} from '../../src/language/tokens.js';
import { DEFAULT_VIEW_TOKENIZER, VIEW_CONTINUATION } from '../../src/language/types.js';

const S = '\u0001';
const E = '\u0002';
const rules = parseTokenizerRules(DEFAULT_VIEW_TOKENIZER)!;
const joinRules = parseTokenizerRules("unicode61 remove_diacritics 0 tokenchars '+#_'")!;

describe('tokenizer emulation', () => {
  it('parses supported tokenizer specs and rejects others', () => {
    expect(rules.tokenChars).toEqual(new Set(['+', '#']));
    expect(parseTokenizerRules("porter unicode61 separators '-'")!.separators).toEqual(
      new Set(['-']),
    );
    expect(parseTokenizerRules('ascii')!.ascii).toBe(true);
    expect(parseTokenizerRules('')).not.toBeNull();
    expect(parseTokenizerRules('trigram')).toBeNull();
    expect(parseTokenizerRules("unicode61 categories 'L*'")).toBeNull();
  });

  it.each([DEFAULT_VIEW_TOKENIZER, "unicode61 remove_diacritics 2 tokenchars '_'", 'ascii'])(
    'splits text exactly like SQLite FTS5 (%s)',
    (spec) => {
      const text = 'Kế hoạch C++ snake_case été (NFD) 12,5% ok…done α-β 中文字 🎉emoji a+b #tag x';
      const db = new Database(':memory:');
      try {
        db.exec(`CREATE VIRTUAL TABLE t USING fts5(c, tokenize = '${spec.replaceAll("'", "''")}');
          CREATE VIRTUAL TABLE v USING fts5vocab(t, 'instance');`);
        db.prepare('INSERT INTO t(c) VALUES (?)').run(text);
        const sqlite = (
          db.prepare('SELECT offset FROM v ORDER BY offset').all() as Array<{ offset: number }>
        ).length;
        expect(tokenize(text, parseTokenizerRules(spec)!)).toHaveLength(sqlite);
      } finally {
        db.close();
      }
    },
  );
});

describe('mapping view matches to original text', () => {
  it('maps one-to-one tokens and joined tokens', () => {
    const original = 'Die Große Straße am Ende';
    const highlighted = `DIE ${S}GROSSE_STRASSE${E} AM ENDE`;
    const mapped = mapHighlightedTokens(original, highlighted, joinRules, S, E)!;
    expect([...mapped.matched]).toEqual([1, 2]);
    expect(matchedWords(original, mapped.tokens, mapped.matched)).toEqual(['Große', 'Straße']);
    expect(buildMarkedSnippet(original, mapped.tokens, mapped.matched, 10, S, E)).toBe(
      `Die ${S}Große${E} ${S}Straße${E} am Ende`,
    );
  });

  it('counts an original snake_case word as two tokens on both sides', () => {
    const original = 'call snake_case here';
    const mapped = mapHighlightedTokens(original, `CALL ${S}SNAKE_CASE${E} HERE`, joinRules, S, E)!;
    expect(matchedWords(original, mapped.tokens, mapped.matched)).toEqual(['snake', 'case']);
  });

  it('maps split continuation tokens to the source token they came from', () => {
    const C = VIEW_CONTINUATION;
    const splitRules = parseTokenizerRules(`unicode61 remove_diacritics 2 tokenchars '${C}'`)!;
    const original = 'Das Donaudampfschiff fährt';
    const highlighted = `das donaudampfschiff ${S}${C}dampf${E} ${C}schiff fahrt`;
    const mapped = mapHighlightedTokens(original, highlighted, splitRules, S, E)!;
    expect(matchedWords(original, mapped.tokens, mapped.matched)).toEqual(['Donaudampfschiff']);
  });

  it('returns null when the projection changes the token count', () => {
    expect(mapHighlightedTokens('one two three', `TWO ${S}THREE${E}`, rules, S, E)).toBeNull();
  });

  it('cuts a window around the densest matches with ellipses', () => {
    const original = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    const tokens = tokenize(original, rules);
    const snippet = buildMarkedSnippet(original, tokens, new Set([20, 21, 3]), 6, S, E);
    expect(snippet).toBe(`...w18 w19 ${S}w20${E} ${S}w21${E} w22 w23...`);
    expect(buildMarkedSnippet(original, tokens, new Set(), 6, S, E)).toBe('');
    expect(buildMarkedSnippet(original, tokens, new Set([39]), 6, S, E)).toBe(
      `...w34 w35 w36 w37 w38 ${S}w39${E}`,
    );
  });
});

describe('loader validation', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ohs-lang-loader-'));
  // The loader reads the vault path from the environment; do not depend on another
  // test file having left one behind.
  const previousVault = process.env.OBSIDIAN_VAULT_PATH;
  beforeAll(() => {
    process.env.OBSIDIAN_VAULT_PATH = root;
  });
  afterAll(() => {
    if (previousVault === undefined) delete process.env.OBSIDIAN_VAULT_PATH;
    else process.env.OBSIDIAN_VAULT_PATH = previousVault;
    rmSync(root, { recursive: true, force: true });
    delete process.env.OHS_LANGUAGE_PACK;
    delete process.env.OHS_LANGUAGE_PACK_OPTIONS;
  });

  function packFile(name: string, body: string): string {
    const dir = path.join(root, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module","main":"main.js"}');
    writeFileSync(path.join(dir, 'main.js'), body);
    return dir;
  }

  const valid = `apiVersion: 1, id: 'x', version: '1', signature: () => 's',
    project: (_v, _f, t) => t, analyzeQuery: () => ({ viewQueries: {} })`;

  it.each([
    [
      'too many views',
      `views: [{name:'a',weight:1},{name:'b',weight:1},{name:'c',weight:1},{name:'d',weight:1}]`,
      '1 to 3 views',
    ],
    ['bad view name', `views: [{name:'Bad-Name',weight:1}]`, 'Invalid or duplicate'],
    ['bad weight', `views: [{name:'a',weight:-1}]`, 'non-negative weight'],
    ['unknown alias view', `views: [{name:'a',weight:1}], aliasViews: ['b']`, 'aliasViews'],
  ])('rejects %s', async (name, extra, message) => {
    const dir = packFile(name.replaceAll(' ', '-'), `export default { ${valid}, ${extra} };`);
    process.env.OHS_LANGUAGE_PACK = dir;
    delete process.env.OHS_LANGUAGE_PACK_OPTIONS;
    const loader = await import('../../src/language/loader.js');
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(await loader.loadLanguagePack()).toBeNull();
    } finally {
      stderr.mockRestore();
    }
    expect(loader.languagePackStatus()).toMatchObject({ loaded: false });
    expect(String(loader.languagePackStatus()!.error)).toContain(message);
  });

  it('loads an object export, a createPack factory and a direct file path', async () => {
    const loader = await import('../../src/language/loader.js');
    const object = packFile('object', `export default { ${valid}, views: [{name:'a',weight:1}] };`);
    const factory = packFile(
      'factory',
      `export function createPack(o) { return { ${valid}, id: o.id, views: [{name:'b',weight:2}] }; }`,
    );
    for (const [spec, id] of [
      [object, 'x'],
      [path.join(factory, 'main.js'), 'from-options'],
    ] as const) {
      process.env.OHS_LANGUAGE_PACK = spec;
      process.env.OHS_LANGUAGE_PACK_OPTIONS = JSON.stringify({ id: 'from-options' });
      const loaded = await loader.loadLanguagePack();
      expect(loaded?.pack.id).toBe(id);
      expect(loader.getLanguagePack()).toBe(loaded);
      expect(loaded!.views[0]!.tokenizer).toBe(DEFAULT_VIEW_TOKENIZER);
    }
    delete process.env.OHS_LANGUAGE_PACK;
    expect(await loader.loadLanguagePack()).toBeNull();
    expect(loader.languagePackStatus()).toBeUndefined();
  });
});
