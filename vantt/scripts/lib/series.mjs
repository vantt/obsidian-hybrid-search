// Minimal reader for vantt/patches/series.toml (PRD 4.2, 9.1).
// Supports: comments, [[patches]] tables, bare keys, basic and literal strings,
// arrays of strings (may span lines), booleans. Anything else is a syntax error.

export class SeriesError extends Error {
  constructor(message, line) {
    super(line ? `series.toml:${line}: ${message}` : `series.toml: ${message}`);
    this.name = 'SeriesError';
    this.line = line;
  }
}

const REQUIRED = ['id', 'name', 'patch_file'];
const UPSTREAM_STATUS = new Set(['unsubmitted', 'issue_opened', 'pr_opened', 'merged', 'rejected']);
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const ESCAPES = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' };

/** Basic string starting at the `"` at src[i]; returns [value, nextIndex]. */
function parseBasicString(src, i, lineOf) {
  let out = '';
  i++;
  while (i < src.length && src[i] !== '"') {
    if (src[i] === '\n') throw new SeriesError('unterminated string', lineOf(i));
    if (src[i] === '\\') {
      const esc = src[++i];
      if (esc === 'u' || esc === 'U') {
        const len = esc === 'u' ? 4 : 8;
        const hex = src.slice(i + 1, i + 1 + len);
        if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== len)
          throw new SeriesError('bad unicode escape', lineOf(i));
        out += String.fromCodePoint(parseInt(hex, 16));
        i += len + 1;
        continue;
      }
      if (!(esc in ESCAPES)) throw new SeriesError(`bad escape \\${esc}`, lineOf(i));
      out += ESCAPES[esc];
      i++;
      continue;
    }
    out += src[i++];
  }
  if (src[i] !== '"') throw new SeriesError('unterminated string', lineOf(i - 1));
  return [out, i + 1];
}

/** Literal string starting at the `'` at src[i]; returns [value, nextIndex]. */
function parseLiteralString(src, i, lineOf) {
  const end = src.indexOf("'", i + 1);
  const nl = src.indexOf('\n', i + 1);
  if (end < 0 || (nl >= 0 && nl < end)) throw new SeriesError('unterminated string', lineOf(i));
  return [src.slice(i + 1, end), end + 1];
}

/** Array of strings starting at the `[` at src[i]; returns [value, nextIndex]. */
function parseArray(src, i, lineOf) {
  const arr = [];
  i++;
  for (;;) {
    i = skipWs(src, i, true);
    if (src[i] === ']') return [arr, i + 1];
    if (src[i] !== '"' && src[i] !== "'")
      throw new SeriesError('arrays may only contain strings', lineOf(i));
    const [v, next] = parseValue(src, i, lineOf);
    arr.push(v);
    i = skipWs(src, next, true);
    if (src[i] === ',') {
      i++;
      continue;
    }
    if (src[i] === ']') return [arr, i + 1];
    throw new SeriesError("expected ',' or ']' in array", lineOf(i));
  }
}

/** Parse one value starting at src[i]; returns [value, nextIndex]. */
function parseValue(src, i, lineOf) {
  const ch = src[i];
  if (ch === '"') return parseBasicString(src, i, lineOf);
  if (ch === "'") return parseLiteralString(src, i, lineOf);
  if (ch === '[') return parseArray(src, i, lineOf);
  const m = /^(true|false)\b/.exec(src.slice(i, i + 6));
  if (m) return [m[1] === 'true', i + m[1].length];
  throw new SeriesError('unsupported value (use a string, array of strings or boolean)', lineOf(i));
}

/** Skip spaces/tabs; with multiline also newlines and comments. */
function skipWs(src, i, multiline) {
  for (;;) {
    while (i < src.length && (src[i] === ' ' || src[i] === '\t' || src[i] === '\r')) i++;
    if (multiline && src[i] === '#') {
      while (i < src.length && src[i] !== '\n') i++;
    }
    if (multiline && src[i] === '\n') {
      i++;
      continue;
    }
    return i;
  }
}

/** 1-based line number of a position in src. */
function lineIndex(src) {
  const lineStarts = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === '\n') lineStarts.push(k + 1);
  return (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * `text` without a trailing `# comment`: the same as `.replace(/#.*$/, '')` in linear time. The
 * comment is the first `#` after the last line terminator (`.` never matches one).
 */
function stripComment(text) {
  const lastBreak = Math.max(
    text.lastIndexOf('\n'),
    text.lastIndexOf('\r'),
    text.lastIndexOf('\u2028'),
    text.lastIndexOf('\u2029'),
  );
  const hash = text.indexOf('#', lastBreak + 1);
  return hash < 0 ? text : text.slice(0, hash);
}

/** Check the required keys and allowed values of every patch; drops the `__line` bookkeeping. */
function validatePatches(patches) {
  const seen = new Set();
  for (const p of patches) {
    const line = p.__line;
    delete p.__line;
    for (const k of REQUIRED) {
      if (typeof p[k] !== 'string' || p[k] === '')
        throw new SeriesError(`patch is missing required string "${k}"`, line);
    }
    if (!ID_RE.test(p.id)) throw new SeriesError(`id "${p.id}" is not kebab-case`, line);
    if (seen.has(p.id)) throw new SeriesError(`duplicate patch id "${p.id}"`, line);
    seen.add(p.id);
    if (p.upstream_status !== undefined && !UPSTREAM_STATUS.has(p.upstream_status))
      throw new SeriesError(`unknown upstream_status "${p.upstream_status}"`, line);
    if (p.touches !== undefined && !Array.isArray(p.touches))
      throw new SeriesError('touches must be an array of strings', line);
  }
}

export function parseSeries(text) {
  const src = text.replace(/^\uFEFF/, '');
  const lineOf = lineIndex(src);

  const meta = {};
  const patches = [];
  let current = meta;
  let i = 0;
  while (i < src.length) {
    i = skipWs(src, i, true);
    if (i >= src.length) break;
    const line = lineOf(i);
    if (src[i] === '[') {
      const close = src.indexOf('\n', i);
      const header = stripComment(src.slice(i, close < 0 ? src.length : close)).trim();
      if (header !== '[[patches]]')
        throw new SeriesError(`unsupported table ${header} (only [[patches]])`, line);
      current = { __line: line };
      patches.push(current);
      i = close < 0 ? src.length : close;
      continue;
    }
    const km = /^([A-Za-z0-9_-]+)[ \t]*=[ \t]*/.exec(src.slice(i));
    if (!km) throw new SeriesError('expected key = value', line);
    const key = km[1];
    i += km[0].length;
    const [value, next] = parseValue(src, i, lineOf);
    if (Object.prototype.hasOwnProperty.call(current, key))
      throw new SeriesError(`duplicate key ${key}`, line);
    current[key] = value;
    i = skipWs(src, next, false);
    if (src[i] === '#') while (i < src.length && src[i] !== '\n') i++;
    if (i < src.length && src[i] !== '\n')
      throw new SeriesError('unexpected text after value', lineOf(i));
  }

  validatePatches(patches);
  return { meta, patches };
}
