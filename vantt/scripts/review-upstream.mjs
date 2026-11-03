#!/usr/bin/env node
// Review of a new upstream release (PRD 12). Machine part: builds the four trees, runs every
// patch probe, compares search quality and diffs what upstream changed in the patches' files.
// The agent turns the JSON into vantt/reviews/<tag>.md (skill ohs-upstream-review).
//
//   node vantt/scripts/review-upstream.mjs --tag v0.17.2 [--prev v0.17.1 | v0.17.1-vantt.2]
//        [--build-missing]   build absent fork branches vantt/<tag> with catchup (--skip-tests --skip-quality)
//        [--lang-pack <dir>] language pack for the fork sides of the vi eval (default vantt/packages/ohs-lang-vi when built)
//        [--otf <otf.mjs>]   clone of obsidian-test-fixture (default: npx, needs network)
//        [--private <dir>]   dir with golden-set.json and vault/; only aggregate numbers are kept
//        [--skip-eval] [--force] [--keep] [--fetch] [--seed 1] [--blind-max 20]
//        [--out <dir>] [--work <dir>]
//   node vantt/scripts/review-upstream.mjs --tag v0.17.2 --unblind    # tally verdicts written by the judge
//   node vantt/scripts/review-upstream.mjs --trends-only [--out <dir>] # redraw trends.svg and refresh the newest report
//
// Run from a work clone (its remotes, tags and fork branches are used; worktrees and builds go to
// <clone>/vantt/.work/review-<tag>). Probes, series, eval sets and the pack come from the repo that
// holds this script. Never pushes. Exit 0 = data written, 2 = usage, 7 = error.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { evalEnv, goldenFile, prepareDataset, runEvaluate } from './lib/eval-run.mjs';
import { ensureNpm } from './lib/npm.mjs';
import { childEnv, git, npmCommand, sh } from './lib/proc.mjs';
import {
  buildQualityRows,
  flagQuality,
  forkBranchOf,
  highestStableTag,
  makeBlindPairs,
  makeSnippet,
  pickBlindQueries,
  scrubPrivate,
  suggestPatch,
  tallyVerdicts,
  upstreamTagOf,
} from './lib/review-core.mjs';
import {
  buildPack,
  buildTree,
  checkApplicability,
  hookChanges,
  readJsonIfExists,
  runEvaluateTimed,
  runProbe,
  runViEval,
  upstreamChanges,
  upstreamOverview,
  writeJson,
} from './lib/review-run.mjs';
import { writeTrends } from './lib/review-trends.mjs';
import { parseSeries } from './lib/series.mjs';
import { createUpstreamTree } from './lib/trees.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const forkDir = path.resolve(here, '../..');
const FORK_TAG = /^v\d+\.\d+\.\d+-vantt\.\d+$/;
const log = (m) => process.stderr.write(`${m}\n`);

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      tag: { type: 'string' },
      prev: { type: 'string' },
      'build-missing': { type: 'boolean', default: false },
      'lang-pack': { type: 'string' },
      otf: { type: 'string' },
      private: { type: 'string' },
      'skip-eval': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      keep: { type: 'boolean', default: false },
      fetch: { type: 'boolean', default: false },
      unblind: { type: 'boolean', default: false },
      'trends-only': { type: 'boolean', default: false },
      seed: { type: 'string', default: '1' },
      'blind-max': { type: 'string', default: '20' },
      out: { type: 'string' },
      work: { type: 'string' },
    },
    strict: true,
  });
  return values;
}

const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const refExists = (root, ref) =>
  git(root, ['rev-parse', '--verify', '-q', `${ref}^{commit}`], { allowFail: true }).ok;
const shaOf = (root, ref) => git(root, ['rev-parse', `${ref}^{commit}`]);

/** Previous side: explicit --prev, else highest fork release tag below NEW, else previous upstream tag. */
function resolvePrev(root, tagNew, explicit) {
  const tags = git(root, ['tag', '--list', 'v*']).split('\n').filter(Boolean);
  const below = (t) => {
    const up = upstreamTagOf(t);
    return up && up !== tagNew && highestStableTag([up, tagNew]) === tagNew;
  };
  const pick =
    explicit ??
    tags
      .filter((t) => FORK_TAG.test(t) && below(t))
      .sort()
      .at(-1) ??
    highestStableTag(tags.filter(below));
  const up = pick && upstreamTagOf(pick);
  if (!up)
    throw new Error(
      `cannot work out the previous release from "${pick ?? ''}" (use --prev <vX.Y.Z or vX.Y.Z-vantt.N>)`,
    );
  return { given: pick, upstream_tag: up, fork_tag: FORK_TAG.test(pick) ? pick : null };
}

/** Fork build ref for an upstream tag: local branch, origin branch, or the fork release tag. */
function findForkRef(root, upTag, forkTag) {
  const branch = forkBranchOf(upTag);
  return (
    [branch, `origin/${branch}`, forkTag].filter(Boolean).find((r) => refExists(root, r)) ?? null
  );
}

function catchupBranch(root, upTag) {
  log(`Building ${forkBranchOf(upTag)} with catchup (tests and quality gate skipped).`);
  const res = sh(
    root,
    `node ${JSON.stringify(path.join(here, 'catchup.mjs'))} --ref ${upTag} --skip-tests --skip-quality`,
  );
  if (res.status === 3) sh(root, `node ${JSON.stringify(path.join(here, 'catchup.mjs'))} --abort`);
  return { exit: res.status, ok: res.status === 0 };
}

function makeTree(root, name, ref, workDir, treeInfo) {
  const info = { ref: ref ?? null, sha: null, built: false };
  treeInfo[name] = info;
  if (!ref) {
    info.error = 'no ref';
    return null;
  }
  try {
    info.sha = shaOf(root, ref);
    const t = createUpstreamTree(root, info.sha, path.join(workDir, 'trees', name), log);
    info.deps = t.deps;
    const b = buildTree(t.dir);
    info.built = b.ok;
    if (!b.ok) info.error = `build failed: ${b.log}`;
    return b.ok ? t : (t.cleanup(), null);
  } catch (e) {
    info.error = e.message;
    return null;
  }
}

function viVault(workDir, otf) {
  const vault = path.join(workDir, 'vi-vault');
  if (!existsSync(vault)) {
    mkdirSync(workDir, { recursive: true });
    const gen = [
      'generate',
      '--preset',
      'vi-search',
      '--out',
      vault,
      '--answers-out',
      path.join(workDir, 'vi-answers.json'),
    ];
    // No shell: the paths in `gen` reach the fixture as single arguments on every platform.
    const env = childEnv();
    const fixture = otf
      ? { command: process.execPath, args: [path.resolve(otf), ...gen] }
      : npmCommand('npx', ['--yes', 'github:vantt/obsidian-test-fixture#v0.12.0', ...gen], { env });
    const res = spawnSync(fixture.command, fixture.args, {
      cwd: workDir,
      env,
      stdio: ['ignore', 2, 2],
    });
    if (res.status !== 0) throw new Error('could not generate the vi vault for snippets');
  }
  const files = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.set(path.relative(vault, p).normalize('NFC'), p);
    }
  };
  walk(vault);
  return files;
}

function blindFiles(workDir) {
  const dir = path.join(workDir, 'blind');
  return {
    dir,
    pairs: path.join(dir, 'pairs.json'),
    key: path.join(dir, 'key.json'),
    verdicts: path.join(dir, 'verdicts.json'),
  };
}

function buildBlind({ workDir, a, b, otf, seed, max }) {
  const files = viVault(workDir, otf);
  const queries = Object.fromEntries(a.per_query.map((q) => [q.id, q.query]));
  const byId = {
    upstream: new Map(a.per_query.map((q) => [q.id, q])),
    fork: new Map(b.per_query.map((q) => [q.id, q])),
  };
  const view = (side, id) =>
    byId[side]
      .get(id)
      .top_paths.slice(0, 5)
      .map((p) => {
        const file = files.get(p.normalize('NFC'));
        const text = file ? readFileSync(file, 'utf8') : '';
        return {
          title: path.basename(p, '.md').normalize('NFC'),
          snippet: makeSnippet(text, queries[id]),
        };
      });
  const ids = pickBlindQueries(a.per_query, b.per_query, { max, seed });
  const { pairs, key } = makeBlindPairs(ids, queries, view, { seed });
  const f = blindFiles(workDir);
  writeJson(f.pairs, pairs);
  writeJson(f.key, key);
  return { pairs: pairs.length, seed, pairs_file: f.pairs, verdicts_file: f.verdicts, tally: null };
}

export async function main(argv, { cwd = process.cwd() } = {}) {
  let opts;
  try {
    opts = parseCli(argv);
  } catch (e) {
    log(`review-upstream: ${e.message}`);
    return 2;
  }
  if (opts['trends-only']) {
    const r = writeTrends(path.resolve(opts.out ?? path.join(forkDir, 'vantt/reviews')));
    log(
      `Trends over ${r.tags.join(', ') || 'no releases'}: ${r.svg}${r.report ? `, refreshed ${r.report}` : ''}`,
    );
    return 0;
  }
  const root = git(cwd, ['rev-parse', '--show-toplevel']);
  const started = Date.now();
  const trees = {};
  try {
    if (opts.fetch) {
      log('Fetching upstream master and tags.');
      git(root, [
        'fetch',
        '--quiet',
        '--tags',
        'upstream',
        '+refs/heads/master:refs/remotes/upstream/master',
      ]);
    }
    const tagNew =
      opts.tag ??
      highestStableTag(
        git(root, ['tag', '--list', 'v*'])
          .split('\n')
          .filter((t) => upstreamTagOf(t) === t),
      );
    if (!tagNew || !refExists(root, tagNew)) {
      log(
        `review-upstream: tag "${tagNew ?? ''}" not found (pass --tag, or --fetch to get new tags)`,
      );
      return 2;
    }
    const outDir = path.resolve(opts.out ?? path.join(forkDir, 'vantt/reviews'));
    const workDir = path.resolve(opts.work ?? path.join(root, 'vantt/.work', `review-${tagNew}`));
    const dataFile = path.join(outDir, `${tagNew}.data.json`);

    if (opts.unblind) {
      const data = readJsonIfExists(dataFile);
      const f = blindFiles(workDir);
      if (!data?.blind || !existsSync(f.verdicts))
        throw new Error(`need ${dataFile} and ${f.verdicts}`);
      data.blind.tally = tallyVerdicts(readJsonIfExists(f.verdicts), readJsonIfExists(f.key));
      writeJson(dataFile, data);
      log(JSON.stringify(data.blind.tally));
      return 0;
    }

    const prev = resolvePrev(root, tagNew, opts.prev);
    if (!refExists(root, prev.upstream_tag))
      throw new Error(`upstream tag ${prev.upstream_tag} not found`);
    const seriesFile = path.join(forkDir, 'vantt/patches/series.toml');
    const patches = parseSeries(readFileSync(seriesFile, 'utf8')).patches;
    const patchesDir = path.dirname(seriesFile);
    log(
      `Review ${tagNew} against ${prev.given} (upstream ${prev.upstream_tag}); ${patches.length} patches.`,
    );

    const warnings = [];
    const refs = {};
    for (const [side, up, ft] of [
      ['new', tagNew, null],
      ['prev', prev.upstream_tag, prev.fork_tag],
    ]) {
      let ref = findForkRef(root, up, ft);
      if (!ref && opts['build-missing']) {
        const r = catchupBranch(root, up);
        if (!r.ok) warnings.push(`catchup for ${up} exited ${r.exit}`);
        ref = findForkRef(root, up, ft);
      }
      if (!ref) warnings.push(`no fork build for ${up} (${forkBranchOf(up)} missing)`);
      refs[side] = ref;
    }

    // Patch applicability on both upstream tags, independent of catchup's branches.
    log('Patch applicability.');
    const apply = {
      new: checkApplicability(root, patches, tagNew, path.join(workDir, 'apply-new'), patchesDir),
      prev: checkApplicability(
        root,
        patches,
        prev.upstream_tag,
        path.join(workDir, 'apply-prev'),
        patchesDir,
      ),
    };

    // Four trees.
    const npmErr = ensureNpm(root, log);
    if (npmErr) throw new Error(npmErr);
    const treeInfo = {};
    for (const [name, ref] of [
      ['up_new', tagNew],
      ['up_prev', prev.upstream_tag],
      ['fork_prev', refs.prev],
      ['fork_new', refs.new],
    ]) {
      log(`Tree ${name} (${ref ?? 'none'})`);
      trees[name] = makeTree(root, name, ref, workDir, treeInfo);
      if (!trees[name]) warnings.push(`tree ${name} unavailable: ${treeInfo[name].error}`);
    }

    // What upstream changed.
    const overview = upstreamOverview(root, prev.upstream_tag, tagNew);
    const hooks = hookChanges(root, prev.upstream_tag, tagNew);

    // Probes on every tree, for every patch in the series.
    const patchData = [];
    for (const p of patches) {
      log(`Probe ${p.id}`);
      const probe = {};
      for (const name of Object.keys(trees)) {
        if (!p.probe)
          probe[name] = {
            verdict: 'error',
            exit: null,
            output: 'no probe declared in series.toml',
          };
        else if (!trees[name])
          probe[name] = { verdict: 'skipped', exit: null, output: `tree ${name} unavailable` };
        else {
          probe[name] = runProbe(path.join(forkDir, p.probe), trees[name].dir);
          log(`  ${name}: ${probe[name].verdict}`);
        }
      }
      patchData.push({
        id: p.id,
        name: p.name,
        upstream_status: p.upstream_status,
        touches: p.touches,
        probe: p.probe ?? null,
        apply: { new: apply.new[p.id], prev: apply.prev[p.id] },
        upstream_changes: upstreamChanges(root, prev.upstream_tag, tagNew, p.touches),
        probe_results: probe,
        suggestion: suggestPatch({
          upstream: probe.up_new.verdict,
          apply: apply.new[p.id],
          upstreamStatus: p.upstream_status,
        }),
        fork_probe_ok: trees.fork_new ? probe.fork_new.verdict === 'solved' : null,
      });
    }

    // Quality.
    const quality = { skipped: opts['skip-eval'] };
    let blind = null;
    if (!opts['skip-eval']) {
      const resDir = path.join(workDir, 'results');
      const cached = async (name, fn) => {
        const f = path.join(resDir, `${name}.json`);
        const hit = !opts.force && readJsonIfExists(f);
        if (hit) return hit;
        const r = await fn();
        writeJson(f, r);
        return r;
      };
      const light = (r) => ({
        summary: r.summary,
        by_category: r.by_category,
        note_count: r.meta?.note_count ?? null,
        timing: r.review_timing ?? null,
      });
      const available = (names) => names.filter((n) => trees[n]);

      if (trees.up_new) {
        log('Eval obsidian-help');
        const shared = path.join(forkDir, 'fixtures/obsidian-help/dataset');
        const vault = existsSync(shared)
          ? shared
          : prepareDataset(trees.up_new.dir, 'obsidian-help', log);
        const golden = goldenFile(trees.up_new.dir, 'obsidian-help');
        const sides = {};
        for (const n of available(['up_new', 'fork_prev', 'fork_new'])) {
          log(` side ${n}`);
          sides[n] = await cached(`obsidian-help-${n}`, () =>
            runEvaluateTimed({
              tree: trees[n].dir,
              vault,
              golden,
              scratch: path.join(workDir, 'scratch'),
              env: evalEnv(),
            }),
          );
        }
        const lightSides = Object.fromEntries(Object.entries(sides).map(([n, r]) => [n, light(r)]));
        const rows = buildQualityRows(lightSides);
        quality['obsidian-help'] = { sides: lightSides, rows, flags: flagQuality(rows) };

        log('Eval vi');
        const packDir = path.resolve(
          opts['lang-pack'] ?? path.join(forkDir, 'vantt/packages/ohs-lang-vi'),
        );
        const pack = packDir;
        // A pack without its build output is silently ignored by OHS, which makes the fork look like upstream.
        buildPack(packDir, log);
        const vi = {};
        const viRuns = [
          ['up_new', null],
          ['fork_prev', pack],
          ['fork_new', pack],
          ['fork_new_nopack', null],
        ];
        for (const [n, p] of viRuns) {
          const tree = trees[n === 'fork_new_nopack' ? 'fork_new' : n];
          if (!tree) continue;
          log(` side ${n}`);
          vi[n] = await cached(`vi-${n}`, () =>
            runViEval({
              forkDir,
              tree: tree.dir,
              out: path.join(workDir, 'scratch', `vi-${n}.json`),
              pack: p,
              otf: opts.otf,
            }),
          );
        }
        const lightVi = Object.fromEntries(Object.entries(vi).map(([n, r]) => [n, light(r)]));
        const rowsVi = buildQualityRows(lightVi);
        if (
          vi.fork_new &&
          vi.fork_new_nopack &&
          JSON.stringify(vi.fork_new.summary) === JSON.stringify(vi.fork_new_nopack.summary)
        )
          warnings.push(
            'vi eval of fork_new is identical with and without the language pack: the pack may not have loaded',
          );
        quality.vi = {
          pack: pack ? path.relative(forkDir, packDir) : null,
          sides: lightVi,
          rows: rowsVi,
          flags: flagQuality(rowsVi),
        };
        if (vi.up_new && vi.fork_new) {
          log('Blind pairs');
          blind = buildBlind({
            workDir,
            a: vi.up_new,
            b: vi.fork_new,
            otf: opts.otf,
            seed: Number(opts.seed),
            max: Number(opts['blind-max']),
          });
        }
      }

      if (opts.private) {
        log('Eval private set (aggregate numbers only)');
        const dir = path.resolve(opts.private);
        const sides = {};
        for (const n of available(['up_new', 'fork_prev', 'fork_new'])) {
          sides[n] = scrubPrivate(
            runEvaluate({
              tree: trees[n].dir,
              vault: path.join(dir, 'vault'),
              golden: path.join(dir, 'golden-set.json'),
              scratch: path.join(workDir, 'scratch'),
              capture: true,
              log,
            }),
          );
        }
        const rows = buildQualityRows(sides);
        quality.private = { sides, rows, flags: flagQuality(rows) };
      }
    }

    const data = {
      tool: 'review-upstream',
      generated_at: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      new: { tag: tagNew, sha: shaOf(root, tagNew), fork_ref: refs.new },
      prev: { ...prev, sha: shaOf(root, prev.upstream_tag), fork_ref: refs.prev },
      series_sha256: sha256(seriesFile),
      trees: treeInfo,
      upstream: { ...overview, hook_files_changed: hooks },
      patches: patchData,
      quality,
      blind,
      warnings,
      duration_s: Math.round((Date.now() - started) / 1000),
    };
    writeJson(dataFile, data);
    log(`Wrote ${dataFile}`);
    const tr = writeTrends(outDir);
    log(
      `Trends over ${tr.tags.join(', ')}: ${tr.svg}${tr.report ? `, refreshed ${tr.report}` : ' (no report yet; rerun with --trends-only after writing it)'}`,
    );
    return 0;
  } catch (e) {
    log(`review-upstream: ${e.message}`);
    return 7;
  } finally {
    if (!opts.keep) for (const t of Object.values(trees)) t?.cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
