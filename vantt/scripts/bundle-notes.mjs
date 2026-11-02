#!/usr/bin/env node
// Release notes for a bundle release: upstream base, patches, language pack, sizes and smoke results (PRD 7.3).
//   node vantt/scripts/bundle-notes.mjs --dir <dir with *.bundle.json and smoke-*.json> --tag <tag>
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { dir: { type: 'string' }, tag: { type: 'string' }, parity: { type: 'string' }, hold: { type: 'string', multiple: true } } });
const dir = path.resolve(values.dir);
const read = (f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const all = (suffix) => readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(suffix)).map(String).sort();
const bundles = all('.bundle.json').map((f) => read(f));
const smokes = Object.fromEntries(all('smoke.json').map((f) => read(f)).map((s) => [s.platform, s]));
const mb = (n) => (n / 1e6).toFixed(1);
const first = bundles[0];
if (!first) throw new Error(`no *.bundle.json under ${dir}`);

const lines = [
  `Prebuilt OHS bundles (Node included, no npm needed) for \`${values.tag}\`, based on upstream \`v${first.upstream_version}\`.`,
  '',
  `- Node ${first.node_version}`,
  `- Language packs: ${Object.entries(first.lang_packs).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`,
  `- Patches (${first.patch_list.length}): ${first.patch_list.map((p) => `${p.id} (${p.upstream_status})`).join(', ') || 'none'}`,
  '',
  '| Platform | Bundle | Packed (MB) | Unpacked (MB) | Before prune (MB) | Index time (s) | DB (MB) | Smoke |',
  '|---|---|---|---|---|---|---|---|',
];
for (const b of bundles) {
  const s = smokes[b.platform];
  lines.push(
    `| ${b.platform} | ${s?.ok && !(values.hold ?? []).includes(b.platform) ? `\`${b.bundle}\`` : 'not published'} | ${mb(b.size_packed)} | ${mb(b.size_unpacked)} | ${mb(b.size_unpacked_before_prune)} | ${s?.index_ms != null ? (s.index_ms / 1000).toFixed(1) : '-'} | ${s?.db_size_mb ?? '-'} | ${s ? (s.ok ? 'pass' : 'FAIL') : '-'} |`,
  );
}
const subs = bundles.filter((b) => b.substitutions && Object.keys(b.substitutions).length);
for (const b of subs)
  lines.push('', `${b.platform}: dependencies replaced at bundling time (${Object.entries(b.substitutions).map(([n, v]) => `${n} ${v.from} -> ${v.to}`).join(', ')}); the release tree is unchanged.`);
if (values.parity) lines.push('', 'Effect of the darwin-x64 dependency pins on search quality (same machine, locked against pinned, nDCG@5, tolerance 0.01):', '', readFileSync(path.resolve(values.parity), 'utf8').trim());
lines.push('', 'Each bundle has a `.sha256` file (`<hex>  <name>`) and a `.bundle.json` with sizes. macOS bundles are not code-signed: remove the quarantine attribute after verifying the checksum (`xattr -dr com.apple.quarantine <dir>`).');
process.stdout.write(lines.join('\n') + '\n');
