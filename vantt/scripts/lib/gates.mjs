// Gate rules of PRD 11.6 as pure functions over eval results, testable without running an
// eval. A check is {id, status, detail, ...}; status is pass | fail | pending (reported,
// never fails) | warn (informational drift, never fails) | skipped.
const EPS = 1e-9;
const r3 = (x) => Math.round(x * 1000) / 1000;
const check = (id, status, detail, extra = {}) => ({ id, status, detail, ...extra });
const metricOf = (result, category, metric) => result?.by_category?.[category]?.[metric];

/** Per-category and overall drop of `metric` against a reference result. */
export function regressionChecks(
  idPrefix,
  { result, ref, refLabel, metric, categoryMax, overallMax },
) {
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
    check(
      `${idPrefix}-overall`,
      t - o > overallMax + EPS ? 'fail' : 'pass',
      `overall ${metric} ${t} -> ${o} vs ${refLabel}`,
      {
        ref: t,
        now: o,
      },
    ),
  ];
}

/**
 * Stored baselines were measured on another machine, and quantised ONNX gives different
 * scores per CPU, so they are a drift report (status `warn`, never a failure). The pass or
 * fail comes from a measurement of pristine upstream made in the same run on the same
 * machine (`reference`). On macOS ARM upstream's own floors (eval/quality.ts) decide.
 */
const driftCheck = (id, cfg, now, baseline, label) =>
  baseline
    ? check(
        id,
        Math.abs(now - baseline.result.summary[cfg.metric]) > cfg.tolerance + EPS ? 'warn' : 'pass',
        `informational: ${cfg.metric} ${baseline.result.summary[cfg.metric]} (stored ${label} ${baseline.version}, recorded on another machine) vs ${now} measured here`,
        {
          value: now,
          baseline: baseline.result.summary[cfg.metric],
          baseline_version: baseline.version,
        },
      )
    : check(id, 'skipped', `no stored ${label} baseline for this platform`);

/** Upstream eval without a pack (PRD 11.6, first row). `reference` = pristine upstream measured in this run. */
export function upstreamChecks(cfg, { platform, result, reference, baseline, floors }) {
  const m = cfg.metric;
  const now = result.summary[m];
  const checks = [];
  if (platform === 'darwin-arm64' && floors) {
    checks.push(
      check('upstream-no-pack', floors.ok ? 'pass' : 'fail', floors.message, { value: now }),
    );
  } else if (!reference) {
    checks.push(
      check('upstream-no-pack', 'pending', 'pristine upstream was not measured in this run', {
        value: now,
      }),
    );
  } else {
    const then = reference.summary[m];
    checks.push(
      check(
        'upstream-no-pack',
        Math.abs(now - then) > cfg.tolerance + EPS ? 'fail' : 'pass',
        `${m} ${then} (pristine upstream, same run and machine) -> ${now} (fork, no pack), tolerance ${cfg.tolerance}`,
        { value: now, upstream: then },
      ),
    );
  }
  checks.push(driftCheck('upstream-baseline-drift', cfg, now, baseline, cfg.corpus));
  return checks;
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
    if (v !== undefined)
      values.push(`${c} ${t.metric} ${r3(v)}${u === undefined ? '' : ` (upstream ${r3(u)})`}`);
    if (v === undefined) {
      missing = true;
      continue;
    }
    if (t.min !== undefined && v < t.min - EPS) problems.push(`${c} ${t.metric} ${v} < ${t.min}`);
    const needsUpstream =
      t.min_gain_over_upstream !== undefined ||
      t.min_ratio_over_upstream !== undefined ||
      t.max_drop_vs_upstream !== undefined;
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
    return check(
      t.id,
      t.status === 'enforced' ? 'fail' : 'pending',
      `metric or upstream baseline not available${dep}`,
    );
  const ok = problems.length === 0;
  if (t.status !== 'enforced')
    return check(
      t.id,
      'pending',
      `${ok ? 'already met' : 'not met yet'}${ok ? '' : `: ${problems.join('; ')}`}${dep}`,
      {
        would: ok ? 'pass' : 'fail',
      },
    );
  return check(t.id, ok ? 'pass' : 'fail', ok ? `met: ${values.join('; ')}` : problems.join('; '), {
    values,
  });
}

/**
 * Checks of the vi eval with a pack.
 *   upstream     no-pack eval of the same tree measured in this run, {version, result}: reference for
 *                the regression rules and for the "over upstream" targets
 *   stored       stored upstream baseline of the corpus (another machine): drift report only
 *   prevRelease  stored baseline of the previous release with the pack: reported, and enforced only
 *                when cfg.previous_release_enforced (scores differ per CPU)
 */
export function viChecks(cfg, { result, upstream, stored, prevRelease }) {
  const checks = upstream
    ? regressionChecks('vi-regression', {
        result,
        ref: upstream.result,
        refLabel: `upstream ${upstream.version}`,
        metric: cfg.metric,
        categoryMax: cfg.category_regression_max,
        overallMax: cfg.overall_regression_max,
      })
    : [check('vi-regression', 'pending', 'upstream was not measured on the vi corpus in this run')];
  if (prevRelease) {
    for (const c of regressionChecks('vi-previous-release', {
      result,
      ref: prevRelease.result,
      refLabel: `previous release ${prevRelease.version}`,
      metric: cfg.metric,
      categoryMax: cfg.category_regression_max,
      overallMax: cfg.overall_regression_max,
    }))
      checks.push(
        cfg.previous_release_enforced || c.status !== 'fail'
          ? c
          : { ...c, status: 'warn', detail: `informational: ${c.detail}` },
      );
  }
  if (stored && upstream) {
    const sizes = [stored.result.meta?.golden_set_size, upstream.result.meta?.golden_set_size];
    const worst = Math.max(
      Math.abs(stored.result.summary[cfg.metric] - upstream.result.summary[cfg.metric]),
      ...Object.keys(stored.result.by_category ?? {}).map((c) =>
        Math.abs(
          (metricOf(stored.result, c, cfg.metric) ?? 0) -
            (metricOf(upstream.result, c, cfg.metric) ?? 0),
        ),
      ),
    );
    const stale = sizes[0] !== sizes[1];
    checks.push(
      check(
        'vi-baseline-drift',
        stale || worst > cfg.category_regression_max + EPS ? 'warn' : 'pass',
        stale
          ? `informational: stored baseline ${stored.version} has ${sizes[0]} queries, the eval ran ${sizes[1]}: record a new baseline`
          : `informational: largest ${cfg.metric} difference to the stored baseline ${stored.version} (another machine) is ${r3(worst)}`,
      ),
    );
  }
  for (const t of cfg.targets) checks.push(targetCheck(t, { result, upstream: upstream?.result }));
  return checks;
}

/** Aggregate verdict: fail if any check failed; `strict` also fails on pending. */
export function verdict(checks, strict = false) {
  const failed = checks.filter((c) => c.status === 'fail' || (strict && c.status === 'pending'));
  return { status: failed.length ? 'fail' : 'pass', failed: failed.map((c) => c.id) };
}
