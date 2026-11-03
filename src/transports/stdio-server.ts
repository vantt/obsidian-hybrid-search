import {
  formatValidationError,
  parseStringArrayParam,
  StdioNeighborsRequestSchema,
  StdioReadRequestSchema,
  StdioReindexRequestSchema,
  StdioRequestSchema,
  StdioStatusRequestSchema,
  StdioVectorsRequestSchema,
  type SearchOptionsBoundary,
} from '../contracts/boundary-validation.js';
import type { NeighborsOptions, NoteVectorsOptions, VectorExport } from '../search/note-vectors.js';
import type { SearchOptions, SearchResult } from '../search/searcher.js';

export type SearchFunction = (query: string, options?: SearchOptions) => Promise<SearchResult[]>;
export type StatusFunction = () => Promise<Record<string, unknown>> | Record<string, unknown>;

/** `ohsVersion` is added by the transport; callers of the stdio actions never send it. */
type StdioVectorsParams = Omit<NoteVectorsOptions, 'ohsVersion'>;
type StdioNeighborsParams = Omit<NeighborsOptions, 'ohsVersion'>;

/**
 * Implementations of the non-search actions, supplied by the server that owns the
 * index. An action whose handler is missing answers "not available on this server".
 */
export interface StdioActionHandlers {
  read?: (paths: string[], options: { snippetLength?: number; related?: boolean }) => unknown[];
  vectors?: (params: StdioVectorsParams) => VectorExport<unknown>;
  neighbors?: (params: StdioNeighborsParams) => VectorExport<unknown>;
  reindex?: (params: { path?: string; force?: boolean }) => Promise<unknown>;
}

export interface StdioResponse {
  id: string;
  results?: SearchResult[];
  status?: Record<string, unknown>;
  /** `read`: one entry per requested path, in request order. */
  notes?: unknown[];
  /** `vectors` and `neighbors`: the same meta object and records the CLI prints. */
  meta?: Record<string, unknown>;
  records?: unknown[];
  /** `reindex`: the index result. */
  result?: unknown;
  error?: string;
}

/** Longest time a closing server waits for requests that are still running. */
const STDIO_DRAIN_TIMEOUT_MS = 60_000;

/**
 * Resolve once every promise in `inFlight` has settled, or after `timeoutMs`.
 * Returns true when everything settled. Requests that arrive meanwhile are waited for too.
 */
export async function drainInFlight(
  inFlight: ReadonlySet<Promise<unknown>>,
  timeoutMs: number = STDIO_DRAIN_TIMEOUT_MS,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  const settled = (async (): Promise<true> => {
    while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    return true;
  })();
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Process a single newline-delimited JSON request for the stdio IPC server.
 * Exported for unit testing — called by `ohs serve --stdio` in a loop.
 *
 * Protocol:
 *   Request:  {"id":"1","query":"zettelkasten","options":{...}}
 *   Response: {"id":"1","results":[...]}
 *   Request:  {"id":"2","action":"status"}
 *   Response: {"id":"2","status":{...}}
 *   Error:    {"id":"1","error":"message"}
 */
export async function handleStdioLine(
  line: string,
  searchFn: SearchFunction,
  writeLine: (s: string) => void,
  statusFn?: StatusFunction,
  actions: StdioActionHandlers = {},
): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  let id = 'unknown';
  try {
    const raw: unknown = JSON.parse(trimmed);
    if (isRecord(raw) && typeof raw.id === 'string') {
      id = raw.id;
    }

    if (isRecord(raw) && Object.hasOwn(raw, 'action')) {
      if (typeof raw.action !== 'string') {
        writeLine(JSON.stringify({ id, error: 'Invalid stdio request: action must be a string' }));
        return;
      }
      if (!KNOWN_ACTIONS.has(raw.action)) {
        writeLine(JSON.stringify({ id, error: `unknown action: ${raw.action}` }));
        return;
      }
      if (raw.action === 'status') {
        const parsed = StdioStatusRequestSchema.safeParse(raw);
        if (!parsed.success) {
          writeLine(
            JSON.stringify({ id, error: formatValidationError('stdio request', parsed.error) }),
          );
          return;
        }
        if (!statusFn) {
          writeLine(JSON.stringify({ id, error: 'status is not available on this server' }));
          return;
        }
        writeLine(JSON.stringify({ id, status: await statusFn() }));
        return;
      }
      if (raw.action !== 'search') {
        writeLine(JSON.stringify({ id, ...(await runAction(raw.action, raw, actions)) }));
        return;
      }
    }

    const parsed = StdioRequestSchema.safeParse(raw);
    if (!parsed.success) {
      writeLine(
        JSON.stringify({ id, error: formatValidationError('stdio request', parsed.error) }),
      );
      return;
    }

    const req = parsed.data;
    const options = normalizeSearchOptions(req.options);
    const results = await searchFn(req.query, options);
    writeLine(JSON.stringify({ id, results }));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    writeLine(JSON.stringify({ id, error }));
  }
}

const KNOWN_ACTIONS: ReadonlySet<string> = new Set([
  'search',
  'status',
  'read',
  'vectors',
  'neighbors',
  'reindex',
]);

/** Validate and run `read`, `vectors`, `neighbors` or `reindex`; returns the response fields. */
async function runAction(
  action: string,
  raw: Record<string, unknown>,
  actions: StdioActionHandlers,
): Promise<Omit<StdioResponse, 'id'>> {
  const invalid = (error: unknown): { error: string } => ({
    error: formatValidationError(
      'stdio request',
      error as Parameters<typeof formatValidationError>[1],
    ),
  });
  const unavailable = { error: `${action} is not available on this server` };

  if (action === 'read') {
    const parsed = StdioReadRequestSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    if (!actions.read) return unavailable;
    const rawPaths = parseStringArrayParam('paths', parsed.data.paths);
    const paths = Array.isArray(rawPaths) ? rawPaths : rawPaths ? [rawPaths] : [];
    if (paths.length === 0) return { error: 'Invalid stdio request: paths must not be empty' };
    return {
      notes: actions.read(paths, {
        snippetLength: parsed.data.snippetLength,
        related: parsed.data.related !== false,
      }),
    };
  }
  if (action === 'vectors') {
    const parsed = StdioVectorsRequestSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    if (!actions.vectors) return unavailable;
    const { paths, pooling, normalize } = parsed.data;
    return collectExport(actions.vectors({ paths, pooling, normalize }));
  }
  if (action === 'neighbors') {
    const parsed = StdioNeighborsRequestSchema.safeParse(raw);
    if (!parsed.success) return invalid(parsed.error);
    if (!actions.neighbors) return unavailable;
    const { paths, k, minScore, excludeLinked, pooling } = parsed.data;
    const scope = parseStringArrayParam('scope', parsed.data.scope);
    return collectExport(actions.neighbors({ paths, k, minScore, excludeLinked, scope, pooling }));
  }
  const parsed = StdioReindexRequestSchema.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  if (!actions.reindex) return unavailable;
  return { result: await actions.reindex({ path: parsed.data.path, force: parsed.data.force }) };
}

function collectExport(exported: VectorExport<unknown>): Omit<StdioResponse, 'id'> {
  return {
    meta: exported.meta as unknown as Record<string, unknown>,
    records: [...exported.records],
  };
}

function normalizeSearchOptions(rawOptions: SearchOptionsBoundary | undefined): SearchOptions {
  if (rawOptions === undefined) {
    return {};
  }

  const options: SearchOptions = {};
  if (rawOptions.mode !== undefined) options.mode = rawOptions.mode;
  if (rawOptions.limit !== undefined) options.limit = rawOptions.limit;
  if (rawOptions.threshold !== undefined) options.threshold = rawOptions.threshold;
  if (rawOptions.related !== undefined) options.related = rawOptions.related;
  if (rawOptions.depth !== undefined) options.depth = rawOptions.depth;
  if (rawOptions.direction !== undefined) options.direction = rawOptions.direction;
  if (rawOptions.linkType !== undefined) options.linkType = rawOptions.linkType;
  if (rawOptions.snippetLength !== undefined) options.snippetLength = rawOptions.snippetLength;
  if (rawOptions.notePath !== undefined) options.notePath = rawOptions.notePath;
  if (rawOptions.rerank !== undefined) options.rerank = rawOptions.rerank;
  if (rawOptions.queries !== undefined) options.queries = rawOptions.queries;
  if (rawOptions.anchors !== undefined) options.anchors = rawOptions.anchors;
  if (rawOptions.explain !== undefined) options.explain = rawOptions.explain;

  const scope = parseStringArrayParam('scope', rawOptions.scope);
  if (scope !== undefined) options.scope = scope;
  const tag = parseStringArrayParam('tag', rawOptions.tag);
  if (tag !== undefined) options.tag = tag;
  const frontmatter = parseStringArrayParam('frontmatter', rawOptions.frontmatter);
  if (frontmatter !== undefined) options.frontmatter = frontmatter;

  return options;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
