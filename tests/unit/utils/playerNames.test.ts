import { describe, it, expect } from 'vitest';
import {
  additionFeedback,
  adminLabel,
  checkAdditions,
  displayNames,
  filterSuggestions,
  fullName,
  knownPlayers,
  nameKey,
  normalizeRoster,
  normalizeSettingsPlayers,
  parsePlayerInput,
  parsePlayerList,
  parsePlayerNames,
  playerMatchesQuery,
  playerSuggestions,
  rosterDisplayNames,
  rosterSignature,
  samePlayer,
  toRosterPlayer,
} from '@/utils/playerNames';
import type { TeamState } from '@/types/game';
import { names, player, rp, rpOf, typed } from '../../_helpers/players';

describe('displayNames', () => {
  it('shows the nickname, not the first name', () => {
    expect(displayNames([rp('Marlene', 'Auer'), { firstName: 'Marlene', lastName: 'Auer', nickname: 'Maus' }].slice(1)))
      .toEqual(['Maus']);
  });

  it('adds the first surname letter when two share a nickname', () => {
    const michis = [
      { firstName: 'Michael', lastName: 'Huber', nickname: 'Michi' },
      { firstName: 'Michaela', lastName: 'Pichler', nickname: 'michi' },
      { firstName: 'Michi', lastName: 'Kurz' },
    ];
    expect(displayNames(michis)).toEqual(['Michi H.', 'michi P.', 'Michi K.']);
  });

  it('does not group by first name when the nicknames differ', () => {
    expect(displayNames([
      { firstName: 'Michael', lastName: 'Huber', nickname: 'Michi' },
      { firstName: 'Michael', lastName: 'Pichler', nickname: 'Mike' },
    ])).toEqual(['Michi', 'Mike']);
  });

  it('tells a shared nickname and surname apart by first name', () => {
    expect(displayNames([
      { firstName: 'Michael', lastName: 'Huber', nickname: 'Michi' },
      { firstName: 'Michaela', lastName: 'Huber', nickname: 'Michi' },
    ])).toEqual(['Michi (Michael)', 'Michi (Michaela)']);
  });

  it('shows only the first name when it is unique', () => {
    expect(displayNames([rp('Anna', 'Müller')])).toEqual(['Anna']);
    expect(displayNames([rp('Anna', 'Müller'), rp('Ben', 'Huber')])).toEqual(['Anna', 'Ben']);
  });

  it('adds the surname initial when two share a first name', () => {
    expect(displayNames([rp('Michi', 'Huber'), rp('Michi', 'Pichler')])).toEqual(['Michi H.', 'Michi P.']);
  });

  it('adds as many letters as it takes', () => {
    expect(displayNames([rp('Johannes', 'Kaiser'), rp('Johannes', 'Koller')])).toEqual(['Johannes Ka.', 'Johannes Ko.']);
  });

  it('shows the whole surname, without a dot, when only that tells them apart', () => {
    expect(displayNames([rp('Anna', 'Huber'), rp('Anna', 'Huberty')])).toEqual(['Anna Huber', 'Anna Hubert.']);
  });

  it('handles a player without a surname next to one with', () => {
    expect(displayNames([rp('Anna'), rp('Anna', 'Müller')])).toEqual(['Anna', 'Anna M.']);
  });

  it('groups first names that differ only by case', () => {
    expect(displayNames([rp('michi', 'Huber'), rp('Michi', 'Pichler')])).toEqual(['michi H.', 'Michi P.']);
  });

  it('counts an umlaut as one letter', () => {
    expect(displayNames([rp('Mesut', 'Özil'), rp('Mesut', 'Oswald')])).toEqual(['Mesut Ö.', 'Mesut O.']);
    expect(displayNames([rp('Jo', 'Ölz'), rp('Jo', 'Öhler')])).toEqual(['Jo Öl.', 'Jo Öh.']);
  });

  it('adds no second dot to a legacy initial', () => {
    expect(displayNames([rp('Raphi', 'W.'), rp('Raphi', 'Z.')])).toEqual(['Raphi W.', 'Raphi Z.']);
  });

  it('never ends a prefix at a space or a hyphen', () => {
    expect(displayNames([rp('Lisa', 'van Berg'), rp('Lisa', 'van Dyk')])).toEqual(['Lisa van B.', 'Lisa van D.']);
    expect(displayNames([rp('Jan', 'Müller-Lüdenscheidt'), rp('Jan', 'Müller-Wohlfahrt')]))
      .toEqual(['Jan Müller-L.', 'Jan Müller-W.']);
  });

  it('shows the full name for legacy duplicates with the same surname', () => {
    expect(displayNames([rp('Anna', 'Huber'), rp('Anna', 'Huber')])).toEqual(['Anna Huber', 'Anna Huber']);
    expect(displayNames(names('Anna', 'Anna'))).toEqual(['Anna', 'Anna']);
  });

  it('only disambiguates within a first-name group', () => {
    expect(displayNames([rp('Michi', 'Huber'), rp('Anna', 'Huber'), rp('Michi', 'Hammer')]))
      .toEqual(['Michi Hu.', 'Anna', 'Michi Ha.']);
  });
});

describe('rosterDisplayNames', () => {
  it('labels over the whole draw and lines up with each roster by index', () => {
    const teams = {
      team1: [rp('Michi', 'Huber'), rp('Anna')],
      team2: [rp('Ben'), rp('Michi', 'Pichler')],
      team3: [rp('Carla')],
      team1Points: 0,
      team2Points: 0,
      team1JokersUsed: [],
      team2JokersUsed: [],
    } as TeamState;
    expect(rosterDisplayNames(teams, ['team1', 'team2'])).toEqual({
      team1: ['Michi H.', 'Anna'],
      team2: ['Ben', 'Michi P.'],
    });
    // A team outside `keys` doesn't take part.
    expect(rosterDisplayNames(teams, ['team1', 'team2', 'team3']).team3).toEqual(['Carla']);
  });
});

describe('identity', () => {
  it('nameKey ignores case and extra whitespace', () => {
    expect(nameKey(rp(' anna ', 'van  der Berg'))).toBe(nameKey(rp('Anna', 'Van Der Berg')));
  });

  it('samePlayer compares ids when both have one, otherwise names', () => {
    expect(samePlayer(rp('Anna', 'Müller', 'a'), rp('Anna', 'Meier', 'a'))).toBe(true);
    expect(samePlayer(rp('Anna', 'Müller', 'a'), rp('Anna', 'Müller', 'b'))).toBe(false);
    expect(samePlayer(rp('Anna', 'Müller', 'a'), rp('anna', 'müller'))).toBe(true);
    expect(samePlayer(rp('Anna'), rp('Anna', 'Müller'))).toBe(false);
  });

  it('fullName drops a missing surname', () => {
    expect(fullName(rp('Anna', 'Müller'))).toBe('Anna Müller');
    expect(fullName(rp('Anna'))).toBe('Anna');
  });

  it('rosterSignature does not depend on key order', () => {
    const a = [{ firstName: 'Anna', lastName: 'M', id: 'x' }];
    const b = [{ id: 'x', lastName: 'M', firstName: 'Anna' }];
    expect(rosterSignature(a)).toBe(rosterSignature(b));
    expect(rosterSignature(a)).not.toBe(rosterSignature([rp('Anna', 'M')]));
  });
});

describe('legacy conversion', () => {
  it('converts a name string: first word → first name, rest → surname, no id', () => {
    expect(toRosterPlayer('Anna')).toEqual({ firstName: 'Anna', lastName: '' });
    expect(toRosterPlayer('  Raphi   W. ')).toEqual({ firstName: 'Raphi', lastName: 'W.' });
    expect(toRosterPlayer('Anna Maria Müller')).toEqual({ firstName: 'Anna', lastName: 'Maria Müller' });
  });

  it('keeps only the known fields of an object, in a fixed order', () => {
    expect(toRosterPlayer({ id: 'a', lastName: ' Müller ', firstName: 'Anna', extra: 1 }))
      .toEqual({ firstName: 'Anna', lastName: 'Müller', id: 'a' });
    expect(toRosterPlayer({ firstName: 'Anna', id: '' })).toEqual({ firstName: 'Anna', lastName: '' });
  });

  it('rejects entries without a first name', () => {
    expect(toRosterPlayer('')).toBeNull();
    expect(toRosterPlayer({ lastName: 'Müller' })).toBeNull();
    expect(toRosterPlayer(42)).toBeNull();
    expect(toRosterPlayer(null)).toBeNull();
  });

  it('normalizeRoster converts strings, drops junk and keeps duplicates', () => {
    expect(normalizeRoster(['Anna', 'Anna', 7, { firstName: 'Ben', lastName: 'Bauer' }]))
      .toEqual([rp('Anna'), rp('Anna'), rp('Ben', 'Bauer')]);
    expect(normalizeRoster('Anna')).toEqual([]);
  });

  it('normalizeSettingsPlayers keeps only registry entries with an id', () => {
    expect(normalizeSettingsPlayers([{ id: 'a', firstName: 'Anna', lastName: 'M', nickname: 'Ani' }, 'Ben', { firstName: 'Carla' }]))
      .toEqual([{ id: 'a', firstName: 'Anna', lastName: 'M', nickname: 'Ani' }]);
    // A server without nicknames: the first name stands in.
    expect(normalizeSettingsPlayers([{ id: 'b', firstName: 'Ben', lastName: 'B' }]))
      .toEqual([{ id: 'b', firstName: 'Ben', lastName: 'B', nickname: 'Ben' }]);
    expect(normalizeSettingsPlayers(undefined)).toEqual([]);
  });
});

describe('parsing input', () => {
  it('keeps a new name as written, as the nickname', () => {
    expect(parsePlayerInput('  anna  müller ')).toEqual(typed('anna müller'));
    expect(parsePlayerInput('Anna')).toEqual(typed('Anna'));
    expect(parsePlayerInput('   ')).toBeNull();
  });

  it('takes over the registry player when the full name or the admin label matches', () => {
    const known = [player('Anna', 'Müller', 'anna-mueller', 'Ani')];
    expect(parsePlayerInput('ANNA müller', known))
      .toEqual({ firstName: 'Anna', lastName: 'Müller', nickname: 'Ani', id: 'anna-mueller' });
    expect(parsePlayerInput('Anna „Ani“ Müller', known)).toEqual(rpOf(known[0]!));
    // A first name alone is not the player.
    expect(parsePlayerInput('Anna', known)).toEqual(typed('Anna'));
  });

  it('takes over the one registry player whose nickname it is', () => {
    const maus = player('Marlene', 'Auer', 'marlene-auer', 'Maus');
    expect(parsePlayerInput('maus', [maus])).toEqual(rpOf(maus));
    const bigMaus = player('Mia', 'Berg', 'mia-berg', 'Große Maus');
    expect(parsePlayerInput('große maus', [maus, bigMaus])).toEqual(rpOf(bigMaus));
    // A registry player with only a nickname.
    const kiki = { id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' };
    expect(parsePlayerInput('KIKI', [kiki])).toEqual(typed('Kiki', 'kiki'));
  });

  it('refuses to guess between registry players who share a nickname', () => {
    const michis = [player('Michael', 'Huber', 'mh', 'Michi'), player('Michaela', 'Pichler', 'mp', 'Michi')];
    expect(parsePlayerInput('Michi', michis)).toBeNull();
    expect(parsePlayerNames('Anna, michi', michis)).toEqual({ players: [typed('Anna')], ambiguous: ['michi'] });
  });

  it('parsePlayerList splits on commas and newlines and drops blanks', () => {
    expect(parsePlayerList(' anna, ben bauer\ncarla ,, \n')).toEqual([typed('anna'), typed('ben bauer'), typed('carla')]);
  });

  it('knownPlayers adds the binned players last, marked disabled (full name only)', () => {
    const anna = player('Anna', 'Müller');
    const gone = player('Gerd', 'Gone', 'gerd');
    const known = knownPlayers({ players: [], registry: [anna], binned: [gone, anna] });
    expect(known).toEqual([anna, { ...gone, disabled: true }]);
    expect(playerSuggestions(known, []).find(i => i.id === 'gerd')).toEqual({ id: 'gerd', label: 'Gerd Gone', fullMatch: ['Gerd', 'Gone', 'Gerd Gone'] });
  });

  it('knownPlayers lists the gameshow players first, then the rest of the registry once', () => {
    const anna = player('Anna', 'Müller');
    const ben = player('Ben', 'Bauer');
    expect(knownPlayers({ players: [ben], registry: [anna, ben] })).toEqual([ben, anna]);
    expect(knownPlayers({ players: [ben] })).toEqual([ben]);
  });
});

describe('players with only a nickname', () => {
  const kiki = typed('Kiki');

  it('are identified by the nickname', () => {
    expect(nameKey(kiki)).toBe('~kiki');
    expect(samePlayer(kiki, typed('kiki'))).toBe(true);
    expect(samePlayer(kiki, typed('Koko'))).toBe(false);
    // Two different name-less players are not the same just because both lack a name.
    expect(nameKey(typed('A'))).not.toBe(nameKey(typed('B')));
  });

  it('are the player whose full name the typed text is', () => {
    expect(samePlayer(typed('anna müller'), rp('Anna', 'Müller'))).toBe(true);
    expect(samePlayer(rp('Anna', 'Müller', 'anna-mueller'), typed('Anna Müller'))).toBe(true);
    expect(samePlayer(typed('Anna'), rp('Anna', 'Müller'))).toBe(false);
  });

  it('show the nickname everywhere', () => {
    expect(fullName(kiki)).toBe('Kiki');
    expect(adminLabel(kiki)).toBe('Kiki');
    expect(displayNames([kiki, rp('Anna')])).toEqual(['Kiki', 'Anna']);
  });

  it('survive normalizing untrusted roster data', () => {
    expect(toRosterPlayer({ firstName: '', lastName: '', nickname: ' Kiki ', id: 'kiki' })).toEqual(typed('Kiki', 'kiki'));
    expect(toRosterPlayer({ firstName: '', lastName: '', nickname: '' })).toBeNull();
    expect(normalizeSettingsPlayers([{ id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' }]))
      .toEqual([{ id: 'kiki', firstName: '', lastName: '', nickname: 'Kiki' }]);
  });
});

describe('autocomplete', () => {
  const registry = [
    player('Michael', 'Huber', 'mh', 'Michi'),
    player('Michaela', 'Pichler', 'mp', 'Michi'),
    player('Anna', 'Müller', 'am'),
    player('Johanna', 'Berger', 'jb'),
  ];

  it('suggests registry players not in the draw, labelled with full name and nickname', () => {
    expect(playerSuggestions(registry, [rpOf(registry[0]!), typed('Anna Müller')])).toEqual([
      { id: 'jb', label: 'Johanna Berger' },
      { id: 'mp', label: 'Michaela „Michi“ Pichler' },
    ]);
  });

  it('filters by any part of the label, best match first', () => {
    const items = playerSuggestions(registry, []);
    expect(filterSuggestions(items, 'mich').map(i => i.id)).toEqual(['mh', 'mp']);
    // A word start ranks before a match inside a word.
    expect(filterSuggestions(items, 'an').map(i => i.id)).toEqual(['am', 'jb']);
    expect(filterSuggestions(items, 'huber').map(i => i.id)).toEqual(['mh']);
    expect(filterSuggestions(items, '  ')).toEqual([]);
    expect(filterSuggestions(items, 'a', 2)).toHaveLength(2);
  });
});

describe('checkAdditions / additionFeedback', () => {
  it('accepts new players without feedback', () => {
    const result = checkAdditions(names('Anna'), [rp('Ben')]);
    expect(result).toEqual({ accepted: [rp('Ben')], duplicates: [], clashes: [] });
    expect(additionFeedback(result)).toBeNull();
  });

  it('refuses a player already in the draw', () => {
    const result = checkAdditions([rp('Anna', 'Müller')], [rp('anna', 'müller')]);
    expect(result.accepted).toEqual([]);
    expect(result.duplicates).toEqual([rp('anna', 'müller')]);
    expect(additionFeedback(result)).toBe('„anna müller“ ist schon dabei.');
  });

  it('refuses a duplicate within the same batch', () => {
    const result = checkAdditions([], [rp('Ben'), rp('Carla'), rp('Ben'), rp('Carla')]);
    expect(result.accepted).toEqual([rp('Ben'), rp('Carla')]);
    expect(additionFeedback(result)).toBe('Schon dabei: Ben, Carla.');
  });

  it('accepts a surname-less player whose first name is taken, but reports it', () => {
    const result = checkAdditions([rp('Anna', 'Müller')], [rp('Anna')]);
    expect(result.accepted).toEqual([rp('Anna')]);
    expect(result.clashes).toEqual([rp('Anna')]);
    expect(additionFeedback(result)).toBe('„Anna“ gibt es schon – Vor- und Nachnamen im Admin ergänzen, damit sie unterscheidbar sind.');
  });

  it('reports a nickname several registry players share', () => {
    expect(additionFeedback({ accepted: [], duplicates: [], clashes: [], ambiguous: ['Michi'] }))
      .toBe('„Michi“ gibt es mehrmals – bitte aus der Liste auswählen.');
  });

  it('does not report a clash when the new player has a surname', () => {
    expect(checkAdditions([rp('Anna')], [rp('Anna', 'Müller')]).clashes).toEqual([]);
  });
});

describe('disabled players', () => {
  const michi = player('Michael', 'Huber', 'mh', 'Michi');
  const old = { ...player('Johanna', 'Berger', 'jb', 'Jo'), disabled: true };

  it('are offered only for one of their names typed in full', () => {
    expect(playerMatchesQuery(old, 'joh')).toBe(false);
    expect(playerMatchesQuery(old, 'Berg')).toBe(false);
    for (const q of ['johanna', ' BERGER ', 'jo', 'Johanna Berger', 'Johanna „Jo“ Berger']) {
      expect(playerMatchesQuery(old, q)).toBe(true);
    }
    // Nothing typed: an active player is listed, a disabled one is not.
    expect(playerMatchesQuery(michi, '')).toBe(true);
    expect(playerMatchesQuery(old, '')).toBe(false);
    expect(playerMatchesQuery(michi, 'hub')).toBe(true);
  });

  it('carry their names for the show and GM lists, which filter on them', () => {
    const items = playerSuggestions([michi, old], []);
    expect(items).toEqual([
      { id: 'jb', label: 'Johanna „Jo“ Berger', fullMatch: ['Johanna', 'Berger', 'Jo', 'Johanna Berger', 'Johanna „Jo“ Berger'] },
      { id: 'mh', label: 'Michael „Michi“ Huber' },
    ]);
    expect(filterSuggestions(items, 'er').map(i => i.id)).toEqual(['mh']);
    expect(filterSuggestions(items, 'berger').map(i => i.id)).toEqual(['jb']);
    expect(filterSuggestions(items, 'jo').map(i => i.id)).toEqual(['jb']);
  });

  it('still resolve when typed, but a nickname shared with an active player means the active one', () => {
    expect(parsePlayerInput('johanna berger', [old])).toEqual(rpOf(old));
    const oldMichi = { ...player('Michaela', 'Pichler', 'mp', 'Michi'), disabled: true };
    expect(parsePlayerInput('Michi', [michi, oldMichi])).toEqual(rpOf(michi));
    expect(parsePlayerInput('Michi', [oldMichi])).toEqual(rpOf(oldMichi));
  });

  it('keep the flag through the settings', () => {
    expect(normalizeSettingsPlayers([{ ...old }, { ...michi, disabled: 'yes' }]))
      .toEqual([old, michi]);
  });
});
