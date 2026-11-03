import type { QueryContext } from '../src/contract.js';
import { createPack } from '../src/index.js';
import { resolveOptions, type PackOptions } from '../src/options.js';
import { tokenize } from '../src/views.js';

/** Tokens of the seg view: `_` is a token character there (SEG_TOKENIZER). */
const segTokenize = (text: string): string[] => text.match(/[\p{L}\p{N}\p{Co}\p{M}+#_]+/gu) ?? [];

export interface FakeContext extends QueryContext {
  /** Number of termStats / phraseDocs calls made (cache tests). */
  calls: { termStats: number; phraseDocs: number };
  /** Bump the db version (simulates a note write). */
  bump(): void;
}

/**
 * A QueryContext over an in-memory "vault": each document is projected with
 * the pack's own views, then term document counts and adjacent-pair phrase
 * counts are computed like FTS5 would (prefix-free, exact token match).
 */
export function fakeContext(
  docs: readonly string[],
  options: PackOptions = resolveOptions(),
): FakeContext {
  const pack = createPack(options);
  const views = pack.views.map((v) => v.name);
  const termDocs = new Map<string, Map<string, number>>();
  const phraseDocs = new Map<string, Map<string, number>>();
  for (const view of views) {
    const terms = new Map<string, number>();
    const phrases = new Map<string, number>();
    for (const doc of docs) {
      const projected = pack.project(view, 'content', doc);
      const words = (view === 'seg' ? segTokenize(projected) : tokenize(projected)).map((w) =>
        w.toLowerCase(),
      );
      for (const w of new Set(words)) terms.set(w, (terms.get(w) ?? 0) + 1);
      const pairs = new Set<string>();
      for (let i = 1; i < words.length; i++) pairs.add(`${words[i - 1]} ${words[i]}`);
      for (const p of pairs) phrases.set(p, (phrases.get(p) ?? 0) + 1);
    }
    termDocs.set(view, terms);
    phraseDocs.set(view, phrases);
  }
  return fakeContextFromCounts(termDocs, phraseDocs, docs.length);
}

/** A QueryContext over precomputed counts (perf tests with a large vocabulary). */
export function fakeContextFromCounts(
  termDocs: Map<string, Map<string, number>>,
  phraseDocs: Map<string, Map<string, number>>,
  noteCount: number,
): FakeContext {
  let version = 1;
  const calls = { termStats: 0, phraseDocs: 0 };
  return {
    calls,
    bump: () => {
      version++;
    },
    termStats(view, term) {
      calls.termStats++;
      const n = termDocs.get(view)?.get(term) ?? 0;
      return { docs: n, hits: n };
    },
    termsWithPrefix(view, prefix, limit) {
      const out: Array<{ term: string; docs: number }> = [];
      for (const [term, docs] of termDocs.get(view) ?? [])
        if (term.startsWith(prefix)) out.push({ term, docs });
      return out.sort((a, b) => b.docs - a.docs || (a.term < b.term ? -1 : 1)).slice(0, limit);
    },
    phraseDocs(view, phrase) {
      calls.phraseDocs++;
      const words = phrase.split(' ');
      if (words.length !== 2) return 0;
      return phraseDocs.get(view)?.get(phrase) ?? 0;
    },
    noteCount: () => noteCount,
    dbVersion: () => version,
    vaultPath: '/fake/vault',
  };
}
