import type { TeamKey } from '../utils/teams.js';

export interface JokerDef {
  id: string;
  name: string;
  description: string;
}

/**
 * Alias kept for readability at joker call sites; identical to `TeamKey`, so it
 * widens with the supported team count. See specs/team-count.md.
 */
export type JokerTeam = TeamKey;