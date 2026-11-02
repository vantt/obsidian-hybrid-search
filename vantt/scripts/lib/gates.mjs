// Gate rules of PRD 11.6 as pure functions over eval results, testable without running an
// eval. A check is {id, status, detail, ...}; status is pass | fail | pending (reported,
// never fails) | skipped.
const EPS = 1e-9;
const r3 = (x) => Math.round(x * 1000) / 1000;
const check = (id, status, detail, extra = {}) => ({ id, status, detail, ...extra });
const metricOf = (result, category, metric) => result?.by_category?.[category]?.[metric];

/** Per-category and overall drop of `metric` against a reference result. */
export function regressionChecks(idPrefix, { result, ref, refLabel, metric, categoryMax, overallMax }) {
  const bad = [];
  const rows = {};
  for (const name of Object.keys(ref.by_category ?? {})) {
    const now = metricOf(result, name, metric);
    const then = metricOf(ref, name, metric);
    if (now === undefined) {
      bad.push(`${name} missing from the result`);
      continue;
    }
    rows[name] = { ref: then, now, delta: r3(now - then) };
    if (then - now > categoryMax + EPS) bad.push(`${name} ${then} -> ${now}`);
  }
  const o = result.summary?.[metric];
  const t = ref.summary?.[metric];
  return [
    check(
      `${idPrefix}-categories`,
      bad.length ? 'fail' : 'pass',
      bad.length
        ? `drop over ${categoryMax} ${metric} vs ${refLabel}: ${bad.join('; ')}`
        : `no category drops more than ${categoryMax} ${metric} vs ${refLabel}`,
      { categories: rows },
    ),
    check(`${idPrefix}-overall`, t - o > overallMax + EPS ? 'fail' : 'pass', `overall ${metric} ${t} -> ${o} vs ${refLabel}`, {
      ref: t,
      now: o,
    }),
  ];
}

/** Upstream eval without a pack (PRD 11.6, first row). `floors` = {ok, message} from eval/quality.ts (macOS ARM only). */
export function upstreamChecks(cfg, { platform, result, baseline, floors }) {
  const m = cfg.metric;
  const now = result.summary[m];
  if (platform === 'darwin-arm64' && floors) {
    return [check('upstream-no-pack', floors.ok ? 'pass' : 'fail', floors.message, { value: now })];
  }
  if (!baseline) {
    return [
      check('upstream-no-pack', 'pending', `no ${cfg.corpus} baseline for ${platform}; record one with --write-baseline`, {
        value: now,
      }),
    ];
  }
  const then = baseline.result.summary[m];
  return [
    check(
      'upstream-no-pack',
      Math.abs(now - then) > cfg.linux_tolerance + EPS ? 'fail' : 'pass',
      `${m} ${then} (baseline ${baseline.version}${baseline.exact ? '' : ', nearest older'}) -> ${now}, tolerance ${cfg.linux_tolerance}`,
      { value: now, baseline: then, baseline_version: baseline.version },
    ),
  ];
}

/** Upstream eval with a pack may lose at most `pack_regression_max` (PRD 11.6, second row). */
export function upstreamPackCheck(cfg, { noPack, withPack }) {
  const m = cfg.metric;
  const drop = noPack.summary[m] - withPack.summary[m];
  return check(
    'upstream-with-pack',
    drop > cfg.pack_regression_max + EPS ? 'fail' : 'pass',
    `${m} ${noPack.summary[m]} without pack -> ${withPack.summary[m]} with pack (max drop ${cfg.pack_regression_max})`,
    { without: noPack.summary[m], with: withPack.summary[m] },
  );
}

function targetCheck(t, { result, upstream }) {
  const categories = t.categories ?? [t.category];
  const problems = [];
  const values = [];
  let missing = false;
  for (const c of categories) {
    const v = metricOf(result, c, t.metric);
    const u = metricOf(upstream, c, t.metric);
    if (v !== undefined) values.push(`${c} ${t.metric} ${r3(v)}${u === undefined ? '' : ` (upstream ${r3(u)})`}`);
    if (v === undefined) {
      missing = true;
      continue;
    }
    if (t.min !== undefined && v < t.min - EPS) problems.push(`${c} ${t.metric} ${v} < ${t.min}`);
    const needsUpstream =
      t.min_gain_over_upstream !== undefined || t.min_ratio_over_upstream !== undefined || t.max_drop_vs_upstream !== undefined;
    if (needsUpstream && u === undefined) {
      missing = true;
      continue;
    }
    if (t.min_gain_over_upstream !== undefined && v - u < t.min_gain_over_upstream - EPS)
      problems.push(`${c} ${t.metric} gain ${r3(v - u)} < ${t.min_gain_over_upstream}`);
    if (t.min_ratio_over_upstream !== undefined && v < u * t.min_ratio_over_upstream - EPS)
      problems.push(`${c} ${t.metric} ${v} < ${t.min_ratio_over_upstream} x ${u}`);
    if (t.max_drop_vs_upstream !== undefined && u - v > t.max_drop_vs_upstream + EPS)
      problems.push(`${c} ${t.metric} ${u} -> ${v}`);
  }
  const dep = t.depends_on ? ` [${t.depends_on}]` : '';
  if (missing && !problems.length)
    return check(t.id, t.status === 'enforced' ? 'fail' : 'pending', `metric or upstream baseline not available${dep}`);
  const ok = problems.length === 0;
  if (t.status !== 'enforced')
    return check(t.id, 'pending', `${ok ? 'already met' : 'not met yet'}${ok ? '' : `: ${problems.join('; ')}`}${dep}`, {
      would: ok ? 'pass' : 'fail',
    });
  return check(t.id, ok ? 'pass' : 'fail', ok ? `met: ${values.join('; ')}` : problems.join('; '), { values });
}

/**
 * Checks of the vi eval with a pack. `prevRelease` = baseline of the previous release with
 * that pack, `upstream` = upstream (no pack) baseline of the same corpus; both
 * {version, result} or null. Without a previous release the upstream baseline is the reference.
 */
export function viChecks(cfg, { result, upstream, prevRelease }) {
  if (upstream && upstream.result.meta?.golden_set_size !== result.meta?.golden_set_size) {
    return [
      check(
        'vi-baseline-valid',
        'fail',
        `upstream baseline ${upstream.version} has ${upstream.result.meta?.golden_set_size} queries but the eval ran ${result.meta?.golden_set_size}: record a new baseline (reviewed PR)`,
      ),
    ];
  }
  const ref = prevRelease ?? upstream;
  const checks = ref
    ? regressionChecks('vi-regression', {
        result,
        ref: ref.result,
        refLabel: prevRelease ? `previous release ${prevRelease.version}` : `upstream ${upstream.version}`,
        metric: cfg.metric,
        categoryMax: cfg.category_regression_max,
        overallMax: cfg.overall_regression_max,
      })
    : [check('vi-regression', 'pending', 'no baseline for the vi corpus on this platform; record one with --write-baseline')];
  for (const t of cfg.targets) checks.push(targetCheck(t, { result, upstream: upstream?.result }));
  return checks;
}

/** Aggregate verdict: fail if any check failed; `strict` also fails on pending. */
export function verdict(checks, strict = false) {
  const failed = checks.filter((c) => c.status === 'fail' || (strict && c.status === 'pending'));
  return { status: failed.length ? 'fail' : 'pass', failed: failed.map((c) => c.id) };
}
