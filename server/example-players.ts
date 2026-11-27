/**
 * Example players for a fresh clone: the default config (server/clean-install.ts)
 * and "Beispiele erstellen" / `npm run fixtures` (server/example-games.ts) seed
 * them into an EMPTY registry, so the draw, the nickname rule and the
 * autocomplete can be tried without real names. Made-up people only.
 * See specs/example-games.md and specs/players.md.
 */
import type { Player } from '../src/types/config.js';

export const EXAMPLE_PLAYERS: readonly Player[] = [
  // Two "Michi" and two "Jo": the show tells them apart by surname ("Michi H." / "Michi P.", "Jo Ka." / "Jo Ko.").
  { id: 'michael-huber', firstName: 'Michael', lastName: 'Huber', nickname: 'Michi' },
  { id: 'michaela-pichler', firstName: 'Michaela', lastName: 'Pichler', nickname: 'Michi' },
  { id: 'johannes-kaiser', firstName: 'Johannes', lastName: 'Kaiser', nickname: 'Jo' },
  { id: 'johanna-koller', firstName: 'Johanna', lastName: 'Koller', nickname: 'Jo' },
  { id: 'anna-berger', firstName: 'Anna', lastName: 'Berger', nickname: 'Anna' },
  { id: 'ben-lechner', firstName: 'Ben', lastName: 'Lechner', nickname: 'Ben' },
  // Added during a show: only the nickname ("Name fehlt" in the Spieler tab).
  { id: 'maus', firstName: '', lastName: '', nickname: 'Maus' },
  // Not in the Beispiele gameshow: one to pick from the autocomplete, one disabled
  // (suggested only for a name typed in full).
  { id: 'clara-weiss', firstName: 'Clara', lastName: 'Weiß', nickname: 'Clara' },
  { id: 'felix-brandl', firstName: 'Felix', lastName: 'Brandl', nickname: 'Felix', disabled: true },
];

/** The example players the Beispiele gameshow lists. */
export const EXAMPLE_GAMESHOW_PLAYER_IDS: readonly string[] = [
  'michael-huber', 'michaela-pichler', 'johannes-kaiser', 'johanna-koller', 'anna-berger', 'ben-lechner', 'maus',
];

/** Fresh copies, so a caller that mutates the config can't change the constants. */
export function examplePlayers(): Player[] {
  return EXAMPLE_PLAYERS.map(p => ({ ...p }));
}

export function exampleGameshowPlayerIds(): string[] {
  return [...EXAMPLE_GAMESHOW_PLAYER_IDS];
}
