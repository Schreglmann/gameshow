import type { TeamState } from '@/types/game';

/**
 * Display name for a team. Returns the custom name when set (and non-blank),
 * otherwise the positional fallback "Team 1" / "Team 2". Computed at read time
 * — never stored as derived state.
 */
export function teamName(teams: Pick<TeamState, 'team1Name' | 'team2Name'>, n: 1 | 2): string {
  const name = n === 1 ? teams.team1Name : teams.team2Name;
  return name?.trim() || `Team ${n}`;
}

/**
 * Soft length limit for a custom team name. The header team pill only gets ~⅓
 * of the width minus the always-visible score (and joker grid), so a name above
 * this length will be ellipsis-truncated in the header — guaranteed to fully fit
 * on a projector (≥1920px) but cut off on smaller screens. Used only to surface a
 * non-blocking hint; longer names are still accepted and truncate gracefully.
 * (Measured empirically against the real header layout.)
 */
export const TEAM_NAME_SOFT_LIMIT = 12;

/** True when a name is long enough to risk header truncation (see TEAM_NAME_SOFT_LIMIT). */
export function isTeamNameLong(name?: string): boolean {
  return (name?.trim().length ?? 0) > TEAM_NAME_SOFT_LIMIT;
}
