import { describe, it, expect } from 'vitest';
import { decideTeamStateWrite, teamStateRev } from '../../../server/ws.js';

// Stale-write guard for the `gamemaster-team-state` channel. Every PWA
// publishes the WHOLE TeamState on any local mutation, so without a version a
// client that fell behind could roll the live score back for everyone
// (last-writer-wins). See specs/cross-device-gamemaster.md.
describe('teamStateRev', () => {
  it('reads the rev off a payload', () => {
    expect(teamStateRev({ rev: 7 })).toBe(7);
  });

  it('treats a missing / malformed rev as 0', () => {
    expect(teamStateRev({})).toBe(0);
    expect(teamStateRev({ rev: 'nope' })).toBe(0);
    expect(teamStateRev({ rev: NaN })).toBe(0);
    expect(teamStateRev(null)).toBe(0);
    expect(teamStateRev(undefined)).toBe(0);
    expect(teamStateRev('string payload')).toBe(0);
  });
});

describe('decideTeamStateWrite', () => {
  it('accepts any write when nothing is cached (fresh boot / after a restart)', () => {
    expect(decideTeamStateWrite(null, 0)).toBe(true);
    expect(decideTeamStateWrite(null, 42)).toBe(true);
  });

  it('accepts a write that beats the cached rev', () => {
    expect(decideTeamStateWrite(4, 5)).toBe(true);
  });

  it('rejects a write that is behind the cached rev', () => {
    // The live failure: a show re-seeding on reconnect, or an installed PWA
    // replaying a previous session, must not resurrect the old score.
    expect(decideTeamStateWrite(9, 3)).toBe(false);
  });

  it('rejects an equal rev so concurrent mutations converge on first-write-wins', () => {
    // Two clients mutating from the same base both produce rev N+1. Accepting
    // both would leave each holding the other's value — permanent divergence.
    expect(decideTeamStateWrite(6, 6)).toBe(false);
  });

  it('rejects a rev-less payload once anything is cached', () => {
    expect(decideTeamStateWrite(0, 0)).toBe(false);
    expect(decideTeamStateWrite(1, 0)).toBe(false);
  });
});
