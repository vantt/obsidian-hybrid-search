// Test tiers run by catchup after the build (PRD 6.2 steps 10-11, 11.1).
//
// Hook points:
//   T1 upstream   `npm run test` of upstream.
//   T2 patches    `test_command` of every applied patch.
//   T3 lang_<id>  tests of vantt/packages/ohs-lang-<id> when `--with-lang <id>` is given.
//   T4 invariance `node vantt/scripts/invariance.mjs` (PRD 11.4) when the script exists.
//   T5 quality    `node vantt/scripts/quality-gate.mjs` (PRD 11.6) when the script exists.
//
// T4/T5 hook contract: the script is run from the repo root of the release branch
// with `--target-ref <ref> --target-sha <sha> --branch <branch> --json` (plus
// `--with-lang <id>` per language). Exit 0 = pass, anything else = fail. If it
// prints a JSON object on stdout, catchup stores it in the report
// (`tests.invariance_detail`, `quality`). A tier whose script or package does not
// exist yet reports "skipped" and never fails the run.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { sh } from './proc.mjs';

const parseJson = (s) => {
  try {
    const v = JSON.parse(s.trim());
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
};

function hookScript(cwd, rel, ctx, log) {
  const file = path.join(cwd, rel);
  if (!existsSync(file)) {
    log(`  ${rel} not present: skipped`);
    return { status: 'skipped', detail: null };
  }
  const args = [
    '--target-ref', ctx.target.ref,
    '--target-sha', ctx.target.sha,
    '--branch', ctx.target.branch,
    '--json',
    ...ctx.withLang.flatMap((l) => ['--with-lang', l]),
  ].map((a) => JSON.stringify(a));
  const res = sh(cwd, `node ${JSON.stringify(rel)} ${args.join(' ')}`, { capture: true });
  if (res.stderr) process.stderr.write(res.stderr);
  return { status: res.ok ? 'pass' : 'fail', detail: parseJson(res.stdout) };
}

function langPackTests(cwd, lang, log) {
  const dir = path.join(cwd, 'vantt', 'packages', `ohs-lang-${lang}`);
  const pkgFile = path.join(dir, 'package.json');
  if (!existsSync(pkgFile)) {
    log(`  vantt/packages/ohs-lang-${lang} not present: skipped`);
    return 'skipped';
  }
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'));
  if (!pkg.scripts?.test) {
    log(`  ohs-lang-${lang} has no test script: skipped`);
    return 'skipped';
  }
  const install = existsSync(path.join(dir, 'package-lock.json')) ? 'npm ci' : 'npm install';
  if (!sh(dir, install).ok) return 'fail';
  return sh(dir, 'npm test').ok ? 'pass' : 'fail';
}

/**
 * Run T1-T5. ctx: {cwd, target, patches (applied series entries), withLang[], skipTests, skipQuality, log}.
 * Returns {tests, quality, failed: null | 'tests' | 'quality'}.
 */
export function runTiers(ctx) {
  const { cwd, log } = ctx;
  const tests = { upstream: 'skipped', patches: {}, invariance: 'skipped' };
  for (const l of ctx.withLang) tests[`lang_${l}`] = 'skipped';
  const quality = { gate: 'skipped' };

  if (ctx.skipTests) {
    log('Tests skipped (--skip-tests).');
    for (const p of ctx.patches) tests.patches[p.id] = 'skipped';
  } else {
    log('T1 upstream tests: npm run test');
    tests.upstream = sh(cwd, 'npm run test').ok ? 'pass' : 'fail';
    for (const p of ctx.patches) {
      if (!p.test_command) {
        tests.patches[p.id] = 'skipped';
        continue;
      }
      log(`T2 ${p.id}: ${p.test_command}`);
      tests.patches[p.id] = sh(cwd, p.test_command).ok ? 'pass' : 'fail';
    }
    for (const l of ctx.withLang) {
      log(`T3 language pack ${l}`);
      tests[`lang_${l}`] = langPackTests(cwd, l, log);
    }
    log('T4 invariance');
    const inv = hookScript(cwd, 'vantt/scripts/invariance.mjs', ctx, log);
    tests.invariance = inv.status;
    if (inv.detail) tests.invariance_detail = inv.detail;
  }
  const testsFailed = [
    tests.upstream,
    tests.invariance,
    ...Object.values(tests.patches),
    ...ctx.withLang.map((l) => tests[`lang_${l}`]),
  ].includes('fail');
  if (testsFailed) return { tests, quality, failed: 'tests' };

  if (ctx.skipQuality) {
    log('Quality gate skipped (--skip-quality).');
  } else {
    log('T5 quality gate');
    const q = hookScript(cwd, 'vantt/scripts/quality-gate.mjs', ctx, log);
    Object.assign(quality, q.detail ?? {}, { gate: q.status });
    if (q.status === 'fail') return { tests, quality, failed: 'quality' };
  }
  return { tests, quality, failed: null };
}
