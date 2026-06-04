import type { GameFileSummary, GameType, GameshowConfig } from '@/types/config';
import { GAME_TYPE_INFO } from '@/data/gameTypeInfo';

/**
 * Whether `player` appears as a token in a `_players` session string.
 *
 * Sessions are comma-separated lists of player abbreviations (e.g. "St, Ju, Th").
 * Matching is case-insensitive and trimmed — identical to the overlap logic in
 * `GameshowEditor.computeOverlap`, kept in sync intentionally.
 */
export function sessionIncludesPlayer(session: string, playerLower: string): boolean {
  return session
    .split(',')
    .map(s => s.trim().toLowerCase())
    .some(token => token !== '' && token === playerLower);
}

export interface PlayerHistoryEntry {
  fileName: string;
  title: string;
  type: GameType;
  /** Instance key (e.g. "v1"). */
  instance: string;
  /** Full gameOrder ref (`fileName/instance`). */
  ref: string;
  /** The past `_players` sessions for this instance that include the player. */
  sessions: string[];
}

export interface PlayerHistoryGroup {
  /** Gameshow id, or null for the "Andere Spiele" catch-all group. */
  gameshowId: string | null;
  /** Gameshow display name, or null for the catch-all. */
  gameshowName: string | null;
  entries: PlayerHistoryEntry[];
}

export interface PlayerHistory {
  /** Number of distinct game instances the player has played. */
  totalInstances: number;
  /** Number of distinct game files (titles) the player has played. */
  gameCount: number;
  /** Number of gameshows the player is a participant of (listed in `players`). */
  gameshowCount: number;
  /** Per-game-type counts of played instances, sorted by count descending. */
  byType: Array<{ type: GameType; label: string; count: number }>;
  /** Flat list of every played instance, sorted by game title then instance. */
  entries: PlayerHistoryEntry[];
  /**
   * Played instances grouped by the gameshow the player was in — one group per
   * gameshow whose participant list includes the player AND whose `gameOrder`
   * contains the played instance. A played instance referenced by several such
   * gameshows appears in each. Instances not covered by any joined gameshow land
   * in a trailing catch-all group (`gameshowId: null`). See specs/player-stats.md.
   */
  groups: PlayerHistoryGroup[];
}

function playerInList(list: string[] | undefined, playerLower: string): boolean {
  return (list ?? []).some(p => p.trim().toLowerCase() === playerLower);
}

/**
 * Derive a player's "games already played" history from the `_players` data
 * carried by `GameFileSummary.instancePlayers`. Only multi-instance games carry
 * this data (the server does not collect it for single-instance games), so
 * single-instance games never contribute — see specs/player-stats.md.
 */
export function computePlayerHistory(
  player: string,
  games: GameFileSummary[],
  gameshows: Record<string, GameshowConfig> = {},
): PlayerHistory {
  const playerLower = player.trim().toLowerCase();
  const entries: PlayerHistoryEntry[] = [];

  if (playerLower) {
    for (const game of games) {
      if (!game.instancePlayers) continue;
      for (const [instance, sessions] of Object.entries(game.instancePlayers)) {
        const matching = sessions.filter(s => sessionIncludesPlayer(s, playerLower));
        if (matching.length > 0) {
          entries.push({
            fileName: game.fileName,
            title: game.title,
            type: game.type,
            instance,
            ref: `${game.fileName}/${instance}`,
            sessions: matching,
          });
        }
      }
    }
  }

  entries.sort((a, b) => a.title.localeCompare(b.title) || a.instance.localeCompare(b.instance));

  const typeCounts = new Map<GameType, number>();
  for (const e of entries) typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
  const byType = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, label: GAME_TYPE_INFO[type]?.label ?? type, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  const gameCount = new Set(entries.map(e => e.fileName)).size;

  // Group by gameshows the player joined (participant list match) whose lineup
  // contains the played instance. Config insertion order is preserved.
  const groups: PlayerHistoryGroup[] = [];
  const assigned = new Set<string>();
  let gameshowCount = 0;
  if (playerLower) {
    for (const [gsId, gs] of Object.entries(gameshows)) {
      if (!playerInList(gs.players, playerLower)) continue;
      gameshowCount++; // participated (listed), even if none of its games were played
      const orderSet = new Set(gs.gameOrder);
      const groupEntries = entries.filter(e => orderSet.has(e.ref));
      if (!groupEntries.length) continue;
      for (const e of groupEntries) assigned.add(e.ref);
      groups.push({ gameshowId: gsId, gameshowName: gs.name, entries: groupEntries });
    }
  }
  const leftover = entries.filter(e => !assigned.has(e.ref));
  if (leftover.length) groups.push({ gameshowId: null, gameshowName: null, entries: leftover });

  return { totalInstances: entries.length, gameCount, gameshowCount, byType, entries, groups };
}
