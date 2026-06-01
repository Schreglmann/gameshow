import { describe, it, expect, afterEach, vi } from 'vitest';
import { isTouchDevice } from '@/utils/isTouchDevice';

afterEach(() => {
  vi.unstubAllGlobals();
  // Restore any matchMedia / maxTouchPoints we attached during a test.
  delete (window as unknown as { matchMedia?: unknown }).matchMedia;
  delete (navigator as unknown as { maxTouchPoints?: unknown }).maxTouchPoints;
});

/** Define navigator.maxTouchPoints (absent in jsdom by default). */
function setMaxTouchPoints(value: number) {
  Object.defineProperty(navigator, 'maxTouchPoints', {
    value,
    configurable: true,
  });
}

/** Stub window.matchMedia so `(pointer: coarse)` reports `coarse`. */
function stubMatchMedia(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('coarse') ? coarse : !coarse,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

describe('isTouchDevice', () => {
  it('returns true when the primary pointer is coarse (phone / iPad)', () => {
    stubMatchMedia(true);
    expect(isTouchDevice()).toBe(true);
  });

  it('returns false when the primary pointer is fine (mouse / trackpad)', () => {
    stubMatchMedia(false);
    expect(isTouchDevice()).toBe(false);
  });

  it('falls back to navigator.maxTouchPoints when matchMedia is unavailable', () => {
    // jsdom does not implement matchMedia by default.
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;

    setMaxTouchPoints(5);
    expect(isTouchDevice()).toBe(true);

    setMaxTouchPoints(0);
    expect(isTouchDevice()).toBe(false);
  });

  it('returns false in the default jsdom test environment (no matchMedia, 0 touch points)', () => {
    // This is the path existing component tests rely on: autofocus stays enabled.
    expect(isTouchDevice()).toBe(false);
  });
});
