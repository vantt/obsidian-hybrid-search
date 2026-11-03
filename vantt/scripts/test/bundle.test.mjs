// Pure helpers of bundle.mjs (PRD 8.2): what pruning may delete, which onnxruntime builds are foreign,
// and the launchers. The full build and smoke run on real runners (vantt-bundles.yml).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { foreignOnnxDirs, isPrunable, wrapperScripts } from '../bundle.mjs';

describe('isPrunable', () => {
  it('drops docs, maps, headers and tests', () => {
    for (const f of [
      'x/README.md',
      'x/CHANGELOG.md',
      'x/lib/a.js.map',
      'x/include/node_api.h',
      'x/test/a.js',
      'x/__tests__/b.js',
    ])
      expect(isPrunable(f), f).toBe(true);
  });
  it('keeps licenses, code and typings', () => {
    for (const f of [
      'x/LICENSE',
      'x/LICENSE.md',
      'x/license.txt',
      'x/NOTICE',
      'x/index.js',
      'x/index.d.ts',
      'x/package.json',
    ])
      expect(isPrunable(f), f).toBe(false);
  });
  it('drops CUDA/TensorRT providers and the onnxruntime-web WASM builds, but keeps the CPU runtime', () => {
    expect(
      isPrunable('onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime_providers_cuda.so'),
    ).toBe(true);
    expect(
      isPrunable('onnxruntime-node/bin/napi-v6/win32/x64/onnxruntime_providers_tensorrt.dll'),
    ).toBe(true);
    expect(isPrunable('onnxruntime-web/' + 'di' + 'st/ort-wasm-simd-threaded.wasm')).toBe(true);
    expect(isPrunable('onnxruntime-node/bin/napi-v6/linux/x64/libonnxruntime.so.1')).toBe(false);
    expect(isPrunable('onnxruntime-node/bin/napi-v6/win32/x64/DirectML.dll')).toBe(false);
  });
});

describe('foreignOnnxDirs', () => {
  const dirs = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  it('keeps only the target os and arch', () => {
    const nm = mkdtempSync(path.join(os.tmpdir(), 'ohs-bundle-'));
    dirs.push(nm);
    const napi = path.join(nm, 'onnxruntime-node', 'bin', 'napi-v6');
    for (const p of [
      'darwin/arm64',
      'darwin/x64',
      'linux/x64',
      'linux/arm64',
      'win32/x64',
      'win32/arm64',
    ]) {
      mkdirSync(path.join(napi, p), { recursive: true });
      writeFileSync(path.join(napi, p, 'a.node'), '');
    }
    const rel = (list) => list.map((d) => path.relative(napi, d).split(path.sep).join('/')).sort();
    expect(rel(foreignOnnxDirs('win32-x64', nm))).toEqual(['darwin', 'linux', 'win32/arm64']);
    expect(rel(foreignOnnxDirs('darwin-arm64', nm))).toEqual(['darwin/x64', 'linux', 'win32']);
  });
});

describe('wrapperScripts', () => {
  it('clears NODE_OPTIONS and runs the bundled node', () => {
    const w = wrapperScripts();
    expect(Object.keys(w).sort()).toEqual(['ohs', 'ohs-mcp', 'ohs-mcp.cmd', 'ohs.cmd']);
    expect(w.ohs).toContain('unset NODE_OPTIONS');
    expect(w.ohs).toContain('node/bin/node');
    expect(w['ohs-mcp']).toContain('server.js');
    expect(w['ohs.cmd']).toContain('set "NODE_OPTIONS="');
    expect(w['ohs.cmd']).toContain('..\\app\\');
    expect(w['ohs.cmd']).toContain('\r\n');
  });
});
