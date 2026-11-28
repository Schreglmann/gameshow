// Spec: specs/players.md ("Sync and migration")
import { describe, it, expect } from 'vitest';
import type { AppConfig } from '@/types/config';
import { legacyPlayerNames, mappingTemplate, migratePlayers, nicknameFromAlias, type PlayerMapping } from '../../../scripts/lib/migrate-players';
import { validatePlayerRegistry } from '@/utils/playerRegistry';

function config(shows: Record<string, string[]>, extra: Partial<AppConfig> = {}): AppConfig {
  return {
    activeGameshow: Object.keys(shows)[0]!,
    ...extra,
    gameshows: Object.fromEntries(
      Object.entries(shows).map(([key, players]) => [key, { name: key, gameOrder: [], players }]),
    ),
  };
}

const mapping: PlayerMapping = {
  players: [
    { firstName: 'Raphael', lastName: 'Weber', aliases: ['Raphi', 'Raphi W.'] },
    { firstName: 'Michael', lastName: 'Huber', aliases: ['Michi H.'] },
    { firstName: 'Michael', lastName: 'Pichler', aliases: ['Michi P.'] },
    { firstName: 'Jürgen', lastName: 'Groß', aliases: ['Jo'] },
  ],
};

describe('legacyPlayerNames / mappingTemplate', () => {
  it('lists every old name once, case-insensitively, sorted', () => {
    const c = config({ a: ['Raphi', 'Michi H.'], b: ['raphi', 'Jo', 'Michi P.'] });
    expect(legacyPlayerNames(c)).toEqual(['Jo', 'Michi H.', 'Michi P.', 'Raphi']);
  });

  it('ignores entries that are already registry ids', () => {
    const c = config({ a: ['anna-mueller', 'Jo'] }, { players: [{ id: 'anna-mueller', firstName: 'Anna', lastName: 'Müller' }] });
    expect(legacyPlayerNames(c)).toEqual(['Jo']);
  });

  it('splits each name at the first space for the template', () => {
    expect(mappingTemplate(config({ a: ['Tobi R.', 'Maus'] })).players).toEqual([
      { firstName: 'Maus', lastName: '', aliases: ['Maus'] },
      { firstName: 'Tobi', lastName: 'R.', aliases: ['Tobi R.'] },
    ]);
  });
});

describe('nicknameFromAlias', () => {
  it.each([
    ['Michi H.', 'Michi'],
    ['Fabian Sp.', 'Fabian'],
    ['  Tobi   R. ', 'Tobi'],
    ['Maus', 'Maus'],
    ['Anna-Lena', 'Anna-Lena'],
    ['Ö.', 'Ö.'],
    ['Big Mike', 'Big Mike'],
  ])('%s → %s', (alias, nickname) => {
    expect(nicknameFromAlias(alias)).toBe(nickname);
  });
});

describe('migratePlayers', () => {
  const legacy = config({
    show1: ['Raphi', 'Michi H.', 'Jo'],
    show2: ['Raphi W.', 'Michi P.', 'Raphi'],
  });

  it('builds the registry, rewrites gameshows to ids and merges aliases', () => {
    const { config: out, report } = migratePlayers(legacy, mapping);
    expect(report.errors).toEqual([]);
    // The first alias is the nickname, minus the old surname initial.
    expect(out.players).toEqual([
      { id: 'juergen-gross', firstName: 'Jürgen', lastName: 'Groß', nickname: 'Jo' },
      { id: 'michael-huber', firstName: 'Michael', lastName: 'Huber', nickname: 'Michi' },
      { id: 'michael-pichler', firstName: 'Michael', lastName: 'Pichler', nickname: 'Michi' },
      { id: 'raphael-weber', firstName: 'Raphael', lastName: 'Weber', nickname: 'Raphi' },
    ]);
    expect(out.gameshows.show1!.players).toEqual(['raphael-weber', 'michael-huber', 'juergen-gross']);
    // "Raphi W." and "Raphi" are one person — listed once, with a warning.
    expect(out.gameshows.show2!.players).toEqual(['raphael-weber', 'michael-pichler']);
    expect(report.warnings).toHaveLength(1);
    expect(report.changedShows).toEqual(['show1', 'show2']);
    expect(validatePlayerRegistry(out).errors).toEqual([]);
  });

  it('puts the registry right before gameshows in the file', () => {
    const { config: out } = migratePlayers(legacy, mapping);
    const keys = Object.keys(out);
    expect(keys.indexOf('players')).toBe(keys.indexOf('gameshows') - 1);
  });

  it('is idempotent: a second run changes nothing', () => {
    const first = migratePlayers(legacy, mapping).config;
    const { config: second, report } = migratePlayers(first, mapping);
    expect(report.errors).toEqual([]);
    expect(report.created).toEqual([]);
    expect(report.changedShows).toEqual([]);
    expect(second).toEqual(first);
  });

  it('reuses an existing registry player with the same full name', () => {
    const c = config({ a: ['Jo'] }, { players: [{ id: 'jg', firstName: 'jürgen', lastName: 'groß', nickname: 'Jo' }] });
    const { config: out, report } = migratePlayers(c, { players: [{ firstName: 'Jürgen', lastName: 'Groß', aliases: ['Jo'] }] });
    expect(report.created).toEqual([]);
    expect(out.gameshows.a!.players).toEqual(['jg']);
  });

  it('gives a colliding slug a suffix', () => {
    const c = config({ a: ['A', 'B'] }, { players: [{ id: 'anna-mueller', firstName: 'Anna', lastName: 'Mueller', nickname: 'Anna' }] });
    const { config: out, report } = migratePlayers(c, {
      players: [
        { firstName: 'Anna', lastName: 'Müller', aliases: ['A'] },
        { firstName: 'Anna', lastName: 'Mueller', aliases: ['B'] },
      ],
    });
    expect(report.errors).toEqual([]);
    expect(out.gameshows.a!.players).toEqual(['anna-mueller-2', 'anna-mueller']);
  });

  it.each([
    ['an old name is in no aliases list', { players: mapping.players.slice(0, 3) }, '"Jo" is not in any aliases list'],
    ['a surname is missing', { players: [...mapping.players.slice(0, 3), { firstName: 'Jo', lastName: '', aliases: ['Jo'] }] }, 'firstName and lastName are both required'],
    ['an alias belongs to two players', { players: [...mapping.players, { firstName: 'Jo', lastName: 'X', aliases: ['jo'] }] }, 'listed for more than one player'],
    ['a full name is listed twice', { players: [...mapping.players, { firstName: 'Michael', lastName: 'huber', aliases: [] }] }, 'listed twice in the mapping'],
  ])('refuses to write when %s', (_label, bad, message) => {
    const { config: out, report } = migratePlayers(legacy, bad as PlayerMapping);
    expect(report.errors.join('\n')).toContain(message);
    expect(out).toBe(legacy);
  });
});
