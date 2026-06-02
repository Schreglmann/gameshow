import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture the fs.watch callbacks per directory and the broadcast spy. Hoisted so
// the vi.mock factories (which are hoisted above imports) can reference them.
const { watchCbs, broadcastMock } = vi.hoisted(() => ({
  watchCbs: new Map<string, (event: string, filename: string) => void>(),
  broadcastMock: vi.fn(),
}));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  const watch = (dir: string, _opts: unknown, cb: (event: string, filename: string) => void) => {
    watchCbs.set(dir, cb);
    return { close: vi.fn() };
  };
  return { ...actual, watch, default: { ...actual, watch } };
});

vi.mock('../../../server/ws.js', () => ({ broadcast: broadcastMock }));

import { startContentWatch } from '../../../server/content-watch';

const ROOT = '/proj';
const GAMES = '/proj/games';

describe('content-watch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    watchCbs.clear();
    broadcastMock.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces and coalesces a burst into a single content-changed with the right flags', () => {
    startContentWatch(ROOT, GAMES);
    watchCbs.get(ROOT)!('change', 'config.json');
    watchCbs.get(GAMES)!('rename', 'allgemeinwissen.json');
    watchCbs.get(ROOT)!('change', 'theme-settings.json');

    // Still within the debounce window — nothing sent yet.
    expect(broadcastMock).not.toHaveBeenCalled();

    vi.advanceTimersByTime(200);
    expect(broadcastMock).toHaveBeenCalledTimes(1);
    expect(broadcastMock).toHaveBeenCalledWith('content-changed', { config: true, games: true, theme: true });
  });

  it('sets only the games flag for a games/*.json change', () => {
    startContentWatch(ROOT, GAMES);
    watchCbs.get(GAMES)!('rename', 'quizjagd.json');
    vi.advanceTimersByTime(200);
    expect(broadcastMock).toHaveBeenCalledWith('content-changed', { games: true });
  });

  it('ignores atomic-write tmp files and unrelated root files', () => {
    startContentWatch(ROOT, GAMES);
    watchCbs.get(ROOT)!('rename', 'config.json.tmp');
    watchCbs.get(ROOT)!('change', 'package.json');
    watchCbs.get(GAMES)!('rename', 'foo.json.7f3a-uuid.tmp');
    vi.advanceTimersByTime(200);
    expect(broadcastMock).not.toHaveBeenCalled();
  });

  it('starts a fresh batch after each flush (no stale false flags)', () => {
    startContentWatch(ROOT, GAMES);
    watchCbs.get(ROOT)!('change', 'config.json');
    vi.advanceTimersByTime(200);
    expect(broadcastMock).toHaveBeenLastCalledWith('content-changed', { config: true });

    watchCbs.get(GAMES)!('rename', 'bandle.json');
    vi.advanceTimersByTime(200);
    // Second broadcast carries ONLY games — config must not leak from the prior batch.
    expect(broadcastMock).toHaveBeenLastCalledWith('content-changed', { games: true });
    expect(broadcastMock).toHaveBeenCalledTimes(2);
  });

  it('stop() closes watchers and cancels a pending flush', () => {
    const stop = startContentWatch(ROOT, GAMES);
    watchCbs.get(ROOT)!('change', 'config.json');
    stop();
    vi.advanceTimersByTime(200);
    expect(broadcastMock).not.toHaveBeenCalled();
  });
});
