// Process helpers that make the fork scripts spawn npm, npx and .cmd launchers without a shell on
// Windows. The Windows branches are pure (platform, PATH and file checks are injected), so they run here.
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { batchCommand, childEnv, npmCommand, pathKey, prependPath } from '../lib/proc.mjs';

const files = (...list) => {
  const set = new Set(list.map((f) => path.win32.normalize(f)));
  return (f) => set.has(path.win32.normalize(f));
};
const win = (env, exists) => ({ env, platform: 'win32', exists });

describe('npmCommand', () => {
  it('spawns the tool by name off Windows', () => {
    for (const platform of ['linux', 'darwin'])
      expect(npmCommand('npx', ['--yes', 'pkg'], { platform })).toEqual({
        command: 'npx',
        args: ['--yes', 'pkg'],
      });
  });

  it("runs npm's JS entry next to node.exe with this node", () => {
    const node = 'C:\\Program Files\\nodejs';
    const exists = files(
      `${node}\\npx.cmd`,
      `${node}\\node_modules\\npm\\bin\\npx-cli.js`,
      'C:\\other\\npx.cmd',
    );
    expect(
      npmCommand('npx', ['--yes', 'a b'], win({ Path: `C:\\Windows;"${node}";C:\\other` }, exists)),
    ).toEqual({
      command: process.execPath,
      args: [`${node}\\node_modules\\npm\\bin\\npx-cli.js`, '--yes', 'a b'],
    });
  });

  it('prefers an npm installed with npm install -g in the global prefix, like npm.cmd', () => {
    const node = 'C:\\hostedtoolcache\\windows\\node\\22.23.3\\x64';
    const prefix = 'C:\\npm\\prefix';
    const exists = files(
      `${node}\\node.exe`,
      `${node}\\npm.cmd`,
      `${node}\\node_modules\\npm\\bin\\npm-cli.js`,
      `${prefix}\\node_modules\\npm\\bin\\npm-cli.js`,
    );
    const seen = [];
    const globalPrefix = (cli) => (seen.push(cli), prefix);
    expect(
      npmCommand('npm', ['ci'], { ...win({ Path: node }, exists), globalPrefix }).args,
    ).toEqual([`${prefix}\\node_modules\\npm\\bin\\npm-cli.js`, 'ci']);
    expect(seen).toEqual([`${node}\\node_modules\\npm\\bin\\npm-cli.js`]);
    // no npm in the prefix, or no prefix: the bundled npm
    const bundled = [`${node}\\node_modules\\npm\\bin\\npm-cli.js`, 'ci'];
    expect(
      npmCommand('npm', ['ci'], { ...win({ Path: node }, exists), globalPrefix: () => 'C:\\x' })
        .args,
    ).toEqual(bundled);
    expect(
      npmCommand('npm', ['ci'], { ...win({ Path: node }, exists), globalPrefix: () => null }).args,
    ).toEqual(bundled);
  });

  it('resolves a node_modules/.bin shim (the npm pinned by ensureNpm)', () => {
    const bin = 'D:\\w\\vantt\\.work\\tools\\npm-12.2.0\\node_modules\\.bin';
    const exists = files(
      `${bin}\\npm.cmd`,
      'D:\\w\\vantt\\.work\\tools\\npm-12.2.0\\node_modules\\npm\\bin\\npm-cli.js',
    );
    expect(npmCommand('npm', ['ci'], win({ PATH: `${bin};C:\\nodejs` }, exists)).args).toEqual([
      'D:\\w\\vantt\\.work\\tools\\npm-12.2.0\\node_modules\\npm\\bin\\npm-cli.js',
      'ci',
    ]);
  });

  it('uses the first shim on PATH and fails loudly when it has no JS entry', () => {
    const exists = files(
      'C:\\a\\npm.cmd',
      'C:\\b\\npm.cmd',
      'C:\\b\\node_modules\\npm\\bin\\npm-cli.js',
    );
    expect(() => npmCommand('npm', [], win({ PATH: 'C:\\a;C:\\b' }, exists))).toThrow(
      /npm-cli\.js next to C:\\a\\npm\.cmd/,
    );
  });

  it('fails when the shim is not on PATH, and refuses other tools', () => {
    expect(() =>
      npmCommand(
        'npx',
        [],
        win({ PATH: 'C:\\x' }, () => false),
      ),
    ).toThrow(/npx\.cmd is not on PATH/);
    expect(() => npmCommand('tsx', [], { platform: 'linux' })).toThrow(/npm or npx/);
  });
});

describe('batchCommand', () => {
  it('quotes the file and every argument for cmd.exe /s /c', () => {
    expect(
      batchCommand('C:\\o h s\\bin\\ohs.cmd', ['search', 'giu chan khach', 'a&b|c', ''], {
        ComSpec: 'C:\\Windows\\system32\\cmd.exe',
      }),
    ).toEqual({
      command: 'C:\\Windows\\system32\\cmd.exe',
      args: ['/d', '/s', '/c', '""C:\\o h s\\bin\\ohs.cmd" "search" "giu chan khach" "a&b|c" """'],
    });
  });

  it('doubles trailing backslashes so they do not escape the closing quote', () => {
    expect(batchCommand('x.cmd', ['C:\\dir\\'], {}).args[3]).toBe('""x.cmd" "C:\\dir\\\\""');
    expect(batchCommand('x.cmd', [], {}).command).toBe('cmd.exe');
  });

  it('refuses characters cmd.exe expands inside quotes', () => {
    for (const bad of ['a"b', '%PATH%', 'a!b', 'a\nb', 'a\rb'])
      expect(() => batchCommand('x.cmd', [bad], {}), bad).toThrow(/through cmd\.exe/);
    expect(() => batchCommand('C:\\100%\\x.cmd', [], {})).toThrow(/through cmd\.exe/);
  });
});

describe('childEnv PATH', () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    prependPath(null);
  });

  it('finds the PATH key whatever its case', () => {
    expect(pathKey({ Path: 'x' })).toBe('Path');
    expect(pathKey({ PATH: 'x' })).toBe('PATH');
    expect(pathKey({})).toBe('PATH');
  });

  it('prepends to the existing PATH variable instead of adding a second one', () => {
    const orig = process.env.PATH;
    delete process.env.PATH;
    process.env.Path = orig;
    prependPath('/pinned/bin');
    const env = childEnv();
    expect(env.Path).toBe(`/pinned/bin${path.delimiter}${orig}`);
    expect('PATH' in env).toBe(false);
    expect(env.HUSKY).toBe('0');
  });
});
