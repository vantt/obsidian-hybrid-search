// Quality gate (PRD 11.6): rule functions on synthetic results, baseline files, and the CLI
// (standard and --private) on a throw-away repo whose eval is a stub.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baseVersion, compareVersions, pickBaseline, writeBaseline } from '../lib/baselines.mjs';
import { platformKey } from '../lib/eval-run.mjs';
import { regressionChecks, upstreamChecks, upstreamPackCheck, verdict, viChecks } from '../lib/gates.mjs';
import { main } from '../quality-gate.mjs';
import { git, write } from './helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL_MODULES = path.resolve(here, '../../../node_modules');
const CONFIG = JSON.parse(readFileSync(path.resolve(here, '../quality-gates.json'), 'utf8'));

const res = (summary, cats = {}, size = 10) => ({
  meta: { golden_set_size: size },
  summary: { ndcg_5: 0.8, ...summary },
  by_category: Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, { ndcg_5: 0.8, ...v }])),
});
const byId = (checks) => Object.fromEntries(checks.map((c) => [c.id, c]));

describe('upstreamChecks', () => {
  const cfg = CONFIG.upstream;
  const baseline = { version: '1.0.0', exact: true, result: res({ ndcg_5: 0.8 }) };
  it('passes within the Linux tolerance and fails beyond it (both directions)', () => {
    const run = (v) => upstreamChecks(cfg, { platform: 'linux-x64', result: res({ ndcg_5: v }), baseline })[0].status;
    expect(run(0.804)).toBe('pass');
    expect(run(0.796)).toBe('pass');
    expect(run(0.7939)).toBe('fail');
    expect(run(0.8061)).toBe('fail');
  });
  it('is pending without a baseline', () => {
    expect(upstreamChecks(cfg, { platform: 'linux-x64', result: res({}), baseline: null })[0].status).toBe('pending');
  });
  it('uses the quality.ts floors on darwin-arm64', () => {
    const c = upstreamChecks(cfg, { platform: 'darwin-arm64', result: res({}), baseline, floors: { ok: false, message: 'below floor' } })[0];
    expect(c).toMatchObject({ status: 'fail', detail: 'below floor' });
  });
});

describe('upstreamPackCheck', () => {
  const cfg = CONFIG.upstream;
  it('allows a drop up to 0.01 nDCG@5 with the pack', () => {
    expect(upstreamPackCheck(cfg, { noPack: res({ ndcg_5: 0.8 }), withPack: res({ ndcg_5: 0.79 }) }).status).toBe('pass');
    expect(upstreamPackCheck(cfg, { noPack: res({ ndcg_5: 0.8 }), withPack: res({ ndcg_5: 0.789 }) }).status).toBe('fail');
    expect(upstreamPackCheck(cfg, { noPack: res({ ndcg_5: 0.8 }), withPack: res({ ndcg_5: 0.9 }) }).status).toBe('pass');
  });
});

describe('regressionChecks', () => {
  const ref = res({ ndcg_5: 0.8 }, { a: { ndcg_5: 0.8 }, b: { ndcg_5: 0.5 } });
  const run = (result) =>
    byId(regressionChecks('r', { result, ref, refLabel: 'ref', metric: 'ndcg_5', categoryMax: 0.02, overallMax: 0 }));
  it('passes at equal or better, allows 0.02 per category', () => {
    const r = run(res({ ndcg_5: 0.8 }, { a: { ndcg_5: 0.78 }, b: { ndcg_5: 0.9 } }));
    expect(r['r-categories'].status).toBe('pass');
    expect(r['r-overall'].status).toBe('pass');
  });
  it('fails a category beyond 0.02 and an overall drop', () => {
    const r = run(res({ ndcg_5: 0.79 }, { a: { ndcg_5: 0.7 }, b: { ndcg_5: 0.5 } }));
    expect(r['r-categories']).toMatchObject({ status: 'fail' });
    expect(r['r-categories'].detail).toMatch(/a 0.8 -> 0.7/);
    expect(r['r-overall'].status).toBe('fail');
  });
  it('fails a category missing from the result', () => {
    expect(run(res({ ndcg_5: 0.8 }, { a: {} }))['r-categories'].detail).toMatch(/b missing/);
  });
});

const PENDING = { ...CONFIG.vi, targets: CONFIG.vi.targets.map((t) => ({ ...t, status: 'pending' })) };

describe('viChecks', () => {
  const upstream = {
    version: '1.0.0',
    result: res({ ndcg_5: 0.7 }, { 'vi-telex': { ndcg_5: 0.4, hit_5: 0.5 }, 'vi-compound': { ndcg_5: 0.85 }, 'vi-accented': { ndcg_5: 1 } }),
  };
  const cats = (o) => ({ 'vi-telex': { hit_5: 0.5, ndcg_5: 0.4 }, 'vi-compound': { ndcg_5: 0.85 }, 'vi-accented': { ndcg_5: 1 }, ...o });

  it('pending targets are reported, never failed, even when not met', () => {
    const checks = viChecks(PENDING, { result: res({ ndcg_5: 0.7 }, cats()), upstream, prevRelease: null });
    const c = byId(checks);
    expect(c['G8-telex']).toMatchObject({ status: 'pending', would: 'fail' });
    expect(c['vi-regression-categories'].status).toBe('pass');
    expect(verdict(checks).status).toBe('pass');
    expect(verdict(checks, true).status).toBe('fail');
  });

  it('reports a pending target that is already met', () => {
    const c = byId(viChecks(PENDING, { result: res({ ndcg_5: 0.7 }, cats({ 'vi-telex': { hit_5: 0.9, ndcg_5: 0.4 } })), upstream }));
    expect(c['G8-telex']).toMatchObject({ status: 'pending', would: 'pass' });
  });

  it('enforced targets fail the gate: min, gain over upstream, ratio, snippet', () => {
    const cfg = {
      ...CONFIG.vi,
      targets: [
        { id: 't-min', category: 'vi-telex', metric: 'hit_5', min: 0.8, status: 'enforced' },
        { id: 't-gain', category: 'vi-compound', metric: 'ndcg_5', min_gain_over_upstream: 0.1, status: 'enforced' },
        { id: 't-ratio', category: 'vi-telex', metric: 'hit_5', min_ratio_over_upstream: 2, status: 'enforced' },
        { id: 't-snippet', category: 'vi-snippet', metric: 'snippet_ok', min: 1, status: 'enforced' },
      ],
    };
    const c = byId(viChecks(cfg, { result: res({ ndcg_5: 0.7 }, cats({ 'vi-compound': { ndcg_5: 0.9 } })), upstream }));
    expect(c['t-min'].status).toBe('fail');
    expect(c['t-gain'].status).toBe('fail');
    expect(c['t-ratio'].status).toBe('fail');
    expect(c['t-snippet'].status).toBe('fail'); // metric not reported: an enforced target cannot pass blind
    const ok = byId(viChecks(cfg, { result: res({ ndcg_5: 0.7 }, cats({ 'vi-compound': { ndcg_5: 0.96 }, 'vi-telex': { hit_5: 1, ndcg_5: 0.4 }, 'vi-snippet': { snippet_ok: 1 } })), upstream }));
    expect(ok['t-min'].status).toBe('pass');
    expect(ok['t-gain'].status).toBe('pass');
    expect(ok['t-ratio'].status).toBe('pass');
    expect(ok['t-snippet'].status).toBe('pass');
  });

  it('compares with the previous release when there is one, else with upstream', () => {
    const prev = { version: '1.0.0-vantt.1', result: res({ ndcg_5: 0.9 }, cats({ 'vi-accented': { ndcg_5: 1 } })) };
    const c = byId(viChecks(CONFIG.vi, { result: res({ ndcg_5: 0.8 }, cats()), upstream, prevRelease: prev }));
    expect(c['vi-regression-overall'].status).toBe('fail');
    expect(c['vi-regression-overall'].detail).toMatch(/previous release 1.0.0-vantt.1/);
  });

  it('fails when the upstream baseline was recorded for another golden set', () => {
    const c = viChecks(CONFIG.vi, { result: res({}, cats(), 99), upstream });
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ id: 'vi-baseline-valid', status: 'fail' });
  });

  it('is pending without any baseline', () => {
    expect(byId(viChecks(CONFIG.vi, { result: res({}, cats()), upstream: null }))['vi-regression'].status).toBe('pending');
  });

  it('the shipped thresholds file lists the PRD targets, all enforced', () => {
    const ids = CONFIG.vi.targets.map((t) => t.id);
    for (const id of ['G3-unaccented', 'G3-dd', 'G3-tone-precision', 'G8-telex', 'G8-typo', 'G8-synonym', 'G8-abbr', 'G8-alias', 'G8-compound', 'G8-snippet'])
      expect(ids).toContain(id);
    expect(CONFIG.vi.targets.filter((t) => t.status !== 'enforced')).toEqual([]);
    expect(CONFIG.upstream).toMatchObject({ linux_tolerance: 0.005, pack_regression_max: 0.01 });
    expect(CONFIG.vi).toMatchObject({ category_regression_max: 0.02 });
  });
});

describe('baselines', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ohs-bl-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('orders versions, vantt counters and stamped versions', () => {
    expect(compareVersions('0.17.2', '0.17.10')).toBeLessThan(0);
    expect(compareVersions('0.17.2-vantt.2', '0.17.2-vantt.10')).toBeLessThan(0);
    expect(compareVersions('0.17.2-vantt.0.gabc1234', '0.17.2-vantt.1')).toBeLessThan(0);
    expect(baseVersion('0.17.2-vantt.1')).toBe('0.17.2');
  });

  it('picks the newest baseline not newer than the version, per set and language', () => {
    for (const [version, set, lang] of [['0.17.2', 'vi-search', null], ['0.18.0', 'vi-search', null], ['0.17.2-vantt.1', 'vi-search', 'vi'], ['0.17.2-vantt.2', 'vi-search', 'vi']])
      writeBaseline(dir, { version, set, lang, result: { v: version } });
    expect(pickBaseline(dir, { set: 'vi-search', version: '0.17.5' })).toMatchObject({ version: '0.17.2', exact: false });
    expect(pickBaseline(dir, { set: 'vi-search', version: '0.18.0' })).toMatchObject({ version: '0.18.0', exact: true });
    expect(pickBaseline(dir, { set: 'vi-search', lang: 'vi', version: '0.17.2-vantt.3' }).version).toBe('0.17.2-vantt.2');
    expect(pickBaseline(dir, { set: 'vi-search', lang: 'vi', version: '0.17.1' })).toBeNull();
    expect(pickBaseline(dir, { set: 'obsidian-help', version: '9.9.9' })).toBeNull();
    expect(pickBaseline(path.join(dir, 'missing'), { set: 'vi-search', version: '1.0.0' })).toBeNull();
  });

  it('refuses to overwrite a baseline unless forced', () => {
    writeBaseline(dir, { version: '1.0.0', set: 'smoke', result: { a: 1 } });
    expect(() => writeBaseline(dir, { version: '1.0.0', set: 'smoke', result: { a: 2 } })).toThrow(/reviewed PR/);
    writeBaseline(dir, { version: '1.0.0', set: 'smoke', result: { a: 2 }, force: true });
    expect(pickBaseline(dir, { set: 'smoke', version: '1.0.0' }).result).toEqual({ a: 2 });
  });
});

// Stub of eval/evaluate.ts. With OHS_LANGUAGE_PACK set, the score is read from <pack>/score.txt.
const EVALUATE = `import fs from 'node:fs';
import path from 'node:path';
const a = process.argv;
const get = (f) => a[a.indexOf(f) + 1];
const pack = process.env.OHS_LANGUAGE_PACK;
const score = pack ? Number(fs.readFileSync(path.join(pack, 'score.txt'), 'utf8')) : 0.8;
const golden = JSON.parse(fs.readFileSync(get('--golden-set'), 'utf8'));
console.log('SECRET-QUERY SECRET-PATH ' + get('--vault'));
console.error('SECRET-STDERR');
const per_query = golden.map((q) => ({ id: q.id, query: 'SECRET-QUERY', category: q.category, ndcg_5: score, top_paths: ['SECRET-PATH.md'] }));
fs.writeFileSync(get('--output'), JSON.stringify({ meta: { golden_set_size: golden.length }, summary: { ndcg_5: score, hit_5: score }, by_category: { c: { ndcg_5: score, hit_5: score } }, per_query }));
`;

describe('quality-gate CLI on a stub eval', () => {
  let dir;
  let root;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ohs-qg-'));
    root = path.join(dir, 'fork');
    mkdirSync(root);
    git(root, 'init', '-q', '-b', 'master');
    write(root, 'package.json', '{"name":"x","version":"1.0.0-vantt.1"}\n');
    write(root, 'eval/evaluate.ts', EVALUATE);
    write(root, 'fixtures/obsidian-help/golden-set.json', JSON.stringify([{ id: 'q1', category: 'c' }, { id: 'q2', category: 'c' }]));
    write(root, 'fixtures/obsidian-help/dataset/a.md', '# a\n');
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.79');
    write(root, '.gitignore', 'node_modules\nvantt/.work\nfixtures/*/dataset\n');
    symlinkSync(REAL_MODULES, path.join(root, 'node_modules'), 'dir');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function run(argv) {
    const out = [];
    const err = [];
    const o = process.stdout.write.bind(process.stdout);
    const e = process.stderr.write.bind(process.stderr);
    process.stdout.write = (c) => (out.push(String(c)), true);
    process.stderr.write = (c) => (err.push(String(c)), true);
    let code;
    try {
      code = await main(argv, { cwd: root });
    } finally {
      process.stdout.write = o;
      process.stderr.write = e;
    }
    return { code, out: out.join(''), err: err.join(''), report: out.length ? JSON.parse(out.join('')) : null };
  }
  const std = ['--target-ref', 'v1.0.0', '--target-sha', 'abc', '--branch', 'vantt/v1.0.0', '--json'];
  const baselineDir = () => path.join(root, 'vantt/eval/baselines', platformKey());

  it('no pack: runs the upstream eval, pending without a baseline', async () => {
    const { code, report } = await run(std);
    expect(code).toBe(0);
    expect(report).toMatchObject({ gate: 'pass', pending: ['upstream-no-pack'] });
  });

  it('no pack: fails when the result drifts from the recorded baseline', async () => {
    writeBaseline(baselineDir(), { version: '1.0.0', set: 'obsidian-help', result: { summary: { ndcg_5: 0.9 } } });
    const { code, report } = await run(std);
    expect(code).toBe(1);
    expect(report.failed).toEqual(['upstream-no-pack']);
  });

  it('with a pack: passes within 0.01 and pends the language without a golden set', async () => {
    const { code, report } = await run([...std, '--with-lang', 'de']);
    expect(code).toBe(0);
    expect(byId(report.checks)['upstream-with-pack'].status).toBe('pass');
    expect(report.pending).toContain('de-eval');
  });

  it('with a pack: fails when it loses more than 0.01 on the upstream eval', async () => {
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.7');
    const { code, report } = await run([...std, '--with-lang', 'de']);
    expect(code).toBe(1);
    expect(report.failed).toEqual(['upstream-with-pack']);
  });

  it('a missing pack is pending, not a failure', async () => {
    const { code, report } = await run([...std, '--with-lang', 'zz']);
    expect(code).toBe(0);
    expect(report.pending).toContain('pack-zz');
  });

  it('--strict fails on pending; --write-baseline records and never replaces', async () => {
    expect((await run([...std, '--strict'])).code).toBe(1);
    const first = await run([...std, '--write-baseline']);
    expect(first.report.baselines_written).toHaveLength(1);
    expect(existsSync(path.join(baselineDir(), '1.0.0.obsidian-help.json'))).toBe(true);
    const second = await run([...std, '--write-baseline']);
    expect(second.code).toBe(2);
    expect(second.report.error).toMatch(/reviewed PR/);
  });

  it('--private prints aggregate numbers only and leaves nothing behind', async () => {
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.85');
    const priv = path.join(dir, 'private');
    mkdirSync(path.join(priv, 'vault'), { recursive: true });
    writeFileSync(path.join(priv, 'vault', 'note.md'), '# SECRET-NOTE\n');
    writeFileSync(path.join(priv, 'golden-set.json'), JSON.stringify([{ id: 'p1', query: 'SECRET-QUERY', category: 'c' }, { id: 'p2', category: 'c' }]));
    const { code, out, err, report } = await run(['--private', priv, '--with-lang', 'de', '--json']);
    expect(code).toBe(0);
    expect(report).toMatchObject({ private: true, gate: 'pass', pack: 'de' });
    expect(report.without_pack.categories.c).toMatchObject({ n: 2, ndcg_5: 0.8 });
    expect(report.with_pack.summary.ndcg_5).toBe(0.85);
    expect(out + err).not.toMatch(/SECRET/);
    expect(existsSync(path.join(root, 'vantt/.work/quality-private'))).toBe(false);
  });

  it('--private fails when the pack regresses the private vault, still without content', async () => {
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.5');
    const priv = path.join(dir, 'p.json');
    writeFileSync(priv, JSON.stringify([{ id: 'p1', query: 'SECRET-QUERY', category: 'c' }]));
    const { code, out, err } = await run(['--private', priv, '--vault', path.join(root, 'fixtures/obsidian-help/dataset'), '--with-lang', 'de', '--json']);
    expect(code).toBe(1);
    expect(out + err).not.toMatch(/SECRET/);
  });

  it('--private reports a missing vault without echoing paths', async () => {
    const priv = path.join(dir, 'g.json');
    writeFileSync(priv, '[]');
    const { code, report } = await run(['--private', priv, '--json']);
    expect(code).toBe(2);
    expect(report.error).toMatch(/vault/);
  });
});
