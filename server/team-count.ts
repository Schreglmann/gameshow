import type { AppConfig, GameType } from '../src/types/config.js';
import { gameSupportsTeamCount } from '../src/data/gameTypeInfo.js';
import { normalizeTeamCount, DEFAULT_TEAM_COUNT } from '../src/utils/teams.js';

/**
 * Team-count resolution for the two routes that serve it.
 *
 * Pure and I/O-free so the decisions can be unit-tested in isolation — the
 * caller in server/index.ts supplies the resolved game configs.
 * See specs/team-count.md.
 */

/** The minimum a resolved game config has to expose for a scoring decision. */
export interface ScorableGame {
  type: GameType;
  title?: string;
  scoringMode?: string;
}

/**
 * How many teams the active gameshow runs with (0-4).
 *
 * The global `pointSystemEnabled: false` is the master "no teams" switch and
 * forces 0; otherwise the active gameshow's own `teamCount` applies, defaulting
 * to the historic 2 when absent. Everything else — the served
 * `pointSystemEnabled` on both routes, the joker cascade, the incompatible-game
 * list — derives from this one number.
 */
export function effectiveTeamCount(config: AppConfig): number {
  if (config.pointSystemEnabled === false) return 0;
  const activeShow = config.gameshows?.[config.activeGameshow];
  const raw = activeShow?.teamCount;
  return raw === undefined ? DEFAULT_TEAM_COUNT : normalizeTeamCount(raw);
}

/**
 * Can this specific game be scored right now? True only when the show has teams
 * AND this game's type (and scoring mode) supports that many. A `false` here is
 * what `GET /api/game/:index` serves as `pointSystemEnabled`, which every game
 * component already handles as a complete play-through with no award.
 */
/**
 * Whether the show has TEAMS at all, as opposed to a single scoring entity.
 *
 * 0 teams is the no-scoring play-through. 1 team scores, but there is nobody to
 * be split from or compared against: the audience plays the show itself. Both
 * therefore run without any team-assignment flow, and player randomization has
 * nothing to randomize — the server forces `teamRandomizationEnabled` off below
 * two teams so no client has to special-case it. See specs/team-count.md.
 */
export function hasTeamSplit(teamCount: number): boolean {
  return teamCount > 1;
}

export function gameIsScorable(game: ScorableGame, teamCount: number): boolean {
  return teamCount > 0 && gameSupportsTeamCount(game.type, teamCount, game.scoringMode);
}

/** One gameOrder entry that will play without scoring at the configured count. */
export interface IncompatibleGameEntry {
  index: number;
  title: string;
  type: GameType;
}

/**
 * The entries of a resolved gameOrder that cannot be scored at `teamCount`.
 *
 * A `null` entry is a game whose file failed to load — skipped rather than
 * reported, because a broken reference is a different problem and `/api/settings`
 * must not fail because of one. Empty at 0 teams, where nothing scores anyway.
 */
export function listIncompatibleGames(
  games: readonly (ScorableGame | null)[],
  teamCount: number,
): IncompatibleGameEntry[] {
  if (teamCount === 0) return [];
  const out: IncompatibleGameEntry[] = [];
  games.forEach((game, index) => {
    if (!game || gameIsScorable(game, teamCount)) return;
    out.push({ index, title: game.title || game.type, type: game.type });
  });
  return out;
}
