#!/usr/bin/env node
// Build a self-contained OHS bundle of a release tree for the platform this script runs on
// (PRD 8). Zero dependencies. The bundle ships its own Node so native modules always match
// the ABI; it runs `npm ci --omit=dev` on the very platform it targets.
//
//   node vantt/scripts/bundle.mjs [--platform win32-x64|darwin-arm64|darwin-x64|linux-x64]
//        [--tree <release tree>] [--out <dir>] [--work <dir>] [--no-lang] [--skip-build] [--keep-stage]
//        [--version <v>] [--json]
//
// Output (in --out, default <tree>/vantt/.work/bundles):
//   ohs-<version>-<platform>.zip (win32) | .tar.gz   the bundle
//   <archive>.sha256                                 "<hex>  <archive name>"
//   <archive>.bundle.json                            sizes, hashes, node version, manifest summary
//
// Layout and rules: PRD 8.2.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { npmCommand } from './lib/proc.mjs';
import { parseSeries } from './lib/series.mjs';

export const PLATFORMS = {
  'win32-x64': { node: 'win-x64', ext: 'zip', os: 'win32', arch: 'x64' },
  'darwin-arm64': { node: 'darwin-arm64', ext: 'tar.gz', os: 'darwin', arch: 'arm64' },
  'darwin-x64': { node: 'darwin-x64', ext: 'tar.gz', os: 'darwin', arch: 'x64' },
  'linux-x64': { node: 'linux-x64', ext: 'tar.xz', os: 'linux', arch: 'x64' },
};

// Packages replaced by an exact older version at bundling time, per platform. The release tree and its lockfile
// stay untouched. onnxruntime-node dropped its darwin/x64 binding after 1.23.2 (checked in the npm tarballs of
// 1.21.1 to 1.30.0), while @huggingface/transformers pins 1.30.0 exactly; the bundle's smoke and eval parity
// runs on macos-15-intel decide whether the substitution is good enough.
export const PLATFORM_PINS = {
  'darwin-x64': { 'onnxruntime-node': '1.23.2', 'onnxruntime-common': '1.23.2' },
};

const isWin = process.platform === 'win32';
// GNU tar (Git for Windows) cannot read zip; the system bsdtar can.
const TAR = isWin
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar';
const here = path.dirname(fileURLToPath(import.meta.url));

const log = (m) => process.stderr.write(`[bundle] ${m}\n`);

/**
 * Replace installed packages by exact versions from the npm registry (file replacement; the tree's lockfile is not
 * touched). Returns {name: {from, to}}.
 */
export function applyPins(nodeModules, pins, scratch) {
  const substitutions = {};
  for (const [name, ver] of Object.entries(pins)) {
    const installed = JSON.parse(
      readFileSync(path.join(nodeModules, name, 'package.json'), 'utf8'),
    ).version;
    log(`replacing ${name}@${installed} with ${name}@${ver}`);
    const pk = path.join(scratch, name);
    rmSync(pk, { recursive: true, force: true });
    mkdirSync(pk, { recursive: true });
    const tgz = run('npm', ['pack', `${name}@${ver}`, '--silent', '--pack-destination', pk], {
      cwd: pk,
      capture: true,
    })
      .trim()
      .split('\n')
      .pop();
    run(TAR, ['-xf', path.join(pk, tgz)], { cwd: pk });
    rmSync(path.join(nodeModules, name), { recursive: true, force: true });
    cpSync(path.join(pk, 'package'), path.join(nodeModules, name), { recursive: true });
    substitutions[name] = { from: installed, to: ver };
  }
  return substitutions;
}

export function parsePins(base, specs = []) {
  const pins = { ...base };
  for (const spec of specs) {
    const at = spec.lastIndexOf('@');
    if (at <= 0) throw new Error(`--pin expects name@version, got ${spec}`);
    pins[spec.slice(0, at)] = spec.slice(at + 1);
  }
  return pins;
}

export function hostPlatform() {
  return `${process.platform}-${process.arch}`;
}

export function run(cmd, args, opts = {}) {
  // npm/npx are .cmd shims on Windows: run npm's JS entry instead of going through a shell.
  const spec = /^(npm|npx)$/.test(cmd)
    ? npmCommand(cmd, args, { env: opts.env ?? process.env })
    : { command: cmd, args };
  const res = spawnSync(spec.command, spec.args, {
    stdio: opts.capture ? ['ignore', 'pipe', 'inherit'] : ['ignore', 2, 2],
    encoding: 'utf8',
    ...opts,
  });
  if (res.error || res.status !== 0)
    throw new Error(
      `${cmd} ${args.join(' ')} failed (${res.error?.message ?? 'exit ' + res.status})`,
    );
  return res.stdout ?? '';
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

/** All files under dir (no symlinks followed), as paths relative to dir with `/` separators. */
export function walk(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, r));
    else out.push(r);
  }
  return out;
}

export function dirSize(dir) {
  let total = 0;
  for (const f of walk(dir)) total += lstatSync(path.join(dir, f)).size;
  return total;
}

const LICENSE_FILE = /^(licen[sc]e|licen[sc]ing|copying|notice|patents|unlicense)([-._].*)?$/i;

// Needs NVIDIA drivers and a CUDA/TensorRT install the bundle never ships; OHS runs on CPU (or DirectML on
// Windows). The WASM builds of onnxruntime-web are the browser fallback; Node loads onnxruntime-node.
const HEAVY_OPTIONAL = [
  /^onnxruntime-node\/bin\/[^/]+\/[^/]+\/[^/]+\/(lib)?onnxruntime_providers_(cuda|tensorrt)/,
  /^onnxruntime-web\/dist\/.*\.wasm$/,
];

/** True when a file in node_modules is safe to drop (PRD 8.2: docs, tests, source maps, C headers). */
export function isPrunable(rel) {
  const base = rel.split('/').pop();
  if (LICENSE_FILE.test(base) || LICENSE_FILE.test(base.replace(/\.(md|txt|markdown)$/i, '')))
    return false;
  if (/\.(md|markdown|map|h|hpp|cc|cpp|gyp|gypi|tsbuildinfo)$/i.test(base)) return true;
  if (HEAVY_OPTIONAL.some((re) => re.test(rel))) return true;
  return /(^|\/)(__tests__|tests?|\.github)\//.test(rel);
}

/** onnxruntime-node ships every platform in bin/napi-v6/<os>/<arch>; keep the target only. */
export function foreignOnnxDirs(platform, nodeModules) {
  const { os, arch } = PLATFORMS[platform];
  const base = path.join(nodeModules, 'onnxruntime-node', 'bin');
  const dropped = [];
  if (!existsSync(base)) return dropped;
  for (const napi of readdirSync(base)) {
    const nd = path.join(base, napi);
    if (!statSync(nd).isDirectory()) continue;
    for (const o of readdirSync(nd)) {
      const od = path.join(nd, o);
      if (!statSync(od).isDirectory()) continue;
      if (o !== os) dropped.push(od);
      else for (const a of readdirSync(od)) if (a !== arch) dropped.push(path.join(od, a));
    }
  }
  return dropped;
}

export function wrapperScripts() {
  const unix = (entry) =>
    `#!/bin/sh\n# Generated by vantt/scripts/bundle.mjs\nd=$(cd "$(dirname "$0")/.." && pwd -P)\nunset NODE_OPTIONS\nexec "$d/node/bin/node" "$d/app/${entry}" "$@"\n`;
  const win = (entry) =>
    `@echo off\r\nrem Generated by vantt/scripts/bundle.mjs\r\nsetlocal\r\nset "NODE_OPTIONS="\r\n"%~dp0..\\node\\node.exe" "%~dp0..\\app\\${entry.replaceAll('/', '\\')}" %*\r\nexit /b %ERRORLEVEL%\r\n`;
  return {
    ohs: unix('dist/src/cli.js'),
    'ohs-mcp': unix('dist/src/server.js'),
    'ohs.cmd': win('dist/src/cli.js'),
    'ohs-mcp.cmd': win('dist/src/server.js'),
  };
}

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url}: ${res.status}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

/** Download the portable Node of `version` for the platform into `dest/node`, verified against SHASUMS256.txt. */
async function fetchNode(platform, version, work, dest) {
  const p = PLATFORMS[platform];
  const ext = p.ext === 'zip' ? 'zip' : p.ext === 'tar.xz' ? 'tar.xz' : 'tar.gz';
  const name = `node-v${version}-${p.node}.${ext}`;
  const base = `https://nodejs.org/dist/v${version}`;
  const archive = path.join(work, name);
  mkdirSync(work, { recursive: true });
  if (!existsSync(archive)) {
    log(`downloading ${name}`);
    await download(`${base}/${name}`, archive);
  }
  const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
  const want = sums
    .split('\n')
    .map((l) => l.trim().split(/\s+/))
    .find((c) => c[1] === name)?.[0];
  if (!want) throw new Error(`${name} not listed in SHASUMS256.txt`);
  const got = await sha256File(archive);
  if (got !== want) {
    rmSync(archive, { force: true });
    throw new Error(`sha256 mismatch for ${name}: ${got} != ${want}`);
  }
  const ex = path.join(work, `node-extract-${platform}`);
  rmSync(ex, { recursive: true, force: true });
  mkdirSync(ex, { recursive: true });
  run(TAR, ['-xf', archive, '-C', ex]);
  const root = path.join(ex, `node-v${version}-${p.node}`);
  mkdirSync(dest, { recursive: true });
  // Only the runtime is needed: no npm, corepack, headers or docs.
  if (p.os === 'win32') {
    cpSync(path.join(root, 'node.exe'), path.join(dest, 'node.exe'));
  } else {
    mkdirSync(path.join(dest, 'bin'), { recursive: true });
    cpSync(path.join(root, 'bin', 'node'), path.join(dest, 'bin', 'node'));
    chmodSync(path.join(dest, 'bin', 'node'), 0o755);
  }
  return { licenseFile: path.join(root, 'LICENSE'), archive: name, sha256: got, extractDir: ex };
}

export const FORK_REPO = 'https://github.com/vantt/obsidian-hybrid-search';
export const LICENSE_TEXTS_DIR = path.join(here, '..', 'licenses');

// Declared license id (upper-cased) -> canonical text in vantt/licenses (README there: SPDX tag and hashes).
// Bare "Apache" (sqlite-vec) means Apache-2.0. The GNU -only/-or-later variants share one text.
const LICENSE_TEXT_FILES = {
  MIT: 'MIT',
  ISC: 'ISC',
  '0BSD': '0BSD',
  APACHE: 'Apache-2.0',
  'APACHE-2.0': 'Apache-2.0',
  'BSD-2-CLAUSE': 'BSD-2-Clause',
  'BSD-3-CLAUSE': 'BSD-3-Clause',
  'LGPL-3.0': 'LGPL-3.0',
  'LGPL-3.0+': 'LGPL-3.0',
  'LGPL-3.0-ONLY': 'LGPL-3.0',
  'LGPL-3.0-OR-LATER': 'LGPL-3.0',
  'GPL-3.0': 'GPL-3.0',
  'GPL-3.0+': 'GPL-3.0',
  'GPL-3.0-ONLY': 'GPL-3.0',
  'GPL-3.0-OR-LATER': 'GPL-3.0',
};

/** Canonical license texts by text name (`MIT`, `LGPL-3.0`, ...), read from `dir`. */
export function loadLicenseTexts(dir = LICENSE_TEXTS_DIR) {
  const texts = {};
  for (const name of new Set(Object.values(LICENSE_TEXT_FILES)))
    texts[name] = readFileSync(path.join(dir, `${name}.txt`), 'utf8');
  return texts;
}

/** The `license` of a package.json as an SPDX-like expression (also the legacy `licenses: [{type}]` array). */
function declaredLicense(pkg) {
  const one = (l) => (typeof l === 'string' ? l : l?.type);
  if (pkg.license !== undefined) return one(pkg.license)?.trim() || null;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length)
    return pkg.licenses.map(one).filter(Boolean).join(' OR ') || null;
  return null;
}

/**
 * The license texts to ship for a declared expression: every operand of AND, the first operand of OR that has
 * a text (AND binds tighter than OR, as in SPDX). Returns text names, or throws naming the package.
 */
export function chooseLicenseTexts(expr, label) {
  const tokens = String(expr ?? '').match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const fail = (why) => {
    throw new Error(
      `${label}: ${why} in declared license "${expr ?? ''}"; known ids: ${Object.keys(LICENSE_TEXT_FILES).join(', ')}. Add its text to vantt/licenses (see the README there)`,
    );
  };
  // Each parser returns the chosen text names, or null when an operand has no known text.
  const primary = () => {
    const t = tokens[i++];
    if (t === undefined) fail('unexpected end');
    if (t === '(') {
      const r = orExpr();
      if (tokens[i++] !== ')') fail('unbalanced parentheses');
      return r;
    }
    if (/^(AND|OR|WITH)$/i.test(t) || t === ')') fail(`unexpected "${t}"`);
    if (/^WITH$/i.test(tokens[i] ?? '')) {
      i += 2; // a license exception needs its own text: treat the operand as unknown
      return null;
    }
    const name = LICENSE_TEXT_FILES[t.toUpperCase()];
    return name ? [name] : null;
  };
  const andExpr = () => {
    let out = primary();
    while (/^AND$/i.test(tokens[i] ?? '')) {
      i++;
      const r = primary();
      out = out && r ? [...out, ...r] : null;
    }
    return out;
  };
  const orExpr = () => {
    let out = andExpr();
    while (/^OR$/i.test(tokens[i] ?? '')) {
      i++;
      const r = andExpr();
      out ??= r;
    }
    return out;
  };
  if (!tokens.length) fail('no license id');
  const chosen = orExpr();
  if (i !== tokens.length) fail(`unexpected "${tokens[i]}"`);
  if (!chosen) fail('no license text for any choice');
  return [...new Set(chosen)];
}

/** Browsable https URL of a package.json `repository`, or null. */
export function repositoryUrl(pkg) {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  if (!raw) return null;
  let url = raw.trim();
  const short = /^(?:github:)?([\w.-]+\/[\w.-]+)$/.exec(url);
  if (short) url = `https://github.com/${short[1]}`;
  url = url
    .replace(/^git\+/, '')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/^(git|ssh):\/\/(git@)?/, 'https://')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
  return url;
}

/** Copyright holder for a generated notice: the package.json author's name, else "the <name> authors". */
export function copyrightHolder(pkg) {
  const author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  // npm's "Name <email> (url)" form: keep the name.
  const name = author?.split(/[<(]/)[0].trim();
  return name || `the ${pkg.name} authors`;
}

/** Text names to ship plus the source obligation of the copyleft ones (LGPL-3.0 is GPL-3.0 plus permissions). */
function withCopyleft(texts) {
  const lgpl = texts.includes('LGPL-3.0');
  const copyleft = lgpl || texts.includes('GPL-3.0');
  return {
    copyleft,
    texts: lgpl && !texts.includes('GPL-3.0') ? [...texts, 'GPL-3.0'] : texts,
  };
}

function sourceLine(pkg, repo, label) {
  if (!repo)
    throw new Error(`${label}: copyleft license but no repository in package.json to point at`);
  return `Corresponding source: ${repo}/tree/v${pkg.version} (repository ${repo}, tag v${pkg.version})`;
}

// Texts that open with a template copyright line ("Copyright (c) <year> <owner>") to fill with the holder.
// The GNU and Apache texts stay verbatim: their placeholders belong to the how-to-apply appendix.
const HOLDER_TEMPLATES = new Set(['MIT', 'ISC', '0BSD', 'BSD-2-Clause', 'BSD-3-Clause']);

function licenseSections(names, texts, holder) {
  return names
    .map((n) => {
      const lines = texts[n].split('\n');
      if (HOLDER_TEMPLATES.has(n)) {
        const at = lines.findIndex(
          (l) => l.startsWith('Copyright') && (l.includes('<') || l.includes('YEAR')),
        );
        if (at >= 0) lines[at] = `Copyright (c) ${holder}`;
      }
      return `==== ${n} ====\n\n${lines.join('\n').trimEnd()}\n`;
    })
    .join('\n');
}

/** LICENSE-FROM-PACKAGE.txt for a package that declares a license but ships no license file. */
export function generatedNotice(pkg, texts) {
  const label = `${pkg.name}@${pkg.version}`;
  const declared = declaredLicense(pkg);
  const { copyleft, texts: names } = withCopyleft(chooseLicenseTexts(declared, label));
  const repo = repositoryUrl(pkg);
  const holder = copyrightHolder(pkg);
  const head = [
    `Package: ${pkg.name}`,
    `Version: ${pkg.version}`,
    `License (declared in package.json): ${declared}`,
    `License texts below: ${names.join(', ')}`,
    `Copyright holder: ${holder}`,
    `Repository: ${repo ?? 'none declared'}`,
    ...(copyleft ? [sourceLine(pkg, repo, label)] : []),
    '',
    'This package ships no license file. This notice was generated when the bundle was built from the license',
    'declared in its package.json, with the canonical license text from the SPDX License List.',
    '',
  ];
  return `${head.join('\n')}\n${licenseSections(names, texts, holder)}`;
}

/** CORRESPONDING-SOURCE.txt for a copyleft package that ships its own license file, or null. */
function copyleftNotice(pkg, texts) {
  const label = `${pkg.name}@${pkg.version}`;
  let chosen;
  try {
    chosen = chooseLicenseTexts(declaredLicense(pkg), label);
  } catch {
    return null; // the package ships its own license text; the declared id only decides the source obligation
  }
  const { copyleft, texts: names } = withCopyleft(chosen);
  if (!copyleft) return null;
  const head = [
    `Package: ${pkg.name}`,
    `Version: ${pkg.version}`,
    `License (declared in package.json): ${declaredLicense(pkg)}`,
    sourceLine(pkg, repositoryUrl(pkg), label),
    '',
    'The license files shipped by the package are next to this file. The GNU license texts follow.',
    '',
  ];
  return `${head.join('\n')}\n${licenseSections(names, texts, copyrightHolder(pkg))}`;
}

/** Copy one package's license files to destDir/<name>/ and write the notices it needs; see collectLicenses. */
function licensePackage(dir, name, destDir, texts) {
  const out = path.join(destDir, name);
  let copied = 0;
  let generated = 0;
  for (const f of readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (LICENSE_FILE.test(f.replace(/\.(md|txt|markdown)$/i, '')) && statSync(fp).isFile()) {
      mkdirSync(out, { recursive: true });
      cpSync(fp, path.join(out, f));
      copied++;
    }
  }
  const manifest = path.join(dir, 'package.json');
  if (!existsSync(manifest)) {
    if (copied === 0) throw new Error(`${name}: no package.json and no license file`);
    return { copied, generated, entry: null };
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const [file, notice] =
    copied === 0
      ? ['LICENSE-FROM-PACKAGE.txt', generatedNotice(pkg, texts)]
      : ['CORRESPONDING-SOURCE.txt', copyleftNotice(pkg, texts)];
  if (notice) {
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, file), notice);
    generated++;
  }
  const entry = {
    name: pkg.name ?? name,
    version: pkg.version ?? 'unknown',
    license: declaredLicense(pkg) ?? 'see the license files',
    source: repositoryUrl(pkg) ?? `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`,
    dir: name,
  };
  return { copied, generated, entry };
}

/**
 * Copy the license files of every package under nodeModules to destDir/<dir name>/. A package that ships none gets
 * a generated LICENSE-FROM-PACKAGE.txt from its declared license; a copyleft package also gets its source pointer.
 * An undeclared or unknown license fails the build. Returns {copied, generated, packages: [{name, version,
 * license, source, dir}]}.
 */
export function collectLicenses(nodeModules, destDir, texts = loadLicenseTexts()) {
  const total = { copied: 0, generated: 0, packages: [] };
  const visit = (nm) => {
    for (const ent of readdirSync(nm, { withFileTypes: true })) {
      if (!ent.isDirectory() || ent.name.startsWith('.')) continue;
      const dir = path.join(nm, ent.name);
      if (ent.name.startsWith('@')) {
        visit(dir);
        continue;
      }
      const name = path
        .relative(nodeModules, dir)
        .split(path.sep)
        .join('__')
        .replace(/(^|__)node_modules__/g, '$1');
      const r = licensePackage(dir, name, destDir, texts);
      total.copied += r.copied;
      total.generated += r.generated;
      if (r.entry) total.packages.push(r.entry);
      const inner = path.join(dir, 'node_modules');
      if (existsSync(inner)) visit(inner);
    }
  };
  visit(nodeModules);
  return total;
}

/** LICENSES/THIRD_PARTY.md: one row per bundled npm package, plus Node.js and the language pack. */
export function thirdPartyMarkdown({ packages, nodeVersion, lang }) {
  const cell = (s) => String(s).replaceAll('|', '\\|');
  const rows = [
    {
      name: 'Node.js',
      version: nodeVersion,
      license: 'MIT and the licenses of its bundled components (NODE-LICENSE)',
      source: `https://github.com/nodejs/node/tree/v${nodeVersion}`,
    },
    ...(lang
      ? [
          {
            name: 'ohs-lang-vi',
            version: lang.version,
            license:
              'Proprietary, all rights reserved; use only with pkm under its EULA (OHS-LANG-VI-LICENSE)',
            source: lang.source,
          },
        ]
      : []),
    ...[...packages].sort(
      (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    ),
  ];
  const seen = new Set();
  const lines = [];
  for (const r of rows) {
    const key = `${r.name}@${r.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`| ${[r.name, r.version, r.license, r.source].map(cell).join(' | ')} |`);
  }
  return [
    '# Third-party components',
    '',
    'Components shipped in this bundle besides obsidian-hybrid-search itself (MIT, `OHS-LICENSE`).',
    'License texts: `NODE-LICENSE`, `OHS-LANG-VI-LICENSE`, and `deps/<package>/` for npm packages (a scoped',
    'name such as `@a/b` is in `deps/@a__b/`, a nested copy in `deps/<parent>__<package>/`).',
    '',
    '| Component | Version | License | Source |',
    '| --- | --- | --- | --- |',
    ...lines,
    '',
  ].join('\n');
}

/** The language pack is proprietary: its LICENSE goes next to it and into LICENSES/, or the build fails. */
function shipLangLicense(langDir, langDest, licenses) {
  const file = path.join(langDir, 'LICENSE');
  if (!existsSync(file))
    throw new Error('ohs-lang-vi has no LICENSE; the bundle must carry its license');
  cpSync(file, path.join(langDest, 'LICENSE'));
  cpSync(file, path.join(licenses, 'OHS-LANG-VI-LICENSE'));
}

function patchList(tree) {
  const file = path.join(tree, 'vantt', 'patches', 'series.toml');
  if (!existsSync(file)) return [];
  return (
    parseSeries(readFileSync(file, 'utf8')).patches?.map((p) => ({
      id: p.id,
      upstream_status: p.upstream_status ?? 'unsubmitted',
    })) ?? []
  );
}

/** Runtime manifest only: no scripts (upstream's `prepare` refuses to run outside a dev checkout) and no devEngines. */
function runtimeManifest(pkg, version) {
  const runtimePkg = {};
  for (const k of [
    'name',
    'version',
    'type',
    'bin',
    'license',
    'dependencies',
    'optionalDependencies',
    'engines',
    'allowScripts',
  ])
    if (pkg[k] !== undefined) runtimePkg[k] = pkg[k];
  runtimePkg.version = version;
  return runtimePkg;
}

export async function main(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      platform: { type: 'string' },
      tree: { type: 'string' },
      out: { type: 'string' },
      work: { type: 'string' },
      version: { type: 'string' },
      pin: { type: 'string', multiple: true },
      'no-lang': { type: 'boolean', default: false },
      'skip-build': { type: 'boolean', default: false },
      'keep-stage': { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
    },
  });
  const platform = values.platform ?? hostPlatform();
  if (!PLATFORMS[platform])
    throw new Error(
      `unsupported platform ${platform}; one of ${Object.keys(PLATFORMS).join(', ')}`,
    );
  if (platform !== hostPlatform())
    throw new Error(
      `bundles must be built on their own platform (native modules): host is ${hostPlatform()}, asked ${platform}`,
    );
  const tree = path.resolve(values.tree ?? path.resolve(here, '..', '..'));
  const pkg = JSON.parse(readFileSync(path.join(tree, 'package.json'), 'utf8'));
  const version = values.version ?? pkg.version;
  const nodeVersion = readFileSync(path.join(tree, '.node-version'), 'utf8')
    .trim()
    .replace(/^v/, '');
  // Native modules are built by the Node that runs npm here, and must load in the bundled Node.
  if (process.versions.node !== nodeVersion)
    throw new Error(
      `running on Node ${process.versions.node} but the tree needs ${nodeVersion} (.node-version); run this script with that Node`,
    );
  const outDir = path.resolve(values.out ?? path.join(tree, 'vantt', '.work', 'bundles'));
  // Keep this path short on Windows: node_modules nests deeply and MAX_PATH is 260.
  const workBase = path.resolve(values.work ?? path.join(tree, 'vantt', '.work'));
  const work = path.join(workBase, `bundle-${platform}`);
  const bundleName = `ohs-${version}-${platform}`;
  const stage = path.join(work, 'stage');
  const root = path.join(stage, bundleName);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  mkdirSync(outDir, { recursive: true });

  // 1. Compiled app of the release tree.
  const treeDist = path.join(tree, 'dist');
  if (!values['skip-build'] || !existsSync(path.join(treeDist, 'src', 'cli.js'))) {
    log('building the release tree (npm ci --ignore-scripts && npm rebuild && npm run build)');
    run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: tree });
    run('npm', ['rebuild'], { cwd: tree });
    run('npm', ['run', 'build'], { cwd: tree });
  }
  const app = path.join(root, 'app');
  mkdirSync(app, { recursive: true });
  cpSync(treeDist, path.join(app, 'dist'), { recursive: true });
  writeFileSync(
    path.join(app, 'package.json'),
    JSON.stringify(runtimeManifest(pkg, version), null, 2) + '\n',
  );
  cpSync(path.join(tree, 'package-lock.json'), path.join(app, 'package-lock.json'));

  // 2. Production dependencies, built on this platform.
  log('installing production dependencies (npm ci --omit=dev)');
  run('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: app });
  const pins = parsePins(PLATFORM_PINS[platform] ?? {}, values.pin);
  const substitutions = applyPins(path.join(app, 'node_modules'), pins, path.join(work, 'pins'));
  run('npm', ['rebuild'], { cwd: app });
  rmSync(path.join(app, 'package-lock.json'), { force: true });
  // Fail loudly when a dependency ships no native binary for this platform (onnxruntime-node 1.30 has none for darwin-x64).
  const ort = path.join(
    app,
    'node_modules',
    'onnxruntime-node',
    'bin',
    'napi-v6',
    PLATFORMS[platform].os,
    PLATFORMS[platform].arch,
  );
  if (
    existsSync(path.join(app, 'node_modules', 'onnxruntime-node')) &&
    !existsSync(path.join(ort, 'onnxruntime_binding.node'))
  )
    throw new Error(
      `onnxruntime-node ships no native binding for ${platform}; local embeddings cannot run on this platform`,
    );

  // 3. Licenses before pruning (PRD 8.2).
  const licenses = path.join(root, 'LICENSES');
  mkdirSync(licenses, { recursive: true });
  cpSync(path.join(tree, 'LICENSE'), path.join(licenses, 'OHS-LICENSE'));
  const nodeInfo = await fetchNode(
    platform,
    nodeVersion,
    path.join(workBase, 'node-cache'),
    path.join(root, 'node'),
  );
  cpSync(nodeInfo.licenseFile, path.join(licenses, 'NODE-LICENSE'));
  const nm = path.join(app, 'node_modules');
  const deps = collectLicenses(nm, path.join(licenses, 'deps'));

  // 4. Language pack (PRD 8.2 `lang/`), then the third-party table of everything shipped.
  let langVersion = null;
  const langSrc = path.join(tree, 'vantt', 'packages', 'ohs-lang-vi');
  if (!values['no-lang'] && existsSync(path.join(langSrc, 'package.json'))) {
    log('building ohs-lang-vi');
    const work2 = path.join(work, 'ohs-lang-vi');
    rmSync(work2, { recursive: true, force: true });
    cpSync(langSrc, work2, {
      recursive: true,
      filter: (s) => !/[\\/](node_modules|build)$/.test(s),
    });
    run('npm', ['ci', '--no-audit', '--no-fund', '--ignore-scripts'], { cwd: work2 });
    run('npm', ['run', 'build'], { cwd: work2 });
    const langPkg = JSON.parse(readFileSync(path.join(work2, 'package.json'), 'utf8'));
    langVersion = langPkg.version;
    const langDest = path.join(root, 'lang', 'ohs-lang-vi');
    mkdirSync(langDest, { recursive: true });
    for (const item of ['build', 'data', 'package.json'])
      if (existsSync(path.join(work2, item)))
        cpSync(path.join(work2, item), path.join(langDest, item), { recursive: true });
    if (!existsSync(path.join(langDest, 'build', 'index.js')))
      throw new Error('ohs-lang-vi build produced no build/index.js');
    shipLangLicense(work2, langDest, licenses);
  }
  writeFileSync(
    path.join(licenses, 'THIRD_PARTY.md'),
    thirdPartyMarkdown({
      packages: deps.packages,
      nodeVersion,
      lang: langVersion && {
        version: langVersion,
        source: `${FORK_REPO}/tree/v${version}/vantt/packages/ohs-lang-vi`,
      },
    }),
  );

  // 5. Prune (only deletes files; PRD 8.2).
  const before = dirSize(root);
  let pruned = 0;
  for (const d of foreignOnnxDirs(platform, nm)) {
    rmSync(d, { recursive: true, force: true });
    pruned++;
  }
  for (const f of walk(nm)) {
    if (isPrunable(f)) {
      rmSync(path.join(nm, f), { force: true });
      pruned++;
    }
  }

  // 6. Launchers.
  const bin = path.join(root, 'bin');
  mkdirSync(bin, { recursive: true });
  for (const [name, text] of Object.entries(wrapperScripts())) {
    writeFileSync(path.join(bin, name), text);
    if (!name.endsWith('.cmd')) chmodSync(path.join(bin, name), 0o755);
  }

  // 7. Manifest with a hash for every file.
  const files = {};
  for (const f of walk(root).sort()) files[f] = await sha256File(path.join(root, f));
  const manifest = {
    name: 'ohs',
    version,
    upstream_version: version.replace(/-vantt\.\d+$/, ''),
    platform,
    node_version: nodeVersion,
    node_archive: { name: nodeInfo.archive, sha256: nodeInfo.sha256 },
    patches: patchList(tree),
    lang_packs: langVersion ? { vi: langVersion } : {},
    substitutions,
    built_at: new Date().toISOString(),
    files,
  };
  writeFileSync(path.join(root, 'MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n');

  // 8. Archive, checksum, sizes.
  const after = dirSize(root);
  const p = PLATFORMS[platform];
  const archiveName = `${bundleName}.${p.os === 'win32' ? 'zip' : 'tar.gz'}`;
  const archive = path.join(outDir, archiveName);
  rmSync(archive, { force: true });
  if (p.os === 'win32') run(TAR, ['-a', '-cf', archive, '-C', stage, bundleName]);
  else run(TAR, ['-czf', archive, '-C', stage, bundleName]);
  const digest = await sha256File(archive);
  writeFileSync(`${archive}.sha256`, `${digest}  ${archiveName}\n`);
  const result = {
    bundle: archiveName,
    platform,
    version,
    sha256: digest,
    size_packed: statSync(archive).size,
    size_unpacked: after,
    size_unpacked_before_prune: before,
    pruned_files: pruned,
    license_files: deps.copied + deps.generated,
    license_files_generated: deps.generated,
    node_version: nodeVersion,
    lang_packs: manifest.lang_packs,
    patches: manifest.patches.length,
    substitutions,
    patch_list: manifest.patches,
    upstream_version: manifest.upstream_version,
    dir_sizes: Object.fromEntries(
      ['node', 'app', 'lang', 'LICENSES']
        .filter((d) => existsSync(path.join(root, d)))
        .map((d) => [d, dirSize(path.join(root, d))]),
    ),
  };
  writeFileSync(`${archive}.bundle.json`, JSON.stringify(result, null, 2) + '\n');
  if (!values['keep-stage']) rmSync(stage, { recursive: true, force: true });
  log(
    `${archiveName}: ${(result.size_packed / 1e6).toFixed(1)} MB packed, ${(result.size_unpacked / 1e6).toFixed(1)} MB unpacked (was ${(before / 1e6).toFixed(1)} MB before prune)`,
  );
  if (values.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`[bundle] ERROR: ${e.message}\n`);
    process.exit(1);
  });
}
