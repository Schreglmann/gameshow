import { describe, it, expect } from 'vitest';
import {
  GAME_TYPE_INFO,
  gameSupportsTeamCount,
  supportedTeamCounts,
  teamCountSupportLabel,
} from '@/data/gameTypeInfo';
import type { GameType } from '@/types/config';

const ALL_TYPES = Object.keys(GAME_TYPE_INFO) as GameType[];

/**
 * The compatibility matrix is what decides whether a game is scored at a given
 * team count — the server reads it for `GET /api/game/:index`. See specs/team-count.md.
 */
describe('supportedTeamCounts', () => {
  it('declares a list for every game type', () => {
    for (const type of ALL_TYPES) {
      expect(GAME_TYPE_INFO[type].supportedTeamCounts.length, type).toBeGreaterThan(0);
    }
  });

  it('always allows 0 teams — with no teams every type is a pure play-through', () => {
    for (const type of ALL_TYPES) {
      expect(gameSupportsTeamCount(type, 0), type).toBe(true);
    }
  });

  it('always allows the historic 2 teams, so no existing gameshow changes behaviour', () => {
    for (const type of ALL_TYPES) {
      expect(gameSupportsTeamCount(type, 2), type).toBe(true);
      for (const mode of ['standard', 'transfer', 'auto', 'count', 'count-penalty']) {
        expect(gameSupportsTeamCount(type, 2, mode), `${type}/${mode}`).toBe(true);
      }
    }
  });

  it('never declares an out-of-range count', () => {
    for (const type of ALL_TYPES) {
      for (const n of GAME_TYPE_INFO[type].supportedTeamCounts) {
        expect(n, type).toBeGreaterThanOrEqual(0);
        expect(n, type).toBeLessThanOrEqual(4);
      }
    }
  });
});

describe('the type-level matrix', () => {
  const anyCount: GameType[] = [
    'simple-quiz', 'q1', 'four-statements', 'fact-or-fake', 'audio-guess', 'video-guess',
    'bandle', 'image-guess', 'colorguess', 'ranking', 'random-frame', 'city-compass',
    'quizjagd', 'final-quiz', 'bet-quiz', 'guessing-game', 'wer-kennt-mehr',
  ];

  it('scores every type at any count when no scoring mode restricts it', () => {
    for (const type of anyCount) {
      for (const n of [0, 1, 2, 3, 4]) {
        expect(gameSupportsTeamCount(type, n), `${type}@${n}`).toBe(true);
      }
    }
  });
});

describe('scoring-mode restrictions', () => {
  it('bet-quiz transfer is head-to-head only (zero-sum needs exactly one opponent)', () => {
    expect(supportedTeamCounts('bet-quiz', 'transfer')).toEqual([0, 2]);
    expect(gameSupportsTeamCount('bet-quiz', 1, 'transfer')).toBe(false);
    expect(gameSupportsTeamCount('bet-quiz', 3, 'transfer')).toBe(false);
    expect(gameSupportsTeamCount('bet-quiz', 4, 'transfer')).toBe(false);
    // standard mode is unrestricted — the betting team is just a pick from N.
    expect(gameSupportsTeamCount('bet-quiz', 3, 'standard')).toBe(true);
    expect(gameSupportsTeamCount('bet-quiz', 1)).toBe(true);
  });

  it('wer-kennt-mehr count-penalty is head-to-head only', () => {
    expect(supportedTeamCounts('wer-kennt-mehr', 'count-penalty')).toEqual([0, 2]);
    expect(gameSupportsTeamCount('wer-kennt-mehr', 3, 'count-penalty')).toBe(false);
  });

  it('wer-kennt-mehr count needs an opponent, but any number of them', () => {
    expect(supportedTeamCounts('wer-kennt-mehr', 'count')).toEqual([0, 2, 3, 4]);
    expect(gameSupportsTeamCount('wer-kennt-mehr', 1, 'count')).toBe(false);
    expect(gameSupportsTeamCount('wer-kennt-mehr', 4, 'count')).toBe(true);
    // standard mode (the default) works even solo.
    expect(gameSupportsTeamCount('wer-kennt-mehr', 1, 'standard')).toBe(true);
  });

  it('guessing-game auto needs an opponent — "closest guess" is comparative', () => {
    expect(supportedTeamCounts('guessing-game', 'auto')).toEqual([0, 2, 3, 4]);
    expect(gameSupportsTeamCount('guessing-game', 1, 'auto')).toBe(false);
    expect(gameSupportsTeamCount('guessing-game', 1, 'standard')).toBe(true);
  });

  it('ignores a scoring mode that does not belong to the type', () => {
    // A stale/typo'd mode must not silently narrow an unrelated type.
    expect(gameSupportsTeamCount('simple-quiz', 3, 'transfer')).toBe(true);
    expect(gameSupportsTeamCount('bet-quiz', 3, 'count-penalty')).toBe(true);
  });

  it('treats an unknown type as compatible rather than silently unscorable', () => {
    expect(gameSupportsTeamCount('not-a-type' as GameType, 3)).toBe(true);
  });
});

describe('teamCountSupportLabel', () => {
  it('renders a contiguous range', () => {
    expect(teamCountSupportLabel('simple-quiz')).toBe('1–4 Teams');
    expect(teamCountSupportLabel('wer-kennt-mehr', 'count')).toBe('2–4 Teams');
  });

  it('renders a non-contiguous or single value as a list', () => {
    expect(teamCountSupportLabel('bet-quiz', 'transfer')).toBe('2 Teams');
  });

  it('drops 0 — "no teams" is not a scoring option the operator picks here', () => {
    expect(teamCountSupportLabel('simple-quiz')).not.toContain('0');
  });
});
