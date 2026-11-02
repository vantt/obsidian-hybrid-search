import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createPack, CONTINUATION as J, projectText } from '../src/index.js';
import { createSplitter } from '../src/compound.js';

const splitter = createSplitter();
const SOURCE_TOKEN = /[\p{L}\p{N}\p{M}\p{Co}+#]+/gu;
const viewTokens = (text: string) => text.match(SOURCE_TOKEN) ?? [];
const sourceTokens = (text: string) => text.replaceAll(J, ' ').match(SOURCE_TOKEN) ?? [];

describe('projection', () => {
  it('keeps the folded key first and adds continuations', () => {
    expect(projectText('Käse', splitter)).toBe(`kase ${J}kaese`);
    expect(projectText('Straße', splitter)).toBe('strasse');
    expect(projectText('Fußgängerbrücke', splitter)).toBe(
      ['fussgangerbrucke', 'fussgaengerbruecke', 'fuss', 'ganger', 'gaenger', 'brucke', 'bruecke']
        .map((t, i) => (i < 1 ? t : J + t))
        .join(' '),
    );
  });
  it('is deterministic and pure', () => {
    const text = 'Die Große Straße, Fußgängerbrücke und C++ #tag';
    expect(projectText(text, splitter)).toBe(projectText(text, splitter));
  });
  it('keeps one non-continuation view token per source token', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 60 }), (text) => {
        const view = viewTokens(projectText(text, splitter));
        const plain = view.filter((t) => !t.startsWith(J));
        expect(plain.length).toBe(sourceTokens(text).length);
        expect(view.every((t, i) => !t.startsWith(J) || i > 0)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
  it('strips a literal word joiner from the source', () => {
    expect(projectText(`a${J}b`, null)).toBe('a b');
  });
});

describe('pack contract', () => {
  const ctx = {
    termStats: () => ({ docs: 0, hits: 0 }),
    termsWithPrefix: () => [],
    phraseDocs: () => 0,
    noteCount: () => 0,
    dbVersion: () => 1,
    vaultPath: '/v',
  };
  const pack = createPack();
  it('declares a valid layout', () => {
    expect(pack.apiVersion).toBe(1);
    expect(pack.views.length).toBe(1);
    expect(pack.views[0]?.name).toMatch(/^[a-z][a-z0-9_]{0,15}$/);
    expect(pack.views[0]?.tokenizer).toContain(J);
    expect(pack.aliasViews).toEqual(['de']);
  });
  it('signature changes with options that shape the index', () => {
    expect(createPack({ splitCompounds: false }).signature()).not.toBe(pack.signature());
    expect(createPack({ extraWords: ['Sauerkraut'] }).signature()).not.toBe(pack.signature());
    expect(createPack().signature()).toBe(pack.signature());
  });
  it('analyzes a query into spellings, drops stop words', () => {
    const a = pack.analyzeQuery('die Straße', ctx);
    const words = (a.viewQueries.de ?? '').split(' ');
    expect(words).toContain('strasse');
    expect(words).toContain(`${J}strasse`);
    expect(words).not.toContain('die');
    const b = pack.analyzeQuery('Käse', ctx);
    expect((b.viewQueries.de ?? '').split(' ')).toEqual(
      expect.arrayContaining(['kase', 'kaese', `${J}kase`, `${J}kaese`]),
    );
  });
  it('keeps stop words when nothing else is left, null for empty', () => {
    expect(pack.analyzeQuery('die', ctx).viewQueries.de).toContain('die');
    expect(pack.analyzeQuery('  ', ctx).viewQueries.de).toBeNull();
  });
  it('alias key equals the projection of the alias', () => {
    expect(pack.analyzeQuery('Fußweg', ctx).aliasKeys?.de).toBe(pack.project('de', 'aliases', 'Fußweg'));
  });
  it('splits query compounds into component spellings', () => {
    const words = (pack.analyzeQuery('Fußgängerbrücke', ctx).viewQueries.de ?? '').split(' ');
    expect(words).toEqual(expect.arrayContaining(['brucke', 'bruecke', `${J}brucke`]));
  });
});
