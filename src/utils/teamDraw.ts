/**
 * Pure logic behind the random team draw: the full shuffle, the incremental
 * reconcile that keeps a draw stable while names are added or removed, and
 * moving one player between teams. No React, no state — GameContext and
 * HomeScreen call these and dispatch the result. See specs/team-management.md
 * ("Verdeckte Auslosung").
 */
import type { TeamKey } from './teams';

/** Rosters for some or all teams; an omitted team is left untouched. */
export type RosterPatch = Partial<Record<TeamKey, string[]>>;

/** Current rosters, as read from TeamState (team 3/4 may be absent). */
export type Rosters = Partial<Record<TeamKey, string[] | undefined>>;

/**
 * Capitalize EVERY word ("john smith" → "John Smith"), not just the first —
 * and every part of a double name ("anna-lena" → "Anna-Lena"), which the
 * per-word rule used to turn into "Anna-lena".
 */
export function normalizePlayerName(name: string): string {
  const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);
  return name
    .trim()
    .split(/\s+/)
    .map(word => word.split('-').map(cap).join('-'))
    .join(' ');
}

/** Split a comma- or newline-separated list of names; trims and drops blanks. */
export function parsePlayerNames(text: string): string[] {
  return text.split(/[,\n]/).map(n => n.trim()).filter(Boolean);
}

/**
 * Shuffle the names (Fisher-Yates) and deal them round-robin over `keys`.
 * `sort(() => Math.random() - 0.5)` is not a uniform shuffle — the comparator
 * is inconsistent, so players near their original position stay there more
 * often than chance. Teams are drawn in front of an audience, so the draw has
 * to actually be fair. Returns an entry for every key (empty when no names).
 */
export function drawTeams(
  names: readonly string[],
  keys: readonly TeamKey[],
  random: () => number = Math.random,
): RosterPatch {
  const rosters: RosterPatch = {};
  if (keys.length === 0) return rosters;
  for (const key of keys) rosters[key] = [];
  const shuffled = names.map(normalizePlayerName);
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  shuffled.forEach((name, i) => {
    rosters[keys[i % keys.length]!]!.push(name);
  });
  return rosters;
}

const matchKey = (name: string) => normalizePlayerName(name).toLowerCase();

/**
 * Bring an existing draw in line with a new list of names WITHOUT reshuffling:
 * players still listed keep their team, players no longer listed drop out, and
 * each new name joins the currently smallest team (ties broken at random).
 * Names match after normalization, as a multiset — two "Anna" are two players.
 *
 * When every roster is empty there is nothing to keep, so this is a fresh
 * `drawTeams` (adding names one by one to the smallest team would always split
 * neighbours in the list, which is not a fair draw).
 *
 * Returns `null` when nothing changes, so callers never dispatch a no-op.
 */
export function reconcileDraw(
  rosters: Rosters,
  names: readonly string[],
  keys: readonly TeamKey[],
  random: () => number = Math.random,
): RosterPatch | null {
  if (keys.length === 0) return null;
  const current = keys.map(k => rosters[k] ?? []);
  if (current.every(r => r.length === 0)) {
    return names.length === 0 ? null : drawTeams(names, keys, random);
  }

  // How many of each name the new list wants.
  const wanted = new Map<string, number>();
  for (const name of names) {
    const k = matchKey(name);
    wanted.set(k, (wanted.get(k) ?? 0) + 1);
  }

  // Keep existing placements while the wanted count lasts.
  const next = current.map(roster =>
    roster.filter(name => {
      const k = matchKey(name);
      const left = wanted.get(k) ?? 0;
      if (left <= 0) return false;
      wanted.set(k, left - 1);
      return true;
    }),
  );

  // Whatever is still wanted is new — place it on the smallest team, in list order.
  for (const name of names) {
    const k = matchKey(name);
    const left = wanted.get(k) ?? 0;
    if (left <= 0) continue;
    wanted.set(k, left - 1);
    const min = Math.min(...next.map(r => r.length));
    const smallest = next.map((r, i) => (r.length === min ? i : -1)).filter(i => i >= 0);
    const pick = smallest[Math.floor(random() * smallest.length)]!;
    next[pick]!.push(normalizePlayerName(name));
  }

  const patch: RosterPatch = {};
  keys.forEach((key, i) => {
    if (next[i]!.join('\n') !== current[i]!.join('\n')) patch[key] = next[i]!;
  });
  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Move the first player named `name` from team `from` to the end of team `to`.
 * Found by name, not index, so a roster that changed in the meantime can never
 * move the wrong player. Returns `null` when the move is impossible.
 */
export function movePlayer(
  rosters: Rosters,
  from: TeamKey,
  name: string,
  to: TeamKey,
): RosterPatch | null {
  if (from === to) return null;
  const source = rosters[from] ?? [];
  const index = source.indexOf(name);
  if (index < 0) return null;
  return {
    [from]: source.filter((_, i) => i !== index),
    [to]: [...(rosters[to] ?? []), name],
  };
}

/** Every player currently in the draw, across `keys`. */
export function drawnPlayers(rosters: Rosters, keys: readonly TeamKey[]): string[] {
  return keys.flatMap(k => rosters[k] ?? []);
}

/**
 * Remove ONE player named `name` (normalized, case-insensitive) from whichever
 * team holds them first in `keys` order. Returns `null` when nobody matches.
 */
export function removePlayerByName(
  rosters: Rosters,
  keys: readonly TeamKey[],
  name: string,
): RosterPatch | null {
  const k = matchKey(name);
  for (const key of keys) {
    const roster = rosters[key] ?? [];
    const index = roster.findIndex(n => matchKey(n) === k);
    if (index >= 0) return { [key]: roster.filter((_, i) => i !== index) };
  }
  return null;
}
