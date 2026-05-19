import { describe, it, expect, vi, beforeEach } from 'vitest';
import { watchMediaLoad } from '@/utils/mediaLoadTimeout';

function makeMedia() {
  const listeners: Record<string, ((e?: Event) => void)[]> = {};
  return {
    listeners,
    addEventListener: vi.fn((event: string, cb: (e?: Event) => void) => {
      (listeners[event] ||= []).push(cb);
    }),
    removeEventListener: vi.fn((event: string, cb: (e?: Event) => void) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(l => l !== cb);
      }
    }),
    fire(event: string) {
      (listeners[event] || []).slice().forEach(cb => cb());
    },
  } as unknown as HTMLMediaElement & { fire: (e: string) => void; listeners: Record<string, ((e?: Event) => void)[]> };
}

describe('watchMediaLoad', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('calls onSlow after timeout if no event fires', () => {
    const media = makeMedia();
    const onSlow = vi.fn();
    watchMediaLoad(media, 5000, onSlow);
    expect(onSlow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(4999);
    expect(onSlow).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onSlow if canplay fires before timeout', () => {
    const media = makeMedia() as ReturnType<typeof makeMedia>;
    const onSlow = vi.fn();
    watchMediaLoad(media, 5000, onSlow);
    vi.advanceTimersByTime(1000);
    (media as unknown as { fire: (e: string) => void }).fire('canplay');
    vi.advanceTimersByTime(10000);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('does NOT call onSlow if loadedmetadata fires before timeout', () => {
    const media = makeMedia() as ReturnType<typeof makeMedia>;
    const onSlow = vi.fn();
    watchMediaLoad(media, 5000, onSlow);
    (media as unknown as { fire: (e: string) => void }).fire('loadedmetadata');
    vi.advanceTimersByTime(10000);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('does NOT call onSlow if error fires before timeout (error path is handled elsewhere)', () => {
    const media = makeMedia() as ReturnType<typeof makeMedia>;
    const onSlow = vi.fn();
    watchMediaLoad(media, 5000, onSlow);
    (media as unknown as { fire: (e: string) => void }).fire('error');
    vi.advanceTimersByTime(10000);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('the returned cleanup function detaches all listeners and clears the timer', () => {
    const media = makeMedia();
    const onSlow = vi.fn();
    const stop = watchMediaLoad(media, 5000, onSlow);
    expect(media.listeners.canplay.length).toBe(1);
    expect(media.listeners.loadedmetadata.length).toBe(1);
    expect(media.listeners.error.length).toBe(1);
    stop();
    expect(media.listeners.canplay.length).toBe(0);
    expect(media.listeners.loadedmetadata.length).toBe(0);
    expect(media.listeners.error.length).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('does not double-fire onSlow when the timer races with cleanup', () => {
    const media = makeMedia();
    const onSlow = vi.fn();
    const stop = watchMediaLoad(media, 5000, onSlow);
    vi.advanceTimersByTime(6000);
    expect(onSlow).toHaveBeenCalledTimes(1);
    stop();
    expect(onSlow).toHaveBeenCalledTimes(1);
  });
});
