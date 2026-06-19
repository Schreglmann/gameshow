import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  isNasReachable,
  refreshNasReachable,
  nasStat,
  nasPathExists,
  markNasUnreachable,
  startNasMonitor,
  _resetNasReachabilityForTests,
} from '../../../server/nas-reachability';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'nas-reach-test-'));
  _resetNasReachabilityForTests();
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('bounded NAS helpers (nasStat / nasPathExists)', () => {
  it('nasStat resolves to a Stats object for an existing file', async () => {
    const file = path.join(tmpRoot, 'present.txt');
    writeFileSync(file, 'hello');
    const st = await nasStat(file);
    expect(st).not.toBeNull();
    expect(st!.isFile()).toBe(true);
    expect(st!.size).toBe(5);
  });

  it('nasStat resolves to null for a missing path (fast, never hangs)', async () => {
    const st = await nasStat(path.join(tmpRoot, 'does-not-exist'));
    expect(st).toBeNull();
  });

  it('nasPathExists reflects presence/absence', async () => {
    const file = path.join(tmpRoot, 'a.bin');
    writeFileSync(file, 'x');
    expect(await nasPathExists(file)).toBe(true);
    expect(await nasPathExists(path.join(tmpRoot, 'missing.bin'))).toBe(false);
  });
});

describe('reachability flag (test-env behaviour)', () => {
  // Under vitest the probe/monitor are intentionally disabled (no real NAS),
  // mirroring the prior behaviour where `statSync(NAS_BASE)` threw → false.
  it('isNasReachable() is false and never throws', () => {
    expect(isNasReachable()).toBe(false);
  });

  it('refreshNasReachable() resolves to false without probing the filesystem', async () => {
    await expect(refreshNasReachable()).resolves.toBe(false);
  });

  it('startNasMonitor() / markNasUnreachable() are no-throw and start no timers', () => {
    expect(() => startNasMonitor()).not.toThrow();
    expect(() => markNasUnreachable()).not.toThrow();
    expect(isNasReachable()).toBe(false);
  });
});
