import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addPending, findDefinitions, knownEntries, learnAbbreviations } from '../src/abbr.js';
import { runCli } from '../src/cli.js';
import { parseLexicon } from '../src/lexicon.js';

const NOTES: Record<string, string> = {
  'a.md': 'Chăm sóc khách hàng (KH) là việc quan trọng.\nDoanh nghiệp (DN) vừa và nhỏ.\n',
  'b.md': 'TMĐT: thương mại điện tử đang tăng.\nBCTC = báo cáo tài chính quý ba.\n',
  'c.md': 'Sinh ở TP.HCM. Thành phố Hồ Chí Minh (TP.HCM) rất lớn.\n',
  'd.md': 'Gặp khách hàng hôm nay. KH mới. Gặp khách hàng khác. KH cũ. Có khách hàng nữa. Danh sách NV.\n',
  'sub/e.md': 'GĐ họp. Giám đốc điều hành. GĐ nghỉ. Giám đốc kinh doanh. giám đốc về.\n',
  '_ohs/skip.md': 'XX: xe xe\n',
  '.hidden/skip.md': 'YY: yêu yêu\n',
};

function vault(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'ohs-abbr-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe('findDefinitions', () => {
  it('finds phrase (ABBR), ABBR: phrase and ABBR = phrase', () => {
    expect(findDefinitions('Chăm sóc khách hàng (KH) là tốt')).toEqual([{ abbr: 'KH', expansion: 'khách hàng' }]);
    expect(findDefinitions('TMĐT: thương mại điện tử đang')).toEqual([{ abbr: 'TMĐT', expansion: 'thương mại điện tử' }]);
    expect(findDefinitions('BCTC = báo cáo tài chính quý')).toEqual([{ abbr: 'BCTC', expansion: 'báo cáo tài chính' }]);
    expect(findDefinitions('Thành phố Hồ Chí Minh (TP.HCM) lớn')).toEqual([
      { abbr: 'TP.HCM', expansion: 'Thành phố Hồ Chí Minh' },
    ]);
  });

  it('rejects patterns whose initials do not spell the abbreviation', () => {
    expect(findDefinitions('xe máy (KH) lạ')).toEqual([]);
    expect(findDefinitions('NOTE: something here')).toEqual([]);
    expect(findDefinitions('KH: nhân viên')).toEqual([]);
  });
});

describe('learnAbbreviations', () => {
  const none = knownEntries(null);
  const learn = (known = none, options = {}) => learnAbbreviations(Object.values(NOTES), known, options);
  const pairs = (list: ReturnType<typeof learn>) => list.map((p) => `${p.abbr} = ${p.expansion}`);

  it('proposes definitions and frequent phrases', () => {
    const out = pairs(learn());
    expect(out).toEqual(
      expect.arrayContaining([
        'KH = khách hàng',
        'DN = Doanh nghiệp',
        'TMĐT = thương mại điện tử',
        'BCTC = báo cáo tài chính',
        'TP.HCM = Thành phố Hồ Chí Minh',
        'GĐ = giám đốc',
      ]),
    );
    expect(out.filter((l) => l.startsWith('KH ='))).toHaveLength(1);
  });

  it('marks the evidence', () => {
    const list = learn();
    expect(list.find((p) => p.abbr === 'GĐ')?.source).toBe('frequent');
    expect(list.find((p) => p.abbr === 'TMĐT')?.source).toBe('definition');
  });

  it('skips abbreviations already in the main section and pairs already pending', () => {
    const known = knownEntries('## Viết tắt\nKH = khách hàng\n\n## Chờ duyệt\nGĐ = giám đốc\nBCTC = báo cáo tài chính\n');
    const out = pairs(learn(known));
    expect(out.some((l) => l.startsWith('KH ='))).toBe(false);
    expect(out).not.toContain('GĐ = giám đốc');
    expect(out).not.toContain('BCTC = báo cáo tài chính');
    expect(out).toContain('TMĐT = thương mại điện tử');
  });

  it('needs enough frequency for phrases', () => {
    expect(pairs(learn(none, { minPhraseCount: 9 }))).not.toContain('GĐ = giám đốc');
  });

  it('does not guess when two phrases tie', () => {
    const texts = ['CN: x', 'CN công nghệ. công nghệ. công nghệ. chủ nhiệm. chủ nhiệm. chủ nhiệm. CN.'];
    expect(learnAbbreviations(texts, none).filter((p) => p.abbr === 'CN')).toEqual([]);
  });
});

describe('addPending', () => {
  const props = [{ abbr: 'KH', expansion: 'khách hàng', source: 'definition' as const, count: 1 }];

  it('appends under Chờ duyệt and leaves other text byte for byte', () => {
    const before = '# T\n\n## Viết tắt\n\nHĐ = hợp đồng\n\n## Chờ duyệt\n\nGD = giáo dục\n\n## Ghi chú\n\nxin chào\n';
    const after = addPending(before, props);
    expect(after).toBe(
      '# T\n\n## Viết tắt\n\nHĐ = hợp đồng\n\n## Chờ duyệt\n\nGD = giáo dục\nKH = khách hàng\n\n## Ghi chú\n\nxin chào\n',
    );
    expect(parseLexicon(after).abbreviations).toEqual(parseLexicon(before).abbreviations);
  });

  it('creates the section, keeps CRLF, and builds a skeleton for no file', () => {
    expect(addPending('## Viết tắt\r\nHĐ = hợp đồng\r\n', props)).toBe(
      '## Viết tắt\r\nHĐ = hợp đồng\r\n\r\n## Chờ duyệt\r\n\r\nKH = khách hàng\r\n',
    );
    const fresh = addPending(null, props);
    expect(fresh).toContain('## Từ ghép');
    expect(fresh.trimEnd().endsWith('KH = khách hàng')).toBe(true);
    expect(parseLexicon(fresh).abbreviations).toEqual([]);
  });

  it('handles an empty pending section at the end of the file', () => {
    expect(addPending('## Chờ duyệt\n', props)).toBe('## Chờ duyệt\n\nKH = khách hàng\n');
  });
});

describe('learn-abbr command', () => {
  let dir: string;
  const logs: string[] = [];
  const errors: string[] = [];
  const io = { log: (l: string) => logs.push(l), error: (l: string) => errors.push(l) };
  beforeEach(() => {
    logs.length = 0;
    errors.length = 0;
    dir = vault({
      ...NOTES,
      '_ohs/lexicon.md': '## Đồng nghĩa\n\nô tô = xe hơi\n\n## Viết tắt\n\nHĐ = hợp đồng\n\n## Chờ duyệt\n',
    });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('writes proposals under Chờ duyệt without touching the main sections', () => {
    const file = join(dir, '_ohs', 'lexicon.md');
    const before = readFileSync(file, 'utf8');
    expect(runCli(['learn-abbr', '--vault', dir], io)).toBe(0);
    const after = readFileSync(file, 'utf8');
    expect(after.startsWith(before.replace(/\n$/, ''))).toBe(true);
    expect(after).toContain('KH = khách hàng');
    const lex = parseLexicon(after);
    expect(lex.abbreviations).toEqual(parseLexicon(before).abbreviations);
    expect(lex.synonyms).toEqual(parseLexicon(before).synonyms);
    expect(after).not.toContain('XX');
    expect(after).not.toContain('YY');
  });

  it('is idempotent: a second run proposes nothing new', () => {
    runCli(['learn-abbr', '--vault', dir], io);
    const once = readFileSync(join(dir, '_ohs', 'lexicon.md'), 'utf8');
    logs.length = 0;
    expect(runCli(['learn-abbr', '--vault', dir], io)).toBe(0);
    expect(readFileSync(join(dir, '_ohs', 'lexicon.md'), 'utf8')).toBe(once);
    expect(logs.join('\n')).toContain('No new abbreviations');
  });

  it('--dry-run writes nothing, and a missing lexicon is created otherwise', () => {
    rmSync(join(dir, '_ohs'), { recursive: true });
    expect(runCli(['learn-abbr', '--vault', dir, '--dry-run'], io)).toBe(0);
    expect(() => readFileSync(join(dir, '_ohs', 'lexicon.md'))).toThrow();
    expect(runCli(['learn-abbr', '--vault', dir], io)).toBe(0);
    expect(readFileSync(join(dir, '_ohs', 'lexicon.md'), 'utf8')).toContain('## Chờ duyệt');
  });

  it('validates its arguments', () => {
    expect(runCli([], io)).toBe(2);
    expect(runCli(['nope'], io)).toBe(2);
    expect(runCli(['learn-abbr'], io)).toBe(2);
    expect(runCli(['learn-abbr', '--vault'], io)).toBe(2);
    expect(runCli(['learn-abbr', '--vault', dir, '--min-count', '0'], io)).toBe(2);
    expect(runCli(['learn-abbr', '--vault', join(dir, 'missing')], io)).toBe(1);
    expect(runCli(['--help'], io)).toBe(0);
  });
});
