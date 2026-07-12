import type { GameFileSummary, GameType, GameshowConfig } from '@/types/config';
import { GAME_TYPE_INFO } from '@/data/gameTypeInfo';

/**
 * Planning / played-history derivation.
 *
 * There is no manually-maintained per-game player log any more. "Player X has
 * played instance Y" is DERIVED from the gameshow configs: a player is part of
 * a gameshow (`GameshowConfig.players`) iff they played every game in that
 * gameshow's `gameOrder`.
 *
 * Time is modelled by config order: `Object.keys(gameshows)` runs oldest →
 * newest, and the ACTIVE gameshow marks "now" — gameshows before it have
 * happened (already played), the active one and everything after are upcoming.
 *
 * When viewing gameshow G:
 *   - `playedShows` = shows before G that have already happened (index < min(G, active)).
 *   - `plannedShows` = upcoming shows that are earlier in the list than G
 *     (active ≤ index < G). A game queued in one of these — sharing a player —
 *     is "planned" (Eingeplant): the roster hasn't played it yet, but it is
 *     already scheduled in an earlier upcoming show. This is why, when two
 *     upcoming shows use the same game, the FIRST stays Neu/Ungespielt and the
 *     LATER one(s) show Eingeplant.
 * G itself and every show after G are excluded. See specs/game-planning.md.
 */

export type Overlap = 'fresh' | 'none' | 'planned' | 'partial' | 'full';

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Precomputed split of the gameshow timeline relative to the gameshow being
 * viewed. `playedShows` have already happened; `plannedShows` are upcoming shows
 * scheduled earlier in the list than the current one. The current gameshow and
 * everything after it are in neither.
 */
export interface OverlapContext {
  playedShows: GameshowConfig[];
  plannedShows: GameshowConfig[];
  /** Current gameshow roster, normalised (trimmed + lower-cased, blanks dropped). */
  currentPlayersLower: string[];
}

export function buildOverlapContext(
  gameshows: Record<string, GameshowConfig>,
  currentId: string,
  currentPlayers: string[] = [],
  activeId?: string,
): OverlapContext {
  const ids = Object.keys(gameshows);
  const rawCur = ids.indexOf(currentId);
  const cur = rawCur < 0 ? ids.length : rawCur; // unknown id → treat as newest
  const rawActive = activeId ? ids.indexOf(activeId) : -1;
  const active = rawActive < 0 ? ids.length : rawActive; // no/unknown active → nothing is "upcoming"
  const playedEnd = Math.min(cur, active);
  return {
    playedShows: ids.slice(0, playedEnd).map(k => gameshows[k]!),
    plannedShows: active < cur ? ids.slice(active, cur).map(k => gameshows[k]!) : [],
    currentPlayersLower: currentPlayers.map(norm).filter(Boolean),
  };
}

/**
 * Classify a single game-order ref (`fileName` or `fileName/instance`) against
 * the current roster + timeline. See the module docstring for the model.
 */
export function classifyOverlap(ref: string, ctx: OverlapContext): Overlap {
  const P = ctx.currentPlayersLower;
  const played = new Set<string>();
  let everPlayed = false;
  for (const gs of ctx.playedShows) {
    if (!gs.gameOrder.includes(ref)) continue;
    everPlayed = true;
    const showPlayers = new Set((gs.players ?? []).map(norm));
    for (const x of P) if (showPlayers.has(x)) played.add(x);
  }
  if (P.length > 0 && played.size === P.length) return 'full';
  if (played.size > 0) return 'partial';
  for (const gs of ctx.plannedShows) {
    if (!gs.gameOrder.includes(ref)) continue;
    const showPlayers = new Set((gs.players ?? []).map(norm));
    if (P.some(x => showPlayers.has(x))) return 'planned';
  }
  if (everPlayed) return 'none';
  return 'fresh';
}

/**
 * Aggregate overlap across every instance of a game file — used by the
 * "Spiel hinzufügen…" picker badge. `refs` are the fully-qualified refs for the
 * game's instances. Returns null to hide the badge when no roster is set and
 * the game has been played by someone (nothing meaningful to show).
 */
export function classifyGameOverlap(refs: string[], ctx: OverlapContext): Overlap | null {
  if (!refs.length) return null;
  const overlaps = refs.map(r => classifyOverlap(r, ctx));
  if (overlaps.every(o => o === 'fresh')) return 'fresh';
  if (!ctx.currentPlayersLower.length) return null;
  if (overlaps.some(o => o === 'fresh' || o === 'none')) return 'none';
  if (overlaps.some(o => o === 'planned')) return 'planned';
  if (overlaps.every(o => o === 'full')) return 'full';
  return 'partial';
}

/**
 * Current-roster members who already played `ref` in a happened show — i.e. the
 * people who already know the game. Returns their original-cased names, deduped,
 * in first-seen order. Backs the "who knows it" tooltip on partial/full badges.
 */
export function playersWhoPlayed(ref: string, ctx: OverlapContext): string[] {
  const P = new Set(ctx.currentPlayersLower);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const gs of ctx.playedShows) {
    if (!gs.gameOrder.includes(ref)) continue;
    for (const p of gs.players ?? []) {
      const lower = norm(p);
      if (P.has(lower) && !seen.has(lower)) {
        seen.add(lower);
        out.push(p.trim());
      }
    }
  }
  return out;
}

/** One gameshow that played (or plans) a ref, with the overlapping roster members. */
export interface RefShowRef {
  id: string;
  name: string;
  /** Current-roster members that are in this gameshow (the overlap). */
  overlapPlayers: string[];
}

export interface RefProvenance {
  /** Already-happened gameshows whose gameOrder contains the ref. */
  playedIn: RefShowRef[];
  /** Upcoming gameshows scheduled earlier than the current one that contain the ref. */
  plannedIn: RefShowRef[];
}

/**
 * Where a ref has been played (happened shows) and where it is planned (upcoming
 * shows earlier than the current one), limited to gameshows that share at least
 * one current-roster member.
 */
export function refProvenance(ref: string, ctx: OverlapContext, gameshows: Record<string, GameshowConfig>): RefProvenance {
  const P = new Set(ctx.currentPlayersLower);
  const collect = (shows: GameshowConfig[]): RefShowRef[] => {
    const out: RefShowRef[] = [];
    for (const gs of shows) {
      if (!gs.gameOrder.includes(ref)) continue;
      const overlap = (gs.players ?? []).filter(p => P.has(norm(p)));
      if (P.size > 0 && overlap.length === 0) continue;
      // Resolve the id back from the record (config keys are the ids).
      const id = Object.keys(gameshows).find(k => gameshows[k] === gs) ?? gs.name;
      out.push({ id, name: gs.name, overlapPlayers: overlap });
    }
    return out;
  };
  return { playedIn: collect(ctx.playedShows), plannedIn: collect(ctx.plannedShows) };
}

// ── Instance usage (game editor) ──────────────────────────────────────────────

export interface InstanceUsage {
  gameshowId: string;
  gameshowName: string;
  /** The gameshow's roster (these players played this instance). */
  players: string[];
  /** True when the gameshow is upcoming (active-or-later): scheduled, not yet played. */
  planned: boolean;
}

/**
 * Every gameshow whose `gameOrder` contains `ref`, in config order, with its
 * roster. `planned` flags gameshows at or after the active one (upcoming) vs
 * those that have already happened. Backs the "bereits gespielt von" display in
 * the game editor. See specs/game-planning.md.
 */
export function instanceUsage(
  ref: string,
  gameshows: Record<string, GameshowConfig>,
  activeId?: string,
): InstanceUsage[] {
  const ids = Object.keys(gameshows);
  const rawActive = activeId ? ids.indexOf(activeId) : -1;
  const active = rawActive < 0 ? ids.length : rawActive;
  const out: InstanceUsage[] = [];
  ids.forEach((id, idx) => {
    const gs = gameshows[id]!;
    if (!gs.gameOrder.includes(ref)) return;
    out.push({ gameshowId: id, gameshowName: gs.name, players: gs.players ?? [], planned: idx >= active });
  });
  return out;
}

// ── Player stats (modal) ──────────────────────────────────────────────────────

export interface PlayerHistoryEntry {
  ref: string;
  fileName: string;
  /** Instance key (e.g. "v1"), or null for a single-instance game. */
  instance: string | null;
  title: string;
  type: GameType;
}

export interface PlayerHistoryGroup {
  gameshowId: string;
  gameshowName: string;
  /** True when this gameshow is the reference gameshow or a later one (future / planned). */
  planned: boolean;
  entries: PlayerHistoryEntry[];
}

export interface PlayerHistory {
  /** Distinct game instances the player has already played (in past gameshows). */
  playedCount: number;
  /** Distinct game instances planned for the player (reference + following gameshows). */
  plannedCount: number;
  /** Number of distinct game files (titles) the player has already played. */
  gameCount: number;
  /** Number of gameshows the player participates in. */
  gameshowCount: number;
  /** Per-game-type counts of PLAYED instances, sorted by count descending. */
  byType: Array<{ type: GameType; label: string; count: number }>;
  /** One group per gameshow the player is in, in config order. */
  groups: PlayerHistoryGroup[];
}

/** Resolve a gameOrder ref to its display metadata via the games summary list. */
function resolveEntry(ref: string, games: GameFileSummary[]): PlayerHistoryEntry {
  const slash = ref.indexOf('/');
  const fileName = slash >= 0 ? ref.slice(0, slash) : ref;
  const instance = slash >= 0 ? ref.slice(slash + 1) : null;
  const summary = games.find(g => g.fileName === fileName);
  return {
    ref,
    fileName,
    instance,
    title: summary?.title ?? fileName,
    type: summary?.type ?? 'simple-quiz',
  };
}

/**
 * Derive a player's played / planned history from gameshow membership. Every
 * gameshow whose participant list includes the player becomes a group listing
 * that gameshow's full lineup; groups at or after `referenceIndex` are marked
 * `planned` (future). `games` is only used to resolve titles/types for refs.
 * See specs/player-stats.md.
 */
export function computePlayerHistory(
  player: string,
  games: GameFileSummary[],
  gameshows: Record<string, GameshowConfig> = {},
  referenceIndex = Infinity,
): PlayerHistory {
  const playerLower = norm(player);
  const groups: PlayerHistoryGroup[] = [];
  const playedFiles = new Set<string>();
  const playedRefs = new Set<string>();
  const plannedRefs = new Set<string>();
  const typeCounts = new Map<GameType, number>();

  if (playerLower) {
    const ids = Object.keys(gameshows);
    ids.forEach((gsId, idx) => {
      const gs = gameshows[gsId]!;
      if (!(gs.players ?? []).some(p => norm(p) === playerLower)) return;
      const planned = idx >= referenceIndex;
      const entries = gs.gameOrder.map(ref => resolveEntry(ref, games));
      groups.push({ gameshowId: gsId, gameshowName: gs.name, planned, entries });
      for (const e of entries) {
        if (planned) {
          plannedRefs.add(e.ref);
        } else {
          playedRefs.add(e.ref);
          playedFiles.add(e.fileName);
          typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
        }
      }
    });
  }

  const byType = [...typeCounts.entries()]
    .map(([type, count]) => ({ type, label: GAME_TYPE_INFO[type]?.label ?? type, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    playedCount: playedRefs.size,
    plannedCount: plannedRefs.size,
    gameCount: playedFiles.size,
    gameshowCount: groups.length,
    byType,
    groups,
  };
}
