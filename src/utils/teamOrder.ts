/**
 * Left→right display order of the two teams.
 *
 * `team1`/`team2` are stable identities — points, jokers, history stay attached
 * to their team. This module decides only which one is shown on the LEFT.
 *
 * - `swapped` (`TeamState.orderSwapped`): the operator flipped which team sits on
 *   the crowd-facing frontend's left (for whichever way the teams are seated).
 * - `mirror`: this surface is the gamemaster screen. The GM faces the crowd, so
 *   every GM two-team display is the mirror of the frontend order.
 * - `enabled` (`GlobalSettings.teamMirrorEnabled`): master switch for the whole
 *   feature. When false the order is always the natural `[team1, team2]` — no
 *   swap, no GM mirror — regardless of `swapped`/`mirror`.
 *
 * See specs/team-order-mirror.md.
 */
export type TeamKey = 'team1' | 'team2';

export function teamDisplayOrder(
  swapped: boolean | undefined,
  mirror = false,
  enabled = true,
): [TeamKey, TeamKey] {
  if (!enabled) return ['team1', 'team2'];
  const leftIsTeam2 = mirror ? !swapped : Boolean(swapped);
  return leftIsTeam2 ? ['team2', 'team1'] : ['team1', 'team2'];
}
