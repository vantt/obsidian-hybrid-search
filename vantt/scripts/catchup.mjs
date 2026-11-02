#!/usr/bin/env node
// Catchup: build the fork release branch `vantt/<tag>` from an upstream tag and
// apply the patch series in vantt/patches/series.toml (PRD section 6).
//
// Exit codes: 0 green, 2 usage (flags, dirty tree, no session), 3 patch conflict,
// 4 build failed, 5 tests failed, 6 quality gate failed, 7 other error.
//
// Safety rules (PRD 5): only tags reachable from upstream/master are built, only
// upstream `master` (plus tags) is fetched, nothing is pushed, HUSKY=0 everywhere.
import { parseArgs } from 'node:util';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, sh, GitError } from './lib/proc.mjs';
import { parseSeries, SeriesError } from './lib/series.mjs';
import {
  computeVersion,
  forkInputs,
  resolveTarget,
  sameInputs,
  stableUpstreamTags,
  stampVersion,
  VERSION_FILES,
} from './lib/release.mjs';
import { runTiers } from './lib/tiers.mjs';
import { ensureNpm } from './lib/npm.mjs';

const UPSTREAM_URL = 'https://github.com/flowing-abyss/obsidian-hybrid-search';
const STATE_REL = 'vantt/.catchup-state.json';
const SERIES_REL = 'vantt/patches/series.toml';
const MAINT_MSG = 'chore(vantt): include fork maintenance files';
const DROP_WF_MSG = 'chore(vantt): drop upstream workflows from release branch';
const EXIT = { ok: 0, usage: 2, conflict: 3, build: 4, tests: 5, quality: 6, error: 7 };
const STATUS_EXIT = {
  SUCCESS: 0,
  CONFLICT: 3,
  BUILD_FAILED: 4,
  TESTS_FAILED: 5,
  QUALITY_FAILED: 6,
  ERROR: 7,
};

class UsageError extends Error {}

// ---------------------------------------------------------------- cli

function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      ref: { type: 'string' },
      'dry-run': { type: 'boolean' },
      clean: { type: 'boolean' },
      continue: { type: 'boolean' },
      abort: { type: 'boolean' },
      'skip-tests': { type: 'boolean' },
      'skip-quality': { type: 'boolean' },
      json: { type: 'boolean' },
      'with-lang': { type: 'string', multiple: true },
      report: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
    allowPositionals: false,
  });
  const modes = ['continue', 'abort', 'dry-run'].filter((k) => values[k]);
  if (modes.length > 1) throw new UsageError(`--${modes.join(' and --')} cannot be combined`);
  for (const l of values['with-lang'] ?? [])
    if (!/^[a-z]{2,3}$/.test(l)) throw new UsageError(`--with-lang expects a language id like "vi", got "${l}"`);
  return {
    ref: values.ref,
    dryRun: !!values['dry-run'],
    clean: !!values.clean,
    cont: !!values.continue,
    abort: !!values.abort,
    skipTests: !!values['skip-tests'],
    skipQuality: !!values['skip-quality'],
    json: !!values.json,
    withLang: [...new Set(values['with-lang'] ?? [])],
    report: values.report ? path.resolve(values.report) : null,
    help: !!values.help,
  };
}

const HELP = `node vantt/scripts/catchup.mjs [--ref <tag|upstream/master|sha>] [--dry-run] [--clean]
                               [--continue] [--abort] [--skip-tests] [--skip-quality] [--json]
                               [--with-lang <lang>] [--report <file>]
See vantt/PRD.md section 6 and .claude/skills/ohs-catchup/SKILL.md.`;

// ---------------------------------------------------------------- context

function makeCtx(opts) {
  const top = git(process.cwd(), ['rev-parse', '--show-toplevel']);
  const log = (...a) => (opts.json ? console.error : console.log)(...a);
  return { root: top, opts, log, abs: (rel) => path.join(top, rel) };
}

const now = () => new Date().toISOString();
const readState = (ctx) =>
  existsSync(ctx.abs(STATE_REL)) ? JSON.parse(readFileSync(ctx.abs(STATE_REL), 'utf8')) : null;
const writeState = (ctx, state) =>
  writeFileSync(ctx.abs(STATE_REL), JSON.stringify(state, null, 2) + '\n');
const reportPath = (ctx, slug) => ctx.abs(`vantt/reports/catchup-${slug}.json`);

function loadSeries(ctx, treeish) {
  const res = git(ctx.root, ['show', `${treeish}:${SERIES_REL}`], { allowFail: true });
  return res.ok ? parseSeries(res.stdout).patches : [];
}

function currentHead(root) {
  const b = git(root, ['symbolic-ref', '--short', '-q', 'HEAD'], { allowFail: true });
  return b.ok ? b.stdout.trim() : git(root, ['rev-parse', 'HEAD']);
}

function trackedDirty(root) {
  return git(root, ['status', '--porcelain', '--untracked-files=no']) !== '';
}

const unmergedFiles = (root) =>
  git(root, ['diff', '--name-only', '--diff-filter=U']).split('\n').filter(Boolean);

function commit(root, message) {
  git(root, ['commit', '--no-verify', '-q', '-m', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

/** Tracked fork files to carry onto the release branch (PRD 4.1 lesson 1, 6.2 step 5). */
function forkFiles(root) {
  return git(root, ['ls-files', '-z', '--', 'vantt', ':(glob).claude/skills/ohs-*/**'])
    .split('\0')
    .filter(Boolean);
}

// ---------------------------------------------------------------- report

function baseReport(state) {
  return {
    status: 'ERROR',
    target_ref: state.target.ref,
    target_sha: state.target.sha,
    release_branch: state.target.branch,
    branch_sha: null,
    version: null,
    series_sha256: state.inputs.series_sha256,
    patches_sha256: state.inputs.patches_sha256,
    lang_packs: state.inputs.lang_packs,
    options: {
      skip_tests: state.options.skipTests,
      skip_quality: state.options.skipQuality,
      with_lang: state.options.withLang,
    },
    patches: state.patch_results,
    capability: null,
    tests: null,
    quality: null,
    failed_patch: null,
    conflicted_files: [],
    reexported_patches: [],
    started_at: state.started_at,
    finished_at: null,
  };
}

function emit(ctx, report, reportFile) {
  report.finished_at = now();
  const text = JSON.stringify(report, null, 2) + '\n';
  for (const file of [reportFile, ctx.opts.report].filter(Boolean)) {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, text);
  }
  if (ctx.opts.json) process.stdout.write(text);
  return STATUS_EXIT[report.status] ?? EXIT.error;
}

// ---------------------------------------------------------------- upstream

function ensureUpstream(ctx) {
  const remotes = git(ctx.root, ['remote']).split('\n');
  if (!remotes.includes('upstream')) {
    ctx.log(`Adding remote upstream (${UPSTREAM_URL}, master only, push disabled).`);
    git(ctx.root, ['remote', 'add', '-t', 'master', 'upstream', UPSTREAM_URL]);
    git(ctx.root, ['remote', 'set-url', '--push', 'upstream', 'DISABLE']);
  }
  // Explicit refspec: never fetch other upstream branches (PRD 5, 6.6).
  ctx.log('Fetching upstream master and tags.');
  git(ctx.root, [
    'fetch', '--quiet', '--no-recurse-submodules', '--tags', 'upstream',
    '+refs/heads/master:refs/remotes/upstream/master',
  ]);
}

// ---------------------------------------------------------------- dry run

function dryRun(ctx, target, patches) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'catchup-dry-'));
  const env = { GIT_INDEX_FILE: path.join(tmp, 'index') };
  const plan = [];
  try {
    git(ctx.root, ['read-tree', target.sha], { env });
    let blocked = false;
    for (const p of patches) {
      const file = ctx.abs(`vantt/patches/${p.patch_file}`);
      let action;
      if (p.upstream_status === 'merged') action = 'SKIP (upstream_status = merged)';
      else if (!existsSync(file)) action = 'ERROR (patch file missing)';
      else if (blocked) action = 'UNKNOWN (after a conflict)';
      else if (git(ctx.root, ['apply', '--cached', '--reverse', '--check', file], { env, allowFail: true }).ok)
        action = 'SKIP (upstream already has it)';
      else if (git(ctx.root, ['apply', '--cached', file], { env, allowFail: true }).ok) action = 'APPLY';
      else {
        action = 'CONFLICT (needs 3-way merge or a rewrite)';
        blocked = true;
      }
      plan.push({ id: p.id, patch_file: p.patch_file, action });
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  const out = {
    status: 'DRY_RUN',
    target_ref: target.ref,
    target_sha: target.sha,
    release_branch: target.branch,
    branch_exists: branchSha(ctx.root, target.branch) !== null,
    patches: plan,
  };
  ctx.log(`Target: ${target.ref} (${target.sha.slice(0, 12)}) -> branch ${target.branch}`);
  if (!plan.length) ctx.log('Patch series is empty.');
  for (const p of plan) ctx.log(`  ${p.id}: ${p.action}`);
  ctx.log('Dry run: nothing fetched, no branch or file changed.');
  if (ctx.opts.json) process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  return EXIT.ok;
}

const branchSha = (root, branch) => {
  const r = git(root, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { allowFail: true });
  return r.ok ? r.stdout.trim() : null;
};

// ---------------------------------------------------------------- start

function start(ctx) {
  const { root, opts, log } = ctx;
  if (readState(ctx))
    throw new UsageError(
      `a catchup session is in progress (${STATE_REL}); run with --continue or --abort`,
    );
  if (!opts.dryRun && trackedDirty(root))
    throw new UsageError('working tree has uncommitted changes to tracked files; commit or stash them');
  if (!opts.dryRun) ensureUpstream(ctx);

  let target;
  try {
    target = resolveTarget(root, opts.ref);
  } catch (e) {
    if (e.usage) throw new UsageError(e.message);
    throw e;
  }
  const patches = loadSeries(ctx, 'HEAD');
  for (const p of patches)
    if (p.upstream_status !== 'merged' && !existsSync(ctx.abs(`vantt/patches/${p.patch_file}`)))
      throw new UsageError(`patch file vantt/patches/${p.patch_file} (${p.id}) does not exist`);
  if (opts.dryRun) return dryRun(ctx, target, patches);

  const inputs = forkInputs(root, 'HEAD');
  const existing = branchSha(root, target.branch);

  // Step 4: a green branch for the same inputs is not rebuilt.
  if (existing && !opts.clean) {
    const file = reportPath(ctx, target.slug);
    const prev = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    const covers =
      prev &&
      (!prev.options?.skip_tests || opts.skipTests) &&
      (!prev.options?.skip_quality || opts.skipQuality) &&
      opts.withLang.every((l) => prev.options?.with_lang?.includes(l));
    if (
      prev?.status === 'SUCCESS' &&
      prev.target_sha === target.sha &&
      prev.branch_sha === existing &&
      covers &&
      sameInputs(prev, inputs)
    ) {
      log(`${target.branch} is already green for ${target.ref} (${prev.version}); nothing to do.`);
      if (opts.json) process.stdout.write(JSON.stringify({ ...prev, already_green: true }, null, 2) + '\n');
      return EXIT.ok;
    }
  }

  // Step 5: copy fork files out of git's reach before checking out the tag.
  const files = forkFiles(root);
  const stamp = now().replace(/[:.]/g, '-');
  const backupRel = `vantt/.work/backup-${stamp}`;
  for (const f of files) {
    mkdirSync(path.dirname(ctx.abs(`${backupRel}/${f}`)), { recursive: true });
    cpSync(ctx.abs(f), ctx.abs(`${backupRel}/${f}`));
  }
  const backupAbs = ctx.abs(backupRel);

  const state = {
    version: 1,
    target,
    orig: currentHead(root),
    prev_branch_sha: existing,
    base_commit: null,
    backup_dir: backupRel,
    options: { skipTests: opts.skipTests, skipQuality: opts.skipQuality, withLang: opts.withLang, report: opts.report },
    inputs,
    patch_results: [],
    index: 0,
    had_conflict: false,
    conflicted_files: [],
    started_at: now(),
  };

  // Step 6: branch from the target, put the fork files back, commit them.
  log(`Creating ${target.branch} from ${target.ref} (${target.sha.slice(0, 12)}).`);
  git(root, ['checkout', '-q', '-B', target.branch, target.sha]);
  // State lives in vantt/ (ignored once vantt/.gitignore is restored); write it
  // right after checkout so --abort can always recover.
  for (const f of files) {
    mkdirSync(path.dirname(ctx.abs(f)), { recursive: true });
    cpSync(path.join(backupAbs, f), ctx.abs(f));
  }
  writeState(ctx, state);
  git(root, ['add', '-f', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: files.join('\0') });
  state.base_commit = commit(root, MAINT_MSG);
  writeState(ctx, state);
  return applyFrom(ctx, state, 0);
}

// ---------------------------------------------------------------- patches

function applyFrom(ctx, state, from) {
  const { root, log } = ctx;
  const patches = loadSeries(ctx, state.base_commit);
  for (let i = from; i < patches.length; i++) {
    const p = patches[i];
    const rel = `vantt/patches/${p.patch_file}`;
    const result = { id: p.id, status: null, commit: null };
    if (p.upstream_status === 'merged') {
      result.status = 'SKIPPED_UPSTREAM_HAS_IT';
      result.reason = 'upstream_status = merged';
    } else if (git(root, ['apply', '--reverse', '--check', rel], { allowFail: true }).ok) {
      result.status = 'SKIPPED_UPSTREAM_HAS_IT';
      result.reason = 'patch reverse-applies on the target';
    } else {
      const res = git(root, ['apply', '--3way', '--whitespace=nowarn', rel], { allowFail: true });
      if (!res.ok) return conflict(ctx, state, patches, i, res.stderr);
      if (git(root, ['diff', '--cached', '--quiet'], { allowFail: true }).ok) {
        result.status = 'SKIPPED_UPSTREAM_HAS_IT';
        result.reason = 'patch produced no change';
      } else {
        result.status = 'APPLIED';
        result.commit = commit(root, `${p.name}\n\nPatch-Id: ${p.id}`);
      }
    }
    log(`  ${p.id}: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
    state.patch_results.push(result);
    state.index = i + 1;
    writeState(ctx, state);
  }
  return buildAndTest(ctx, state, patches);
}

function conflict(ctx, state, patches, i, stderr) {
  const { root, log } = ctx;
  const p = patches[i];
  let files = unmergedFiles(root);
  if (!files.length) {
    // Plain apply failure without conflict markers (e.g. missing base blobs).
    const ns = git(root, ['apply', '--numstat', `vantt/patches/${p.patch_file}`], { allowFail: true });
    files = (ns.stdout || '').split('\n').filter(Boolean).map((l) => l.split('\t')[2]);
  }
  state.index = i;
  state.had_conflict = true;
  state.conflicted_files = files;
  writeState(ctx, state);

  const tags = stableUpstreamTags(root);
  const prevTag = state.target.isTag ? tags[tags.indexOf(state.target.tag) + 1] : tags[0];
  const range = prevTag ? `${prevTag}..${state.target.sha.slice(0, 12)}` : state.target.sha.slice(0, 12);
  const lines = [
    '',
    `CONFLICT: patch ${p.id} (${i + 1}/${patches.length}) does not apply on ${state.target.ref}.`,
    stderr.trim() ? `git apply: ${stderr.trim().split('\n').slice(-3).join(' | ')}` : '',
    `  branch:     ${state.target.branch}`,
    `  patch:      vantt/patches/${p.patch_file}`,
    `  spec:       ${p.metadata_file ? `vantt/patches/${p.metadata_file}` : '(none)'}  (read "Bất biến" and "Điểm chạm")`,
    '  files:',
    ...files.map((f) => `    - ${f}`),
    '',
    'Next steps (skill .claude/skills/ohs-catchup):',
    `  1. See what upstream changed: git log -p ${range} -- ${files.join(' ')}`,
    '  2. Rewrite the change so every invariant in the spec holds; do not force the old diff.',
    '  3. git add <files>  &&  node vantt/scripts/catchup.mjs --continue',
    '  Upstream already solves it?  git reset --hard HEAD  &&  node vantt/scripts/catchup.mjs --continue',
    '     (records SKIPPED_UPSTREAM_HAS_IT; then set upstream_status = "merged" on master)',
    '  Give up:  node vantt/scripts/catchup.mjs --abort',
    '',
  ];
  log(lines.filter((l) => l !== '').join('\n'));

  const report = baseReport(state);
  report.status = 'CONFLICT';
  report.patches = [...state.patch_results, { id: p.id, status: 'CONFLICT', commit: null }];
  report.failed_patch = p.id;
  report.conflicted_files = files;
  return emit(ctx, report, reportPath(ctx, state.target.slug));
}

function cont(ctx) {
  const { root } = ctx;
  const state = readState(ctx);
  if (!state) throw new UsageError('no catchup session in progress');
  const head = currentHead(root);
  if (head !== state.target.branch)
    throw new UsageError(`expected to be on ${state.target.branch}, but HEAD is ${head}`);
  const unmerged = unmergedFiles(root);
  if (unmerged.length)
    throw new UsageError(`unresolved files (fix them, then git add): ${unmerged.join(', ')}`);
  const markers = git(root, ['diff', '--cached', '--check'], { allowFail: true });
  const markerLines = (markers.stdout || '').split('\n').filter((l) => /conflict marker/.test(l));
  if (markerLines.length)
    throw new UsageError(`conflict markers are still staged:\n${markerLines.join('\n')}`);
  if (git(root, ['diff', '--quiet'], { allowFail: true }).ok === false)
    throw new UsageError('unstaged changes to tracked files; git add the resolution (or reset it) first');

  const patches = loadSeries(ctx, state.base_commit);
  const p = patches[state.index];
  if (!p) throw new UsageError('state does not point at a patch; run --abort');
  const result = { id: p.id, status: null, commit: null, resolved: true };
  if (git(root, ['diff', '--cached', '--quiet'], { allowFail: true }).ok) {
    result.status = 'SKIPPED_UPSTREAM_HAS_IT';
    result.reason = 'conflict resolved to no change';
  } else {
    result.status = 'APPLIED';
    result.commit = commit(root, `${p.name}\n\nPatch-Id: ${p.id}`);
  }
  ctx.log(`  ${p.id}: ${result.status} (resolved by hand)`);
  state.patch_results.push(result);
  state.index += 1;
  state.conflicted_files = [];
  writeState(ctx, state);
  return applyFrom(ctx, state, state.index);
}

// ---------------------------------------------------------------- build and test

function buildAndTest(ctx, state, patches) {
  const { root, log } = ctx;
  const report = baseReport(state);
  const finish = (status) => {
    report.status = status;
    report.branch_sha = git(root, ['rev-parse', 'HEAD']);
    return endSession(ctx, state, report);
  };

  // Step 8: version stamp.
  const pkgVersion = JSON.parse(readFileSync(ctx.abs('package.json'), 'utf8')).version;
  report.version = computeVersion(root, state.target, state.inputs, pkgVersion);
  stampVersion(root, report.version);
  git(root, ['add', '--', ...VERSION_FILES.filter((f) => existsSync(ctx.abs(f)))]);
  commit(root, `chore(vantt): set version ${report.version}`);
  log(`Version ${report.version}.`);

  // Step 9: install and build.
  const npmErr = ensureNpm(root, log);
  if (npmErr) {
    log(npmErr);
    return finish('BUILD_FAILED');
  }
  // Upstream's root `prepare` script links agent configs into .claude/ and
  // .agents/; it refuses when .claude/skills is a real directory (our ohs-*
  // skills) and the release build does not need it. Skip root lifecycle
  // scripts, then run the dependencies' install scripts (native modules).
  log('npm ci --ignore-scripts && npm rebuild');
  if (!sh(root, 'npm ci --ignore-scripts').ok || !sh(root, 'npm rebuild').ok)
    return finish('BUILD_FAILED');
  log('npm run build');
  if (!sh(root, 'npm run build').ok) return finish('BUILD_FAILED');

  // Step 10: capability checks.
  const applied = patches.filter((p) =>
    state.patch_results.some((r) => r.id === p.id && r.status === 'APPLIED'),
  );
  const ver = sh(root, 'node dist/src/cli.js --version', { capture: true });
  report.capability = {
    version: ver.ok && ver.stdout.includes('-vantt.') ? 'pass' : 'fail',
    patches: {},
  };
  if (report.capability.version === 'fail')
    log(`Capability: "node dist/src/cli.js --version" printed "${ver.stdout.trim()}", expected "-vantt."`);
  for (const p of applied) {
    if (!p.capability_check) continue;
    report.capability.patches[p.id] = sh(root, p.capability_check).ok ? 'pass' : 'fail';
  }
  const capFailed = [report.capability.version, ...Object.values(report.capability.patches)].includes('fail');

  // Step 11: test tiers T1-T5.
  if (capFailed) {
    report.tests = null;
    return finish('TESTS_FAILED');
  }
  const tiers = runTiers({
    cwd: root,
    target: state.target,
    patches: applied,
    withLang: state.options.withLang,
    skipTests: state.options.skipTests,
    skipQuality: state.options.skipQuality,
    log,
  });
  report.tests = tiers.tests;
  report.quality = tiers.quality;
  if (tiers.failed === 'tests') return finish('TESTS_FAILED');
  if (tiers.failed === 'quality') return finish('QUALITY_FAILED');

  // Step 12: drop upstream workflows.
  if (git(root, ['ls-files', '--', '.github/workflows']) !== '') {
    git(root, ['rm', '-r', '-q', '--', '.github/workflows']);
    commit(root, DROP_WF_MSG);
  }

  // PRD 6.4: after a fixed conflict, re-export every applied patch.
  if (state.had_conflict) {
    report.reexported_patches = applied.map((p) => {
      const sha = git(root, [
        'log', '--format=%H', '-1', '--fixed-strings', `--grep=Patch-Id: ${p.id}`,
        `${state.base_commit}..HEAD`,
      ]);
      return {
        id: p.id,
        patch_file: p.patch_file,
        content: git(root, ['format-patch', '-1', sha, '--stdout', '--zero-commit', '--no-signature'], {
          raw: true,
        }),
      };
    });
  }
  return finish('SUCCESS');
}

/** Leave the release branch, restore the original checkout, write the report. */
function endSession(ctx, state, report) {
  const { root, log } = ctx;
  const reexports = report.reexported_patches;
  report.reexported_patches = reexports.map((r) => `vantt/patches/${r.patch_file}`);
  // Anything left uncommitted on the release branch is build or test output.
  git(root, ['reset', '-q', '--hard']);
  rmSync(ctx.abs(STATE_REL), { force: true });
  git(root, ['checkout', '-q', state.orig]);
  for (const r of reexports) writeFileSync(ctx.abs(`vantt/patches/${r.patch_file}`), r.content);
  rmSync(ctx.abs(state.backup_dir), { recursive: true, force: true });

  const code = emit(ctx, report, reportPath(ctx, state.target.slug));
  log(`${report.status}: ${state.target.branch} at ${report.branch_sha?.slice(0, 12)} (${report.version}). Back on ${state.orig}.`);
  if (reexports.length) {
    log('Patches were re-exported after the conflict fix (PRD 6.4). Commit them on master:');
    log(`  git add ${report.reexported_patches.join(' ')}`);
    log(`  git commit -m "chore(vantt): refresh patches for ${state.target.ref}"`);
  }
  return code;
}

// ---------------------------------------------------------------- abort

function abort(ctx) {
  const { root, log } = ctx;
  const state = readState(ctx);
  if (!state) throw new UsageError('no catchup session in progress');
  git(root, ['reset', '-q', '--hard']);
  rmSync(ctx.abs(STATE_REL), { force: true });
  git(root, ['checkout', '-q', state.orig]);
  if (state.target.branch !== state.orig) {
    if (state.prev_branch_sha) git(root, ['branch', '-f', state.target.branch, state.prev_branch_sha]);
    else git(root, ['branch', '-D', '-q', state.target.branch]);
  }
  rmSync(ctx.abs(state.backup_dir), { recursive: true, force: true });
  log(`Aborted catchup of ${state.target.ref}; back on ${state.orig}.`);
  if (ctx.opts.json)
    process.stdout.write(JSON.stringify({ status: 'ABORTED', target_ref: state.target.ref }, null, 2) + '\n');
  return EXIT.ok;
}

// ---------------------------------------------------------------- main

function main(argv) {
  let opts;
  try {
    opts = parseCli(argv);
  } catch (e) {
    console.error(`catchup: ${e.message}\n${HELP}`);
    return EXIT.usage;
  }
  if (opts.help) {
    console.log(HELP);
    return EXIT.ok;
  }
  let ctx;
  try {
    ctx = makeCtx(opts);
    if (opts.abort) return abort(ctx);
    if (opts.cont) return cont(ctx);
    return start(ctx);
  } catch (e) {
    if (e instanceof UsageError || e instanceof SeriesError) {
      console.error(`catchup: ${e.message}`);
      return EXIT.usage;
    }
    console.error(`catchup: ${e instanceof GitError ? e.message : e.stack || e}`);
    if (opts.json) process.stdout.write(JSON.stringify({ status: 'ERROR', error: String(e.message) }) + '\n');
    return EXIT.error;
  }
}

process.exitCode = main(process.argv.slice(2));
