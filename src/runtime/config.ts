import path from 'node:path';

export const DEFAULT_RERANKER_MODEL = 'onnx-community/gte-multilingual-reranker-base';

const DEFAULT_WATCH_DEBOUNCE_MS = 5_000;

/** Per-file watcher debounce; OBSIDIAN_WATCH_DEBOUNCE_MS overrides it (non-negative integer). */
function watchDebounceMs(): number {
  const raw = process.env.OBSIDIAN_WATCH_DEBOUNCE_MS?.trim();
  if (!raw) return DEFAULT_WATCH_DEBOUNCE_MS;
  if (!/^\d+$/.test(raw))
    throw new Error(
      `OBSIDIAN_WATCH_DEBOUNCE_MS must be a non-negative integer (received "${raw}")`,
    );
  return Number(raw);
}

export const config = {
  get obsidianPrefix(): string {
    return process.env.OBSIDIAN_PREFIX ?? '';
  },
  get vaultPath(): string {
    const v = process.env.OBSIDIAN_VAULT_PATH;
    if (!v) throw new Error('OBSIDIAN_VAULT_PATH environment variable is required');
    return v;
  },
  get ignorePatterns(): string[] {
    return (process.env.OBSIDIAN_IGNORE_PATTERNS ?? '.obsidian/**,templates/**,*.canvas')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  },
  get includePatterns(): string[] {
    return (process.env.OBSIDIAN_INCLUDE_PATTERNS ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  },
  get contentIgnorePatternsRaw(): string | undefined {
    return process.env.OBSIDIAN_CONTENT_IGNORE_PATTERNS;
  },
  get respectGitignore(): boolean {
    const raw = process.env.OBSIDIAN_RESPECT_GITIGNORE?.trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'no';
  },
  get apiKey(): string | undefined {
    return process.env.OPENAI_API_KEY;
  },
  get apiBaseUrl(): string {
    return process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  },
  get apiModel(): string {
    return process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
  },
  get localModel(): string {
    return process.env.LOCAL_EMBEDDING_MODEL ?? 'Xenova/multilingual-e5-small';
  },
  /** Language pack module name or absolute path; unset means no pack. */
  get languagePack(): string | undefined {
    return process.env.OHS_LANGUAGE_PACK?.trim() || undefined;
  },
  get languagePackOptions(): string | undefined {
    return process.env.OHS_LANGUAGE_PACK_OPTIONS;
  },
  /** Optional upper bound for the chunk size in estimated tokens; unset keeps the model limit. */
  get chunkTokens(): number | undefined {
    const parsed = Number.parseInt(process.env.OBSIDIAN_CHUNK_TOKENS?.trim() ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  },
  get rerankerModel(): string {
    return process.env.RERANKER_MODEL ?? DEFAULT_RERANKER_MODEL;
  },
  /** Absolute path of an index database kept outside the default location; unset means the default. */
  get dbPathOverride(): string | undefined {
    const raw = process.env.OBSIDIAN_DB_PATH?.trim();
    if (!raw) return undefined;
    if (!path.isAbsolute(raw)) {
      throw new Error(`OBSIDIAN_DB_PATH must be an absolute path (received "${raw}")`);
    }
    return path.normalize(raw);
  },
  get dbPath(): string {
    const override = this.dbPathOverride;
    if (override) return override;
    const v = process.env.OBSIDIAN_VAULT_PATH;
    if (!v) throw new Error('OBSIDIAN_VAULT_PATH environment variable is required');
    return path.join(v, '.obsidian-hybrid-search.db');
  },
  // internal defaults
  chunkContextFallback: 512,
  chunkOverlap: 64,
  chunkMinLength: 50,
  chunkHeadingLevel: 0,
  batchSize: 10,
  debounce: watchDebounceMs(),
};
