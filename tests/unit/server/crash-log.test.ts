import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  appendCrashLog, writeLastCrash, readLastCrash, crashReason, setLogsDirForTests, crashLogPath, lastCrashPath,
} from '../../../server/crash-log.js';

// logs/crash.log + logs/last-crash.json — see specs/crash-recovery.md.
describe('crash log', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'crash-log-'));
    setLogsDirForTests(path.join(dir, 'logs'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends entries with the stack, creating the folder', () => {
    appendCrashLog('uncaughtException', new Error('boom'));
    appendCrashLog('unhandledRejection', 'plain reason');
    const text = readFileSync(crashLogPath(), 'utf8');
    expect(text).toContain('uncaughtException');
    expect(text).toContain('Error: boom');
    expect(text).toContain('plain reason');
  });

  it('round-trips last-crash.json', () => {
    expect(readLastCrash()).toBeNull();
    writeLastCrash('TypeError: x is undefined');
    const last = readLastCrash();
    expect(last?.reason).toBe('TypeError: x is undefined');
    expect(Number.isNaN(Date.parse(last!.at))).toBe(false);
  });

  it('ignores a malformed last-crash.json', () => {
    writeLastCrash('x');
    writeFileSync(lastCrashPath(), '{"at": 1}');
    expect(readLastCrash()).toBeNull();
  });

  it('crashReason keeps only the first line', () => {
    expect(crashReason(new TypeError('a\nb'))).toBe('TypeError: a');
    expect(crashReason('line1\nline2')).toBe('line1');
  });
});
