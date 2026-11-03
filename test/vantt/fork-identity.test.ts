import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStatusField,
  readPackageIdentity,
  updateCheckDisabled,
} from '../../src/runtime/package-identity.js';
import { checkForUpdates } from '../../src/transports/mcp-runtime.js';

describe('package identity (fork build marker)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ohs-identity-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the stamped version and the fork marker', () => {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ version: '0.17.2-vantt.1', vanttFork: true }),
    );
    expect(readPackageIdentity(dir)).toEqual({ version: '0.17.2-vantt.1', vanttFork: true });
  });

  it('treats a pristine package.json as upstream', () => {
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '0.17.2' }));
    expect(readPackageIdentity(dir)).toEqual({ version: '0.17.2', vanttFork: false });
  });

  it('adds the build field only on fork builds', () => {
    expect(buildStatusField({ version: '0.17.2-vantt.1', vanttFork: true })).toEqual({
      build: 'vantt',
    });
    expect(buildStatusField({ version: '0.17.2', vanttFork: false })).toEqual({});
  });
});

describe('OHS_DISABLE_UPDATE_CHECK', () => {
  const saved = process.env.OHS_DISABLE_UPDATE_CHECK;

  afterEach(() => {
    if (saved === undefined) delete process.env.OHS_DISABLE_UPDATE_CHECK;
    else process.env.OHS_DISABLE_UPDATE_CHECK = saved;
    vi.unstubAllGlobals();
  });

  it('is enabled only by the value 1', () => {
    delete process.env.OHS_DISABLE_UPDATE_CHECK;
    expect(updateCheckDisabled()).toBe(false);
    process.env.OHS_DISABLE_UPDATE_CHECK = '0';
    expect(updateCheckDisabled()).toBe(false);
    process.env.OHS_DISABLE_UPDATE_CHECK = '1';
    expect(updateCheckDisabled()).toBe(true);
  });

  it('sends no registry request when disabled', async () => {
    process.env.OHS_DISABLE_UPDATE_CHECK = '1';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await checkForUpdates('0.0.0');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
