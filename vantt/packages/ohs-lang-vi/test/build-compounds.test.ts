import { describe, expect, it } from 'vitest';

// The generator is a plain Node script outside the TypeScript project (its dataset readers are
// dev dependencies of the pack); load it by URL at run time.
const SCRIPT = new URL('build-compounds.mjs', new URL('../scripts/', import.meta.url)).href;
const { htmlToText } = (await import(SCRIPT)) as { htmlToText: (html: string) => string };

describe('htmlToText', () => {
  it('turns block tags into line breaks, other tags into spaces, and decodes entities', () => {
    expect(htmlToText('<head><title>x</title></head><p>Hà <b>Nội</b></p>a&amp;b&#x41;&#66;')).toBe(
      ' \nHà  Nội \na&bAB',
    );
  });

  it('replaces each tag up to its first `>`, like /<[^>]*>/g', () => {
    expect(htmlToText('a<i<b>c')).toBe('a c');
    expect(htmlToText('a<>b')).toBe('a b');
    expect(htmlToText('x > y <i>z')).toBe('x > y  z');
    expect(htmlToText('a <i>b< c')).toBe('a  b< c');
    expect(htmlToText('<<<')).toBe('<<<');
    expect(htmlToText('<i\nx>y')).toBe(' y');
  });

  it('stays linear on many unclosed `<`', () => {
    const t0 = performance.now();
    expect(htmlToText('<'.repeat(200_000))).toHaveLength(200_000);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
