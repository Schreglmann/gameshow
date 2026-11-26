import { describe, it, expect } from 'vitest';
import { decideShowRegister } from '../../../server/ws.js';

// Identity-based active-show election: a reloading owner reclaims its slot,
// while a different/background frontend never steals a running show. See
// specs/cross-device-gamemaster.md.
//
// 4th arg `hasOtherShowClients`: whether any OTHER show client is currently
// connected. When none is, an alone tab claims the empty slot rather than being
// stranded behind the takeover overlay by a stale retained owner id.
describe('decideShowRegister', () => {
  it('first show ever claims the empty slot', () => {
    expect(decideShowRegister(false, null, 'A', false)).toBe('claim');
  });

  it('the owner reloading reclaims its (freed) slot — id matches', () => {
    expect(decideShowRegister(false, 'A', 'A', false)).toBe('claim');
    expect(decideShowRegister(false, 'A', 'A', true)).toBe('claim');
  });

  it('a DIFFERENT frontend does NOT claim a freed slot WHILE another show client is connected', () => {
    expect(decideShowRegister(false, 'A', 'B', true)).toBe('ignore');
  });

  it('a DIFFERENT frontend that is the ONLY connected show claims the empty slot (stale retained owner id)', () => {
    expect(decideShowRegister(false, 'A', 'B', false)).toBe('claim');
  });

  it('the owner reconnecting takes over a slot still held by its stale socket', () => {
    expect(decideShowRegister(true, 'A', 'A', false)).toBe('claim');
    expect(decideShowRegister(true, 'A', 'A', true)).toBe('claim');
  });

  it('a new / background frontend never steals a running (occupied) show', () => {
    expect(decideShowRegister(true, 'A', 'B', false)).toBe('ignore');
    expect(decideShowRegister(true, 'A', 'B', true)).toBe('ignore');
  });

  it('an empty id never auto-claims an owned slot (occupied or freed), even when alone', () => {
    expect(decideShowRegister(true, 'A', '', false)).toBe('ignore');
    expect(decideShowRegister(false, 'A', '', false)).toBe('ignore');
    expect(decideShowRegister(false, 'A', '', true)).toBe('ignore');
  });
});

// After a server restart the owner id is restored from `.show-presence.json` and,
// for SHOW_RESTART_GRACE_MS, other tabs may not auto-claim the empty slot — the
// projector is most likely still reconnecting. See specs/crash-recovery.md.
describe('decideShowRegister — restart grace window', () => {
  it('the restored owner reclaims its slot during the grace window', () => {
    expect(decideShowRegister(false, 'A', 'A', false, true)).toBe('claim');
    expect(decideShowRegister(false, 'A', 'A', true, true)).toBe('claim');
  });

  it('a DIFFERENT frontend that is alone does NOT claim during the grace window', () => {
    expect(decideShowRegister(false, 'A', 'B', false, true)).toBe('ignore');
  });

  it('the same lone frontend claims once the grace window is over', () => {
    expect(decideShowRegister(false, 'A', 'B', false, false)).toBe('claim');
  });

  it('a fresh server with no restored owner lets the first show claim, grace or not', () => {
    expect(decideShowRegister(false, null, 'B', false, true)).toBe('claim');
  });
});
