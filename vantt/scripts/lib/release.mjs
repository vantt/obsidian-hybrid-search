// Target selection, release naming and version stamping (PRD 4.3, 5, 6.2 steps 3 and 8).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { git } from './proc.mjs';

export const UPSTREAM_MASTER = 'refs/remotes/upstream/master';
const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function cmpSemver(a, b) {
  const pa = STABLE_TAG.exec(a).slice(1).map(Number);
  const pb = STABLE_TAG.exec(b).slice(1).map(Number);
  for (let k = 0; k < 3; k++) if (pa[k] !== pb[k]) return pa[k] - pb[k];
  return 0;
}

export function isOnUpstreamMaster(cwd, commit) {
  return git(cwd, ['merge-base', '--is-ancestor', commit, UPSTREAM_MASTER], { allowFail: true }).ok;
}

/** Stable `v<semver>` tags (no `-`) reachable from upstream/master, highest first. */
export function stableUpstreamTags(cwd) {
  const tags = git(cwd, ['tag', '--list', 'v*'])
    .split('\n')
    .filter((t) => STABLE_TAG.test(t));
  tags.sort((a, b) => cmpSemver(b, a));
  return tags.filter((t) => isOnUpstreamMaster(cwd, `refs/tags/${t}^{commit}`));
}

/**
 * Resolve the target. Returns {ref, sha, isTag, tag, branch, slug}.
 * Throws UsageError-like Error with .usage = true when the ref is unusable.
 */
export function resolveTarget(cwd, ref) {
  const usage = (msg) => Object.assign(new Error(msg), { usage: true });
  if (!git(cwd, ['rev-parse', '--verify', '--quiet', UPSTREAM_MASTER], { allowFail: true }).ok)
    throw usage('upstream/master is missing; fetch upstream first');
  if (!ref) {
    const [tag] = stableUpstreamTags(cwd);
    if (!tag) throw usage('no stable v<semver> tag found on upstream/master');
    ref = tag;
  }
  const tagSha = git(cwd, ['rev-parse', '--verify', '--quiet', `refs/tags/${ref}^{commit}`], {
    allowFail: true,
  });
  if (tagSha.ok) {
    const sha = tagSha.stdout.trim();
    if (!isOnUpstreamMaster(cwd, sha))
      throw usage(`tag ${ref} is not reachable from upstream/master; refusing to build it`);
    return { ref, sha, isTag: true, tag: ref, branch: `vantt/${ref}`, slug: ref };
  }
  const resolved = git(
    cwd,
    [
      'rev-parse',
      '--verify',
      '--quiet',
      ref === 'upstream/master' ? UPSTREAM_MASTER : `${ref}^{commit}`,
    ],
    { allowFail: true },
  );
  if (!resolved.ok) throw usage(`cannot resolve ref ${ref}`);
  const sha = resolved.stdout.trim();
  if (!isOnUpstreamMaster(cwd, sha))
    throw usage(`${ref} (${sha.slice(0, 7)}) is not reachable from upstream/master`);
  const slug = `upstream-master-${sha.slice(0, 7)}`;
  return { ref, sha, isTag: false, tag: null, branch: `vantt/${slug}`, slug };
}

const lsTree = (cwd, treeish, paths) =>
  git(cwd, ['ls-tree', '-r', '--full-tree', treeish, '--', ...paths], { allowFail: true }).stdout ??
  '';

/** Language packs present at treeish: [{id, version, sha256}]. */
export function langPacks(cwd, treeish) {
  const dirs = git(cwd, ['ls-tree', '-d', '--name-only', `${treeish}:vantt/packages`], {
    allowFail: true,
  });
  if (!dirs.ok) return [];
  return dirs.stdout
    .split('\n')
    .filter((d) => d.startsWith('ohs-lang-'))
    .sort()
    .map((d) => {
      const dir = `vantt/packages/${d}`;
      const pkg = git(cwd, ['show', `${treeish}:${dir}/package.json`], { allowFail: true });
      let version = null;
      try {
        version = pkg.ok ? (JSON.parse(pkg.stdout).version ?? null) : null;
      } catch {
        version = null;
      }
      return {
        id: d.slice('ohs-lang-'.length),
        version,
        sha256: sha256(lsTree(cwd, treeish, [dir])),
      };
    });
}

/** Inputs that define a fork release besides the upstream sha (PRD 4.3, 6.2 step 4). */
export function forkInputs(cwd, treeish) {
  const series = git(cwd, ['show', `${treeish}:vantt/patches/series.toml`], { allowFail: true });
  return {
    series_sha256: sha256(series.ok ? series.stdout : ''),
    patches_sha256: sha256(lsTree(cwd, treeish, ['vantt/patches'])),
    lang_packs: langPacks(cwd, treeish),
  };
}

export const sameInputs = (a, b) =>
  a.series_sha256 === b.series_sha256 &&
  a.patches_sha256 === b.patches_sha256 &&
  JSON.stringify(a.lang_packs) === JSON.stringify(b.lang_packs);

/**
 * Version for the release branch (PRD 4.3, 6.2 step 8).
 * Tag target: `<tag without v>-vantt.<N>`; N = highest existing release tag N for
 * this upstream tag, +1 when the fork inputs differ from that release; 1 if none.
 * Other refs: `<package.json version>-vantt.0.g<sha7>`.
 */
export function computeVersion(cwd, target, inputs, pkgVersion) {
  if (!target.isTag) return `${pkgVersion}-vantt.0.g${target.sha.slice(0, 7)}`;
  const base = target.tag.slice(1);
  const re = new RegExp(`^v${base.replace(/\./g, '\\.')}-vantt\\.(\\d+)$`);
  let best = null;
  for (const t of git(cwd, ['tag', '--list', `v${base}-vantt.*`]).split('\n')) {
    const m = re.exec(t);
    if (m && (!best || Number(m[1]) > best.n)) best = { n: Number(m[1]), tag: t };
  }
  if (!best) return `${base}-vantt.1`;
  const n = sameInputs(forkInputs(cwd, `refs/tags/${best.tag}`), inputs) ? best.n : best.n + 1;
  return `${base}-vantt.${n}`;
}

/**
 * Version stamping hook (PRD 4.3): write `version` and `"vanttFork": true` into
 * package.json (and the root entries of package-lock.json). P00 `fork-identity`
 * reads these; the patch itself never hardcodes a version.
 */
export function stampVersion(cwd, version) {
  const edit = (rel, fn) => {
    const file = path.join(cwd, rel);
    if (!existsSync(file)) return false;
    const raw = readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    fn(json);
    const indent = /^(\s+)"/m.exec(raw)?.[1] ?? '  ';
    writeFileSync(file, JSON.stringify(json, null, indent) + '\n');
    return true;
  };
  let name;
  edit('package.json', (pkg) => {
    name = pkg.name;
    pkg.version = version;
    pkg.vanttFork = true;
  });
  edit('package-lock.json', (lock) => {
    lock.version = version;
    if (lock.packages?.['']) lock.packages[''].version = version;
  });
  // Upstream keeps MCP Registry metadata in sync with package.json
  // (scripts/sync-server-json.sh; test/registry-metadata.test.ts checks it).
  edit('server.json', (server) => {
    server.version = version;
    for (const p of server.packages ?? []) if (p.identifier === name) p.version = version;
  });
}

/** Files stampVersion may change. */
export const VERSION_FILES = ['package.json', 'package-lock.json', 'server.json'];
