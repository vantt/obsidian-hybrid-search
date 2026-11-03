// Cross-release trend chart of the upstream reviews (L24): collects vantt/reviews/*.data.json,
// builds one series per metric over upstream tags, draws small-multiple line charts as a
// standalone SVG (GitHub renders a committed SVG linked from Markdown, not inline <svg>), and
// keeps a marked block in the newest report up to date.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { highestStableTag } from './review-core.mjs';

export const VI_CATEGORIES = [
  'vi-unaccented',
  'vi-dd',
  'vi-semantic',
  'vi-synonym',
  'vi-compound',
  'vi-snippet',
];

/** Panels of the chart: id, title, unit and how to read the value from one side of a review. */
export const PANELS = [
  { id: 'vi_ndcg5', title: 'vi: nDCG@5 (tổng)', set: 'vi', category: 'ALL', metric: 'ndcg_5' },
  { id: 'vi_hit5', title: 'vi: Hit@5 (tổng)', set: 'vi', category: 'ALL', metric: 'hit_5' },
  {
    id: 'help_ndcg5',
    title: 'obsidian-help: nDCG@5',
    set: 'obsidian-help',
    category: 'ALL',
    metric: 'ndcg_5',
  },
  ...VI_CATEGORIES.map((c) => ({
    id: c,
    title: `${c}: nDCG@5`,
    set: 'vi',
    category: c,
    metric: 'ndcg_5',
  })),
  { id: 'index_s', title: 'Thời gian index (giây, vi)', set: 'vi', timing: 'index_s', unit: 's' },
  {
    id: 'per_query_ms',
    title: 'Thời gian mỗi câu (ms, vi)',
    set: 'vi',
    timing: 'per_query_ms',
    unit: 'ms',
  },
];

const SIDE_OF = {
  fork_new: ['new', 'fork'],
  up_new: ['new', 'upstream'],
  fork_prev: ['prev', 'fork'],
};

function readValue(side, panel) {
  if (!side) return null;
  const v = panel.timing
    ? side.timing?.[panel.timing]
    : (panel.category === 'ALL' ? side.summary : side.by_category?.[panel.category])?.[
        panel.metric
      ];
  return typeof v === 'number' ? v : null;
}

/**
 * Series per panel over upstream tags. Each review contributes the new tag (fork and upstream
 * sides) and the previous tag (fork side). A tag measured by several reviews keeps the newest one.
 * Returns {tags: [sorted semver], panels: [{...panel, fork: {tag: value}, upstream: {tag: value}}]}.
 */
export function collectTrends(reviews) {
  const ordered = [...reviews].sort((a, b) =>
    String(a.generated_at).localeCompare(String(b.generated_at)),
  );
  const points = new Map(); // panel id -> kind -> tag -> value
  const tags = new Set();
  for (const r of ordered) {
    const tagOf = { new: r.new?.tag, prev: r.prev?.upstream_tag };
    for (const panel of PANELS) {
      const set = r.quality?.[panel.set];
      if (!set?.sides) continue;
      for (const [side, [which, kind]] of Object.entries(SIDE_OF)) {
        const tag = tagOf[which];
        const value = readValue(set.sides[side], panel);
        if (!tag || value === null) continue;
        tags.add(tag);
        if (!points.has(panel.id)) points.set(panel.id, { fork: {}, upstream: {} });
        points.get(panel.id)[kind][tag] = value;
      }
    }
  }
  const sorted = sortTags([...tags]);
  return {
    tags: sorted,
    panels: PANELS.map((p) => ({ ...p, ...(points.get(p.id) ?? { fork: {}, upstream: {} }) })),
  };
}

export function sortTags(tags) {
  const key = (t) => /^v(\d+)\.(\d+)\.(\d+)/.exec(t)?.slice(1).map(Number) ?? [0, 0, 0];
  return [...tags].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || a.localeCompare(b);
  });
}

/** Read every `<tag>.data.json` in a reviews directory. */
export function readReviews(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.data.json'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')));
}

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const fmt = (v, unit) => (unit ? (v >= 100 ? v.toFixed(0) : v.toFixed(1)) : v.toFixed(3));

/** Y range of a panel: 0..1 for scores, 0..max*1.15 for times. */
export function yRange(panel, values) {
  if (panel.unit) return [0, Math.max(1, ...values) * 1.15];
  return [0, 1];
}

const COLORS = { fork: '#1f6feb', upstream: '#6e7781' };

/** Standalone SVG with one small chart per panel; fork line in blue, upstream in grey. */
export function renderTrendSvg(trends, { columns = 3, cellW = 330, cellH = 190 } = {}) {
  const { tags, panels } = trends;
  const rows = Math.ceil(panels.length / columns);
  const W = columns * cellW + 20;
  const H = rows * cellH + 56;
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif" font-size="11">`,
    `<title>Xu hướng chỉ số qua các bản upstream</title>`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<text x="14" y="22" font-size="14" font-weight="600" fill="#1f2328">Xu hướng chỉ số qua các bản upstream (${esc(tags.join(', ') || 'chưa có dữ liệu')})</text>`,
    `<g transform="translate(${W - 190},12)"><line x1="0" y1="4" x2="22" y2="4" stroke="${COLORS.fork}" stroke-width="2"/><text x="28" y="8" fill="#1f2328">fork (có gói)</text><line x1="100" y1="4" x2="122" y2="4" stroke="${COLORS.upstream}" stroke-width="2"/><text x="128" y="8" fill="#1f2328">upstream</text></g>`,
  );
  panels.forEach((panel, i) => {
    const gx = 10 + (i % columns) * cellW;
    const gy = 40 + Math.floor(i / columns) * cellH;
    const left = 44;
    const right = 16;
    const top = 26;
    const bottom = 34;
    const pw = cellW - left - right - 10;
    const ph = cellH - top - bottom - 6;
    const values = [...Object.values(panel.fork), ...Object.values(panel.upstream)];
    const [lo, hi] = yRange(panel, values);
    const x = (idx) => left + (tags.length <= 1 ? pw / 2 : (idx * pw) / (tags.length - 1));
    const y = (v) => top + ph - ((v - lo) / (hi - lo)) * ph;
    out.push(`<g transform="translate(${gx},${gy})">`);
    out.push(
      `<rect x="0" y="0" width="${cellW - 10}" height="${cellH - 6}" rx="6" fill="#f6f8fa" stroke="#d0d7de"/>`,
    );
    out.push(`<text x="10" y="17" font-weight="600" fill="#1f2328">${esc(panel.title)}</text>`);
    for (const frac of [0, 0.5, 1]) {
      const v = lo + frac * (hi - lo);
      out.push(
        `<line x1="${left}" y1="${y(v).toFixed(1)}" x2="${left + pw}" y2="${y(v).toFixed(1)}" stroke="#d8dee4" stroke-width="1"/>`,
        `<text x="${left - 5}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" fill="#59636e">${fmt(v, panel.unit)}</text>`,
      );
    }
    tags.forEach((t, idx) =>
      out.push(
        `<text x="${x(idx).toFixed(1)}" y="${top + ph + 16}" text-anchor="middle" fill="#59636e">${esc(t)}</text>`,
      ),
    );
    if (!values.length)
      out.push(
        `<text x="${left + pw / 2}" y="${top + ph / 2}" text-anchor="middle" fill="#8c959f">chưa có dữ liệu</text>`,
      );
    for (const kind of ['upstream', 'fork']) {
      const pts = tags
        .map((t, idx) => (panel[kind][t] === undefined ? null : { t, idx, v: panel[kind][t] }))
        .filter(Boolean);
      if (pts.length > 1)
        out.push(
          `<polyline fill="none" stroke="${COLORS[kind]}" stroke-width="2" points="${pts.map((p) => x(p.idx).toFixed(1) + ',' + y(p.v).toFixed(1)).join(' ')}"/>`,
        );
      for (const p of pts) {
        const above = kind === 'fork';
        out.push(
          `<circle cx="${x(p.idx).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.5" fill="${COLORS[kind]}"><title>${esc(kind)} ${esc(p.t)}: ${fmt(p.v, panel.unit)}</title></circle>`,
          `<text x="${x(p.idx).toFixed(1)}" y="${(y(p.v) + (above ? -8 : 15)).toFixed(1)}" text-anchor="middle" fill="${COLORS[kind]}">${fmt(p.v, panel.unit)}</text>`,
        );
      }
    }
    out.push('</g>');
  });
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}

export const TRENDS_START = '<!-- trends:start -->';
export const TRENDS_END = '<!-- trends:end -->';

/** Text block placed between the markers of a report. */
export function trendsBlock(trends, svgName) {
  const tags = trends.tags.join(', ') || 'chưa có';
  return [
    TRENDS_START,
    '## Xu hướng qua các bản',
    '',
    `![Xu hướng chỉ số qua các bản upstream](${svgName})`,
    '',
    `Điểm đo: ${tags}. Tạo tự động bởi \`review-upstream.mjs\` từ \`vantt/reviews/*.data.json\`; mỗi bản lấy lần review mới nhất. Số đo của các bản khác nhau lấy ở những lần chạy khác nhau (máy, tải khác nhau có thể làm thời gian lệch), nên chỉ đọc xu hướng, không đọc chênh nhỏ.`,
    TRENDS_END,
  ].join('\n');
}

/** Replace the marked block of a report, or add it before the last section when there is none. */
export function injectTrends(markdown, block) {
  const a = markdown.indexOf(TRENDS_START);
  const b = markdown.indexOf(TRENDS_END);
  if (a >= 0 && b > a)
    return `${markdown.slice(0, a)}${block}${markdown.slice(b + TRENDS_END.length)}`;
  const last = markdown.lastIndexOf('\n## ');
  if (last < 0) return `${markdown.trimEnd()}\n\n${block}\n`;
  return `${markdown.slice(0, last)}\n${block}\n${markdown.slice(last)}`;
}

/** Newest report (highest tag) that has a `<tag>.md` in `dir`; null when there is none. */
export function newestReport(dir) {
  const tags = readdirSync(dir)
    .filter((f) => /^v\d+\.\d+\.\d+\.md$/.test(f))
    .map((f) => f.slice(0, -3));
  const tag = highestStableTag(tags);
  return tag ? path.join(dir, `${tag}.md`) : null;
}

/**
 * Regenerate `trends.svg` in `dir` from its data files and refresh the block in the newest
 * report. Returns {svg, report, tags}.
 */
export function writeTrends(dir) {
  const trends = collectTrends(readReviews(dir));
  const svg = path.join(dir, 'trends.svg');
  writeFileSync(svg, renderTrendSvg(trends));
  const report = newestReport(dir);
  if (report)
    writeFileSync(
      report,
      injectTrends(readFileSync(report, 'utf8'), trendsBlock(trends, 'trends.svg')),
    );
  return { svg, report, tags: trends.tags };
}
