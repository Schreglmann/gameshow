import { describe, it, expect } from 'vitest';
import { computePlayerHistory, sessionIncludesPlayer } from '@/utils/playerStats';
import type { GameFileSummary, GameshowConfig } from '@/types/config';

function game(overrides: Partial<GameFileSummary>): GameFileSummary {
  return {
    fileName: 'x',
    type: 'simple-quiz',
    title: 'X',
    instances: [],
    isSingleInstance: false,
    ...overrides,
  };
}

describe('sessionIncludesPlayer', () => {
  it('matches a trimmed, case-insensitive token', () => {
    expect(sessionIncludesPlayer('St, Ju, Th', 'ju')).toBe(true);
    expect(sessionIncludesPlayer('St,  JU , Th', 'ju')).toBe(true);
  });

  it('does not match a substring of a token', () => {
    expect(sessionIncludesPlayer('Julia, Th', 'ju')).toBe(false);
  });

  it('returns false for an empty player or no match', () => {
    expect(sessionIncludesPlayer('St, Th', 'ju')).toBe(false);
    expect(sessionIncludesPlayer('', 'ju')).toBe(false);
  });
});

describe('computePlayerHistory', () => {
  const games: GameFileSummary[] = [
    game({
      fileName: 'allgemeinwissen',
      type: 'simple-quiz',
      title: 'Allgemeinwissen',
      instances: ['v1', 'v2'],
      instancePlayers: { v1: ['St, Ju, Th'], v2: ['An, Ju', 'Ko, Th'] },
    }),
    game({
      fileName: 'musik',
      type: 'audio-guess',
      title: 'Musik der 90er',
      instances: ['v1'],
      instancePlayers: { v1: ['Ju, An'] },
    }),
    game({
      fileName: 'bandle',
      type: 'bandle',
      title: 'Bandle',
      instances: ['v1'],
      instancePlayers: { v1: ['St, Th'] }, // no Ju
    }),
    // Single-instance game: never contributes (no instancePlayers).
    game({ fileName: 'einzel', type: 'q1', title: 'Einzelspiel', isSingleInstance: true, instances: [] }),
  ];

  it('collects every instance the player appears in', () => {
    const h = computePlayerHistory('Ju', games);
    expect(h.totalInstances).toBe(3); // allgemeinwissen/v1, allgemeinwissen/v2, musik/v1
    expect(h.gameCount).toBe(2); // allgemeinwissen + musik
    expect(h.entries.map(e => `${e.fileName}/${e.instance}`)).toEqual([
      'allgemeinwissen/v1',
      'allgemeinwissen/v2',
      'musik/v1',
    ]);
  });

  it('only keeps the sessions that include the player', () => {
    const h = computePlayerHistory('Ju', games);
    const v2 = h.entries.find(e => e.instance === 'v2');
    expect(v2?.sessions).toEqual(['An, Ju']); // 'Ko, Th' excluded
  });

  it('aggregates counts per game type with German labels, sorted desc', () => {
    const h = computePlayerHistory('Ju', games);
    expect(h.byType).toEqual([
      { type: 'simple-quiz', label: 'Klassisches Quiz', count: 2 },
      { type: 'audio-guess', label: 'Musikraten', count: 1 },
    ]);
  });

  it('is case-insensitive', () => {
    expect(computePlayerHistory('ju', games).totalInstances).toBe(3);
    expect(computePlayerHistory('  JU  ', games).totalInstances).toBe(3);
  });

  it('returns an empty history for an unknown player', () => {
    const h = computePlayerHistory('Zzz', games);
    expect(h).toEqual({ totalInstances: 0, gameCount: 0, gameshowCount: 0, byType: [], entries: [], groups: [] });
  });

  it('returns an empty history for a blank player name', () => {
    expect(computePlayerHistory('   ', games).totalInstances).toBe(0);
  });

  // Ju's played refs across the fixture: allgemeinwissen/v1, allgemeinwissen/v2, musik/v1.
  describe('grouping by gameshow', () => {
    it('groups played games under gameshows the player joined whose lineup contains them', () => {
      const gameshows: Record<string, GameshowConfig> = {
        pubquiz: { name: 'Pub Quiz', players: ['Ju', 'An'], gameOrder: ['allgemeinwissen/v1', 'musik/v1'] },
        sommer: { name: 'Sommerfest', players: ['Ju'], gameOrder: ['allgemeinwissen/v2'] },
      };
      const h = computePlayerHistory('Ju', games, gameshows);
      expect(h.groups.map(g => g.gameshowId)).toEqual(['pubquiz', 'sommer']);
      expect(h.groups[0].gameshowName).toBe('Pub Quiz');
      expect(h.groups[0].entries.map(e => e.ref)).toEqual(['allgemeinwissen/v1', 'musik/v1']);
      expect(h.groups[1].entries.map(e => e.ref)).toEqual(['allgemeinwissen/v2']);
    });

    it('ignores gameshows whose participant list excludes the player', () => {
      const gameshows: Record<string, GameshowConfig> = {
        winter: { name: 'Winter', players: ['St'], gameOrder: ['allgemeinwissen/v1'] },
      };
      const h = computePlayerHistory('Ju', games, gameshows);
      // No joined gameshow → everything falls into the catch-all group.
      expect(h.groups).toHaveLength(1);
      expect(h.groups[0].gameshowId).toBeNull();
      expect(h.groups[0].entries.map(e => e.ref)).toEqual([
        'allgemeinwissen/v1',
        'allgemeinwissen/v2',
        'musik/v1',
      ]);
    });

    it('puts games not covered by any joined gameshow into a trailing "Andere" group', () => {
      const gameshows: Record<string, GameshowConfig> = {
        pubquiz: { name: 'Pub Quiz', players: ['Ju'], gameOrder: ['allgemeinwissen/v1'] },
      };
      const h = computePlayerHistory('Ju', games, gameshows);
      expect(h.groups.map(g => g.gameshowId)).toEqual(['pubquiz', null]);
      expect(h.groups[0].entries.map(e => e.ref)).toEqual(['allgemeinwissen/v1']);
      expect(h.groups[1].entries.map(e => e.ref)).toEqual(['allgemeinwissen/v2', 'musik/v1']);
    });

    it('lists a game under every joined gameshow whose lineup contains it', () => {
      const gameshows: Record<string, GameshowConfig> = {
        a: { name: 'A', players: ['Ju'], gameOrder: ['allgemeinwissen/v1'] },
        b: { name: 'B', players: ['Ju'], gameOrder: ['allgemeinwissen/v1'] },
      };
      const h = computePlayerHistory('Ju', games, gameshows);
      expect(h.groups.find(g => g.gameshowId === 'a')?.entries.map(e => e.ref)).toEqual(['allgemeinwissen/v1']);
      expect(h.groups.find(g => g.gameshowId === 'b')?.entries.map(e => e.ref)).toEqual(['allgemeinwissen/v1']);
      // The other two played games are not in any lineup → Andere group.
      expect(h.groups.find(g => g.gameshowId === null)?.entries.map(e => e.ref)).toEqual([
        'allgemeinwissen/v2',
        'musik/v1',
      ]);
    });

    it('counts gameshows the player participates in, even with no played games from one', () => {
      const gameshows: Record<string, GameshowConfig> = {
        pubquiz: { name: 'Pub Quiz', players: ['Ju'], gameOrder: ['allgemeinwissen/v1'] },
        // Ju is a participant but played none of this gameshow's games → counts, no group.
        leer: { name: 'Leere Show', players: ['Ju'], gameOrder: ['bandle/v1'] },
        // Ju not a participant → not counted.
        winter: { name: 'Winter', players: ['St'], gameOrder: ['allgemeinwissen/v2'] },
      };
      const h = computePlayerHistory('Ju', games, gameshows);
      expect(h.gameshowCount).toBe(2);
      expect(h.groups.map(g => g.gameshowId)).toEqual(['pubquiz', null]); // 'leer' has no entries
    });

    it('matches the participant list case-insensitively', () => {
      const gameshows: Record<string, GameshowConfig> = {
        pubquiz: { name: 'Pub Quiz', players: ['  jU '], gameOrder: ['musik/v1'] },
      };
      const h = computePlayerHistory('Ju', games, gameshows);
      expect(h.groups[0].gameshowId).toBe('pubquiz');
      expect(h.groups[0].entries.map(e => e.ref)).toEqual(['musik/v1']);
    });

    it('defaults to a single catch-all group when no gameshows are provided', () => {
      const h = computePlayerHistory('Ju', games);
      expect(h.groups).toHaveLength(1);
      expect(h.groups[0].gameshowId).toBeNull();
      expect(h.groups[0].entries).toHaveLength(3);
    });
  });
});
