import { teamKeys, type TeamKey } from '@/utils/teams';

/**
 * Left→right display order of the active teams.
 *
 * The team keys are stable IDENTITIES — points, jokers, history stay attached to
 * their team. This module decides only the order they are shown in.
 *
 * - `swapped` (`TeamState.orderSwapped`): the operator reversed the seating on
 *   the crowd-facing frontend (for whichever way the teams are seated).
 * - `mirror`: this surface is the gamemaster screen. The GM faces the crowd, so
 *   every GM multi-team display is the mirror of the frontend order.
 * - `enabled` (`GlobalSettings.teamMirrorEnabled`): master switch for the whole
 *   feature. When false the order is always the natural identity order — no
 *   swap, no GM mirror — regardless of `swapped`/`mirror`.
 * - `count` (`GlobalSettings.teamCount`): how many teams are in play (0-4).
 *
 * At `count: 2` this returns exactly what the previous two-team implementation
 * returned for every combination of inputs.
 *
 * See specs/team-order-mirror.md and specs/team-count.md.
 */
export type { TeamKey };

export function teamDisplayOrder(
  swapped: boolean | undefined,
  mirror = false,
  enabled = true,
  count = 2,
): TeamKey[] {
  const keys = teamKeys(count);
  if (!enabled) return keys;
  // Two independent reversals: the operator's seating swap and the GM mirror.
  // Both true cancel out, which is what keeps a swapped show and its mirrored
  // gamemaster consistent.
  const reversed = mirror ? !swapped : Boolean(swapped);
  return reversed ? [...keys].reverse() : keys;
}

/**
 * Split an ordered team list into the header's left and right cells, which sit
 * either side of the game counter. 1 team → 1 left / 0 right; 2 → 1/1 (the
 * historic layout); 3 → 2/1; 4 → 2/2. See specs/header.md.
 */
export function splitAroundCenter<T>(order: readonly T[]): { left: T[]; right: T[] } {
  const pivot = Math.ceil(order.length / 2);
  return { left: order.slice(0, pivot), right: order.slice(pivot) };
}
