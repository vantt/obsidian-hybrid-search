import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { extractTiming } from '../lib/review-core.mjs';
import {
  TRENDS_END,
  TRENDS_START,
  collectTrends,
  injectTrends,
  newestReport,
  renderTrendSvg,
  sortTags,
  trendsBlock,
  writeTrends,
  yRange,
} from '../lib/review-trends.mjs';

const side = (nd, timing = null, cats = {}) => ({
  summary: { ndcg_5: nd, hit_5: nd + 0.1 },
  by_category: Object.fromEntries(Object.entries(cats).map(([c, v]) => [c, { ndcg_5: v, hit_5: v }])),
  timing,
});

const review = (newTag, prevTag, at, { fork, up, prev }) => ({
  generated_at: at,
  new: { tag: newTag },
  prev: { upstream_tag: prevTag },
  quality: {
    vi: { sides: { fork_new: fork, up_new: up, fork_prev: prev } },
    'obsidian-help': { sides: { fork_new: side(0.7), up_new: side(0.7), fork_prev: side(0.7) } },
  },
});

describe('extractTiming', () => {
  const ev = (t, line) => ({ t, line });
  it('splits index time and per-query time from output markers', () => {
    const events = [
      ev(0, '[eval] loaded 3 queries'),
      ev(1000, 'Reindexing vault...'),
      ev(11000, '[eval] indexed: 10 new, 0 skipped, 0 errors'),
      ev(11100, '[eval] running q1: "a"... ndcg@5=1'),
      ev(12000, '[eval] running q2: "b"... ndcg@5=1'),
      ev(13000, '[eval] running q3: "c"... ndcg@5=1'),
      ev(14000, '─────────────────────────────────────────'),
      ev(14010, 'nDCG@5: 1'),
    ];
    expect(extractTiming(events)).toEqual({ index_s: 10, query_s: 3, queries: 3, per_query_ms: 1000 });
  });
  it('gives null when markers are missing', () => {
    expect(extractTiming([ev(0, 'nothing')])).toBeNull();
    expect(extractTiming([])).toBeNull();
  });
});

describe('collectTrends', () => {
  const r1 = review('v0.17.2', 'v0.17.1', '2026-11-02T10:00:00Z', {
    fork: side(0.8, { index_s: 20, per_query_ms: 50 }, { 'vi-dd': 0.9 }),
    up: side(0.6, { index_s: 18, per_query_ms: 40 }, { 'vi-dd': 0.2 }),
    prev: side(0.78, { index_s: 21, per_query_ms: 55 }, { 'vi-dd': 0.88 }),
  });
  const trends = collectTrends([r1]);
  const panel = (id) => trends.panels.find((p) => p.id === id);
  it('puts new and previous tags on the axis with fork and upstream series', () => {
    expect(trends.tags).toEqual(['v0.17.1', 'v0.17.2']);
    expect(panel('vi_ndcg5').fork).toEqual({ 'v0.17.2': 0.8, 'v0.17.1': 0.78 });
    expect(panel('vi_ndcg5').upstream).toEqual({ 'v0.17.2': 0.6 });
    expect(panel('vi-dd').fork['v0.17.2']).toBe(0.9);
    expect(panel('index_s').fork['v0.17.1']).toBe(21);
    expect(panel('per_query_ms').upstream['v0.17.2']).toBe(40);
    expect(panel('help_ndcg5').fork['v0.17.2']).toBe(0.7);
  });
  it('keeps the newest review for a tag measured twice and skips missing metrics', () => {
    const r2 = review('v0.17.3', 'v0.17.2', '2026-11-05T10:00:00Z', { fork: side(0.85), up: side(0.6), prev: side(0.81) });
    const t = collectTrends([r2, r1]);
    expect(t.tags).toEqual(['v0.17.1', 'v0.17.2', 'v0.17.3']);
    expect(t.panels.find((p) => p.id === 'vi_ndcg5').fork['v0.17.2']).toBe(0.81); // the newer review (r2) re-measured v0.17.2 as its previous side
    expect(t.panels.find((p) => p.id === 'index_s').fork['v0.17.3']).toBeUndefined();
  });
  it('sorts tags numerically', () => {
    expect(sortTags(['v0.17.10', 'v0.9.1', 'v0.17.2'])).toEqual(['v0.9.1', 'v0.17.2', 'v0.17.10']);
  });
  it('handles no reviews', () => {
    const t = collectTrends([]);
    expect(t.tags).toEqual([]);
    expect(renderTrendSvg(t)).toContain('chưa có dữ liệu');
  });
});

describe('renderTrendSvg', () => {
  const trends = collectTrends([
    review('v0.17.2', 'v0.17.1', '2026-11-02T10:00:00Z', {
      fork: side(0.8, { index_s: 20, per_query_ms: 50 }, { 'vi-dd': 0.9 }),
      up: side(0.6, { index_s: 18, per_query_ms: 40 }),
      prev: side(0.78, { index_s: 21, per_query_ms: 55 }),
    }),
  ]);
  const svg = renderTrendSvg(trends);
  it('is a well-formed standalone svg with a polyline per series and a title per panel', () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect((svg.match(/<polyline/g) ?? []).length).toBeGreaterThanOrEqual(1);
    for (const title of ['vi: nDCG@5 (tổng)', 'vi-snippet: nDCG@5', 'Thời gian index', 'Thời gian mỗi câu'])
      expect(svg).toContain(title);
    expect(svg).toContain('v0.17.1');
    expect(svg).not.toMatch(/NaN|undefined/);
  });
  it('escapes text', () => {
    expect(renderTrendSvg({ tags: ['v<1>'], panels: [] })).toContain('v&lt;1&gt;');
  });
  it('scales scores to 0..1 and times to their maximum', () => {
    expect(yRange({}, [0.3])).toEqual([0, 1]);
    expect(yRange({ unit: 's' }, [40])[1]).toBeCloseTo(46);
  });
});

describe('report block and files', () => {
  const dirs = [];
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  const block = trendsBlock({ tags: ['v0.17.1', 'v0.17.2'] }, 'trends.svg');

  it('replaces the marked block and is idempotent', () => {
    const md = `# R\n## A\ntext\n## Việc cần người quyết\n- x\n`;
    const once = injectTrends(md, block);
    expect(once).toContain('![Xu hướng chỉ số qua các bản upstream](trends.svg)');
    expect(once.indexOf(TRENDS_START)).toBeLessThan(once.indexOf('## Việc cần người quyết'));
    const twice = injectTrends(once, block.replace('v0.17.2', 'v0.17.3'));
    expect(twice.split(TRENDS_START)).toHaveLength(2);
    expect(twice).toContain('v0.17.3');
    expect(twice.split(TRENDS_END)).toHaveLength(2);
    expect(injectTrends(twice, block.replace('v0.17.3', 'v0.17.2'))).toContain('v0.17.2');
  });

  it('writeTrends draws the svg and refreshes only the newest report', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'trends-'));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const data = review('v0.17.2', 'v0.17.1', '2026-11-02T10:00:00Z', { fork: side(0.8), up: side(0.6), prev: side(0.7) });
    writeFileSync(path.join(dir, 'v0.17.2.data.json'), JSON.stringify(data));
    writeFileSync(path.join(dir, 'v0.17.2.md'), '# a\n## Việc cần người quyết\n');
    writeFileSync(path.join(dir, 'v0.17.1.md'), '# old\n');
    expect(newestReport(dir)).toBe(path.join(dir, 'v0.17.2.md'));
    const r = writeTrends(dir);
    expect(r.tags).toEqual(['v0.17.1', 'v0.17.2']);
    expect(readFileSync(path.join(dir, 'trends.svg'), 'utf8')).toContain('<svg');
    expect(readFileSync(path.join(dir, 'v0.17.2.md'), 'utf8')).toContain(TRENDS_START);
    expect(readFileSync(path.join(dir, 'v0.17.1.md'), 'utf8')).not.toContain(TRENDS_START);
  });
});
