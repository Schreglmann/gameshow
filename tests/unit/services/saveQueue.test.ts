import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  enqueueSave,
  flushSave,
  discardSave,
  retryNow,
  markSaved,
  isRecentSelfWrite,
  newerThanRead,
  hasPending,
  peekPending,
  getStatus,
  subscribe,
  onSaved,
  __resetSaveQueueForTests,
} from '@/services/saveQueue';

const KEY = 'test-key';

/** ApiError-shaped rejection: the queue classifies by `.status`. */
function httpError(status: number, message = `HTTP ${status}`) {
  return Object.assign(new Error(message), { status });
}

/** Let queued microtasks (the saver's promise chain) settle. */
const settle = () => Promise.resolve().then(() => Promise.resolve());

describe('saveQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    __resetSaveQueueForTests();
  });

  afterEach(() => {
    __resetSaveQueueForTests();
    vi.useRealTimers();
  });

  it('coalesces edits inside the debounce window into one save of the newest payload', async () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);
    vi.advanceTimersByTime(400);
    enqueueSave(KEY, { v: 2 }, saver);
    vi.advanceTimersByTime(400);
    enqueueSave(KEY, { v: 3 }, saver);

    expect(saver).not.toHaveBeenCalled();
    vi.advanceTimersByTime(800);
    await settle();

    expect(saver).toHaveBeenCalledTimes(1);
    expect(saver).toHaveBeenCalledWith({ v: 3 });
  });

  // The bug this module exists for: the caller that queued the write is gone.
  it('still saves after the component that enqueued it is gone', async () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);
    // Nothing holds a reference to the queue any more — no unmount hook, no listener.
    vi.advanceTimersByTime(800);
    await settle();
    expect(saver).toHaveBeenCalledWith({ v: 1 });
  });

  it('never runs two saves for the same key at once, and sends the newest payload after', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const saver = vi.fn()
      .mockImplementationOnce(() => gate)
      .mockResolvedValue(undefined);

    enqueueSave(KEY, { v: 1 }, saver);
    vi.advanceTimersByTime(800);
    await settle();
    expect(saver).toHaveBeenCalledTimes(1);

    // Two more edits while the first PUT is still open.
    enqueueSave(KEY, { v: 2 }, saver);
    vi.advanceTimersByTime(800);
    enqueueSave(KEY, { v: 3 }, saver);
    vi.advanceTimersByTime(800);
    await settle();
    expect(saver).toHaveBeenCalledTimes(1);   // still serialized behind the first

    release();
    await settle();

    expect(saver).toHaveBeenCalledTimes(2);
    expect(saver).toHaveBeenLastCalledWith({ v: 3 });   // v2 was superseded, never sent
  });

  it('retries a transient failure at 1s then 2s and reports the state along the way', async () => {
    const saver = vi.fn()
      .mockRejectedValueOnce(httpError(500))
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValue(undefined);

    enqueueSave(KEY, { v: 1 }, saver);
    vi.advanceTimersByTime(800);
    await settle();
    expect(saver).toHaveBeenCalledTimes(1);
    expect(getStatus().state).toBe('retrying');
    expect(getStatus().lastError).toBe('HTTP 500');

    vi.advanceTimersByTime(999);
    await settle();
    expect(saver).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await settle();
    expect(saver).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(2000);
    await settle();
    expect(saver).toHaveBeenCalledTimes(3);
    expect(getStatus().state).toBe('idle');
    expect(getStatus().lastError).toBeNull();
  });

  it('treats a network failure (no status) as retryable', async () => {
    const saver = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);
    vi.advanceTimersByTime(800);
    await settle();
    expect(getStatus().state).toBe('retrying');

    vi.advanceTimersByTime(1000);
    await settle();
    expect(saver).toHaveBeenCalledTimes(2);
    expect(getStatus().state).toBe('idle');
  });

  it('caps the backoff at 30s', async () => {
    const saver = vi.fn().mockRejectedValue(httpError(503));
    enqueueSave(KEY, { v: 1 }, saver);
    vi.advanceTimersByTime(800);
    await settle();

    // 1, 2, 4, 8, 16, then capped.
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
      vi.advanceTimersByTime(delay);
      await settle();
    }
    const callsBefore = saver.mock.calls.length;
    vi.advanceTimersByTime(29_999);
    await settle();
    expect(saver).toHaveBeenCalledTimes(callsBefore);
    vi.advanceTimersByTime(1);
    await settle();
    expect(saver).toHaveBeenCalledTimes(callsBefore + 1);
  });

  it('does not auto-retry a 4xx, but retryNow and a fresh edit both un-block it', async () => {
    const saver = vi.fn()
      .mockRejectedValueOnce(httpError(400, 'invalid-config'))
      .mockResolvedValue(undefined);

    enqueueSave(KEY, { v: 1 }, saver);
    vi.advanceTimersByTime(800);
    await settle();
    expect(getStatus().state).toBe('error');
    expect(getStatus().lastError).toBe('invalid-config');

    vi.advanceTimersByTime(60_000);
    await settle();
    expect(saver).toHaveBeenCalledTimes(1);   // no automatic retry

    retryNow();
    await settle();
    expect(saver).toHaveBeenCalledTimes(2);
    expect(getStatus().state).toBe('idle');
  });

  it('un-blocks a rejected payload when a newer edit supersedes it', async () => {
    const saver = vi.fn()
      .mockRejectedValueOnce(httpError(422))
      .mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);
    vi.advanceTimersByTime(800);
    await settle();
    expect(getStatus().state).toBe('error');

    enqueueSave(KEY, { v: 2 }, saver);
    vi.advanceTimersByTime(800);
    await settle();
    expect(saver).toHaveBeenLastCalledWith({ v: 2 });
    expect(getStatus().state).toBe('idle');
  });

  it('flushSave skips the debounce and resolves once the payload is on disk', async () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);
    const done = flushSave(KEY);
    expect(saver).toHaveBeenCalledTimes(1);   // not waiting out the 800 ms
    await expect(done).resolves.toBeUndefined();
    expect(hasPending(KEY)).toBe(false);
  });

  it('flushSave rejects on a failed attempt but leaves the entry queued and retrying', async () => {
    const saver = vi.fn()
      .mockRejectedValueOnce(httpError(500))
      .mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);

    await expect(flushSave(KEY)).rejects.toThrow('HTTP 500');
    expect(hasPending(KEY)).toBe(true);

    vi.advanceTimersByTime(1000);
    await settle();
    expect(saver).toHaveBeenCalledTimes(2);
    expect(hasPending(KEY)).toBe(false);
  });

  it('flushSave on a clean key resolves without a request', async () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    await expect(flushSave('never-touched')).resolves.toBeUndefined();
    expect(saver).not.toHaveBeenCalled();
  });

  it('discardSave drops a queued payload without writing it', async () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);
    discardSave(KEY);
    vi.advanceTimersByTime(5000);
    await settle();
    expect(saver).not.toHaveBeenCalled();
    expect(hasPending(KEY)).toBe(false);
  });

  it('records a successful save as a self-write for ~5s', async () => {
    const payload = { v: 1 };
    const saver = vi.fn().mockResolvedValue(undefined);
    enqueueSave(KEY, payload, saver);
    vi.advanceTimersByTime(800);
    await settle();

    expect(isRecentSelfWrite(KEY, JSON.stringify(payload))).toBe(true);
    expect(isRecentSelfWrite(KEY, JSON.stringify({ v: 99 }))).toBe(false);

    vi.advanceTimersByTime(5001);
    expect(isRecentSelfWrite(KEY, JSON.stringify(payload))).toBe(false);
  });

  it('markSaved registers a server-side write without issuing one of its own', () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);
    markSaved(KEY, { v: 2 });

    vi.advanceTimersByTime(3000);
    expect(saver).not.toHaveBeenCalled();
    expect(hasPending(KEY)).toBe(false);
    expect(isRecentSelfWrite(KEY, JSON.stringify({ v: 2 }))).toBe(true);
  });

  describe('newerThanRead', () => {
    it('returns the queued payload a concurrent read would have missed', () => {
      enqueueSave(KEY, { v: 1 }, vi.fn().mockResolvedValue(undefined));
      expect(newerThanRead(KEY, Date.now())).toEqual({ v: 1 });
      expect(peekPending(KEY)).toEqual({ v: 1 });
    });

    it('returns a payload persisted while the read was in flight', async () => {
      const readStartedAt = Date.now();
      enqueueSave(KEY, { v: 1 }, vi.fn().mockResolvedValue(undefined));
      vi.advanceTimersByTime(800);
      await settle();
      expect(hasPending(KEY)).toBe(false);
      expect(newerThanRead(KEY, readStartedAt)).toEqual({ v: 1 });
    });

    it('returns undefined when the read is authoritative', async () => {
      enqueueSave(KEY, { v: 1 }, vi.fn().mockResolvedValue(undefined));
      vi.advanceTimersByTime(800);
      await settle();
      vi.advanceTimersByTime(1000);
      expect(newerThanRead(KEY, Date.now())).toBeUndefined();
    });
  });

  it('flushes on visibilitychange → hidden and beacons on pagehide', async () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    const beacon = vi.fn();
    enqueueSave(KEY, { v: 1 }, saver, { beacon });

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(saver).toHaveBeenCalledTimes(1);
    expect(beacon).not.toHaveBeenCalled();

    // A later edit that the page-unload path has to rescue.
    enqueueSave(KEY, { v: 2 }, saver, { beacon });
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledWith({ v: 2 });
  });

  it('resets the backoff and retries immediately when the browser comes back online', async () => {
    const saver = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);
    vi.advanceTimersByTime(800);
    await settle();
    expect(getStatus().state).toBe('retrying');

    window.dispatchEvent(new Event('online'));
    await settle();
    expect(saver).toHaveBeenCalledTimes(2);
    expect(getStatus().state).toBe('idle');
  });

  // useSyncExternalStore compares snapshots by identity: an allocating getter
  // would re-render forever.
  it('returns a stable status object between transitions', async () => {
    const before = getStatus();
    expect(getStatus()).toBe(before);

    const saver = vi.fn().mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver);
    const queued = getStatus();
    expect(queued).not.toBe(before);
    expect(getStatus()).toBe(queued);

    vi.advanceTimersByTime(800);
    await settle();
    expect(getStatus()).not.toBe(queued);
  });

  it('notifies subscribers on transitions and stops after unsubscribe', async () => {
    const seen: string[] = [];
    const unsub = subscribe(s => seen.push(s.state));
    const saver = vi.fn().mockResolvedValue(undefined);

    enqueueSave(KEY, { v: 1 }, saver);
    vi.advanceTimersByTime(800);
    await settle();
    expect(seen).toContain('saving');
    expect(seen.at(-1)).toBe('idle');

    unsub();
    const count = seen.length;
    enqueueSave(KEY, { v: 2 }, saver);
    expect(seen).toHaveLength(count);
  });

  it('reports each persisted payload to onSaved listeners', async () => {
    const saved: [string, string][] = [];
    onSaved((key, json) => saved.push([key, json]));
    enqueueSave(KEY, { v: 1 }, vi.fn().mockResolvedValue(undefined));
    vi.advanceTimersByTime(800);
    await settle();
    expect(saved).toEqual([[KEY, JSON.stringify({ v: 1 })]]);
  });

  it('saves different keys independently and in parallel', async () => {
    const a = vi.fn().mockResolvedValue(undefined);
    const b = vi.fn().mockResolvedValue(undefined);
    enqueueSave('a', { v: 1 }, a);
    enqueueSave('b', { v: 1 }, b);
    expect(getStatus().unsavedKeys).toBe(2);

    vi.advanceTimersByTime(800);
    await settle();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    expect(getStatus().unsavedKeys).toBe(0);
  });

  it('runs a debounceMs:0 save without waiting', async () => {
    const saver = vi.fn().mockResolvedValue(undefined);
    enqueueSave(KEY, { v: 1 }, saver, { debounceMs: 0 });
    expect(saver).toHaveBeenCalledTimes(1);
    await settle();
    expect(hasPending(KEY)).toBe(false);
  });
});
