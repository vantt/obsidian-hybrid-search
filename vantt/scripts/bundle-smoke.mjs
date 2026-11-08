#!/usr/bin/env node
// Smoke test of a built bundle on the platform it was built for (PRD 8.4). Zero dependencies.
//
//   node vantt/scripts/bundle-smoke.mjs --archive <ohs-...zip|.tar.gz> [--work <dir>] [--vault <smoke vault>]
//        [--golden <smoke-golden-set.json>] [--min-hit5 0.75] [--out <smoke.json>]
//
// 1. verifies the archive against its .sha256 and every file against MANIFEST.json
// 2. extracts into "<work>/Thư mục thử/" (space and Vietnamese letters in the path)
// 3. copies the smoke vault into "<work>/Kho thử" and runs `ohs --version`, `ohs status`,
//    `ohs reindex` and `ohs search --json` through the launchers
// 4. serves the golden queries through `ohs serve --stdio` (UTF-8 safe on every shell) and checks Hit@5
// 5. MCP handshake over stdio with `ohs-mcp`: initialize + tools/list must list `search`
// 6. imports the bundled Vietnamese pack with the bundled Node
// Exit code 0 only when every check passed. A JSON report with timings and sizes goes to --out.
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { dirSize, sha256File, walk } from './bundle.mjs';
import { batchCommand } from './lib/proc.mjs';

const isWin = process.platform === 'win32';
const TAR = isWin
  ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar';
const log = (m) => process.stderr.write(`[smoke] ${m}\n`);
const nfc = (s) => s.normalize('NFC');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: !!ok, detail: String(detail).slice(0, 400) });
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ': ' + String(detail).slice(0, 200) : ''}`);
  return !!ok;
}

function launcher(root, name) {
  return path.join(root, 'bin', isWin ? `${name}.cmd` : name);
}

/** Spawn a launcher; .cmd files run through cmd.exe with every argument quoted. */
function start(root, name, args, env) {
  const file = launcher(root, name);
  const spec = isWin ? batchCommand(file, args, env) : { command: file, args };
  return spawn(spec.command, spec.args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    windowsVerbatimArguments: isWin,
  });
}

function runOnce(root, name, args, env, timeoutMs = 600_000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = start(root, name, args, env);
    let out = '',
      err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.stdin.end();
    const timer = setTimeout(() => killTree(p), timeoutMs);
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, ms: Date.now() - t0 });
    });
  });
}

function killTree(p) {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- taskkill is a Windows system tool
  if (isWin) spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else p.kill('SIGKILL');
}

/** Newline-delimited JSON conversation: send requests one by one, wait for the reply with the same id. */
async function converse(
  root,
  name,
  args,
  env,
  steps,
  { timeoutMs = 120_000, readyLine = false } = {},
) {
  const p = start(root, name, args, env);
  let buf = '';
  let err = '';
  const waiters = [];
  const lines = [];
  p.stderr.on('data', (d) => (err += d));
  p.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        lines.push(JSON.parse(line));
      } catch {
        continue;
      }
      for (const w of waiters.splice(0)) w();
    }
  });
  const exited = new Promise((r) => p.on('close', () => r('exit')));
  const wait = (pred) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for reply; stderr: ${err.slice(-400)}`)),
        timeoutMs,
      );
      const probe = () => {
        const hit = lines.find(pred);
        if (hit) {
          clearTimeout(timer);
          resolve(hit);
        } else waiters.push(probe);
      };
      probe();
      exited.then(() => {
        clearTimeout(timer);
        const hit = lines.find(pred);
        if (hit) resolve(hit);
        else reject(new Error(`process exited early; stderr: ${err.slice(-400)}`));
      });
    });
  const replies = [];
  try {
    if (readyLine) await wait((m) => m.ready === true);
    for (const step of steps) {
      if (step.notify) {
        p.stdin.write(JSON.stringify(step.notify) + '\n');
        continue;
      }
      p.stdin.write(JSON.stringify(step.send) + '\n');
      replies.push(await wait((m) => m.id === step.send.id));
    }
  } finally {
    p.stdin.end();
    const done = await Promise.race([
      exited,
      new Promise((r) => setTimeout(() => r('slow'), 5000)),
    ]);
    if (done === 'slow') killTree(p);
  }
  return replies;
}

async function main() {
  const { values } = parseArgs({
    options: {
      archive: { type: 'string' },
      work: { type: 'string' },
      vault: { type: 'string' },
      golden: { type: 'string' },
      'min-hit5': { type: 'string', default: '0.75' },
      out: { type: 'string' },
    },
  });
  if (!values.archive) throw new Error('--archive is required');
  const archive = path.resolve(values.archive);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const smokeDir = path.join(repo, 'vantt', 'eval', 'vi');
  const vaultSrc = path.resolve(values.vault ?? path.join(smokeDir, 'smoke-vault'));
  const golden = JSON.parse(
    readFileSync(
      path.resolve(values.golden ?? path.join(smokeDir, 'smoke-golden-set.json')),
      'utf8',
    ),
  );
  const work = path.resolve(values.work ?? path.join(repo, 'vantt', '.work', 'smoke'));
  const report = {
    archive: path.basename(archive),
    platform: `${process.platform}-${process.arch}`,
    node_host: process.versions.node,
  };

  // 1. checksum of the archive
  const sidecar = `${archive}.sha256`;
  const digest = await sha256File(archive);
  if (existsSync(sidecar))
    check(
      'archive sha256 matches the .sha256 file',
      readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0] === digest,
    );
  else check('archive has a .sha256 file', false);

  // 2. extract into a path with a space and Vietnamese letters
  const base = path.join(work, 'Thư mục thử');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const t0 = Date.now();
  // bsdtar on Windows reads argv in the ANSI code page and cannot chdir to "Thư mục thử"; the working directory is passed wide.
  const ex = spawnSync(TAR, ['-xf', archive], { cwd: base, stdio: 'inherit' });
  check('extract archive', ex.status === 0);
  report.extract_ms = Date.now() - t0;
  const roots = readdirSync(base).filter((d) => d.startsWith('ohs-'));
  if (
    !check(
      'archive holds one ohs-<version>-<platform> directory',
      roots.length === 1,
      roots.join(','),
    )
  )
    return finish(report);
  const root = path.join(base, roots[0]);
  report.size_unpacked = dirSize(root);

  // every file against MANIFEST.json
  const manifest = JSON.parse(readFileSync(path.join(root, 'MANIFEST.json'), 'utf8'));
  report.version = manifest.version;
  const onDisk = new Set(walk(root).filter((f) => f !== 'MANIFEST.json'));
  const bad = [];
  for (const [f, h] of Object.entries(manifest.files)) {
    if (f === 'MANIFEST.json') continue;
    if (!existsSync(path.join(root, f)) || (await sha256File(path.join(root, f))) !== h)
      bad.push(f);
    onDisk.delete(f);
  }
  check(
    'MANIFEST.json hashes match every file',
    bad.length === 0 && onDisk.size === 0,
    `bad=${bad.slice(0, 3)} extra=${[...onDisk].slice(0, 3)}`,
  );
  check(
    'manifest platform matches this machine',
    manifest.platform === report.platform,
    manifest.platform,
  );

  // vault copy next to the bundle, also with a Vietnamese name
  const vault = path.join(work, 'Kho thử');
  // File by file: the destination has a non-ASCII name and a whole-tree cpSync left no directory on the Windows runner.
  mkdirSync(vault, { recursive: true });
  for (const f of walk(vaultSrc)) {
    mkdirSync(path.dirname(path.join(vault, f)), { recursive: true });
    copyFileSync(path.join(vaultSrc, f), path.join(vault, f));
  }
  const env = { ...process.env, OBSIDIAN_VAULT_PATH: vault, NODE_OPTIONS: '' };
  delete env.NODE_OPTIONS;

  // The embedder loads this optional dependency lazily and hides the cause when it fails.
  const nodeBin = path.join(root, 'node', isWin ? 'node.exe' : path.join('bin', 'node'));
  const hf = spawnSync(
    nodeBin,
    [
      '--input-type=module',
      '-e',
      "await import('@huggingface/transformers'); process.stdout.write('ok')",
    ],
    { cwd: path.join(root, 'app'), encoding: 'utf8', env },
  );
  check(
    'bundled @huggingface/transformers imports',
    hf.status === 0,
    hf.status === 0 ? '' : `${hf.stderr}`.split('\n').slice(0, 6).join(' | '),
  );

  // The vault path must reach the bundled Node intact (Vietnamese letters, spaces), with and without a shell in between.
  const probe =
    "const p = process.env.OBSIDIAN_VAULT_PATH; process.stdout.write(JSON.stringify({ p, dir: require('node:fs').statSync(p).isDirectory() }));";
  const direct = spawnSync(nodeBin, ['-e', probe], { encoding: 'utf8', env });
  check(
    'vault directory exists for the smoke process',
    existsSync(vault),
    `${vault} entries=${existsSync(vault) ? readdirSync(vault).length : '-'}`,
  );
  check(
    'vault path is a directory for the bundled Node',
    direct.status === 0 && direct.stdout.includes('"dir":true'),
    `${direct.stdout} ${String(direct.stderr)
      .split('\n')
      .filter((l) => /Error|ENOENT|errno|path/i.test(l))
      .join(
        ' | ',
      )} codepoints=${[...path.basename(vault)].map((c) => c.codePointAt(0).toString(16))}`,
  );

  // 3. CLI through launchers
  const ver = await runOnce(root, 'ohs', ['--version'], env, 60_000);
  check(
    'ohs --version prints the bundle version',
    ver.code === 0 && ver.out.includes(manifest.version),
    ver.out.trim() || ver.err,
  );
  const st0 = await runOnce(root, 'ohs', ['status'], env, 120_000);
  check(
    'ohs status runs on an empty index',
    st0.code === 0 && /"total":\s*0/.test(st0.out),
    st0.code !== 0 ? st0.err : st0.out.slice(0, 100),
  );
  const re = await runOnce(root, 'ohs', ['reindex'], env, 1_200_000);
  report.index_ms = re.ms;
  check('ohs reindex indexes the smoke vault', re.code === 0, re.code !== 0 ? re.err : '');
  const st1 = await runOnce(root, 'ohs', ['status'], env, 120_000);
  let status = {};
  try {
    status = JSON.parse(st1.out);
  } catch {
    // Unparsable output: the check below reports the missing fields.
  }
  report.db_size_mb = status.db_size_mb;
  report.chunks = status.chunks;
  check(
    'ohs status reports indexed notes',
    st1.code === 0 && status.indexed > 0 && status.failed_chunks === 0,
    `indexed=${status.indexed} chunks=${status.chunks} failed=${status.failed_chunks}`,
  );
  const se = await runOnce(root, 'ohs', ['search', 'giu chan khach', '--json'], env, 180_000);
  let hits = [];
  try {
    hits = JSON.parse(se.out);
  } catch {
    // Unparsable output: the check below reports no results.
  }
  check(
    'ohs search --json returns results',
    se.code === 0 && Array.isArray(hits) && hits.length > 0,
    se.code !== 0 ? se.err : `${hits.length} results`,
  );

  // 4. golden queries over stdio IPC
  const queries = golden.map((g, i) => ({
    send: { id: `q${i}`, query: g.query, options: { limit: 5 } },
  }));
  const replies = await converse(
    root,
    'ohs',
    ['serve', '--stdio'],
    env,
    [{ send: { id: 'st', action: 'status' } }, ...queries],
    { readyLine: true, timeoutMs: 300_000 },
  );
  check(
    'ohs serve --stdio answers status',
    !!replies[0]?.status && !replies[0].error,
    replies[0]?.error,
  );
  let hit5 = 0;
  const misses = [];
  golden.forEach((g, i) => {
    const r = replies[i + 1];
    const top = (r?.results ?? []).slice(0, 5).map((x) => nfc(x.path));
    const rel = [...g.relevant_paths, ...(g.partial_paths ?? [])].map(nfc);
    if (top.some((p) => rel.includes(p))) hit5++;
    else misses.push(g.id);
  });
  report.hit5 = Number((hit5 / golden.length).toFixed(3));
  report.hit5_misses = misses;
  check(
    `golden Hit@5 >= ${values['min-hit5']} (no language pack: upstream baseline 0.938)`,
    hit5 / golden.length >= Number(values['min-hit5']),
    `${hit5}/${golden.length}, misses ${misses}`,
  );

  // 5. MCP over stdio
  const mcp = await converse(
    root,
    'ohs-mcp',
    [],
    env,
    [
      {
        send: {
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'bundle-smoke', version: '1' },
          },
        },
      },
      { notify: { jsonrpc: '2.0', method: 'notifications/initialized' } },
      { send: { jsonrpc: '2.0', id: 2, method: 'tools/list' } },
    ],
    { timeoutMs: 120_000 },
  );
  const tools = (mcp[1]?.result?.tools ?? []).map((t) => t.name);
  check(
    'ohs-mcp initialize answers',
    !!mcp[0]?.result?.serverInfo,
    JSON.stringify(mcp[0]?.error ?? mcp[0]?.result?.serverInfo),
  );
  check('ohs-mcp tools/list has search', tools.includes('search'), tools.join(','));

  // 6. bundled language pack loads under the bundled Node
  if (manifest.lang_packs?.vi) {
    const entry = pathToFileURL(path.join(root, 'lang', 'ohs-lang-vi', 'build', 'index.js')).href;
    const code = `const m = await import(${JSON.stringify(entry)}); process.stdout.write(typeof m.fold === 'function' ? String(m.fold('Giữ chân khách')) : 'no-fold');`;
    const r = spawnSync(nodeBin, ['--input-type=module', '-e', code], {
      encoding: 'utf8',
      env: { ...env },
    });
    check(
      'bundled ohs-lang-vi loads and folds under the bundled Node',
      r.status === 0 && /giu chan khach/i.test(r.stdout),
      r.status !== 0 ? r.stderr : r.stdout,
    );
  }
  return finish(report);
}

function finish(report) {
  report.checks = checks;
  report.ok = checks.every((c) => c.ok);
  if (parsedOut) writeFileSync(parsedOut, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(report.ok ? 0 : 1);
}

const parsedOut = (() => {
  const i = process.argv.indexOf('--out');
  return i > 0 ? path.resolve(process.argv[i + 1]) : null;
})();

main().catch((e) => {
  check('smoke run completed', false, e.stack ?? e.message);
  finish({ error: e.message });
});
