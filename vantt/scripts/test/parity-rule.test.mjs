// Rule of the pin-effect check (PRD 8.4, step 6): block only on regressions; vi-synonym may drop to -0.03.
import { describe, expect, it } from 'vitest';
import { judgeRegression } from '../lib/parity-rule.mjs';

const judge = (cat, delta, corpus = 'vi') => judgeRegression(corpus, cat, delta);

describe('judgeRegression', () => {
  it('passes small movements in both directions', () => {
    expect(judge('vi-names', 0).status).toBe('pass');
    expect(judge('vi-names', -0.01).ok).toBe(true);
    expect(judge('vi-names', 0.008).status).toBe('pass');
  });

  it('passes improvements of any size and flags the large ones as informational', () => {
    expect(judge('vi-snippet', 0.024)).toMatchObject({ ok: true, status: 'improved' });
    expect(judge('multilingual', 0.063, 'obsidian-help')).toMatchObject({ ok: true, status: 'improved' });
    expect(judge('vi-names', 0.5).ok).toBe(true);
  });

  it('fails a drop worse than -0.01', () => {
    expect(judge('vi-names', -0.0101)).toMatchObject({ ok: false, status: 'FAIL' });
    expect(judge('conceptual', -0.02, 'obsidian-help').ok).toBe(false);
    expect(judge('ALL', -0.011).ok).toBe(false);
  });

  it('lets vi-synonym fall down to -0.03 only', () => {
    expect(judge('vi-synonym', -0.021)).toMatchObject({ ok: true, status: 'allowed-drop' });
    expect(judge('vi-synonym', -0.03).ok).toBe(true);
    expect(judge('vi-synonym', -0.0301).ok).toBe(false);
    // the exception is for that category of that corpus, nothing else
    expect(judge('vi-synonym', -0.02, 'obsidian-help').ok).toBe(false);
    expect(judge('vi-semantic', -0.02).ok).toBe(false);
  });

  it('fails a category that is missing on the pinned side', () => {
    expect(judge('vi-names', NaN).ok).toBe(false);
  });
});
