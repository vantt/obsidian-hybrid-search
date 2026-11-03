import { describe, expect, it } from 'vitest';
import { firstKeyIndent } from '../lib/release.mjs';

describe('firstKeyIndent', () => {
  it('returns the indent of the first line that starts with whitespace and a quote', () => {
    expect(firstKeyIndent('{\n  "name": "x"\n}\n')).toBe('  ');
    expect(firstKeyIndent('{\n\t"name": "x"\n}\n')).toBe('\t');
    expect(firstKeyIndent('{\n    "a": {\n      "b": 1\n    }\n}\n')).toBe('    ');
    expect(firstKeyIndent('{"name": "x"}')).toBeUndefined();
    expect(firstKeyIndent('')).toBeUndefined();
  });

  it('matches /^(\\s+)"/m, whose run may start on an earlier blank line', () => {
    expect(firstKeyIndent('{\n\n  "a": 1}')).toBe('\n  ');
    expect(firstKeyIndent('  \n "a"')).toBe('  \n ');
    expect(firstKeyIndent('{ \n "a"')).toBe(' ');
    expect(firstKeyIndent('x  "a"\n "b"')).toBe(' ');
  });

  it('stays linear on a long run of blank lines', () => {
    const t0 = performance.now();
    expect(firstKeyIndent(`{${'\n'.repeat(100_000)}x`)).toBeUndefined();
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
