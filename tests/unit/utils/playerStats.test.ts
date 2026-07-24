import { describe, it, expect } from 'vitest';
import {
  buildOverlapContext,
  classifyOverlap,
  classifyGameOverlap,
  refProvenance,
  playersWhoPlayed,
  instanceUsage,
  computePlayerHistory,
} from '@/utils/playerStats';
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

// Ordered timeline (config insertion order = oldest → newest). `active` marks
// "now": s0/s1/s2 have happened; `active`, `cur`, `later` are upcoming.
const gameshows: Record<string, GameshowConfig> = {
  s0: { name: 'S0', players: ['A', 'C'], gameOrder: ['gFull'] },
  s1: { name: 'S1', players: ['B'], gameOrder: ['gNone'] },
  s2: { name: 'S2', players: ['A', 'B'], gameOrder: ['gPartial'] },
  active: { name: 'Aktiv', players: ['A'], gameOrder: ['gEarlierUpcoming'] },
  cur: { name: 'Aktuell', players: ['A', 'C'], gameOrder: ['gCurrent', 'gEarlierUpcoming'] },
  later: { name: 'Später', players: ['A', 'D'], gameOrder: ['gCurrent'] },
};

describe('buildOverlapContext', () => {
  it('splits the timeline at the active show: played (< now) vs upcoming-earlier', () => {
    const ctx = buildOverlapContext(gameshows, 'cur', ['A', 'C'], 'active');
    expect(ctx.playedShows.map(s => s.name)).toEqual(['S0', 'S1', 'S2']); // before active
    expect(ctx.plannedShows.map(s => s.name)).toEqual(['Aktiv']); // active..before cur
    expect(ctx.currentPlayersLower).toEqual(['a', 'c']);
  });

  it('with no active show, nothing is upcoming (all before-cur = played)', () => {
    const ctx = buildOverlapContext(gameshows, 'cur', ['A', 'C']);
    expect(ctx.playedShows.map(s => s.name)).toEqual(['S0', 'S1', 'S2', 'Aktiv']);
    expect(ctx.plannedShows).toHaveLength(0);
  });
});

describe('classifyOverlap', () => {
  const ctx = buildOverlapContext(gameshows, 'cur', ['A', 'C'], 'active');

  it('full — every current player played it in a happened show', () => {
    expect(classifyOverlap('gFull', ctx)).toBe('full');
  });
  it('partial — some current players played it', () => {
    expect(classifyOverlap('gPartial', ctx)).toBe('partial');
  });
  it('planned — an upcoming show earlier than cur (sharing a player) has it queued', () => {
    expect(classifyOverlap('gEarlierUpcoming', ctx)).toBe('planned');
  });
  it('none — played in a happened show, but by nobody in the current roster', () => {
    expect(classifyOverlap('gNone', ctx)).toBe('none');
  });
  it('fresh — never played and not planned earlier', () => {
    expect(classifyOverlap('gUnknown', ctx)).toBe('fresh');
  });
  it('a game only in the current + a LATER show stays fresh (later show gets Eingeplant, not cur)', () => {
    // gCurrent is in cur and later; nothing earlier-upcoming has it → fresh for cur.
    expect(classifyOverlap('gCurrent', ctx)).toBe('fresh');
  });
});

describe('the "first upcoming show is normal, later ones are Eingeplant" rule', () => {
  // active + cur + later all upcoming; all use gShared; all share player A.
  const g: Record<string, GameshowConfig> = {
    past: { name: 'Past', players: ['Z'], gameOrder: [] },
    active: { name: 'Aktiv', players: ['A'], gameOrder: ['gShared'] },
    cur: { name: 'Aktuell', players: ['A'], gameOrder: ['gShared'] },
    later: { name: 'Später', players: ['A'], gameOrder: ['gShared'] },
  };
  it('the earliest upcoming show (active) shows fresh', () => {
    const ctx = buildOverlapContext(g, 'active', ['A'], 'active');
    expect(classifyOverlap('gShared', ctx)).toBe('fresh');
  });
  it('a later upcoming show (cur) shows planned/Eingeplant', () => {
    const ctx = buildOverlapContext(g, 'cur', ['A'], 'active');
    expect(classifyOverlap('gShared', ctx)).toBe('planned');
  });
  it('an even later show also shows planned', () => {
    const ctx = buildOverlapContext(g, 'later', ['A'], 'active');
    expect(classifyOverlap('gShared', ctx)).toBe('planned');
  });
});

describe('classifyGameOverlap', () => {
  const ctx = buildOverlapContext(gameshows, 'cur', ['A', 'C'], 'active');
  it('returns fresh when every instance is fresh', () => {
    expect(classifyGameOverlap(['gUnknown', 'gCurrent'], ctx)).toBe('fresh');
  });
  it('prefers "none" when some instance is still unplayed by the roster', () => {
    expect(classifyGameOverlap(['gFull', 'gUnknown'], ctx)).toBe('none');
  });
  it('surfaces planned when no instance is fresh/none', () => {
    expect(classifyGameOverlap(['gFull', 'gEarlierUpcoming'], ctx)).toBe('planned');
  });
  it('returns full only when every instance is fully played', () => {
    expect(classifyGameOverlap(['gFull'], ctx)).toBe('full');
  });
});

describe('refProvenance', () => {
  const ctx = buildOverlapContext(gameshows, 'cur', ['A', 'C'], 'active');
  it('lists happened shows that played a ref with the overlapping roster', () => {
    const p = refProvenance('gPartial', ctx, gameshows);
    expect(p.playedIn).toEqual([{ id: 's2', name: 'S2', overlapPlayers: ['A'] }]);
    expect(p.plannedIn).toEqual([]);
  });
  it('lists upcoming-earlier shows that plan a ref', () => {
    const p = refProvenance('gEarlierUpcoming', ctx, gameshows);
    expect(p.plannedIn).toEqual([{ id: 'active', name: 'Aktiv', overlapPlayers: ['A'] }]);
  });
  it('omits happened shows with no roster overlap', () => {
    const p = refProvenance('gNone', ctx, gameshows);
    expect(p.playedIn).toEqual([]);
  });
});

describe('playersWhoPlayed', () => {
  const ctx = buildOverlapContext(gameshows, 'cur', ['A', 'C'], 'active');
  it('names the current-roster members who already played it (for the tooltip)', () => {
    // gPartial is in s2 (played, players A+B); current roster A,C → only A knows it.
    expect(playersWhoPlayed('gPartial', ctx)).toEqual(['A']);
    // gFull is in s0 (players A,C) → both current players know it.
    expect(playersWhoPlayed('gFull', ctx)).toEqual(['A', 'C']);
  });
  it('returns empty for a game nobody in the roster played', () => {
    expect(playersWhoPlayed('gNone', ctx)).toEqual([]);
    expect(playersWhoPlayed('gUnknown', ctx)).toEqual([]);
  });
});

describe('instanceUsage', () => {
  it('lists every gameshow using a ref, flagging upcoming ones as planned', () => {
    const u = instanceUsage('gShared', {
      past: { name: 'Past', players: ['Z'], gameOrder: ['gShared'] },
      active: { name: 'Aktiv', players: ['A'], gameOrder: ['gShared'] },
      later: { name: 'Später', players: ['B'], gameOrder: ['gShared'] },
    }, 'active');
    expect(u).toEqual([
      { gameshowId: 'past', gameshowName: 'Past', players: ['Z'], planned: false },
      { gameshowId: 'active', gameshowName: 'Aktiv', players: ['A'], planned: true },
      { gameshowId: 'later', gameshowName: 'Später', players: ['B'], planned: true },
    ]);
  });
  it('returns empty when no gameshow uses the ref', () => {
    expect(instanceUsage('nope', gameshows, 'active')).toEqual([]);
  });
});

describe('computePlayerHistory', () => {
  const games: GameFileSummary[] = [
    game({ fileName: 'allgemeinwissen', type: 'simple-quiz', title: 'Allgemeinwissen', instances: ['v1', 'v2'] }),
    game({ fileName: 'musik', type: 'audio-guess', title: 'Musik der 90er', instances: ['v1'] }),
    game({ fileName: 'einzel', type: 'q1', title: 'Einzelspiel', isSingleInstance: true, instances: [] }),
  ];

  const shows: Record<string, GameshowConfig> = {
    pubquiz: { name: 'Pub Quiz', players: ['Ju', 'An'], gameOrder: ['allgemeinwissen/v1', 'musik/v1'] },
    sommer: { name: 'Sommerfest', players: ['Ju'], gameOrder: ['allgemeinwissen/v2', 'einzel'] },
    winter: { name: 'Winter', players: ['St'], gameOrder: ['allgemeinwissen/v1'] }, // Ju not a member
  };

  it('derives played history from gameshow membership (all games in a joined show)', () => {
    const h = computePlayerHistory('Ju', games, shows);
    expect(h.groups.map(g => g.gameshowId)).toEqual(['pubquiz', 'sommer']); // not 'winter'
    expect(h.gameshowCount).toBe(2);
    expect(h.playedCount).toBe(4); // v1, musik/v1, v2, einzel
    expect(h.gameCount).toBe(3); // allgemeinwissen, musik, einzel
  });

  it('resolves titles/types and instance keys from the games list', () => {
    const h = computePlayerHistory('Ju', games, shows);
    const first = h.groups[0]!.entries[0]!;
    expect(first).toMatchObject({ ref: 'allgemeinwissen/v1', fileName: 'allgemeinwissen', instance: 'v1', title: 'Allgemeinwissen', type: 'simple-quiz' });
    const single = h.groups[1]!.entries.find(e => e.ref === 'einzel')!;
    expect(single).toMatchObject({ fileName: 'einzel', instance: null, title: 'Einzelspiel', type: 'q1' });
  });

  it('marks groups at or after the reference index as planned', () => {
    // referenceIndex 1 → 'sommer' (index 1) and later are planned; 'pubquiz' (0) is played.
    const h = computePlayerHistory('Ju', games, shows, 1);
    const pub = h.groups.find(g => g.gameshowId === 'pubquiz')!;
    const som = h.groups.find(g => g.gameshowId === 'sommer')!;
    expect(pub.planned).toBe(false);
    expect(som.planned).toBe(true);
    expect(h.playedCount).toBe(2); // only pubquiz's two games
    expect(h.plannedCount).toBe(2); // sommer's two games
  });

  it('byType counts only played (non-planned) entries, sorted desc', () => {
    const h = computePlayerHistory('Ju', games, shows);
    expect(h.byType).toEqual([
      { type: 'simple-quiz', label: 'Klassisches Quiz', count: 2 },
      { type: 'audio-guess', label: 'Musikraten', count: 1 },
      { type: 'q1', label: h.byType.find(t => t.type === 'q1')!.label, count: 1 },
    ]);
  });

  it('is case-insensitive on the participant match', () => {
    const cs: Record<string, GameshowConfig> = { s: { name: 'S', players: ['  jU '], gameOrder: ['musik/v1'] } };
    expect(computePlayerHistory('Ju', games, cs).gameshowCount).toBe(1);
  });

  it('returns an empty history for an unknown or blank player', () => {
    expect(computePlayerHistory('Zzz', games, shows).groups).toHaveLength(0);
    expect(computePlayerHistory('   ', games, shows).groups).toHaveLength(0);
  });
});
