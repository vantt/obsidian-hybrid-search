import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSeries, SeriesError } from '../lib/series.mjs';

describe('parseSeries', () => {
  it('parses the shipped series and lists the planned order', () => {
    const text = readFileSync(
      fileURLToPath(new URL('../../patches/series.toml', import.meta.url)),
      'utf8',
    );
    const ids = parseSeries(text).patches.map((p) => p.id);
    // PRD 9.4 order; patches not shipped yet are absent but never reordered.
    const planned = [
      'fork-identity',
      'language-pack-api',
      'db-path',
      'vector-export',
      'stdio-parity',
      'unicode-inline-tags',
      'block-anchors',
      'restrict-paths',
      'index-events',
    ];
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(ids).toEqual(planned.filter((id) => ids.includes(id)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reads strings, multi-line arrays, booleans and comments', () => {
    const { patches } = parseSeries(`
# header
[[patches]]
id = "db-path"   # trailing comment
name = "feat(storage): allow the index database outside the vault"
patch_file = '0002-db-path.patch'
touches = [
  "src/a.ts", # first
  'src/b.ts',
]
upstream_status = "unsubmitted"
probe_required = false
note = "tab\\tand \\"quote\\" \\u00e9"

[[patches]]
id = "restrict-paths"
name = "feat: restrict"
patch_file = "0006.patch"
touches = []
`);
    expect(patches).toHaveLength(2);
    expect(patches[0]).toMatchObject({
      id: 'db-path',
      patch_file: '0002-db-path.patch',
      touches: ['src/a.ts', 'src/b.ts'],
      probe_required: false,
      note: 'tab\tand "quote" é',
    });
    expect(patches[1].touches).toEqual([]);
  });

  it.each([
    ['[[patches]]\nid = "a"\nname = "x"\npatch_file = "p"\nfoo = 12\n', /line 5|:5:/],
    ['[[patches]]\nid = "a\nname = "x"\n', /:2: unterminated string/],
    [
      '[[patches]]\nid = "a"\nname = "x"\npatch_file = "p"\ntouches = ["a" "b"]\n',
      /:5: expected ','/,
    ],
    ['[patches]\n', /:1: unsupported table/],
    ['[[patches]]\nid = "a"\nname = "x"\n', /missing required string "patch_file"/],
    ['[[patches]]\nid = "Bad_Id"\nname = "x"\npatch_file = "p"\n', /not kebab-case/],
    [
      '[[patches]]\nid = "a"\nname = "x"\npatch_file = "p"\n[[patches]]\nid = "a"\nname = "y"\npatch_file = "q"\n',
      /:5: duplicate patch id/,
    ],
    ['[[patches]]\nid = "a"\nid = "b"\n', /:3: duplicate key id/],
    [
      '[[patches]]\nid = "a"\nname = "x"\npatch_file = "p"\nupstream_status = "maybe"\n',
      /unknown upstream_status/,
    ],
    ['[[patches]]\nid = "a" junk\n', /:2: unexpected text/],
  ])('rejects bad syntax %#', (text, re) => {
    expect(() => parseSeries(text)).toThrow(SeriesError);
    expect(() => parseSeries(text)).toThrow(re);
  });
});
