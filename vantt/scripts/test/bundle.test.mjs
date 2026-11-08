// Pure helpers of bundle.mjs (PRD 8.2): what pruning may delete, which onnxruntime builds are foreign,
// the launchers, and the license notices. The full build and smoke run on real runners (vantt-bundles.yml).
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  chooseLicenseTexts,
  collectLicenses,
  copyrightHolder,
  foreignOnnxDirs,
  isPrunable,
  loadLicenseTexts,
  repositoryUrl,
  thirdPartyMarkdown,
  wrapperScripts,
} from '../bundle.mjs';

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

describe('license notices', () => {
  const dirs = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const texts = loadLicenseTexts();
  const NM = 'node' + '_modules';
  /** A fake install: {relative package dir: {pkg: package.json fields, files: {name: content}}}. */
  const tree = (spec) => {
    const base = mkdtempSync(path.join(os.tmpdir(), 'ohs-licenses-'));
    dirs.push(base);
    const nm = path.join(base, NM);
    for (const [rel, { pkg, files = {} }] of Object.entries(spec)) {
      const dir = path.join(nm, ...rel.split('/'));
      mkdirSync(dir, { recursive: true });
      if (pkg) writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
      for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dir, f), text);
    }
    return { nm, dest: path.join(base, 'LICENSES', 'deps') };
  };
  const read = (dest, ...p) => readFileSync(path.join(dest, ...p), 'utf8');

  it('copies the license files a package ships, as before, and generates nothing for it', () => {
    const { nm, dest } = tree({
      a: { pkg: { name: 'a', version: '1.0.0', license: 'MIT' }, files: { LICENSE: 'own text' } },
      b: { pkg: { name: 'b', version: '1.0.0', license: 'WTFPL' }, files: { COPYING: 'b text' } },
      [`b/${NM}/c`]: {
        pkg: { name: 'c', version: '2.0.0', license: 'ISC' },
        files: { 'LICENSE.md': 'c text', 'index.js': '' },
      },
    });
    const r = collectLicenses(nm, dest, texts);
    // b's license has no canonical text here, but it ships its own file: nothing to generate, no error.
    expect(r).toMatchObject({ copied: 3, generated: 0 });
    expect(read(dest, 'b', 'COPYING')).toBe('b text');
    expect(read(dest, 'a', 'LICENSE')).toBe('own text');
    expect(read(dest, 'b__c', 'LICENSE.md')).toBe('c text');
    expect(readdirSync(path.join(dest, 'a'))).toEqual(['LICENSE']);
  });

  it('generates the full text and the holder for a package that ships no license file', () => {
    const { nm, dest } = tree({
      'js-tiktoken': {
        pkg: {
          name: 'js-tiktoken',
          version: '1.0.21',
          license: 'MIT',
          repository: { type: 'git', url: 'https://github.com/dqbd/tiktoken' },
        },
      },
      'guid-typescript': {
        pkg: {
          name: 'guid-typescript',
          version: '1.0.9',
          license: 'ISC',
          author: 'nicolas <n@example.com> (https://example.com)',
        },
      },
    });
    const r = collectLicenses(nm, dest, texts);
    expect(r).toMatchObject({ copied: 0, generated: 2 });
    const mit = read(dest, 'js-tiktoken', 'LICENSE-FROM-PACKAGE.txt');
    expect(mit).toContain('Package: js-tiktoken\nVersion: 1.0.21\n');
    expect(mit).toContain('License (declared in package.json): MIT');
    expect(mit).toContain('Repository: https://github.com/dqbd/tiktoken');
    expect(mit).toContain('This package ships no license file.');
    expect(mit).toContain('Copyright (c) the js-tiktoken authors\n');
    expect(mit).toContain('Permission is hereby granted, free of charge');
    expect(mit).not.toContain('<copyright holders>');
    expect(mit).not.toContain('Corresponding source');
    const isc = read(dest, 'guid-typescript', 'LICENSE-FROM-PACKAGE.txt');
    expect(isc).toContain('Copyright holder: nicolas\n');
    expect(isc).toContain('Copyright (c) nicolas\n');
    expect(isc).toContain('Permission to use, copy, modify, and/or distribute');
  });

  it('picks the first id of an OR-expression that has a text, and every id of an AND', () => {
    expect(chooseLicenseTexts('MIT OR Apache', 'x')).toEqual(['MIT']);
    expect(chooseLicenseTexts('WTFPL OR Apache', 'x')).toEqual(['Apache-2.0']);
    expect(chooseLicenseTexts('(MIT OR WTFPL)', 'x')).toEqual(['MIT']);
    expect(chooseLicenseTexts('(BSD-2-Clause OR MIT OR Apache-2.0)', 'x')).toEqual([
      'BSD-2-Clause',
    ]);
    expect(chooseLicenseTexts('Apache-2.0 AND LGPL-3.0-or-later AND MIT', 'x')).toEqual([
      'Apache-2.0',
      'LGPL-3.0',
      'MIT',
    ]);
    expect(chooseLicenseTexts('WTFPL AND MIT OR ISC', 'x')).toEqual(['ISC']);
    const { nm, dest } = tree({
      'sqlite-vec': {
        pkg: {
          name: 'sqlite-vec',
          version: '0.1.9',
          license: 'MIT OR Apache',
          author: 'Alex Garcia',
          repository: { type: 'git', url: 'https://github.com/asg017/sqlite-vec', directory: null },
        },
      },
    });
    collectLicenses(nm, dest, texts);
    const out = read(dest, 'sqlite-vec', 'LICENSE-FROM-PACKAGE.txt');
    expect(out).toContain('License (declared in package.json): MIT OR Apache');
    expect(out).toContain('License texts below: MIT\n');
    expect(out).toContain('Copyright (c) Alex Garcia\n');
    expect(out).not.toContain('Apache License');
  });

  it('fails the build on an unknown or missing license instead of skipping the package', () => {
    expect(() => chooseLicenseTexts('WTFPL', 'w@1.0.0')).toThrow(
      /w@1\.0\.0.*"WTFPL".*vantt\/licenses/,
    );
    expect(() => chooseLicenseTexts('MIT WITH Some-exception', 'w@1.0.0')).toThrow(/w@1\.0\.0/);
    expect(() => chooseLicenseTexts('(MIT OR', 'w@1.0.0')).toThrow(/w@1\.0\.0/);
    for (const pkg of [
      { name: 'odd', version: '1.0.0', license: 'SEE LICENSE IN eula.txt' },
      { name: 'odd', version: '1.0.0', license: 'UNLICENSED' },
      { name: 'odd', version: '1.0.0' },
    ]) {
      const { nm, dest } = tree({ odd: { pkg } });
      expect(() => collectLicenses(nm, dest, texts), JSON.stringify(pkg)).toThrow(/odd@1\.0\.0/);
    }
    const { nm, dest } = tree({ junk: { files: { 'index.js': '' } } });
    expect(() => collectLicenses(nm, dest, texts)).toThrow(/junk: no package\.json/);
  });

  it('adds the GPL text and the corresponding-source line to an LGPL package', () => {
    const { nm, dest } = tree({
      '@img/sharp-libvips-linux-x64': {
        pkg: {
          name: '@img/sharp-libvips-linux-x64',
          version: '1.3.4',
          license: 'LGPL-3.0-or-later',
          author: 'Lovell Fuller <npm@lovell.info>',
          repository: {
            type: 'git',
            url: 'git+https://github.com/lovell/sharp-libvips.git',
            directory: 'npm/linux-x64',
          },
        },
        files: { 'versions.json': '{}' },
      },
      '@img/sharp-win32-x64': {
        pkg: {
          name: '@img/sharp-win32-x64',
          version: '0.35.5',
          license: 'Apache-2.0 AND LGPL-3.0-or-later',
          repository: { type: 'git', url: 'git+https://github.com/lovell/sharp.git' },
        },
        files: { LICENSE: 'apache text' },
      },
    });
    const r = collectLicenses(nm, dest, texts);
    const out = read(dest, '@img__sharp-libvips-linux-x64', 'LICENSE-FROM-PACKAGE.txt');
    expect(out).toContain('License texts below: LGPL-3.0, GPL-3.0\n');
    expect(out).toContain(
      'Corresponding source: https://github.com/lovell/sharp-libvips/tree/v1.3.4 (repository https://github.com/lovell/sharp-libvips, tag v1.3.4)',
    );
    expect(out).toContain('Copyright holder: Lovell Fuller\n');
    expect(out).toContain('==== LGPL-3.0 ====\n\nGNU LESSER GENERAL PUBLIC LICENSE');
    expect(out).toContain('==== GPL-3.0 ====\n\nGNU GENERAL PUBLIC LICENSE');
    expect(out).toContain(texts['GPL-3.0'].trimEnd()); // verbatim, placeholders untouched
    // A copyleft package with its own license file keeps it and gets the source pointer next to it.
    expect(read(dest, '@img__sharp-win32-x64', 'LICENSE')).toBe('apache text');
    const src = read(dest, '@img__sharp-win32-x64', 'CORRESPONDING-SOURCE.txt');
    expect(src).toContain('Corresponding source: https://github.com/lovell/sharp/tree/v0.35.5');
    expect(src).toContain('==== GPL-3.0 ====');
    expect(r).toMatchObject({ copied: 1, generated: 2 });
  });

  it('refuses a copyleft package with no repository to point at', () => {
    const { nm, dest } = tree({
      g: { pkg: { name: 'g', version: '1.0.0', license: 'GPL-3.0-only' } },
    });
    expect(() => collectLicenses(nm, dest, texts)).toThrow(/g@1\.0\.0: copyleft.*no repository/);
    expect(existsSync(path.join(dest, 'g'))).toBe(false);
  });

  it('normalises repository URLs and author names', () => {
    expect(repositoryUrl({ repository: 'github:dqbd/tiktoken' })).toBe(
      'https://github.com/dqbd/tiktoken',
    );
    expect(repositoryUrl({ repository: 'a/b' })).toBe('https://github.com/a/b');
    expect(repositoryUrl({ repository: { url: 'git://github.com/a/b.git' } })).toBe(
      'https://github.com/a/b',
    );
    expect(repositoryUrl({ repository: { url: 'git+ssh://git@github.com/a/b.git' } })).toBe(
      'https://github.com/a/b',
    );
    expect(repositoryUrl({ repository: 'git@github.com:a/b.git' })).toBe('https://github.com/a/b');
    expect(repositoryUrl({})).toBeNull();
    expect(copyrightHolder({ name: 'p', author: { name: 'Ann', email: 'a@x' } })).toBe('Ann');
    expect(copyrightHolder({ name: 'p', author: '' })).toBe('the p authors');
  });

  it('lists every bundled package, Node.js and the language pack in THIRD_PARTY.md', () => {
    const { nm, dest } = tree({
      zed: {
        pkg: { name: 'zed', version: '1.0.0', license: 'MIT', repository: 'z/zed' },
        files: { LICENSE: 'x' },
      },
      [`zed/${NM}/ansi-regex`]: { pkg: { name: 'ansi-regex', version: '5.0.1', license: 'MIT' } },
      'ansi-regex': {
        pkg: { name: 'ansi-regex', version: '6.0.0', license: 'MIT' },
        files: { license: 'y' },
      },
      '@img/colour': { pkg: { name: '@img/colour', version: '1.0.0', license: 'MIT' } },
    });
    const { packages } = collectLicenses(nm, dest, texts);
    const md = thirdPartyMarkdown({
      packages,
      nodeVersion: '22.23.3',
      lang: {
        version: '0.2.0',
        source: 'https://github.com/vantt/obsidian-hybrid-search/tree/v1/x',
      },
    });
    const rows = md
      .split('\n')
      .filter((l) => l.startsWith('| ') && !l.startsWith('| Component') && !l.startsWith('| ---'));
    expect(rows).toEqual([
      '| Node.js | 22.23.3 | MIT and the licenses of its bundled components (NODE-LICENSE) | https://github.com/nodejs/node/tree/v22.23.3 |',
      '| ohs-lang-vi | 0.2.0 | Proprietary, all rights reserved; use only with pkm under its EULA (OHS-LANG-VI-LICENSE) | https://github.com/vantt/obsidian-hybrid-search/tree/v1/x |',
      '| @img/colour | 1.0.0 | MIT | https://www.npmjs.com/package/@img/colour/v/1.0.0 |',
      '| ansi-regex | 5.0.1 | MIT | https://www.npmjs.com/package/ansi-regex/v/5.0.1 |',
      '| ansi-regex | 6.0.0 | MIT | https://www.npmjs.com/package/ansi-regex/v/6.0.0 |',
      '| zed | 1.0.0 | MIT | https://github.com/z/zed |',
    ]);
    expect(thirdPartyMarkdown({ packages: [], nodeVersion: '1.0.0', lang: null })).not.toContain(
      'ohs-lang-vi |',
    );
  });
});
