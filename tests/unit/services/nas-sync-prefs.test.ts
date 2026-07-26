import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  getNasSyncConfig,
  getNasBasePath,
  getNasSyncEnabled,
  setNasSyncConfig,
  _setNasSyncPrefsPathForTests,
} from '../../../server/nas-sync-prefs';

let tmpRoot: string;
let prefsPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'nas-sync-prefs-test-'));
  prefsPath = path.join(tmpRoot, 'nas-sync-prefs.json');
  _setNasSyncPrefsPathForTests(prefsPath);
});

afterEach(() => {
  _setNasSyncPrefsPathForTests(null);
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('defaults', () => {
  it('returns the hardcoded NAS path + enabled when no sidecar exists', () => {
    expect(existsSync(prefsPath)).toBe(false);
    expect(getNasBasePath()).toBe('/Volumes/Georg/Gameshow/Assets');
    expect(getNasSyncEnabled()).toBe(true);
    expect(getNasSyncConfig()).toEqual({ basePath: '/Volumes/Georg/Gameshow/Assets', enabled: true });
  });
});

describe('load', () => {
  it('reads a valid sidecar', () => {
    writeFileSync(prefsPath, JSON.stringify({ basePath: '/mnt/nas', enabled: false }));
    expect(getNasBasePath()).toBe('/mnt/nas');
    expect(getNasSyncEnabled()).toBe(false);
  });

  it('falls back to the default path when the persisted path is relative/empty', () => {
    writeFileSync(prefsPath, JSON.stringify({ basePath: 'relative/dir', enabled: true }));
    expect(getNasBasePath()).toBe('/Volumes/Georg/Gameshow/Assets');
  });

  it('treats a missing enabled as true, and only exact false as false', () => {
    writeFileSync(prefsPath, JSON.stringify({ basePath: '/mnt/nas' }));
    expect(getNasSyncEnabled()).toBe(true);
  });

  it('uses defaults when the sidecar is corrupt JSON', () => {
    writeFileSync(prefsPath, '{ not json');
    expect(getNasBasePath()).toBe('/Volumes/Georg/Gameshow/Assets');
    expect(getNasSyncEnabled()).toBe(true);
  });
});

describe('setNasSyncConfig', () => {
  it('persists an absolute basePath atomically and returns the full config', () => {
    const result = setNasSyncConfig({ basePath: '/Volumes/Other/Assets' });
    expect(result).toEqual({ basePath: '/Volumes/Other/Assets', enabled: true });
    expect(existsSync(prefsPath)).toBe(true);
    expect(JSON.parse(readFileSync(prefsPath, 'utf-8'))).toEqual({
      basePath: '/Volumes/Other/Assets',
      enabled: true,
    });
    // the tmp file was renamed away
    expect(existsSync(prefsPath + '.tmp')).toBe(false);
  });

  it('trims whitespace around the path', () => {
    expect(setNasSyncConfig({ basePath: '  /mnt/nas  ' }).basePath).toBe('/mnt/nas');
  });

  it('applies a partial update without clobbering the other field', () => {
    setNasSyncConfig({ basePath: '/mnt/nas' });
    const r = setNasSyncConfig({ enabled: false });
    expect(r).toEqual({ basePath: '/mnt/nas', enabled: false });
  });

  it('reflects a set immediately on subsequent reads', () => {
    setNasSyncConfig({ enabled: false });
    expect(getNasSyncEnabled()).toBe(false);
  });

  it('rejects an empty path', () => {
    expect(() => setNasSyncConfig({ basePath: '   ' })).toThrow(/empty/);
  });

  it('rejects a relative path', () => {
    expect(() => setNasSyncConfig({ basePath: 'relative/dir' })).toThrow(/absolute/);
  });

  it('rejects a non-string path', () => {
    expect(() => setNasSyncConfig({ basePath: 42 })).toThrow(/string/);
  });

  it('rejects a non-boolean enabled', () => {
    expect(() => setNasSyncConfig({ enabled: 'yes' })).toThrow(/boolean/);
  });

  it('does not write the sidecar when validation fails', () => {
    expect(() => setNasSyncConfig({ basePath: 'relative' })).toThrow();
    expect(existsSync(prefsPath)).toBe(false);
  });
});
