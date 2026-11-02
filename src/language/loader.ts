import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../runtime/config.js';
import {
  DEFAULT_VIEW_TOKENIZER,
  LANGUAGE_PACK_API_VERSION,
  MAX_LANGUAGE_VIEWS,
  VIEW_NAME_PATTERN,
  type LanguagePackField,
  type LanguagePackStatus,
  type LanguagePackV1,
  type LoadedLanguagePack,
} from './types.js';

interface LoaderState {
  key: string;
  requested: string;
  loaded: LoadedLanguagePack | null;
  error?: string;
}

let state: LoaderState | undefined;
let pending: { key: string; promise: Promise<LoadedLanguagePack | null> } | undefined;
const warned = new Set<string>();
let generation = 0;

const FIELDS: readonly LanguagePackField[] = ['title', 'aliases', 'content'];
const SMOKE_TEXT = 'Language pack smoke test 123';

function requestKey(): string | undefined {
  const spec = config.languagePack;
  // The vault is part of the key: signature() receives it, so another vault means another load.
  return spec ? `${spec}\0${config.languagePackOptions ?? ''}\0${config.vaultPath}` : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Log a language-pack problem once per distinct message, so a broken pack cannot flood stderr. */
export function warnLanguagePackOnce(text: string): void {
  if (warned.has(text)) return;
  warned.add(text);
  process.stderr.write(`[language] ${text}\n`);
}

function packageEntry(dir: string): string {
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >;
  } catch {
    // A plain directory without a manifest falls back to index.js.
  }
  const pick = (value: unknown): string | undefined => {
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;
      return pick(record['.']) ?? pick(record.import) ?? pick(record.node) ?? pick(record.default);
    }
    return undefined;
  };
  return (
    pick(manifest.exports) ??
    (typeof manifest.module === 'string' ? manifest.module : undefined) ??
    (typeof manifest.main === 'string' ? manifest.main : undefined) ??
    'index.js'
  );
}

function moduleSpecifier(spec: string): string {
  if (!path.isAbsolute(spec)) return spec;
  const target = statSync(spec).isDirectory() ? path.join(spec, packageEntry(spec)) : spec;
  return pathToFileURL(target).href;
}

function parseOptions(): unknown {
  const raw = config.languagePackOptions;
  if (raw === undefined || raw.trim() === '') return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new Error(`OHS_LANGUAGE_PACK_OPTIONS is not valid JSON: ${message(error)}`, {
      cause: error,
    });
  }
}

function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

/** Check the contract and build the table layout; throws a descriptive error. */
function validateLanguagePack(candidate: unknown): LoadedLanguagePack {
  if (!candidate || typeof candidate !== 'object')
    throw new Error('Language pack module did not provide a pack object');
  const pack = candidate as Partial<LanguagePackV1> & Record<string, unknown>;
  if (pack.apiVersion !== LANGUAGE_PACK_API_VERSION)
    throw new Error(
      `Language pack API version ${String(pack.apiVersion)} is not supported; this OHS supports version ${LANGUAGE_PACK_API_VERSION}`,
    );
  if (typeof pack.id !== 'string' || !pack.id) throw new Error('Language pack id must be a string');
  if (typeof pack.version !== 'string') throw new Error('Language pack version must be a string');
  if (!isFunction(pack.signature) || !isFunction(pack.project) || !isFunction(pack.analyzeQuery))
    throw new Error('Language pack must implement signature(), project() and analyzeQuery()');
  if (pack.rescore !== undefined && !isFunction(pack.rescore))
    throw new Error('Language pack rescore must be a function');
  if (pack.queryCacheKey !== undefined && !isFunction(pack.queryCacheKey))
    throw new Error('Language pack queryCacheKey must be a function');
  const signature = pack.signature({ vaultPath: config.vaultPath });
  if (typeof signature !== 'string')
    throw new Error('Language pack signature() must return a string');
  if (!Array.isArray(pack.views) || pack.views.length < 1 || pack.views.length > MAX_LANGUAGE_VIEWS)
    throw new Error(`Language pack must declare 1 to ${MAX_LANGUAGE_VIEWS} views`);
  const names = new Set<string>();
  const views = pack.views.map((view: unknown) => {
    const v = view as Record<string, unknown>;
    if (typeof v?.name !== 'string' || !VIEW_NAME_PATTERN.test(v.name) || names.has(v.name))
      throw new Error(`Invalid or duplicate language view name: ${String(v?.name)}`);
    if (typeof v.weight !== 'number' || !Number.isFinite(v.weight) || v.weight < 0)
      throw new Error(`Language view ${v.name} needs a finite, non-negative weight`);
    if (
      v.tokenizer !== undefined &&
      (typeof v.tokenizer !== 'string' || v.tokenizer.includes('\0'))
    )
      throw new Error(`Language view ${v.name} has an invalid tokenizer`);
    names.add(v.name);
    return {
      name: v.name,
      weight: v.weight,
      tokenizer: v.tokenizer ?? DEFAULT_VIEW_TOKENIZER,
    };
  });
  const rawAliasViews: unknown = pack.aliasViews ?? [];
  if (
    !Array.isArray(rawAliasViews) ||
    (rawAliasViews as unknown[]).some((name) => typeof name !== 'string' || !names.has(name))
  )
    throw new Error('Language pack aliasViews must name declared views');
  const aliasViews = rawAliasViews as string[];
  const typed = pack as LanguagePackV1;
  for (const view of views)
    for (const field of FIELDS)
      if (typeof typed.project(view.name, field, SMOKE_TEXT) !== 'string')
        throw new Error(`Language pack project(${view.name}, ${field}) must return a string`);
  const layout = JSON.stringify({
    id: typed.id,
    version: typed.version,
    signature,
    views: views.map(({ name, tokenizer }) => ({ name, tokenizer })),
    aliasViews: [...aliasViews],
  });
  return { pack: typed, views, aliasViews: [...aliasViews], layout, generation: ++generation };
}

async function importPack(spec: string): Promise<LoadedLanguagePack> {
  const options = parseOptions();
  // The specifier is computed at runtime on purpose: packs are installed beside
  // OHS, never declared as its dependencies.
  const specifier = moduleSpecifier(spec);
  const mod = (await import(specifier)) as Record<string, unknown>;
  const exported = mod.createPack ?? mod.default;
  const candidate: unknown = isFunction(exported)
    ? await (exported as (options: unknown) => unknown)(options)
    : exported;
  return validateLanguagePack(candidate);
}

/**
 * Load the pack named by OHS_LANGUAGE_PACK once per configuration. Never throws:
 * a pack that cannot be loaded is reported through languagePackStatus() and OHS
 * continues exactly as if no pack were configured.
 */
export async function loadLanguagePack(): Promise<LoadedLanguagePack | null> {
  const key = requestKey();
  if (key === undefined) {
    state = undefined;
    return null;
  }
  if (state?.key === key) return state.loaded;
  if (pending?.key === key) return pending.promise;
  const requested = config.languagePack!;
  const promise = importPack(requested).then(
    (loaded) => {
      state = { key, requested, loaded };
      return loaded;
    },
    (error: unknown) => {
      state = { key, requested, loaded: null, error: message(error) };
      warnLanguagePackOnce(
        `pack "${requested}" was not loaded: ${message(error)}. Continuing without a language pack.`,
      );
      return null;
    },
  );
  pending = { key, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) pending = undefined;
  }
}

/** The loaded pack for the current configuration, or null. */
export function getLanguagePack(): LoadedLanguagePack | null {
  const key = requestKey();
  return key !== undefined && state?.key === key ? state.loaded : null;
}

/** Turn a pack off for the rest of this process after it failed at runtime. */
export function disableLanguagePack(error: unknown): void {
  if (!state?.loaded) return;
  const text = `pack "${state.requested}" failed and was disabled: ${message(error)}`;
  state = { ...state, loaded: null, error: text };
  warnLanguagePackOnce(`${text}. Continuing without a language pack.`);
}

/** Status payload field; undefined when no pack is configured. */
export function languagePackStatus(): LanguagePackStatus | undefined {
  const key = requestKey();
  if (key === undefined) return undefined;
  if (state?.key !== key) return { requested: config.languagePack!, loaded: false };
  const loaded = state.loaded;
  if (!loaded) return { requested: state.requested, loaded: false, error: state.error };
  return {
    requested: state.requested,
    loaded: true,
    id: loaded.pack.id,
    version: loaded.pack.version,
    signature: (JSON.parse(loaded.layout) as { signature: string }).signature,
    views: loaded.views.map((view) => view.name),
  };
}
