import { describe, it, expect } from 'vitest';
import { decideShowRegister } from '../../../server/ws.js';

// Identity-based active-show election: a reloading owner reclaims its slot,
// while a different/background frontend never steals a running show. See
// specs/cross-device-gamemaster.md.
describe('decideShowRegister', () => {
  it('first show ever claims the empty slot', () => {
    expect(decideShowRegister(false, null, 'A')).toBe('claim');
  });

  it('the owner reloading reclaims its (freed) slot — id matches', () => {
    expect(decideShowRegister(false, 'A', 'A')).toBe('claim');
  });

  it('a DIFFERENT frontend does NOT claim a slot the owner just freed', () => {
    expect(decideShowRegister(false, 'A', 'B')).toBe('ignore');
  });

  it('the owner reconnecting takes over a slot still held by its stale socket', () => {
    expect(decideShowRegister(true, 'A', 'A')).toBe('claim');
  });

  it('a new / background frontend never steals a running show', () => {
    expect(decideShowRegister(true, 'A', 'B')).toBe('ignore');
  });

  it('an empty id never claims/steals (occupied or owned slot)', () => {
    expect(decideShowRegister(true, 'A', '')).toBe('ignore');
    expect(decideShowRegister(false, 'A', '')).toBe('ignore');
  });
});
