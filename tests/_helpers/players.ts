import type { RosterPlayer } from '@/types/game';
import type { Player } from '@/types/config';

/** A live roster player: `rp('Anna', 'Müller')`, `rp('Anna')`, `rp('Anna', 'Müller', 'anna-mueller')`. */
export function rp(firstName: string, lastName = '', id?: string): RosterPlayer {
  return id ? { firstName, lastName, id } : { firstName, lastName };
}

/**
 * A registry player; the id defaults to a simple slug of the name and the
 * nickname to the first name.
 */
export function player(firstName: string, lastName: string, id?: string, nickname = firstName): Player {
  return {
    id: id ?? `${firstName} ${lastName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    firstName,
    lastName,
    nickname,
  };
}

/** A configured player as it sits in a live roster (id + nickname). */
export function rpOf(p: Player): RosterPlayer {
  return { firstName: p.firstName, lastName: p.lastName, nickname: p.nickname, id: p.id };
}

/** First names only — `names('Anna', 'Ben')` → two surname-less roster players. */
export function names(...firstNames: string[]): RosterPlayer[] {
  return firstNames.map(n => rp(n));
}

/** A name typed on the show for someone not in the registry: kept as written, as the nickname. */
export function typed(nickname: string, id?: string): RosterPlayer {
  return id ? { firstName: '', lastName: '', nickname, id } : { firstName: '', lastName: '', nickname };
}
