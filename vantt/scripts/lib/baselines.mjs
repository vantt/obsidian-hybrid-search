// Baseline files `vantt/eval/baselines/<platform>/<version>.<set>[.<lang>].json` (PRD 11.6).
//   <version>.obsidian-help.json    upstream, no pack (version = upstream version)
//   <version>.vi-search.json        upstream, no pack, generated vi corpus
//   <version>.vi-search.<lang>.json a released fork with that pack (version = x.y.z-vantt.N)
// Lowering a baseline is a reviewed PR; this module only reads and, on request, writes new files.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const NAME =
  /^(\d+\.\d+\.\d+(?:-vantt\.\d+)?)\.(obsidian-help|vi-search|smoke)(?:\.([a-z]{2,3}))?\.json$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-vantt\.(\d+)(?:\..*)?)?$/;

const parts = (v) => {
  const m = VERSION.exec(v);
  if (!m) throw new Error(`unusable version "${v}"`);
  return [m[1], m[2], m[3], m[4] ?? '0'].map(Number);
};

export function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

export const baseVersion = (v) => v.split('-')[0];

export function listBaselines(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((file) => ({ file, m: NAME.exec(file) }))
    .filter((x) => x.m)
    .map(({ file, m }) => ({
      file: path.join(dir, file),
      version: m[1],
      set: m[2],
      lang: m[3] ?? null,
    }));
}

/**
 * Newest baseline of (set, lang) whose version is <= `version`. Returns
 * {file, version, exact, result} or null.
 */
export function pickBaseline(dir, { set, lang = null, version }) {
  const hits = listBaselines(dir)
    .filter((b) => b.set === set && b.lang === lang && compareVersions(b.version, version) <= 0)
    .sort((x, y) => compareVersions(y.version, x.version));
  if (!hits.length) return null;
  const [best] = hits;
  return {
    file: best.file,
    version: best.version,
    exact: compareVersions(best.version, version) === 0,
    result: JSON.parse(readFileSync(best.file, 'utf8')),
  };
}

/** Write a new baseline file; refuses to replace an existing one unless `force`. Returns the path. */
export function writeBaseline(dir, { version, set, lang = null, result, force = false }) {
  const file = path.join(dir, `${version}.${set}${lang ? `.${lang}` : ''}.json`);
  if (existsSync(file) && !force)
    throw new Error(
      `${file} exists; lowering a baseline needs a reviewed PR (--force overwrites it locally)`,
    );
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
  return file;
}
