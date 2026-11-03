// Quality gate (PRD 11.6): rule functions on synthetic results, baseline files, and the CLI
// (standard and --private) on a throw-away repo whose eval is a stub.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { baseVersion, compareVersions, pickBaseline, writeBaseline } from '../lib/baselines.mjs';
import {
  ChildRunError,
  lexiconIgnorePattern,
  nfdGolden,
  outputTail,
  platformKey,
  privateEvalEnv,
  ReportableError,
  terminalDetail,
} from '../lib/eval-run.mjs';
import {
  regressionChecks,
  upstreamChecks,
  upstreamPackCheck,
  verdict,
  viChecks,
} from '../lib/gates.mjs';
import { detailPathError, main, parseLangOptions, privateErrorText } from '../quality-gate.mjs';
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

describe('nfdGolden', () => {
  it('turns relevant and partial paths into NFD and keeps everything else', () => {
    const nfc = 'Đường về nhà.md'.normalize('NFC');
    const [q] = nfdGolden([
      { id: 'a', query: nfc, relevant_paths: [nfc], partial_paths: [nfc, 'x.md'], category: 'c' },
    ]);
    expect(q.relevant_paths).toEqual([nfc.normalize('NFD')]);
    expect(q.partial_paths).toEqual([nfc.normalize('NFD'), 'x.md']);
    expect(q.query).toBe(nfc);
    expect(nfdGolden([{ id: 'b' }])).toEqual([{ id: 'b' }]);
  });
});

describe('privateEvalEnv', () => {
  it("keeps the user's note selection and always ignores the lexicon folder", () => {
    const user = privateEvalEnv(
      {},
      {
        OBSIDIAN_IGNORE_PATTERNS: '.obsidian/**, templates/**,*.canvas',
        OBSIDIAN_INCLUDE_PATTERNS: 'notes/**',
        OHS_LANGUAGE_PACK: 'x',
      },
    );
    expect(user).toMatchObject({
      OBSIDIAN_IGNORE_PATTERNS: '.obsidian/**,templates/**,*.canvas,_ohs/**',
      OBSIDIAN_INCLUDE_PATTERNS: 'notes/**',
      OBSIDIAN_RESPECT_GITIGNORE: 'false',
    });
    expect(
      privateEvalEnv({}, { OBSIDIAN_IGNORE_PATTERNS: '_ohs/**' }).OBSIDIAN_IGNORE_PATTERNS,
    ).toBe('_ohs/**');
    const fallback = privateEvalEnv({ OHS_LANGUAGE_PACK: '/p' }, {});
    expect(fallback).toMatchObject({
      OBSIDIAN_IGNORE_PATTERNS: '.obsidian/**,templates/**,*.canvas,_ohs/**',
      OBSIDIAN_INCLUDE_PATTERNS: '',
      OHS_LANGUAGE_PACK: '/p',
    });
    expect(fallback.LOCAL_EMBEDDING_MODEL).toBe('Xenova/multilingual-e5-small');
  });

  it("also ignores a pack's lexiconPath inside the vault, the same for both runs", () => {
    const ignore = (...a) => privateEvalEnv({}, ...a).OBSIDIAN_IGNORE_PATTERNS;
    const base = '.obsidian/**,templates/**,*.canvas,_ohs/**';
    expect(ignore({}, { lexiconPath: 'meta/từ điển.md' })).toBe(`${base},meta/từ điển.md`);
    // The user's own pack options count when the gate configures none.
    const user = { OHS_LANGUAGE_PACK_OPTIONS: JSON.stringify({ lexiconPath: './Lex/vi.md' }) };
    expect(ignore(user)).toBe(`${base},Lex/vi.md`);
    expect(ignore(user, { lexiconPath: 'other.md' })).toBe(`${base},other.md`);
    expect(ignore(user, null)).toBe(ignore(user, {}));
    expect(() => ignore({ OHS_LANGUAGE_PACK_OPTIONS: '{SECRET' })).toThrow(ReportableError);
  });

  it('lexiconIgnorePattern ignores the file itself, never more', () => {
    expect(lexiconIgnorePattern(undefined)).toBeNull();
    expect(lexiconIgnorePattern('_ohs/lexicon.md')).toBeNull();
    expect(lexiconIgnorePattern('/abs/lexicon.md')).toBeNull();
    expect(lexiconIgnorePattern('C:\\v\\lexicon.md')).toBeNull();
    expect(lexiconIgnorePattern('../outside.md')).toBeNull();
    expect(lexiconIgnorePattern('notes\\lex.md')).toBe('notes/lex.md');
    expect(lexiconIgnorePattern('a/./b/../lex.md')).toBe('a/lex.md');
    expect(lexiconIgnorePattern('lexicon/')).toBe('lexicon');
    expect(lexiconIgnorePattern('notes//lex.md//')).toBe('notes/lex.md');
    for (const bad of ['a,b.md', 'lex*.md', '!lex.md', '', 3])
      expect(() => lexiconIgnorePattern(bad), String(bad)).toThrow(ReportableError);
  });

  it('terminalDetail shows detail only when asked, else one line on how to see it', () => {
    expect(terminalDetail('x', '', { show: true })).toBeNull();
    expect(terminalDetail('x', 'SECRET', { show: true })).toMatch(/SECRET/);
    const hidden = terminalDetail('x', 'SECRET', { show: false });
    expect(hidden).not.toMatch(/SECRET/);
    expect(hidden).toMatch(/--show-child-stderr/);
    expect(hidden.split('\n')).toHaveLength(1);
  });

  it('privateErrorText keeps fixed messages and reports anything else by category', () => {
    expect(privateErrorText(new ChildRunError('eval failed in private run (exit 1)', {}))).toBe(
      'eval failed in private run (exit 1)',
    );
    expect(privateErrorText(new ReportableError('private vault not found'))).toBe(
      'private vault not found',
    );
    let syntax;
    try {
      JSON.parse('{"q": SECRET-QUERY');
    } catch (e) {
      syntax = e;
    }
    expect(privateErrorText(syntax)).toBe('invalid JSON (private golden set or eval output)');
    expect(privateErrorText(Object.assign(new Error('open /SECRET'), { code: 'ENOENT' }))).toBe(
      'file system error (ENOENT)',
    );
    expect(privateErrorText(new TypeError('SECRET of undefined'))).toBe(
      'unexpected error in the private gate',
    );
  });

  it('outputTail keeps the last non-empty lines', () => {
    expect(outputTail('a\r\n\nb\nc\n', 2)).toBe('b\nc');
  });
});

describe('parseLangOptions', () => {
  it('returns a JSON object as given', () => {
    expect(parseLangOptions('{"foldIY":true,"lexiconPath":"lex/words.txt"}')).toEqual({
      foldIY: true,
      lexiconPath: 'lex/words.txt',
    });
    expect(parseLangOptions('{}')).toEqual({});
  });

  it('rejects invalid JSON and non-objects with fixed text that never quotes the input', () => {
    const error = (raw) => {
      try {
        parseLangOptions(raw);
      } catch (e) {
        return e;
      }
      throw new Error('parseLangOptions accepted the input');
    };
    const bad = error('{"lexiconPath": SECRET');
    expect(bad).toBeInstanceOf(ReportableError);
    expect(bad.message).toBe('--lang-options is not valid JSON');
    for (const raw of ['null', '[1]', '"SECRET"', '42', 'true']) {
      const e = error(raw);
      expect(e).toBeInstanceOf(ReportableError);
      expect(e.message).toBe('--lang-options must be a JSON object');
    }
  });
});

describe('upstreamChecks', () => {
  const cfg = CONFIG.upstream;
  const reference = res({ ndcg_5: 0.8 });
  const baseline = { version: '1.0.0', exact: true, result: res({ ndcg_5: 0.8 }) };
  const run = (v, extra = {}) =>
    upstreamChecks(cfg, {
      platform: 'linux-x64',
      result: res({ ndcg_5: v }),
      reference,
      baseline,
      ...extra,
    });
  it('compares with upstream measured in the same run, tolerance both directions', () => {
    const status = (v) => byId(run(v))['upstream-no-pack'].status;
    expect(status(0.804)).toBe('pass');
    expect(status(0.796)).toBe('pass');
    expect(status(0.7939)).toBe('fail');
    expect(status(0.8061)).toBe('fail');
  });
  it('a stored baseline from another CPU only warns, never fails', () => {
    // The CI runner scored 0.728 where the dev machine recorded 0.735: same tree, different CPU.
    const c = byId(
      upstreamChecks(cfg, {
        platform: 'linux-x64',
        result: res({ ndcg_5: 0.728 }),
        reference: res({ ndcg_5: 0.728 }),
        baseline: { version: '0.17.2', result: res({ ndcg_5: 0.735 }) },
      }),
    );
    expect(c['upstream-no-pack'].status).toBe('pass');
    expect(c['upstream-baseline-drift'].status).toBe('warn');
    expect(verdict(Object.values(c)).status).toBe('pass');
  });
  it('is pending without a same-run reference, and skips drift without a baseline', () => {
    const c = byId(run(0.8, { reference: null, baseline: null }));
    expect(c['upstream-no-pack'].status).toBe('pending');
    expect(c['upstream-baseline-drift'].status).toBe('skipped');
  });
  it('uses the quality.ts floors on darwin-arm64', () => {
    const c = byId(
      run(0.8, { platform: 'darwin-arm64', floors: { ok: false, message: 'below floor' } }),
    )['upstream-no-pack'];
    expect(c).toMatchObject({ status: 'fail', detail: 'below floor' });
  });
});

describe('upstreamPackCheck', () => {
  const cfg = CONFIG.upstream;
  it('allows a drop up to 0.01 nDCG@5 with the pack', () => {
    expect(
      upstreamPackCheck(cfg, { noPack: res({ ndcg_5: 0.8 }), withPack: res({ ndcg_5: 0.79 }) })
        .status,
    ).toBe('pass');
    expect(
      upstreamPackCheck(cfg, { noPack: res({ ndcg_5: 0.8 }), withPack: res({ ndcg_5: 0.789 }) })
        .status,
    ).toBe('fail');
    expect(
      upstreamPackCheck(cfg, { noPack: res({ ndcg_5: 0.8 }), withPack: res({ ndcg_5: 0.9 }) })
        .status,
    ).toBe('pass');
  });
});

describe('regressionChecks', () => {
  const ref = res({ ndcg_5: 0.8 }, { a: { ndcg_5: 0.8 }, b: { ndcg_5: 0.5 } });
  const run = (result) =>
    byId(
      regressionChecks('r', {
        result,
        ref,
        refLabel: 'ref',
        metric: 'ndcg_5',
        categoryMax: 0.02,
        overallMax: 0,
      }),
    );
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

const PENDING = {
  ...CONFIG.vi,
  targets: CONFIG.vi.targets.map((t) => ({ ...t, status: 'pending' })),
};

describe('viChecks', () => {
  const upstream = {
    version: '1.0.0',
    result: res(
      { ndcg_5: 0.7 },
      {
        'vi-telex': { ndcg_5: 0.4, hit_5: 0.5 },
        'vi-compound': { ndcg_5: 0.85 },
        'vi-accented': { ndcg_5: 1 },
      },
    ),
  };
  const cats = (o) => ({
    'vi-telex': { hit_5: 0.5, ndcg_5: 0.4 },
    'vi-compound': { ndcg_5: 0.85 },
    'vi-accented': { ndcg_5: 1 },
    ...o,
  });

  it('pending targets are reported, never failed, even when not met', () => {
    const checks = viChecks(PENDING, {
      result: res({ ndcg_5: 0.7 }, cats()),
      upstream,
      prevRelease: null,
    });
    const c = byId(checks);
    expect(c['G8-telex']).toMatchObject({ status: 'pending', would: 'fail' });
    expect(c['vi-regression-categories'].status).toBe('pass');
    expect(verdict(checks).status).toBe('pass');
    expect(verdict(checks, true).status).toBe('fail');
  });

  it('reports a pending target that is already met', () => {
    const c = byId(
      viChecks(PENDING, {
        result: res({ ndcg_5: 0.7 }, cats({ 'vi-telex': { hit_5: 0.9, ndcg_5: 0.4 } })),
        upstream,
      }),
    );
    expect(c['G8-telex']).toMatchObject({ status: 'pending', would: 'pass' });
  });

  it('enforced targets fail the gate: min, gain over upstream, ratio, snippet', () => {
    const cfg = {
      ...CONFIG.vi,
      targets: [
        { id: 't-min', category: 'vi-telex', metric: 'hit_5', min: 0.8, status: 'enforced' },
        {
          id: 't-gain',
          category: 'vi-compound',
          metric: 'ndcg_5',
          min_gain_over_upstream: 0.1,
          status: 'enforced',
        },
        {
          id: 't-ratio',
          category: 'vi-telex',
          metric: 'hit_5',
          min_ratio_over_upstream: 2,
          status: 'enforced',
        },
        {
          id: 't-snippet',
          category: 'vi-snippet',
          metric: 'snippet_ok',
          min: 1,
          status: 'enforced',
        },
      ],
    };
    const c = byId(
      viChecks(cfg, {
        result: res({ ndcg_5: 0.7 }, cats({ 'vi-compound': { ndcg_5: 0.9 } })),
        upstream,
      }),
    );
    expect(c['t-min'].status).toBe('fail');
    expect(c['t-gain'].status).toBe('fail');
    expect(c['t-ratio'].status).toBe('fail');
    expect(c['t-snippet'].status).toBe('fail'); // metric not reported: an enforced target cannot pass blind
    const ok = byId(
      viChecks(cfg, {
        result: res(
          { ndcg_5: 0.7 },
          cats({
            'vi-compound': { ndcg_5: 0.96 },
            'vi-telex': { hit_5: 1, ndcg_5: 0.4 },
            'vi-snippet': { snippet_ok: 1 },
          }),
        ),
        upstream,
      }),
    );
    expect(ok['t-min'].status).toBe('pass');
    expect(ok['t-gain'].status).toBe('pass');
    expect(ok['t-ratio'].status).toBe('pass');
    expect(ok['t-snippet'].status).toBe('pass');
  });

  it('the previous release baseline is informational unless enforced', () => {
    const prev = {
      version: '1.0.0-vantt.1',
      result: res({ ndcg_5: 0.9 }, cats({ 'vi-accented': { ndcg_5: 1 } })),
    };
    const input = { result: res({ ndcg_5: 0.8 }, cats()), upstream, prevRelease: prev };
    const soft = byId(viChecks(PENDING, input));
    expect(soft['vi-previous-release-overall']).toMatchObject({ status: 'warn' });
    expect(soft['vi-previous-release-overall'].detail).toMatch(/previous release 1.0.0-vantt.1/);
    expect(verdict(Object.values(soft)).status).toBe('pass');
    const hard = byId(viChecks({ ...PENDING, previous_release_enforced: true }, input));
    expect(hard['vi-previous-release-overall'].status).toBe('fail');
  });

  it('a stored upstream baseline from another machine is a drift note, also when it is stale', () => {
    const stored = { version: '0.9.0', result: res({ ndcg_5: 0.6 }, cats(), 99) };
    const c = byId(viChecks(PENDING, { result: res({}, cats()), upstream, stored }));
    expect(c['vi-baseline-drift']).toMatchObject({ status: 'warn' });
    expect(c['vi-baseline-drift'].detail).toMatch(/99 queries/);
    expect(c['vi-regression-categories'].status).toBe('pass');
  });

  it('is pending without a same-run upstream measurement', () => {
    expect(
      byId(viChecks(CONFIG.vi, { result: res({}, cats()), upstream: null }))['vi-regression']
        .status,
    ).toBe('pending');
  });

  it('the shipped thresholds file lists the PRD targets, all enforced', () => {
    const ids = CONFIG.vi.targets.map((t) => t.id);
    for (const id of [
      'G3-unaccented',
      'G3-dd',
      'G3-tone-precision',
      'G8-telex',
      'G8-typo',
      'G8-synonym',
      'G8-abbr',
      'G8-alias',
      'G8-compound',
      'G8-snippet',
    ])
      expect(ids).toContain(id);
    expect(CONFIG.vi.targets.filter((t) => t.status !== 'enforced')).toEqual([]);
    expect(CONFIG.upstream).toMatchObject({ tolerance: 0.005, pack_regression_max: 0.01 });
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
    for (const [version, set, lang] of [
      ['0.17.2', 'vi-search', null],
      ['0.18.0', 'vi-search', null],
      ['0.17.2-vantt.1', 'vi-search', 'vi'],
      ['0.17.2-vantt.2', 'vi-search', 'vi'],
    ])
      writeBaseline(dir, { version, set, lang, result: { v: version } });
    expect(pickBaseline(dir, { set: 'vi-search', version: '0.17.5' })).toMatchObject({
      version: '0.17.2',
      exact: false,
    });
    expect(pickBaseline(dir, { set: 'vi-search', version: '0.18.0' })).toMatchObject({
      version: '0.18.0',
      exact: true,
    });
    expect(
      pickBaseline(dir, { set: 'vi-search', lang: 'vi', version: '0.17.2-vantt.3' }).version,
    ).toBe('0.17.2-vantt.2');
    expect(pickBaseline(dir, { set: 'vi-search', lang: 'vi', version: '0.17.1' })).toBeNull();
    expect(pickBaseline(dir, { set: 'obsidian-help', version: '9.9.9' })).toBeNull();
    expect(
      pickBaseline(path.join(dir, 'missing'), { set: 'vi-search', version: '1.0.0' }),
    ).toBeNull();
  });

  it('refuses to overwrite a baseline unless forced', () => {
    writeBaseline(dir, { version: '1.0.0', set: 'smoke', result: { a: 1 } });
    expect(() => writeBaseline(dir, { version: '1.0.0', set: 'smoke', result: { a: 2 } })).toThrow(
      /reviewed PR/,
    );
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
if (pack && fs.existsSync(path.join(pack, 'fail-eval.txt'))) {
  console.log('SECRET-QUERY on stdout');
  console.error('Error: eval-diagnostic from the child');
  process.exit(1);
}
// With eval/log-env.txt, every run records the pack switches it got (one JSON line).
if (fs.existsSync('eval/log-env.txt'))
  fs.appendFileSync('eval/env.jsonl', JSON.stringify({ run: 'eval', pack: Boolean(pack), options: process.env.OHS_LANGUAGE_PACK_OPTIONS ?? null, ignore: process.env.OBSIDIAN_IGNORE_PATTERNS }) + '\\n');
const worse = fs.existsSync('eval/behavior.txt');
const golden = JSON.parse(fs.readFileSync(get('--golden-set'), 'utf8'));
// Like upstream, paths compare as NFD strings: an NFC path in the golden set never matches.
const nfc = golden.some((q) => [...(q.relevant_paths ?? []), ...(q.partial_paths ?? [])].some((p) => p !== p.normalize('NFD')));
const score = nfc ? 0 : pack ? Number(fs.readFileSync(path.join(pack, 'score.txt'), 'utf8')) : worse ? 0.7 : 0.8;
console.log('SECRET-QUERY SECRET-PATH ' + get('--vault'));
console.error('SECRET-STDERR');
const per_query = golden.map((q) => ({ id: q.id, query: 'SECRET-QUERY', category: q.category, ndcg_5: score, top_paths: ['SECRET-PATH.md'] }));
fs.writeFileSync(get('--output'), JSON.stringify({ meta: { golden_set_size: golden.length }, summary: { ndcg_5: score, hit_5: score }, by_category: { c: { ndcg_5: score, hit_5: score } }, per_query }));
`;

// Stubs of the core modules that lib/detail-search.mjs imports: one result per query with explain data.
const INDEX_SERVICE = `export async function openIndexDatabase() {}
export function createIndexService() { return { reindex: async () => ({}), close() {} }; }
`;
const SEARCHER = `import fs from 'node:fs';
import path from 'node:path';
export async function search(query) {
  const pack = process.env.OHS_LANGUAGE_PACK;
  if (pack && fs.existsSync(path.join(pack, 'fail-detail.txt'))) throw new Error('detail-diagnostic from the child');
  if (fs.existsSync('eval/log-env.txt'))
    fs.appendFileSync('eval/env.jsonl', JSON.stringify({ run: 'detail', pack: Boolean(pack), options: process.env.OHS_LANGUAGE_PACK_OPTIONS ?? null, ignore: process.env.OBSIDIAN_IGNORE_PATTERNS }) + '\\n');
  return [{ path: 'SECRET-PATH.md', score: 0.5, scores: { bm25: 1 }, matchedBy: ['bm25'], explain: { ranks: { bm25: 1 }, debug: process.env.OHS_LANGUAGE_PACK ? { restore: 'SECRET-RESTORED ' + query } : undefined } }];
}
`;

let STUB_SHA;
describe('quality-gate CLI on a stub eval', () => {
  let dir;
  let root;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ohs-qg-'));
    root = path.join(dir, 'fork');
    mkdirSync(root);
    git(root, 'init', '-q', '-b', 'master');
    write(root, 'package.json', '{"name":"x","version":"1.0.0-vantt.1"}\n');
    write(
      root,
      'package-lock.json',
      '{"name":"x","version":"1.0.0-vantt.1","packages":{"":{"version":"1.0.0-vantt.1"}}}\n',
    );
    write(root, 'eval/evaluate.ts', EVALUATE);
    write(root, 'src/indexing/index-service.ts', INDEX_SERVICE);
    write(root, 'src/search/searcher.ts', SEARCHER);
    write(
      root,
      'fixtures/obsidian-help/golden-set.json',
      JSON.stringify([
        { id: 'q1', category: 'c' },
        { id: 'q2', category: 'c' },
      ]),
    );
    write(root, 'fixtures/obsidian-help/dataset/a.md', '# a\n');
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.79');
    write(root, '.gitignore', 'node_modules\nvantt/.work\nfixtures/*/dataset\n');
    symlinkSync(REAL_MODULES, path.join(root, 'node_modules'), 'dir');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'init');
    STUB_SHA = git(root, 'rev-parse', 'HEAD');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  async function run(argv, { tty = false, config } = {}) {
    const out = [];
    const err = [];
    const o = process.stdout.write.bind(process.stdout);
    const e = process.stderr.write.bind(process.stderr);
    process.stdout.write = (c) => (out.push(String(c)), true);
    process.stderr.write = (c) => (err.push(String(c)), true);
    let code;
    try {
      code = await main(argv, { cwd: root, stderrIsTTY: tty, config });
    } finally {
      process.stdout.write = o;
      process.stderr.write = e;
    }
    return {
      code,
      out: out.join(''),
      err: err.join(''),
      report: out.length ? JSON.parse(out.join('')) : null,
    };
  }
  const std = () => [
    '--target-ref',
    'v1.0.0',
    '--target-sha',
    STUB_SHA,
    '--branch',
    'vantt/v1.0.0',
    '--json',
  ];
  const baselineDir = () => path.join(root, 'vantt/eval/baselines', platformKey());

  it('no pack: measures pristine upstream itself and compares with it; no stored baseline needed', async () => {
    const { code, report } = await run(std());
    expect(code).toBe(0);
    expect(byId(report.checks)['upstream-no-pack'].detail).toMatch(/same run and machine/);
    expect(report.pending).toEqual([]);
  });

  it('no pack: reuses the invariance measurement of this commit instead of measuring again', async () => {
    const head = git(root, 'rev-parse', 'HEAD');
    write(
      root,
      'vantt/.work/invariance-last.json',
      JSON.stringify({
        target: { sha: STUB_SHA },
        fork_head: head,
        k: 10,
        corpora: { 'obsidian-help': { summary_upstream: { ndcg_5: 0.8 } } },
      }),
    );
    const { code, err } = await run(std());
    expect(code).toBe(0);
    expect(err).toMatch(/reusing the invariance run/);
  });

  it('no pack: fails when the fork scores differently from pristine upstream on this machine', async () => {
    write(root, 'eval/behavior.txt', 'worse');
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', 'fork changes search');
    const { code, report } = await run(std());
    expect(code).toBe(1);
    expect(report.failed).toEqual(['upstream-no-pack']);
  });

  it('no pack: a stored baseline recorded on another machine only warns', async () => {
    writeBaseline(baselineDir(), {
      version: '1.0.0',
      set: 'obsidian-help',
      result: { summary: { ndcg_5: 0.9 } },
    });
    const { code, report } = await run(std());
    expect(code).toBe(0);
    expect(report.warnings).toEqual(['upstream-baseline-drift']);
  });

  it('with a pack: passes within 0.01 and pends the language without a golden set', async () => {
    const { code, report } = await run([...std(), '--with-lang', 'de']);
    expect(code).toBe(0);
    expect(byId(report.checks)['upstream-with-pack'].status).toBe('pass');
    expect(report.pending).toContain('de-eval');
  });

  it('with a pack: fails when it loses more than 0.01 on the upstream eval', async () => {
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.7');
    const { code, report } = await run([...std(), '--with-lang', 'de']);
    expect(code).toBe(1);
    expect(report.failed).toEqual(['upstream-with-pack']);
  });

  it('a missing pack is pending, not a failure', async () => {
    const { code, report } = await run([...std(), '--with-lang', 'zz']);
    expect(code).toBe(0);
    expect(report.pending).toContain('pack-zz');
  });

  it('--strict fails on pending; --write-baseline records and never replaces', async () => {
    expect((await run([...std(), '--strict', '--with-lang', 'zz'])).code).toBe(1);
    const first = await run([...std(), '--write-baseline']);
    expect(first.report.baselines_written).toHaveLength(1);
    expect(existsSync(path.join(baselineDir(), '1.0.0.obsidian-help.json'))).toBe(true);
    const second = await run([...std(), '--write-baseline']);
    expect(second.code).toBe(2);
    expect(second.report.error).toMatch(/reviewed PR/);
  });

  it('--private prints aggregate numbers only and leaves nothing behind', async () => {
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.85');
    const priv = path.join(dir, 'private');
    mkdirSync(path.join(priv, 'vault'), { recursive: true });
    writeFileSync(path.join(priv, 'vault', 'note.md'), '# SECRET-NOTE\n');
    writeFileSync(
      path.join(priv, 'golden-set.json'),
      JSON.stringify([
        { id: 'p1', query: 'SECRET-QUERY', category: 'c' },
        { id: 'p2', category: 'c' },
      ]),
    );
    const { code, out, err, report } = await run([
      '--private',
      priv,
      '--with-lang',
      'de',
      '--json',
    ]);
    expect(code).toBe(0);
    expect(report).toMatchObject({ private: true, gate: 'pass', pack: 'de' });
    expect(report.without_pack.categories.c).toMatchObject({ n: 2, ndcg_5: 0.8 });
    // eslint-disable-next-line sonarjs/no-floating-point-equality -- the value is copied unchanged from the eval result
    expect(report.with_pack.summary.ndcg_5).toBe(0.85);
    expect(out + err).not.toMatch(/SECRET/);
    expect(existsSync(path.join(root, 'vantt/.work/quality-private'))).toBe(false);
  });

  it('--private compares NFC golden paths the way upstream stores them (NFD)', async () => {
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.85');
    const priv = path.join(dir, 'nfc.json');
    const nfc = 'Hoà giải.md'.normalize('NFC');
    writeFileSync(
      priv,
      JSON.stringify([
        { id: 'p1', query: 'q', relevant_paths: [nfc], partial_paths: [nfc], category: 'c' },
      ]),
    );
    const { code, report } = await run([
      '--private',
      priv,
      '--vault',
      path.join(root, 'fixtures/obsidian-help/dataset'),
      '--with-lang',
      'de',
      '--json',
    ]);
    expect(code).toBe(0);
    // eslint-disable-next-line sonarjs/no-floating-point-equality -- the value is copied unchanged from the eval result
    expect(report.without_pack.summary.ndcg_5).toBe(0.8);
    // eslint-disable-next-line sonarjs/no-floating-point-equality -- the value is copied unchanged from the eval result
    expect(report.with_pack.summary.ndcg_5).toBe(0.85);
    expect(JSON.parse(readFileSync(priv, 'utf8'))[0].relevant_paths[0]).toBe(nfc);
  });

  it('--private fails when the pack regresses the private vault, still without content', async () => {
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.5');
    const priv = path.join(dir, 'p.json');
    writeFileSync(priv, JSON.stringify([{ id: 'p1', query: 'SECRET-QUERY', category: 'c' }]));
    const { code, out, err } = await run([
      '--private',
      priv,
      '--vault',
      path.join(root, 'fixtures/obsidian-help/dataset'),
      '--with-lang',
      'de',
      '--json',
    ]);
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
  describe("a failed private eval's own stderr", () => {
    const failing = (extra, opts) => {
      write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.85');
      write(root, 'vantt/packages/ohs-lang-de/fail-eval.txt', '1');
      const priv = path.join(dir, 'p.json');
      writeFileSync(priv, JSON.stringify([{ id: 'p1', query: 'SECRET-QUERY', category: 'c' }]));
      return run(
        [
          '--private',
          priv,
          '--vault',
          path.join(root, 'fixtures/obsidian-help/dataset'),
          '--with-lang',
          'de',
          '--json',
          ...extra,
        ],
        opts,
      );
    };
    it('is shown with --show-child-stderr, never its stdout or in the report', async () => {
      const { code, err, report } = await failing(['--show-child-stderr']);
      expect(code).toBe(2);
      expect(report.error).toBe('eval failed in private run (exit 1)');
      expect(err).toMatch(/eval-diagnostic from the child/);
      expect(err).not.toMatch(/SECRET-QUERY/);
      expect(JSON.stringify(report)).not.toMatch(/diagnostic|SECRET/);
    });
    it('is shown on an interactive terminal', async () => {
      const { err } = await failing([], { tty: true });
      expect(err).toMatch(/eval-diagnostic from the child/);
    });
    it('is hidden from a non-interactive stderr, which says how to see it', async () => {
      const { code, err, report } = await failing([]);
      expect(code).toBe(2);
      expect(report.error).toBe('eval failed in private run (exit 1)');
      expect(err).not.toMatch(/diagnostic|SECRET/);
      expect(err).toMatch(/hidden.*--show-child-stderr/);
    });
  });

  it('--private reports a malformed golden set by category, never quoting it', async () => {
    write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.85');
    const priv = path.join(dir, 'p.json');
    writeFileSync(priv, '[{"id": "p1", "query": SECRET-QUERY');
    const { code, out, err, report } = await run([
      '--private',
      priv,
      '--vault',
      path.join(root, 'fixtures/obsidian-help/dataset'),
      '--with-lang',
      'de',
      '--json',
    ]);
    expect(code).toBe(2);
    expect(report.error).toBe('invalid JSON (private golden set or eval output)');
    expect(out + err).not.toMatch(/SECRET/);
    expect(err).toMatch(/error detail is hidden/);
  });

  describe('--private-detail', () => {
    const setup = () => {
      write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.85');
      const priv = path.join(dir, 'private');
      mkdirSync(path.join(priv, 'vault'), { recursive: true });
      writeFileSync(path.join(priv, 'vault', 'note.md'), '# SECRET-NOTE\n');
      const rel = 'Hoà giải.md'.normalize('NFC');
      writeFileSync(
        path.join(priv, 'golden-set.json'),
        JSON.stringify([{ id: 'p1', query: 'SECRET-QUERY', relevant_paths: [rel], category: 'c' }]),
      );
      return priv;
    };

    it('writes per-query detail to a file outside the repository and prints no content', async () => {
      const priv = setup();
      const file = path.join(dir, 'out', 'detail.json');
      const { code, out, err } = await run([
        '--private',
        priv,
        '--with-lang',
        'de',
        '--private-detail',
        file,
        '--json',
      ]);
      expect(code).toBe(0);
      expect(out + err).not.toMatch(/SECRET/);
      const detail = JSON.parse(readFileSync(file, 'utf8'));
      expect(detail).toMatchObject({ pack: 'de', k: 10 });
      const [q] = detail.queries;
      expect(q).toMatchObject({
        id: 'p1',
        category: 'c',
        query: 'SECRET-QUERY',
        relevant_paths: ['Hoà giải.md'.normalize('NFC')],
      });
      expect(q.without_pack.top_paths).toEqual(['SECRET-PATH.md']);
      expect(q.with_pack.relevant_ranks).toEqual({ [q.relevant_paths[0]]: null });
      expect(q.without_pack.results[0]).toMatchObject({
        path: 'SECRET-PATH.md',
        ranks: { bm25: 1 },
      });
      expect(q.without_pack.analysis).toBeNull();
      expect(q.with_pack.analysis).toEqual({ restore: 'SECRET-RESTORED SECRET-QUERY' });
      expect(existsSync(path.join(root, 'vantt/.work/quality-private'))).toBe(false);
    });

    it('refuses a path inside the repository or vantt/, and writes nothing', async () => {
      const priv = setup();
      for (const rel of ['detail.json', 'vantt/reviews/detail.json', 'vantt/.work/d/detail.json']) {
        const file = path.join(root, rel);
        const { code, out, err } = await run([
          '--private',
          priv,
          '--with-lang',
          'de',
          '--private-detail',
          file,
          '--json',
        ]);
        expect(code).toBe(2);
        expect(out).toBe('');
        expect(err).toMatch(/outside the repository/);
        expect(err).not.toMatch(/SECRET/);
        expect(existsSync(file)).toBe(false);
      }
    });

    it('refuses a path that reaches the repository through a symlink', async () => {
      const priv = setup();
      symlinkSync(root, path.join(dir, 'link'), 'dir');
      const { code } = await run([
        '--private',
        priv,
        '--with-lang',
        'de',
        '--private-detail',
        path.join(dir, 'link', 'x', 'detail.json'),
        '--json',
      ]);
      expect(code).toBe(2);
      expect(existsSync(path.join(root, 'x'))).toBe(false);
    });

    it("shows a failed detail run's own stderr on the terminal and writes no detail file", async () => {
      const priv = setup();
      write(root, 'vantt/packages/ohs-lang-de/fail-detail.txt', '1');
      const file = path.join(dir, 'out', 'detail.json');
      const { code, err, report } = await run([
        '--private',
        priv,
        '--with-lang',
        'de',
        '--private-detail',
        file,
        '--k',
        '30',
        '--json',
        '--show-child-stderr',
      ]);
      expect(code).toBe(2);
      expect(report.error).toBe('detail run failed (exit 1)');
      expect(err).toMatch(/detail-diagnostic from the child/);
      expect(JSON.stringify(report)).not.toMatch(/diagnostic/);
      expect(existsSync(file)).toBe(false);
      expect(existsSync(path.join(root, 'vantt/.work/quality-private'))).toBe(false);
    });

    it('is only valid with --private', async () => {
      const { code, err } = await run([...std(), '--private-detail', path.join(dir, 'd.json')]);
      expect(code).toBe(2);
      expect(err).toMatch(/only valid with --private/);
    });

    it('detailPathError accepts a fresh directory outside any work tree', () => {
      expect(detailPathError(path.join(dir, 'a', 'b', 'detail.json'), root)).toBeNull();
    });
  });

  describe('--lang-options', () => {
    const LEX = 'lex/words.txt';
    const setup = () => {
      write(root, 'vantt/packages/ohs-lang-de/score.txt', '0.85');
      write(root, 'eval/log-env.txt', '1');
      const priv = path.join(dir, 'private');
      mkdirSync(path.join(priv, 'vault'), { recursive: true });
      writeFileSync(path.join(priv, 'vault', 'note.md'), '# note\n');
      writeFileSync(
        path.join(priv, 'golden-set.json'),
        JSON.stringify([{ id: 'p1', query: 'q', category: 'c' }]),
      );
      return priv;
    };
    const runs = () =>
      readFileSync(path.join(root, 'eval/env.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
    const configWith = (options) => ({ ...CONFIG, pack_options: { de: options } });

    it('replaces the configured options for both runs and records them in the report', async () => {
      const priv = setup();
      const given = { foldIY: true, lexiconPath: LEX };
      const { code, report } = await run(
        ['--private', priv, '--with-lang', 'de', '--lang-options', JSON.stringify(given), '--json'],
        { config: configWith({ foldIY: false, lexiconPath: 'old/lexicon.txt' }) },
      );
      expect(code).toBe(0);
      expect(report.pack_options).toEqual(given);
      const [without, withPack] = runs();
      expect(without).toMatchObject({ run: 'eval', pack: false, options: null });
      expect(withPack).toMatchObject({ run: 'eval', pack: true });
      expect(JSON.parse(withPack.options)).toEqual(given);
      // Both runs index the same notes: the given lexicon is ignored, the configured one is not.
      expect(withPack.ignore).toBe(without.ignore);
      expect(without.ignore.split(',')).toContain(LEX);
      expect(without.ignore).not.toMatch(/old\/lexicon/);
    });

    it('reaches the detail runs too, and the detail file records the options', async () => {
      const priv = setup();
      const file = path.join(dir, 'out', 'detail.json');
      const given = { lexiconPath: LEX };
      const { code } = await run([
        '--private',
        priv,
        '--with-lang',
        'de',
        '--lang-options',
        JSON.stringify(given),
        '--private-detail',
        file,
        '--json',
      ]);
      expect(code).toBe(0);
      const detail = runs().filter((r) => r.run === 'detail');
      expect(detail.map((r) => r.pack)).toEqual([false, true]);
      expect(detail[0].options).toBeNull();
      expect(JSON.parse(detail[1].options)).toEqual(given);
      expect(detail[0].ignore).toBe(detail[1].ignore);
      expect(JSON.parse(readFileSync(file, 'utf8')).pack_options).toEqual(given);
    });

    it('without the flag, the report records the configured options (or null)', async () => {
      const priv = setup();
      const configured = { foldIY: false };
      const withConfig = await run(['--private', priv, '--with-lang', 'de', '--json'], {
        config: configWith(configured),
      });
      expect(withConfig.report.pack_options).toEqual(configured);
      expect(JSON.parse(runs()[1].options)).toEqual(configured);
      const none = await run(['--private', priv, '--with-lang', 'de', '--json']);
      expect(none.report.pack_options).toBeNull();
    });

    it('reports invalid JSON or a non-object by fixed text and runs nothing', async () => {
      const priv = setup();
      for (const [raw, message] of [
        ['{"lexiconPath": SECRET', '--lang-options is not valid JSON'],
        ['["SECRET"]', '--lang-options must be a JSON object'],
      ]) {
        const { code, out, err, report } = await run([
          '--private',
          priv,
          '--with-lang',
          'de',
          '--lang-options',
          raw,
          '--json',
        ]);
        expect(code).toBe(2);
        expect(report).toMatchObject({ gate: 'error', error: message, pack_options: null });
        expect(out + err).not.toMatch(/SECRET/);
      }
      expect(existsSync(path.join(root, 'eval/env.jsonl'))).toBe(false);
    });

    it('is only valid with --private', async () => {
      const { code, out, err } = await run([...std(), '--lang-options', '{}']);
      expect(code).toBe(2);
      expect(out).toBe('');
      expect(err).toMatch(/--lang-options is only valid with --private/);
    });
  });
});
