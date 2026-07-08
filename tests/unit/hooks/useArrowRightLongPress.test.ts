import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useArrowRightLongPress } from '@/hooks/useArrowRightLongPress';

function keydown(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}
function keyup(key: string) {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true }));
  });
}

describe('useArrowRightLongPress', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('short ArrowRight tap fires onShortPress, not onLongPress', () => {
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress, onLongPress }));

    keydown('ArrowRight');
    keyup('ArrowRight');

    expect(onShortPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('short Space tap also fires onShortPress (presenter forward may map to Space)', () => {
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress, onLongPress }));

    keydown(' ');
    keyup(' ');

    expect(onShortPress).toHaveBeenCalledTimes(1);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('holding ArrowRight past holdMs fires onLongPress via the wall-clock timer', () => {
    vi.useFakeTimers();
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress, onLongPress }));

    keydown('ArrowRight');
    act(() => { vi.advanceTimersByTime(600); }); // cross the 500 ms threshold
    keyup('ArrowRight');

    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onShortPress).not.toHaveBeenCalled();
  });

  it('an OS key-repeat keydown fires onLongPress immediately, before any keyup', () => {
    // Reproduces the presenter-clicker fix: the clicker sends an early keyup
    // that would cancel the timer, but OS key-repeat proves the key is held.
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress, onLongPress }));

    keydown('ArrowRight');                   // initial press (repeat=false)
    keydown('ArrowRight', { repeat: true }); // OS auto-repeat → still held

    expect(onLongPress).toHaveBeenCalledTimes(1);

    keyup('ArrowRight');
    expect(onShortPress).not.toHaveBeenCalled(); // gesture already consumed
  });

  it('key-repeat on Space also fires onLongPress', () => {
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress, onLongPress }));

    keydown(' ');
    keydown(' ', { repeat: true });

    expect(onLongPress).toHaveBeenCalledTimes(1);
    keyup(' ');
    expect(onShortPress).not.toHaveBeenCalled();
  });

  it('fires onLongPress exactly once regardless of how many repeats arrive', () => {
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress: vi.fn(), onLongPress }));

    keydown('ArrowRight');
    keydown('ArrowRight', { repeat: true });
    keydown('ArrowRight', { repeat: true });
    keydown('ArrowRight', { repeat: true });

    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('a second keydown without repeat (a new tap that lost its keyup) is NOT a hold', () => {
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress: vi.fn(), onLongPress }));

    keydown('ArrowRight'); // press 1 (no keyup delivered)
    keydown('ArrowRight'); // press 2, repeat=false → must not read as a hold

    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('rapid consecutive short taps (no repeat) never fire onLongPress', () => {
    // Double-tap was deliberately rejected as a skip trigger — too easy to
    // fire by accident during normal fast advancing. Two independent taps,
    // however quickly they follow each other, must only ever advance twice.
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress, onLongPress }));

    keydown('ArrowRight'); keyup('ArrowRight');
    keydown('ArrowRight'); keyup('ArrowRight');
    keydown('ArrowRight'); keyup('ArrowRight');

    expect(onShortPress).toHaveBeenCalledTimes(3);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('does nothing and lets the event propagate when disabled', () => {
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    const bubbleSpy = vi.fn();
    document.addEventListener('keydown', bubbleSpy); // bubble phase, after capture
    renderHook(() => useArrowRightLongPress({ enabled: false, onShortPress, onLongPress }));

    keydown('ArrowRight');
    keyup('ArrowRight');

    expect(onShortPress).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
    expect(bubbleSpy).toHaveBeenCalled(); // not stopped → normal navigation still sees it
    document.removeEventListener('keydown', bubbleSpy);
  });

  it('ignores the gesture while a text field is focused', () => {
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress, onLongPress }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    });

    expect(onShortPress).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('ignores unrelated keys', () => {
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    renderHook(() => useArrowRightLongPress({ enabled: true, onShortPress, onLongPress }));

    keydown('ArrowLeft'); keyup('ArrowLeft');
    keydown('Enter'); keyup('Enter');

    expect(onShortPress).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('cleans up listeners on unmount', () => {
    const onShortPress = vi.fn();
    const onLongPress = vi.fn();
    const { unmount } = renderHook(() =>
      useArrowRightLongPress({ enabled: true, onShortPress, onLongPress })
    );

    unmount();
    keydown('ArrowRight');
    keyup('ArrowRight');

    expect(onShortPress).not.toHaveBeenCalled();
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
