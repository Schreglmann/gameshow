import type { TeamState } from '../types/game.js';
import type { AppConfig } from '../types/config.js';

/**
 * Team identity — the single source of truth for "which teams exist".
 *
 * A gameshow runs with 0–4 teams (`GameshowConfig.teamCount`, default 2). The
 * team keys are stable identities: points, jokers, rosters and score history
 * stay attached to their key regardless of how many teams are active or how
 * they are ordered on screen (that is `teamOrder.ts`).
 *
 * `TeamState` keeps FLAT `teamN*` fields rather than an array so the
 * localStorage keys and the WS payload stay purely additive — `team3*`/`team4*`
 * are optional, which is why every read goes through the tolerant accessors
 * below instead of indexing the state directly.
 *
 * See specs/team-count.md.
 */

export type TeamKey = 'team1' | 'team2' | 'team3' | 'team4';

export const ALL_TEAM_KEYS = ['team1', 'team2', 'team3', 'team4'] as const;

export const MAX_TEAMS = ALL_TEAM_KEYS.length;

/** The default when a gameshow does not set `teamCount` — the historic behaviour. */
export const DEFAULT_TEAM_COUNT = 2;

/** Clamp arbitrary input (config, API payload) to a valid team count. */
export function normalizeTeamCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return DEFAULT_TEAM_COUNT;
  return Math.min(MAX_TEAMS, Math.max(0, value));
}

/**
 * How many teams the active gameshow runs with (0-4).
 *
 * The global `pointSystemEnabled: false` is the master "no teams" switch and
 * forces 0; otherwise the active gameshow's own `teamCount` applies, defaulting
 * to the historic 2 when absent. Lives here rather than in server/team-count.ts
 * because the admin needs the same number to preview a rules preset's team-count
 * band. See specs/team-count.md and specs/rules-presets.md.
 */
export function effectiveTeamCount(config: AppConfig): number {
  if (config.pointSystemEnabled === false) return 0;
  const activeShow = config.gameshows?.[config.activeGameshow];
  const raw = activeShow?.teamCount;
  return raw === undefined ? DEFAULT_TEAM_COUNT : normalizeTeamCount(raw);
}

/** The keys of the `count` active teams, in identity order. */
export function teamKeys(count: number): TeamKey[] {
  return ALL_TEAM_KEYS.slice(0, normalizeTeamCount(count));
}

/** `3` → `'team3'`. Out-of-range numbers clamp into the valid range. */
export function teamKey(n: number): TeamKey {
  const idx = Math.min(MAX_TEAMS, Math.max(1, Math.trunc(n))) - 1;
  return ALL_TEAM_KEYS[idx]!;
}

/** `'team3'` → `3`. The positional number behind a key (used for fallback labels). */
export function teamNumber(key: TeamKey): number {
  return ALL_TEAM_KEYS.indexOf(key) + 1;
}

/** True for a string that names a team. Narrows untrusted input (WS commands, JSON). */
export function isTeamKey(value: unknown): value is TeamKey {
  return typeof value === 'string' && (ALL_TEAM_KEYS as readonly string[]).includes(value);
}

// ── Tolerant field accessors ──
// team3/team4 are optional on TeamState (so the existing two-team literals and
// test fixtures keep compiling), so nothing may index those fields directly.

export function teamPoints(teams: TeamState, key: TeamKey): number {
  const value = teams[`${key}Points`];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function teamRoster(teams: TeamState, key: TeamKey): string[] {
  return teams[key] ?? [];
}

export function teamJokersUsed(teams: TeamState, key: TeamKey): string[] {
  return teams[`${key}JokersUsed`] ?? [];
}

/** Every team's points as a plain record — for the surfaces that want one value bag. */
export function pointsByTeam(teams: TeamState, keys: readonly TeamKey[]): Record<TeamKey, number> {
  const out = {} as Record<TeamKey, number>;
  for (const key of ALL_TEAM_KEYS) out[key] = 0;
  for (const key of keys) out[key] = teamPoints(teams, key);
  return out;
}

// ── Standings ──

/**
 * The team(s) on the highest score. Several keys mean a tie for the lead; an
 * empty `keys` list yields an empty result. Everyone is "leading" when all
 * scores are equal — callers that need a *unique* winner check `length === 1`.
 */
export function leadingTeams(teams: TeamState, keys: readonly TeamKey[]): TeamKey[] {
  if (keys.length === 0) return [];
  const max = Math.max(...keys.map(k => teamPoints(teams, k)));
  return keys.filter(k => teamPoints(teams, k) === max);
}

/**
 * The team(s) strictly below the highest score — who may spend the Aufholjoker.
 * At two teams this is exactly the old rule ("the team with fewer points, nobody
 * on a draw"); at 3+ every team that is not tied for the lead qualifies.
 * See specs/comeback-joker.md.
 */
export function trailingTeams(teams: TeamState, keys: readonly TeamKey[]): TeamKey[] {
  if (keys.length === 0) return [];
  const max = Math.max(...keys.map(k => teamPoints(teams, k)));
  return keys.filter(k => teamPoints(teams, k) < max);
}
