import { useMemo } from 'react';
import { useGameContext } from '@/context/GameContext';
import { rosterDisplayNames } from '@/utils/playerNames';
import { teamKeys, type TeamKey } from '@/utils/teams';

/**
 * Show/GM labels for every active roster, index-aligned with `teamRoster`:
 * first name only, plus the shortest distinguishing surname prefix when a
 * first name occurs twice in the whole draw. Derived, never stored.
 *
 * The returned object keeps its identity until a label actually changes, so
 * effects can list it as a dependency without re-running on every point award
 * (which also replaces `state.teams`). See specs/players.md.
 */
export function useRosterDisplayNames(): Record<TeamKey, string[]> {
  const { state } = useGameContext();
  const labels = rosterDisplayNames(state.teams, teamKeys(state.settings.teamCount));
  const key = JSON.stringify([labels.team1 ?? [], labels.team2 ?? [], labels.team3 ?? [], labels.team4 ?? []]);
  return useMemo(() => {
    const [team1, team2, team3, team4] = JSON.parse(key) as string[][];
    return { team1: team1!, team2: team2!, team3: team3!, team4: team4! };
  }, [key]);
}
