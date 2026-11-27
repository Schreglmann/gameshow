/**
 * The local player bin (`players-bin.json`, gitignored): every player who
 * leaves the registry — deleted in the Spieler tab, or taken out of their last
 * gameshow — lands here, and comes back when someone adds them again by a name
 * typed in full. Pure functions; the file is read and written by
 * server/player-bin.ts. See specs/players.md ("Player bin").
 */
import type { Player } from '../types/config.js';
import { nameKey, normalizeSettingsPlayers } from './playerNames.js';

/** Binned players from untrusted file content (`{ players: [...] }`); unreadable entries are dropped. */
export function normalizeBin(raw: unknown): Player[] {
  const players = raw && typeof raw === 'object' ? (raw as { players?: unknown }).players : undefined;
  return normalizeSettingsPlayers(players);
}

/**
 * The bin after a registry change from `before` to `after`: players who left
 * the registry go in (replacing an older entry with their id), and a player
 * who is in the registry again — same id or same identity — comes out.
 * Returns `bin` itself when nothing changes.
 */
export function updateBin(bin: readonly Player[], before: readonly Player[], after: readonly Player[]): readonly Player[] {
  const afterIds = new Set(after.map(p => p.id));
  const afterKeys = new Set(after.map(nameKey));
  const removed = before.filter(p => !afterIds.has(p.id));
  const removedIds = new Set(removed.map(p => p.id));
  const kept = bin.filter(p => !afterIds.has(p.id) && !afterKeys.has(nameKey(p)) && !removedIds.has(p.id));
  const next = [...kept, ...removed];
  const same = next.length === bin.length && next.every((p, i) => p === bin[i]);
  return same ? bin : next;
}

/** The binned player with this identity (full name, or nickname for one without). */
export function findInBin(
  bin: readonly Player[],
  firstName: string,
  lastName: string,
  nickname: string,
): Player | undefined {
  const key = nameKey({ firstName, lastName, nickname });
  return bin.find(p => nameKey(p) === key);
}
