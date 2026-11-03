// Pass/fail rule of the pin-effect check (PRD 8.4, step 6): the pinned build may not search worse than the locked
// one. user chốt 2026-11-02: chỉ chặn khi tụt; vi-synonym chấp nhận tới -0,03.
//
// delta = pinned nDCG@5 - locked nDCG@5, per category.
//  - delta >= -REGRESSION_LIMIT passes, and any improvement passes at any size (reported, never blocking);
//  - a drop worse than -REGRESSION_LIMIT fails, except for the categories in DROP_ALLOWED, which may fall further.
export const REGRESSION_LIMIT = 0.01;
export const DROP_ALLOWED = { 'vi:vi-synonym': 0.03 };
const EPS = 1e-9;

/** @returns {{ok: boolean, status: 'pass'|'improved'|'allowed-drop'|'FAIL', limit: number}} */
export function judgeRegression(corpus, category, delta, limit = REGRESSION_LIMIT) {
  if (!Number.isFinite(delta)) return { ok: false, status: 'FAIL', limit };
  const allowed = DROP_ALLOWED[`${corpus}:${category}`];
  const floor = -(allowed ?? limit);
  if (delta < floor - EPS) return { ok: false, status: 'FAIL', limit: -floor };
  if (delta > limit + EPS) return { ok: true, status: 'improved', limit: -floor };
  if (allowed !== undefined && delta < -limit - EPS)
    return { ok: true, status: 'allowed-drop', limit: -floor };
  return { ok: true, status: 'pass', limit: -floor };
}

export const ruleText = () =>
  `A category passes unless pinned nDCG@5 is more than ${REGRESSION_LIMIT} below locked; improvements always pass. ` +
  `Drops accepted further (user chốt 2026-11-02): ${Object.entries(DROP_ALLOWED)
    .map(([k, v]) => `${k} down to -${v}`)
    .join(', ')}.`;
