/**
 * Pure logic behind the random team draw: the full shuffle, the incremental
 * reconcile that keeps a draw stable while players are added or removed, and
 * moving one player between teams. No React, no state — GameContext and
 * HomeScreen call these and dispatch the result. See specs/team-management.md
 * ("Verdeckte Auslosung") and specs/players.md (player identity).
 */
import type { Player } from '../types/config';
import type { RosterPlayer } from '../types/game';
import { rosterPlayerOf, rosterSignature, samePlayer } from './playerNames';
import type { TeamKey } from './teams';

export { normalizePlayerName } from './playerNames';

/** Rosters for some or all teams; an omitted team is left untouched. */
export type RosterPatch = Partial<Record<TeamKey, RosterPlayer[]>>;

/** Current rosters, as read from TeamState (team 3/4 may be absent). */
export type Rosters = Partial<Record<TeamKey, RosterPlayer[] | undefined>>;

/**
 * Shuffle the players (Fisher-Yates) and deal them round-robin over `keys`.
 * `sort(() => Math.random() - 0.5)` is not a uniform shuffle — the comparator
 * is inconsistent, so players near their original position stay there more
 * often than chance. Teams are drawn in front of an audience, so the draw has
 * to actually be fair. Returns an entry for every key (empty when no players).
 */
export function drawTeams(
  players: readonly RosterPlayer[],
  keys: readonly TeamKey[],
  random: () => number = Math.random,
): RosterPatch {
  const rosters: RosterPatch = {};
  if (keys.length === 0) return rosters;
  for (const key of keys) rosters[key] = [];
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  shuffled.forEach((player, i) => {
    rosters[keys[i % keys.length]!]!.push(player);
  });
  return rosters;
}

/** The patch for every team in `keys` whose roster differs from `current`. */
function diffPatch(keys: readonly TeamKey[], current: RosterPlayer[][], next: RosterPlayer[][]): RosterPatch | null {
  const patch: RosterPatch = {};
  keys.forEach((key, i) => {
    if (rosterSignature(next[i]!) !== rosterSignature(current[i]!)) patch[key] = next[i]!;
  });
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Bring an existing draw in line with a new list of players WITHOUT
 * reshuffling: players still listed keep their team, players no longer listed
 * drop out, and each new player joins the currently smallest team (ties broken
 * at random). A kept player is replaced by the listed object, so a rename or a
 * registry id reaches the draw.
 *
 * When every roster is empty there is nothing to keep, so this is a fresh
 * `drawTeams` (adding players one by one to the smallest team would always
 * split neighbours in the list, which is not a fair draw).
 *
 * Returns `null` when nothing changes, so callers never dispatch a no-op.
 */
export function reconcileDraw(
  rosters: Rosters,
  players: readonly RosterPlayer[],
  keys: readonly TeamKey[],
  random: () => number = Math.random,
): RosterPatch | null {
  if (keys.length === 0) return null;
  const current = keys.map(k => rosters[k] ?? []);
  // Uniqueness is enforced where players are added (`checkAdditions`), not
  // here: a legacy draw may hold two "Anna", and neither may silently vanish.
  const wanted = [...players];
  if (current.every(r => r.length === 0)) {
    return wanted.length === 0 ? null : drawTeams(wanted, keys, random);
  }

  // Keep existing placements of players still wanted, swapping in the wanted object.
  const placed = new Set<number>();
  const next = current.map(roster => {
    const kept: RosterPlayer[] = [];
    for (const p of roster) {
      const i = wanted.findIndex((w, idx) => !placed.has(idx) && samePlayer(w, p));
      if (i < 0) continue;
      placed.add(i);
      kept.push(wanted[i]!);
    }
    return kept;
  });

  // Whatever is still wanted is new — place it on the smallest team, in list order.
  wanted.forEach((p, idx) => {
    if (placed.has(idx)) return;
    const min = Math.min(...next.map(r => r.length));
    const smallest = next.map((r, i) => (r.length === min ? i : -1)).filter(i => i >= 0);
    const pick = smallest[Math.floor(random() * smallest.length)]!;
    next[pick]!.push(p);
  });

  return diffPatch(keys, current, next);
}

/**
 * Move `player` from team `from` to the end of team `to`. Found by identity,
 * not index, so a roster that changed in the meantime can never move the
 * wrong player. Returns `null` when the move is impossible.
 */
export function movePlayer(
  rosters: Rosters,
  from: TeamKey,
  player: RosterPlayer,
  to: TeamKey,
): RosterPatch | null {
  if (from === to) return null;
  const source = rosters[from] ?? [];
  const index = source.findIndex(p => samePlayer(p, player));
  if (index < 0) return null;
  return {
    [from]: source.filter((_, i) => i !== index),
    [to]: [...(rosters[to] ?? []), source[index]!],
  };
}

/** Every player currently in the draw, across `keys`. */
export function drawnPlayers(rosters: Rosters, keys: readonly TeamKey[]): RosterPlayer[] {
  return keys.flatMap(k => rosters[k] ?? []);
}

/**
 * Remove `player` from whichever team holds them first in `keys` order.
 * Returns `null` when nobody matches.
 */
export function removePlayer(
  rosters: Rosters,
  keys: readonly TeamKey[],
  player: RosterPlayer,
): RosterPatch | null {
  for (const key of keys) {
    const roster = rosters[key] ?? [];
    const index = roster.findIndex(p => samePlayer(p, player));
    if (index >= 0) return { [key]: roster.filter((_, i) => i !== index) };
  }
  return null;
}

/**
 * Update the names (incl. nickname) of drawn registry players to match `players` (a rename in
 * the admin while the show runs), and give an id-less entry the id of the
 * listed player it matches (a live-added name once it reached the gameshow).
 * Other players are left alone. Returns `null` when nothing changes.
 */
export function applyPlayerRenames(
  rosters: Rosters,
  players: readonly Player[],
  keys: readonly TeamKey[],
): RosterPatch | null {
  const byId = new Map(players.map(p => [p.id, p]));
  const current = keys.map(k => rosters[k] ?? []);
  const next = current.map(roster =>
    roster.map(p => {
      // An entry without an id (a name typed on the show) takes the id of the
      // configured player with the same identity.
      const reg = p.id ? byId.get(p.id) : players.find(q => samePlayer(q, p));
      if (!reg) return p;
      const updated = rosterPlayerOf(reg);
      return rosterSignature([updated]) === rosterSignature([p]) ? p : updated;
    }),
  );
  return diffPatch(keys, current, next);
}
