import { describe, it, expect } from 'vitest';
import { runBatchPercent, runCurrentFilm, runEtaSeconds, runFilmState, type FilmStripeRun } from '@/utils/filmStripeRun';
import { formatDuration } from '@/utils/formatDuration';

const run = (patch: Partial<FilmStripeRun> = {}): FilmStripeRun => ({
  paths: ['a.mp4', 'b.mp4', 'c.mp4', 'd.mp4'],
  done: 0,
  failed: [],
  startedAt: 0,
  ...patch,
});

describe('filmStripeRun', () => {
  it('takes the next unfinished film as the current one until the server names it', () => {
    expect(runCurrentFilm(run())).toBe('a.mp4');
    expect(runCurrentFilm(run({ done: 2 }))).toBe('c.mp4');
    expect(runCurrentFilm(run({ done: 4 }))).toBeNull();
  });

  it('blends the current film into the batch percent', () => {
    expect(runBatchPercent(run())).toBe(0);
    expect(runBatchPercent(run({ done: 1, currentPercent: 50 }))).toBe(37);
    expect(runBatchPercent(run({ done: 4 }))).toBe(100);
  });

  it('extrapolates the time per film into an ETA', () => {
    // One and a half films in 90 s → 60 s per film → two and a half films left.
    expect(runEtaSeconds(run({ done: 1, currentPercent: 50 }), 90_000)).toBeCloseTo(150);
  });

  it('gives no ETA before 2 % of the batch', () => {
    expect(runEtaSeconds(run({ currentPercent: 4 }), 10_000)).toBeNull();
    expect(runEtaSeconds(run({ currentPercent: 8 }), 10_000)).not.toBeNull();
  });

  it('counts a failed film as no work', () => {
    // Film a failed at once; b is half done after 30 s → 60 s per film, 2.5 films left.
    const r = run({ done: 1, failed: [{ path: 'a.mp4', error: 'x' }], currentPercent: 50 });
    expect(runEtaSeconds(r, 30_000)).toBeCloseTo(150);
    // Only failures so far: nothing to extrapolate from.
    expect(runEtaSeconds(run({ done: 1, failed: [{ path: 'a.mp4', error: 'x' }] }), 30_000)).toBeNull();
  });

  it('reports each film’s part in the run', () => {
    const r = run({ done: 2, failed: [{ path: 'a.mp4', error: 'Video nicht erreichbar' }], currentPercent: 12 });
    expect(runFilmState(r, 'a.mp4')).toEqual({ kind: 'failed', error: 'Video nicht erreichbar' });
    expect(runFilmState(r, 'b.mp4')).toEqual({ kind: 'done' });
    expect(runFilmState(r, 'c.mp4')).toEqual({ kind: 'current', percent: 12 });
    expect(runFilmState(r, 'd.mp4')).toEqual({ kind: 'queued' });
    expect(runFilmState(r, 'other.mp4')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats seconds, minutes and hours compactly', () => {
    expect(formatDuration(45)).toBe('45s');
    expect(formatDuration(200)).toBe('3m 20s');
    expect(formatDuration(180)).toBe('3m');
    expect(formatDuration(4320)).toBe('1h 12m');
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
  });
});
