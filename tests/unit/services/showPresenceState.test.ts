import { describe, it, expect } from 'vitest';
import { computeInitialInactive } from '@/services/showPresenceState';

// A prod show tab must start GATED so a freshly-opened second frontend emits
// NOTHING to the gamemaster before it learns it isn't the active show. Dev and
// non-show (GM/admin) tabs start ungated. See specs/cross-device-gamemaster.md.
describe('computeInitialInactive', () => {
  it('gates a prod show tab (loaded on /show…)', () => {
    expect(computeInitialInactive(false, '/show/')).toBe(true);
    expect(computeInitialInactive(false, '/show/game')).toBe(true);
    expect(computeInitialInactive(false, '/show')).toBe(true);
  });

  it('does NOT gate prod non-show tabs (gamemaster / admin)', () => {
    expect(computeInitialInactive(false, '/gamemaster')).toBe(false);
    expect(computeInitialInactive(false, '/admin')).toBe(false);
  });

  it('never gates in dev (every show tab acts active)', () => {
    expect(computeInitialInactive(true, '/show/game')).toBe(false);
  });

  it('does not gate when there is no DOM/pathname (SSR/tests)', () => {
    expect(computeInitialInactive(false, undefined)).toBe(false);
  });
});
