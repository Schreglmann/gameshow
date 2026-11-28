import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
interface TailBufferLike { push: (chunk: string) => void; text: () => string; clear: () => void }
const { restartDelay, nextCrashCount, TailBuffer, dayStamp, describeExit } = require_('../../../scripts/supervise.cjs') as {
  restartDelay: (crashCount: number) => number;
  nextCrashCount: (prevCount: number, uptimeMs: number) => number;
  TailBuffer: new (maxLines: number) => TailBufferLike;
  dayStamp: (date: Date) => string;
  describeExit: (code: number | null, signal: string | null, watchdogKilled: boolean) => string;
};

// npm start supervisor — see specs/crash-recovery.md.
describe('supervise: restart backoff', () => {
  it('restarts immediately first, then doubles from 1 s and caps at 10 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(restartDelay)).toEqual([0, 1000, 2000, 4000, 8000, 10000, 10000, 10000]);
  });

  it('a run of 60 s or more resets the backoff to an immediate restart', () => {
    expect(nextCrashCount(5, 60_000)).toBe(1);
    expect(restartDelay(nextCrashCount(5, 60_000))).toBe(0);
  });

  it('a short run keeps counting up', () => {
    expect(nextCrashCount(0, 500)).toBe(1);
    expect(nextCrashCount(3, 59_999)).toBe(4);
  });
});

describe('supervise: stderr tail', () => {
  it('keeps the last N lines and joins a line split across chunks', () => {
    const tail = new TailBuffer(3);
    tail.push('a\nb\nc');
    tail.push('d\ne\n');
    tail.push('f');
    expect(tail.text()).toBe('cd\ne\nf');
  });

  it('clear() empties it', () => {
    const tail = new TailBuffer(3);
    tail.push('x\ny\n');
    tail.clear();
    expect(tail.text()).toBe('');
  });
});

describe('supervise: helpers', () => {
  it('dayStamp uses the local calendar day', () => {
    expect(dayStamp(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('describeExit names watchdog, signal or exit code', () => {
    expect(describeExit(null, 'SIGKILL', true)).toBe('Keine Antwort mehr (Watchdog-Neustart)');
    expect(describeExit(null, 'SIGKILL', false)).toBe('Beendet durch SIGKILL');
    expect(describeExit(1, null, false)).toBe('Exit-Code 1');
  });
});
