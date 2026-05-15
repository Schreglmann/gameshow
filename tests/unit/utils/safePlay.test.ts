import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safePlay } from '@/utils/safePlay';

function makeMedia(opts: {
  playImpl?: () => Promise<void>;
  readyState?: number;
  muted?: boolean;
} = {}): HTMLMediaElement {
  const listeners: Record<string, ((e?: Event) => void)[]> = {};
  const el = {
    readyState: opts.readyState ?? HTMLMediaElement.HAVE_FUTURE_DATA,
    muted: opts.muted ?? false,
    play: vi.fn(opts.playImpl ?? (() => Promise.resolve())),
    addEventListener: vi.fn((event: string, cb: (e?: Event) => void) => {
      (listeners[event] ||= []).push(cb);
    }),
    removeEventListener: vi.fn((event: string, cb: (e?: Event) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(l => l !== cb);
      }
    }),
    // Test helpers
    _fire(event: string) {
      (listeners[event] || []).slice().forEach(cb => cb());
    },
    _listenerCount(event: string) {
      return (listeners[event] || []).length;
    },
  } as unknown as HTMLMediaElement & { _fire: (e: string) => void; _listenerCount: (e: string) => number };
  return el;
}

describe('safePlay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('resolves true when play() succeeds immediately', async () => {
    const media = makeMedia();
    const result = await safePlay(media);
    expect(result).toBe(true);
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it('retries once after a transient failure, then succeeds', async () => {
    let calls = 0;
    const media = makeMedia({
      playImpl: () => {
        calls++;
        // First attempt: both unmuted + muted fallback fail.
        // Retry (attempt 2): succeeds on unmuted.
        return calls <= 2 ? Promise.reject(new Error('network blip')) : Promise.resolve();
      },
    });
    const onError = vi.fn();
    const promise = safePlay(media, { onError, backoffMs: 50 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toBe(0);
    expect(calls).toBe(3);
  });

  it('returns false after retries exhausted', async () => {
    const media = makeMedia({
      playImpl: () => Promise.reject(new Error('persistent failure')),
    });
    const onError = vi.fn();
    const promise = safePlay(media, { onError, retries: 2, backoffMs: 10 });
    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it('returns false on AbortError without retrying', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const media = makeMedia({
      playImpl: () => Promise.reject(abort),
    });
    const onError = vi.fn();
    const result = await safePlay(media, { onError, retries: 5 });
    expect(result).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(media.play).toHaveBeenCalledTimes(1);
  });

  it('falls back to muted play when first play fails with non-abort', async () => {
    const media = makeMedia();
    let calls = 0;
    (media.play as ReturnType<typeof vi.fn>).mockImplementation(() => {
      calls++;
      // First unmuted play fails; subsequent (muted) play succeeds.
      if (calls === 1) {
        return Promise.reject(new DOMException('autoplay blocked', 'NotAllowedError'));
      }
      return Promise.resolve();
    });
    const result = await safePlay(media);
    expect(result).toBe(true);
    expect(media.play).toHaveBeenCalledTimes(2);
    expect(media.muted).toBe(false);
  });

  it('waits for canplay when readyState is below HAVE_FUTURE_DATA', async () => {
    const media = makeMedia({ readyState: HTMLMediaElement.HAVE_NOTHING }) as HTMLMediaElement & { _fire: (e: string) => void };
    const promise = safePlay(media, { waitForReady: true, readyTimeoutMs: 1000 });
    expect(media.addEventListener).toHaveBeenCalledWith('canplay', expect.any(Function), expect.objectContaining({ once: true }));
    media._fire('canplay');
    const result = await promise;
    expect(result).toBe(true);
  });

  it('times out the canplay wait and surfaces failure', async () => {
    const media = makeMedia({ readyState: HTMLMediaElement.HAVE_NOTHING });
    const onError = vi.fn();
    const promise = safePlay(media, { waitForReady: true, readyTimeoutMs: 1000, retries: 0, onError });
    await vi.advanceTimersByTimeAsync(1100);
    const result = await promise;
    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toMatch(/timeout/i);
  });

  it('rejects the canplay wait when an error event fires before canplay', async () => {
    const media = makeMedia({ readyState: HTMLMediaElement.HAVE_NOTHING }) as HTMLMediaElement & { _fire: (e: string) => void };
    const onError = vi.fn();
    const promise = safePlay(media, { waitForReady: true, retries: 0, onError });
    media._fire('error');
    const result = await promise;
    expect(result).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('skips the canplay wait when waitForReady=false', async () => {
    const media = makeMedia({ readyState: HTMLMediaElement.HAVE_NOTHING });
    const result = await safePlay(media, { waitForReady: false });
    expect(result).toBe(true);
    expect(media.addEventListener).not.toHaveBeenCalled();
  });
});
