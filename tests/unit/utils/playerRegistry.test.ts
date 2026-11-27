import { describe, it, expect, vi } from 'vitest';
import {
  applyLivePlayers,
  createPlayer,
  dropOrphanedPlayers,
  findNameConflict,
  playerById,
  playerLabel,
  playerNameError,
  renamePlayer,
  resolveGameshowPlayers,
  setPlayerDisabled,
  slugifyPlayerId,
  uniquePlayerId,
  validatePlayerRegistry,
} from '@/utils/playerRegistry';
import { player } from '../../_helpers/players';

const anna = player('Anna', 'Müller', 'anna-mueller');
const ben = player('Ben', 'Bauer', 'ben-bauer');

describe('ids', () => {
  it('slugifies with German umlauts transliterated and accents stripped', () => {
    expect(slugifyPlayerId('Jürgen', 'Groß')).toBe('juergen-gross');
    expect(slugifyPlayerId('Péter', 'Ödön')).toBe('peter-oedoen');
    expect(slugifyPlayerId('Anna-Lena', "O'Neil")).toBe('anna-lena-o-neil');
  });

  it('falls back when nothing slug-worthy is left', () => {
    expect(slugifyPlayerId('', '')).toBe('spieler');
    expect(slugifyPlayerId('★', '☆')).toBe('spieler');
  });

  it('uniquePlayerId appends the first free counter', () => {
    expect(uniquePlayerId('anna', new Set())).toBe('anna');
    expect(uniquePlayerId('anna', new Set(['anna']))).toBe('anna-2');
    expect(uniquePlayerId('anna', new Set(['anna', 'anna-2']))).toBe('anna-3');
  });
});

describe('lookup', () => {
  it('playerLabel prints the full name, or marks an unknown id', () => {
    const byId = playerById([anna]);
    expect(playerLabel('anna-mueller', byId)).toBe('Anna Müller');
    expect(playerLabel('ghost', byId)).toBe('ghost (unbekannt)');
  });

  it('findNameConflict ignores case and the excepted id', () => {
    expect(findNameConflict([anna], 'anna', 'MÜLLER')).toBe(anna);
    expect(findNameConflict([anna], 'anna', 'müller', 'anna-mueller')).toBeUndefined();
  });
});

describe('createPlayer / renamePlayer', () => {
  it('creates a player with a slug id and trimmed names', () => {
    const result = createPlayer([anna], '  Carla ', ' Weber  ');
    expect(result).toEqual({
      ok: true,
      player: { id: 'carla-weber', firstName: 'Carla', lastName: 'Weber', nickname: 'Carla' },
      registry: [anna, { id: 'carla-weber', firstName: 'Carla', lastName: 'Weber', nickname: 'Carla' }],
    });
  });

  it('stores a given nickname, trimmed', () => {
    const result = createPlayer([anna], 'Michael', 'Huber', '  Michi ');
    expect(result.ok && result.player).toEqual({ id: 'michael-huber', firstName: 'Michael', lastName: 'Huber', nickname: 'Michi' });
  });

  it('makes the id unique even when the name differs only in transliteration', () => {
    const result = createPlayer([anna], 'Anna', 'Mueller');
    expect(result.ok && result.player.id).toBe('anna-mueller-2');
  });

  it('needs a first name or a nickname, nothing more', () => {
    expect(createPlayer([], '', 'Müller')).toEqual({ ok: false, error: 'Vorname oder Spitzname angeben.' });
    expect(playerNameError([], ' ', ' ', undefined, ' ')).toBe('Vorname oder Spitzname angeben.');
    expect(createPlayer([], 'Anna', ' ')).toMatchObject({ ok: true, player: { id: 'anna', firstName: 'Anna', lastName: '', nickname: 'Anna' } });
  });

  it('creates a player with only a nickname (a live addition), unique by nickname', () => {
    const result = createPlayer([anna], '', '', ' Große Maus ');
    expect(result).toMatchObject({ ok: true, player: { id: 'grosse-maus', firstName: '', lastName: '', nickname: 'Große Maus' } });
    const registry = result.ok ? result.registry : [];
    expect(createPlayer(registry, '', '', 'große maus')).toEqual({ ok: false, error: '„große maus“ gibt es schon.' });
    // A named player with that nickname is someone else.
    expect(createPlayer(registry, 'Mia', 'Berg', 'Große Maus').ok).toBe(true);
  });

  it('refuses a full name that already exists', () => {
    expect(createPlayer([anna], 'anna', 'müller')).toEqual({ ok: false, error: '„anna müller“ gibt es schon.' });
  });

  it('renames in place and keeps the id', () => {
    const result = renamePlayer([anna, ben], 'anna-mueller', 'Anna', 'Meier');
    expect(result).toEqual({
      ok: true,
      player: { id: 'anna-mueller', firstName: 'Anna', lastName: 'Meier', nickname: 'Anna' },
      registry: [{ id: 'anna-mueller', firstName: 'Anna', lastName: 'Meier', nickname: 'Anna' }, ben],
    });
  });

  it('renames the nickname, and an emptied one falls back to the first name', () => {
    expect(renamePlayer([anna], 'anna-mueller', 'Anna', 'Müller', 'Ani').ok && renamePlayer([anna], 'anna-mueller', 'Anna', 'Müller', 'Ani'))
      .toMatchObject({ player: { nickname: 'Ani' } });
    expect(renamePlayer([anna], 'anna-mueller', 'Anna', 'Müller', '  ')).toMatchObject({ player: { nickname: 'Anna' } });
  });

  it('allows a rename that only changes case, refuses one onto another player', () => {
    expect(renamePlayer([anna], 'anna-mueller', 'ANNA', 'müller').ok).toBe(true);
    expect(renamePlayer([anna, ben], 'ben-bauer', 'Anna', 'Müller'))
      .toEqual({ ok: false, error: '„Anna Müller“ gibt es schon.' });
    expect(renamePlayer([anna], 'ghost', 'X', 'Y')).toEqual({ ok: false, error: 'Spieler nicht gefunden.' });
  });
});

describe('resolveGameshowPlayers', () => {
  it('resolves ids in gameshow order, skipping and reporting unknown ones, dropping repeats', () => {
    const onUnknown = vi.fn();
    expect(resolveGameshowPlayers([anna, ben], ['ben-bauer', 'ghost', 'anna-mueller', 'ben-bauer', 7], onUnknown))
      .toEqual([ben, anna]);
    expect(onUnknown).toHaveBeenCalledTimes(1);
    expect(onUnknown).toHaveBeenCalledWith('ghost');
  });

  it('tolerates a missing registry or list', () => {
    expect(resolveGameshowPlayers(undefined, ['anna-mueller'])).toEqual([]);
    expect(resolveGameshowPlayers([anna], undefined)).toEqual([]);
  });
});

describe('validatePlayerRegistry', () => {
  it('accepts a valid registry and gameshows', () => {
    expect(validatePlayerRegistry({
      players: [anna, ben],
      gameshows: { a: { players: ['anna-mueller', 'ben-bauer'] }, b: {} },
    })).toEqual({ errors: [], warnings: [] });
  });

  it('accepts a config without any players', () => {
    expect(validatePlayerRegistry({ gameshows: {} })).toEqual({ errors: [], warnings: [] });
  });

  it('rejects a registry that is not an array', () => {
    expect(validatePlayerRegistry({ players: {} }).errors).toEqual(['"players" must be an array of { id, firstName, lastName, nickname }']);
  });

  it('rejects entries that are not objects', () => {
    expect(validatePlayerRegistry({ players: ['Anna'] }).errors)
      .toEqual(['players[0]: must be an object { id, firstName, lastName, nickname }']);
  });

  it('rejects ids that are not slugs, and duplicate ids', () => {
    const errors = validatePlayerRegistry({
      players: [{ ...anna, id: 'Anna Müller' }, ben, { ...ben, firstName: 'Benno' }],
    }).errors;
    expect(errors).toContain('players[0]: "id" must be a lowercase slug like "anna-mueller" (got "Anna Müller")');
    expect(errors).toContain('players[2]: duplicate id "ben-bauer"');
  });

  it('rejects a blank nickname and names that are not strings', () => {
    const result = validatePlayerRegistry({ players: [{ id: 'x', firstName: ' ', lastName: 3 }] });
    expect(result.errors).toEqual([
      'Player "x": "lastName" must be a string',
      'Player "x": "nickname" must be a non-empty string',
    ]);
    expect(result.warnings).toEqual(['Player "x": "firstName" has extra whitespace']);
  });

  it('accepts players with only a nickname, but not two with the same one', () => {
    const kiki = { id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' };
    expect(validatePlayerRegistry({ players: [anna, kiki] })).toEqual({ errors: [], warnings: [] });
    expect(validatePlayerRegistry({ players: [kiki, { ...kiki, id: 'kiki-2', nickname: 'KIKI' }] }).errors)
      .toEqual(['Player "kiki-2": same nickname as "kiki" (KIKI) and no first name or surname — every player must be unique']);
  });

  it('rejects two players with the same full name, case-insensitively', () => {
    const errors = validatePlayerRegistry({ players: [anna, { id: 'anna-2', firstName: 'ANNA', lastName: 'müller', nickname: 'Anna' }] }).errors;
    expect(errors).toEqual(['Player "anna-2": same name as "anna-mueller" (ANNA müller) — every player must be unique']);
  });

  it('warns about extra whitespace', () => {
    const result = validatePlayerRegistry({ players: [{ id: 'anna', firstName: 'Anna ', lastName: 'Müller', nickname: 'Anna' }] });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual(['Player "anna": "firstName" has extra whitespace']);
  });

  it('rejects gameshow players that are not a list of known ids', () => {
    const errors = validatePlayerRegistry({
      players: [anna],
      gameshows: {
        notArray: { players: 'anna-mueller' },
        mixed: { players: [7, 'ghost', 'Raphi W.', 'anna-mueller', 'anna-mueller'] },
      },
    }).errors;
    expect(errors).toEqual([
      'Gameshow "notArray": "players" must be an array of player ids',
      'Gameshow "mixed" players[0]: must be a player id string',
      'Gameshow "mixed" players[1]: unknown player id "ghost"',
      'Gameshow "mixed" players[2]: "Raphi W." is not a player id — migrate the old names with: npx tsx scripts/migrate-players.ts <mapping.json>',
      'Gameshow "mixed" players[4]: "anna-mueller" is listed twice',
    ]);
  });
});

describe('applyLivePlayers', () => {
  const config = () => ({
    players: [anna, ben],
    activeGameshow: 'show',
    gameshows: { show: { players: ['anna-mueller'] }, other: { players: ['ben-bauer'] } },
  });

  it('appends a registry player to the active gameshow, once', () => {
    const c = config();
    expect(applyLivePlayers(c, { add: [{ id: 'ben-bauer' }, { id: 'anna-mueller' }] }))
      .toEqual({ ok: true, changed: true, players: [ben, anna] });
    expect(c.gameshows.show.players).toEqual(['anna-mueller', 'ben-bauer']);
    expect(c.gameshows.other.players).toEqual(['ben-bauer']);
  });

  it('creates a new name as a nickname-only registry player, or reuses the one that exists', () => {
    const c = config();
    const first = applyLivePlayers(c, { add: [{ nickname: 'Kiki' }] });
    expect(first).toEqual({ ok: true, changed: true, players: [{ id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' }] });
    expect(c.players.map(p => p.id)).toEqual(['anna-mueller', 'ben-bauer', 'kiki']);
    expect(c.gameshows.show.players).toEqual(['anna-mueller', 'kiki']);
    // Again (another show device, a retry): nothing new.
    expect(applyLivePlayers(c, { add: [{ nickname: 'kiki' }] })).toMatchObject({ ok: true, changed: false });
    expect(c.players).toHaveLength(3);
  });

  it('takes a removed id out of the gameshow, and out of the registry when it was their last one', () => {
    const c = config();
    expect(applyLivePlayers(c, { remove: ['anna-mueller', 'ghost'] })).toEqual({ ok: true, changed: true, players: [] });
    expect(c.gameshows.show.players).toEqual([]);
    expect(c.players).toEqual([ben]);
    expect(applyLivePlayers(c, { remove: ['anna-mueller'] })).toMatchObject({ changed: false });
  });

  it('keeps a removed player in the registry while another gameshow has them', () => {
    const c = config();
    c.gameshows.other.players = ['ben-bauer', 'anna-mueller'];
    applyLivePlayers(c, { remove: ['anna-mueller'] });
    expect(c.gameshows.show.players).toEqual([]);
    expect(c.players).toEqual([anna, ben]);
  });

  it('refuses an unknown id and a config without the active gameshow, changing nothing', () => {
    const c = config();
    expect(applyLivePlayers(c, { add: [{ nickname: 'Kiki' }, { id: 'ghost' }] }))
      .toEqual({ ok: false, error: 'Unbekannter Spieler "ghost".' });
    expect(c.players).toEqual([anna, ben]);
    expect(c.gameshows.show.players).toEqual(['anna-mueller']);
    expect(applyLivePlayers({ ...config(), activeGameshow: 'gone' }, { add: [{ id: 'ben-bauer' }] }))
      .toEqual({ ok: false, error: 'Keine aktive Gameshow.' });
  });
});

describe('dropOrphanedPlayers', () => {
  const carla = player('Carla', 'Conrad', 'carla');

  it('drops removed players who are in no gameshow any more', () => {
    const gameshows = { a: { players: ['ben-bauer'] }, b: {} };
    expect(dropOrphanedPlayers([anna, ben, carla], gameshows, ['anna-mueller', 'ben-bauer'])).toEqual([ben, carla]);
  });

  it('never touches players that were not removed, even when they are in no gameshow', () => {
    const registry = [anna, ben, carla];
    // Carla is in no gameshow, but nobody removed her: she stays — and nothing changes.
    expect(dropOrphanedPlayers(registry, { a: { players: ['anna-mueller'] } }, ['anna-mueller'])).toBe(registry);
    expect(dropOrphanedPlayers(registry, {}, [])).toBe(registry);
  });
});

describe('disabling players', () => {
  it('sets and clears the flag, leaving no flag on an enabled player', () => {
    const off = setPlayerDisabled([anna, ben], 'anna-mueller', true);
    expect(off).toEqual([{ ...anna, disabled: true }, ben]);
    expect(setPlayerDisabled(off, 'anna-mueller', false)).toEqual([anna, ben]);
    expect(setPlayerDisabled([anna], 'ghost', true)).toEqual([anna]);
  });

  it('keeps the flag through a rename and through the settings', () => {
    const off = { ...anna, disabled: true };
    expect(renamePlayer([off], 'anna-mueller', 'Anna', 'Meier')).toMatchObject({ player: { lastName: 'Meier', disabled: true } });
    expect(resolveGameshowPlayers([off, ben], ['anna-mueller', 'ben-bauer'])).toEqual([off, ben]);
  });

  it('validates the flag', () => {
    expect(validatePlayerRegistry({ players: [{ ...anna, disabled: true }] }).errors).toEqual([]);
    expect(validatePlayerRegistry({ players: [{ ...anna, disabled: 'ja' }] }).errors)
      .toEqual(['Player "anna-mueller": "disabled" must be true or false']);
  });
});

describe('applyLivePlayers with the player bin', () => {
  const kiki = { id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' };
  const carla = { ...player('Carla', 'Conrad', 'carla-conrad', 'Caro'), disabled: true };
  const config = () => ({
    players: [anna, ben],
    activeGameshow: 'show',
    gameshows: { show: { players: ['anna-mueller'] } as { players?: string[] } },
  });

  it('restores a binned player added by id, as they were', () => {
    const c = config();
    expect(applyLivePlayers(c, { add: [{ id: 'carla-conrad' }] }, [carla]))
      .toEqual({ ok: true, changed: true, players: [carla] });
    expect(c.players).toEqual([anna, ben, carla]);
    expect(c.gameshows.show.players).toEqual(['anna-mueller', 'carla-conrad']);
  });

  it('restores a binned player whose identity a typed name has, instead of creating a new one', () => {
    const c = config();
    expect(applyLivePlayers(c, { add: [{ nickname: 'kiki' }] }, [kiki])).toMatchObject({ players: [kiki] });
    expect(c.players).toEqual([anna, ben, kiki]);
  });

  it('never gives a new player a binned player\'s id', () => {
    const c = config();
    const result = applyLivePlayers(c, { add: [{ firstName: 'Kiki', lastName: '', nickname: 'Kiki' }] }, [kiki]);
    expect(result).toMatchObject({ ok: true, players: [{ id: 'kiki-2', firstName: 'Kiki' }] });
  });
});
