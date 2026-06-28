import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useScoreReveal } from '@/hooks/useScoreReveal';

function mockReducedMotion(matches: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }) as unknown as typeof window.matchMedia;
}

describe('useScoreReveal — lead-change detection (reduced-motion, snaps)', () => {
  beforeEach(() => mockReducedMotion(true));

  it('does not flip on the first points from 0-0 (establishing a lead)', () => {
    const { result, rerender } = renderHook(({ a, b }) => useScoreReveal(a, b), { initialProps: { a: 0, b: 0 } });
    expect(result.current.leadChangeKey).toBe(0);
    act(() => rerender({ a: 3, b: 0 }));
    expect(result.current.leadChangeKey).toBe(0);
    expect(result.current.team1).toBe(3);
  });

  it('flips when a team overtakes the other', () => {
    const { result, rerender } = renderHook(({ a, b }) => useScoreReveal(a, b), { initialProps: { a: 3, b: 0 } });
    act(() => rerender({ a: 1, b: 4 })); // team2 overtakes
    expect(result.current.leadChangeKey).toBe(1);
    act(() => rerender({ a: 5, b: 4 })); // team1 overtakes
    expect(result.current.leadChangeKey).toBe(2);
  });

  it('does not flip when settling into a tie, nor when establishing from a tie', () => {
    const { result, rerender } = renderHook(({ a, b }) => useScoreReveal(a, b), { initialProps: { a: 5, b: 3 } });
    act(() => rerender({ a: 5, b: 5 })); // → tie, no flip
    expect(result.current.leadChangeKey).toBe(0);
    act(() => rerender({ a: 5, b: 8 })); // from tie → team2 leads, no flip
    expect(result.current.leadChangeKey).toBe(0);
  });

  it('snaps the display to the target (incl. counting down on an undo)', () => {
    const { result, rerender } = renderHook(({ a, b }) => useScoreReveal(a, b), { initialProps: { a: 6, b: 2 } });
    expect(result.current.team1).toBe(6);
    act(() => rerender({ a: 2, b: 2 })); // team1 lowered (undo)
    expect(result.current.team1).toBe(2);
  });
});

describe('useScoreReveal — count-up animation', () => {
  let rafCb: FrameRequestCallback | null;
  let clock: number;

  beforeEach(() => {
    mockReducedMotion(false);
    rafCb = null;
    clock = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { rafCb = cb; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
  });
  afterEach(() => vi.restoreAllMocks());

  it('tweens from the old value to the new one', () => {
    const { result, rerender } = renderHook(({ a, b }) => useScoreReveal(a, b), { initialProps: { a: 0, b: 0 } });
    act(() => rerender({ a: 10, b: 0 }));
    // Midway through the tween the value is between start and target.
    act(() => { clock = 300; rafCb?.(clock); });
    expect(result.current.team1).toBeGreaterThan(0);
    expect(result.current.team1).toBeLessThan(10);
    // At the end it lands exactly on the target.
    act(() => { clock = 600; rafCb?.(clock); });
    expect(result.current.team1).toBe(10);
  });
});
