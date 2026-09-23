import { describe, it, expect } from 'vitest';
import {
  effectiveTeamCount,
  gameIsScorable,
  hasTeamSplit,
  listIncompatibleGames,
  type ScorableGame,
} from '../../../server/team-count';
import type { AppConfig } from '@/types/config';

function config(over: Partial<AppConfig> = {}, show: Record<string, unknown> = {}): AppConfig {
  return {
    activeGameshow: 'a',
    gameshows: { a: { name: 'A', gameOrder: [], ...show } as never },
    ...over,
  } as AppConfig;
}

describe('effectiveTeamCount', () => {
  it('defaults to two teams — every pre-existing gameshow is unchanged', () => {
    expect(effectiveTeamCount(config())).toBe(2);
  });

  it('uses the active gameshow\'s own count', () => {
    for (const n of [0, 1, 2, 3, 4]) {
      expect(effectiveTeamCount(config({}, { teamCount: n }))).toBe(n);
    }
  });

  it('lets the global pointSystemEnabled:false override any configured count', () => {
    // The historic master switch keeps working: no teams, whatever the gameshow says.
    expect(effectiveTeamCount(config({ pointSystemEnabled: false }, { teamCount: 4 }))).toBe(0);
  });

  it('leaves an explicit pointSystemEnabled:true alone', () => {
    expect(effectiveTeamCount(config({ pointSystemEnabled: true }, { teamCount: 3 }))).toBe(3);
  });

  it('clamps a corrupt count instead of serving a nonsense number', () => {
    expect(effectiveTeamCount(config({}, { teamCount: 9 }))).toBe(4);
    expect(effectiveTeamCount(config({}, { teamCount: -1 }))).toBe(0);
    expect(effectiveTeamCount(config({}, { teamCount: 'three' }))).toBe(2);
  });

  it('falls back to the default when the active gameshow is missing', () => {
    expect(effectiveTeamCount(config({ activeGameshow: 'nope' }))).toBe(2);
  });
});

describe('gameIsScorable — the per-game scoring gate', () => {
  const simple: ScorableGame = { type: 'simple-quiz' };
  const transfer: ScorableGame = { type: 'bet-quiz', scoringMode: 'transfer' };
  const penalty: ScorableGame = { type: 'wer-kennt-mehr', scoringMode: 'count-penalty' };

  it('never scores anything with no teams', () => {
    for (const g of [simple, transfer, penalty]) expect(gameIsScorable(g, 0)).toBe(false);
  });

  it('scores an unrestricted game at every count from 1 to 4', () => {
    for (const n of [1, 2, 3, 4]) expect(gameIsScorable(simple, n)).toBe(true);
  });

  it('refuses a head-to-head mechanic outside two teams', () => {
    expect(gameIsScorable(transfer, 2)).toBe(true);
    expect(gameIsScorable(transfer, 1)).toBe(false);
    expect(gameIsScorable(transfer, 3)).toBe(false);
    expect(gameIsScorable(transfer, 4)).toBe(false);
    expect(gameIsScorable(penalty, 3)).toBe(false);
  });

  it('scores the same type at 3 teams once its mode is unrestricted', () => {
    expect(gameIsScorable({ type: 'bet-quiz' }, 3)).toBe(true);
    expect(gameIsScorable({ type: 'wer-kennt-mehr', scoringMode: 'standard' }, 3)).toBe(true);
  });
});

describe('listIncompatibleGames', () => {
  const order: (ScorableGame | null)[] = [
    { type: 'simple-quiz', title: 'Allgemeinwissen' },
    { type: 'bet-quiz', title: 'Einsatzquiz', scoringMode: 'transfer' },
    { type: 'wer-kennt-mehr', title: 'Wer kennt mehr', scoringMode: 'count-penalty' },
    { type: 'quizjagd', title: 'Quizjagd' },
  ];

  it('is empty at two teams — nothing in the catalogue is 2-team-incompatible', () => {
    expect(listIncompatibleGames(order, 2)).toEqual([]);
  });

  it('is empty at 0 teams, where nothing scores anyway', () => {
    expect(listIncompatibleGames(order, 0)).toEqual([]);
  });

  it('reports the restricted games with their gameOrder position at 3 teams', () => {
    expect(listIncompatibleGames(order, 3)).toEqual([
      { index: 1, title: 'Einsatzquiz', type: 'bet-quiz' },
      { index: 2, title: 'Wer kennt mehr', type: 'wer-kennt-mehr' },
    ]);
  });

  it('keeps indices aligned with gameOrder when a game fails to load', () => {
    // A broken reference is skipped, but must not shift the reported positions.
    const withHole: (ScorableGame | null)[] = [order[0]!, null, order[1]!];
    expect(listIncompatibleGames(withHole, 4)).toEqual([
      { index: 2, title: 'Einsatzquiz', type: 'bet-quiz' },
    ]);
  });

  it('falls back to the type when a game has no title', () => {
    expect(listIncompatibleGames([{ type: 'bet-quiz', scoringMode: 'transfer' }], 3))
      .toEqual([{ index: 0, title: 'bet-quiz', type: 'bet-quiz' }]);
  });
});

describe('hasTeamSplit', () => {
  // 0 = no scoring at all; 1 = points are awarded but the audience plays the
  // show itself, so there is nobody to be split from. Both run without any
  // team-assignment flow, and randomization has nothing to randomize.
  // See specs/team-count.md.
  it('is false without a second team to split players between', () => {
    expect(hasTeamSplit(0)).toBe(false);
    expect(hasTeamSplit(1)).toBe(false);
  });

  it('is true from two teams up', () => {
    expect(hasTeamSplit(2)).toBe(true);
    expect(hasTeamSplit(3)).toBe(true);
    expect(hasTeamSplit(4)).toBe(true);
  });
});
