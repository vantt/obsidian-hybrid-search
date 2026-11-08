import { createSplitter } from './compound.js';
import { foldWord } from './fold.js';
import { CONTINUATION, projectText, sourceWords, VIEW_TOKENIZER, wordTokens } from './project.js';
import { STOPWORDS } from './stopwords.js';
import type { LanguagePackV1, QueryAnalysis, QueryContext } from './types.js';

export { createSplitter } from './compound.js';
export { foldWord, transliterateWord } from './fold.js';
export { CONTINUATION, projectText, VIEW_TOKENIZER } from './project.js';
export type * from './types.js';

export const PACK_VERSION = '0.1.0';
const VIEW = 'de';

/** Default `Array#sort` order (UTF-16 code units), spelled out so the signature stays stable. */
const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export interface GermanPackOptions {
  /** Split long compounds into components (default true). */
  splitCompounds?: boolean;
  /** Extra compound components, natural spelling. */
  extraWords?: string[];
}

export function createPack(options: GermanPackOptions = {}): LanguagePackV1 {
  const split = options.splitCompounds !== false;
  const extra = Array.isArray(options.extraWords)
    ? options.extraWords.filter((w): w is string => typeof w === 'string')
    : [];
  const splitter = split ? createSplitter(extra) : null;

  /** Query words of one source word: every spelling, as a whole token and as a component. */
  function queryTokens(word: string): string[] {
    const out: string[] = [];
    for (const token of wordTokens(word, splitter)) {
      const bare = token.startsWith(CONTINUATION) ? token.slice(1) : token;
      for (const form of [bare, CONTINUATION + bare]) if (!out.includes(form)) out.push(form);
    }
    return out;
  }

  return {
    apiVersion: 1,
    id: 'de',
    version: PACK_VERSION,
    signature: () =>
      `${PACK_VERSION}:${split ? 1 : 0}:${JSON.stringify([...extra].sort(byCodeUnit))}`,
    views: [{ name: VIEW, weight: 1.0, tokenizer: VIEW_TOKENIZER }],
    aliasViews: [VIEW],
    project: (_view, _field, text) => projectText(text, splitter),
    analyzeQuery(query: string, ctx: QueryContext): QueryAnalysis {
      const words = sourceWords(query);
      const content = words.filter((w) => !STOPWORDS.has(foldWord(w)));
      const used = content.length > 0 ? content : words;
      const tokens = [...new Set(used.flatMap(queryTokens))];
      const first = used[0] ? foldWord(used[0]) : '';
      return {
        viewQueries: { [VIEW]: tokens.length > 0 ? tokens.join(' ') : null },
        aliasKeys: { [VIEW]: projectText(query, splitter) || null },
        debug: {
          words: used,
          tokens,
          firstTermDocs: first ? ctx.termStats(VIEW, first).docs : 0,
          notes: ctx.noteCount(),
        },
      };
    },
  };
}

/** Default export is the factory OHS calls with OHS_LANGUAGE_PACK_OPTIONS. */
export default createPack;
