import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAudioPlaying } from '@/hooks/useAudioPlaying';

function fakeAudio(paused = true): HTMLAudioElement {
  const el = new EventTarget() as EventTarget & { paused: boolean };
  el.paused = paused;
  return el as unknown as HTMLAudioElement;
}

describe('useAudioPlaying', () => {
  it('is false without an element', () => {
    const { result } = renderHook(() => useAudioPlaying(null));
    expect(result.current).toBe(false);
  });

  it('starts from the element\'s current state', () => {
    const { result } = renderHook(() => useAudioPlaying(fakeAudio(false)));
    expect(result.current).toBe(true);
  });

  it('follows play, pause and ended events', () => {
    const el = fakeAudio();
    const { result } = renderHook(() => useAudioPlaying(el));
    act(() => { el.dispatchEvent(new Event('play')); });
    expect(result.current).toBe(true);
    act(() => { el.dispatchEvent(new Event('pause')); });
    expect(result.current).toBe(false);
    act(() => { el.dispatchEvent(new Event('play')); });
    act(() => { el.dispatchEvent(new Event('ended')); });
    expect(result.current).toBe(false);
  });

  it('resets when the element is removed and ignores the old element afterwards', () => {
    const el = fakeAudio(false);
    const { result, rerender } = renderHook(({ a }) => useAudioPlaying(a), {
      initialProps: { a: el as HTMLAudioElement | null },
    });
    expect(result.current).toBe(true);
    rerender({ a: null });
    expect(result.current).toBe(false);
    act(() => { el.dispatchEvent(new Event('play')); });
    expect(result.current).toBe(false);
  });
});
