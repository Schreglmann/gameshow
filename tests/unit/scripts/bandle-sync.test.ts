import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
type Song = Record<string, unknown>;
const {
  backfillFolders, isoDay, pendingPlanningDates, earliestDateByPath, applyDailyDates,
  waitForToken, openAuthenticatedSession,
} = require_('../../../scripts/bandle-sync.cjs') as {
    backfillFolders: (catalog: Song[], remoteSongs: Song[], write: (song: Song) => void) => number;
    isoDay: (date: Date) => string;
    pendingPlanningDates: (todayIso: string, cache: Record<string, string | null>, lookbackDays?: number) => string[];
    earliestDateByPath: (cache: Record<string, string | null>) => Map<string, string>;
    applyDailyDates: (catalog: Song[], dateByPath: Map<string, string>, write: (song: Song) => void) => number;
    waitForToken: (page: { evaluate: () => Promise<string | null> }, timeoutMs: number) => Promise<string | null>;
    openAuthenticatedSession: (
      chromium: unknown,
      opts: { launch: (chromium: unknown, headless: boolean) => Promise<unknown>; probeMs: number },
    ) => Promise<{ token: string | null }>;
  };

const song = (path: string, extra: Record<string, unknown> = {}) => ({ path, song: `Song ${path}`, ...extra });

describe('backfillFolders', () => {
  it('copies folder onto entries that lack it and writes them back', () => {
    const catalog = [song('a'), song('b')];
    const write = vi.fn();
    const n = backfillFolders(catalog, [song('a', { folder: '202607/Wanted' }), song('b', { folder: '_kpop/Yeobo' })], write);
    expect(n).toBe(2);
    expect(catalog.map(s => s.folder)).toEqual(['202607/Wanted', '_kpop/Yeobo']);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('leaves entries whose folder already matches untouched, so a repeat run writes nothing', () => {
    const catalog = [song('a', { folder: '202607/Wanted' })];
    const write = vi.fn();
    expect(backfillFolders(catalog, [song('a', { folder: '202607/Wanted' })], write)).toBe(0);
    expect(write).not.toHaveBeenCalled();
  });

  it('rewrites a folder that changed on bandle', () => {
    const catalog = [song('a', { folder: '_kpop/Yeobo' })];
    const write = vi.fn();
    expect(backfillFolders(catalog, [song('a', { folder: '202608/Yeobo' })], write)).toBe(1);
    expect(catalog[0]!.folder).toBe('202608/Yeobo');
  });

  it('skips songs missing from the pack listing and remote entries with no folder', () => {
    const catalog = [song('gone'), song('nofolder')];
    const write = vi.fn();
    expect(backfillFolders(catalog, [song('nofolder')], write)).toBe(0);
    expect(catalog.every(s => s.folder === undefined)).toBe(true);
    expect(write).not.toHaveBeenCalled();
  });

  it('preserves the entry\'s other fields, since the whole object is written back', () => {
    const catalog = [song('a', { year: 2002, view: 301, clue: 'Skater Boy' })];
    const write = vi.fn();
    backfillFolders(catalog, [song('a', { folder: '202607/Wanted' })], write);
    expect(write.mock.calls[0]![0]).toMatchObject({ year: 2002, view: 301, clue: 'Skater Boy', folder: '202607/Wanted' });
  });
});

describe('pendingPlanningDates', () => {
  it('walks the lookback window ending today, inclusive', () => {
    expect(pendingPlanningDates('2026-08-19', {}, 3))
      .toEqual(['2026-08-17', '2026-08-18', '2026-08-19']);
  });

  it('skips days already answered, including a cached null', () => {
    const cache = { '2026-08-17': 'abc', '2026-08-18': null };
    expect(pendingPlanningDates('2026-08-19', cache, 3)).toEqual(['2026-08-19']);
  });

  it('crosses month and year boundaries', () => {
    expect(pendingPlanningDates('2026-01-02', {}, 4))
      .toEqual(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']);
  });

  it('returns nothing when the window is already covered', () => {
    expect(pendingPlanningDates('2026-08-19', { '2026-08-19': 'x' }, 1)).toEqual([]);
  });

  it('never asks for the deep archive bandle does not serve', () => {
    // Default window — a few days, not the ~1450 back to bandle's first daily.
    expect(pendingPlanningDates('2026-08-19', {}).length).toBeLessThanOrEqual(31);
  });

  it('formats dates as UTC days', () => {
    expect(isoDay(new Date('2026-08-19T23:30:00Z'))).toBe('2026-08-19');
  });
});

describe('earliestDateByPath', () => {
  it('keeps the first airing when bandle re-runs a song', () => {
    const map = earliestDateByPath({ '2026-08-19': 'p1', '2023-04-02': 'p1', '2024-01-01': 'p2' });
    expect(map.get('p1')).toBe('2023-04-02');
    expect(map.get('p2')).toBe('2024-01-01');
  });

  it('ignores days that named no song', () => {
    expect(earliestDateByPath({ '2026-08-19': null }).size).toBe(0);
  });
});

describe('applyDailyDates', () => {
  it('stamps dailyDate and writes only the entries that changed', () => {
    const catalog = [song('p1'), song('p2', { dailyDate: '2024-01-01' }), song('p3')];
    const write = vi.fn();
    const n = applyDailyDates(catalog, new Map([['p1', '2023-04-02'], ['p2', '2024-01-01']]), write);
    expect(n).toBe(1);
    expect(catalog[0]!.dailyDate).toBe('2023-04-02');
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('leaves songs with no daily slot untouched', () => {
    const catalog = [song('themed-pack-only')];
    const write = vi.fn();
    expect(applyDailyDates(catalog, new Map(), write)).toBe(0);
    expect(catalog[0]!.dailyDate).toBeUndefined();
    expect(write).not.toHaveBeenCalled();
  });
});

describe('session reuse', () => {
  /** Minimal stand-in for a Playwright context whose page yields `token` from IndexedDB. */
  function fakeContext(token: string | null) {
    const page = { evaluate: vi.fn().mockResolvedValue(token), goto: vi.fn().mockResolvedValue(undefined) };
    return { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined), page };
  }

  it('returns the stored token without ever opening a visible window', async () => {
    const stored = fakeContext('tok-stored');
    const launch = vi.fn().mockResolvedValue(stored);

    const session = await openAuthenticatedSession({}, { launch, probeMs: 1 });

    expect(session.token).toBe('tok-stored');
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(expect.anything(), true);   // headless
    expect(stored.close).not.toHaveBeenCalled();
  });

  it('falls back to a login window when the stored session yields nothing', async () => {
    const expired = fakeContext(null);
    const loggedIn = fakeContext('tok-fresh');
    const launch = vi.fn()
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(loggedIn);

    const session = await openAuthenticatedSession({}, { launch, probeMs: 1 });

    expect(session.token).toBe('tok-fresh');
    expect(launch).toHaveBeenNthCalledWith(1, expect.anything(), true);   // headless probe
    expect(launch).toHaveBeenNthCalledWith(2, expect.anything(), false);  // visible login
    // The profile directory only takes one context, so the probe must be closed first.
    expect(expired.close).toHaveBeenCalledTimes(1);
  });
});

describe('waitForToken', () => {
  it('returns the token on the first read', async () => {
    expect(await waitForToken({ evaluate: vi.fn().mockResolvedValue('tok') }, 1)).toBe('tok');
  });

  it('gives up once the budget is spent rather than polling forever', async () => {
    const evaluate = vi.fn().mockResolvedValue(null);
    expect(await waitForToken({ evaluate }, 1)).toBeNull();
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  it('treats a page error as no token instead of throwing', async () => {
    const evaluate = vi.fn().mockRejectedValue(new Error('page closed'));
    expect(await waitForToken({ evaluate }, 1)).toBeNull();
  });
});

describe('session reuse fallbacks', () => {
  function fakeContext(token: string | null) {
    const page = { evaluate: vi.fn().mockResolvedValue(token), goto: vi.fn().mockResolvedValue(undefined) };
    return { newPage: vi.fn().mockResolvedValue(page), close: vi.fn().mockResolvedValue(undefined), page };
  }

  it('opens a login window when the headless launch itself fails', async () => {
    const loggedIn = fakeContext('tok-fresh');
    const launch = vi.fn()
      .mockRejectedValueOnce(new Error("Executable doesn't exist"))
      .mockResolvedValueOnce(loggedIn);

    const session = await openAuthenticatedSession({}, { launch, probeMs: 1 });

    expect(session.token).toBe('tok-fresh');
    expect(launch).toHaveBeenNthCalledWith(2, expect.anything(), false);
  });

  it('does not try to close a context that never launched', async () => {
    const loggedIn = fakeContext('tok');
    const launch = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(loggedIn);
    await expect(openAuthenticatedSession({}, { launch, probeMs: 1 })).resolves.toMatchObject({ token: 'tok' });
  });

  it('still reaches the login window when closing the probe context throws', async () => {
    const stuck = fakeContext(null);
    stuck.close.mockRejectedValue(new Error('close failed'));
    const loggedIn = fakeContext('tok-fresh');
    const launch = vi.fn().mockResolvedValueOnce(stuck).mockResolvedValueOnce(loggedIn);

    const session = await openAuthenticatedSession({}, { launch, probeMs: 1 });
    expect(session.token).toBe('tok-fresh');
  });
});
