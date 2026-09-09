import { useEffect } from 'react';
import { ALL_TEAM_KEYS } from '@/utils/teams';
import { teamColorVar, type TeamColors } from '@/utils/teamColors';

/**
 * Publish the operator's team colours as `--team1-color` … `--team4-color` on
 * `<html>`, plus `data-team-colors="on"` while at least one is set.
 *
 * One DOM write serves every zone: the show, the gamemaster and the admin all
 * mount `GameProvider`, so calling this there covers all three bundles and the
 * `/theme-showcase` route. Analogous to `ThemeContext` writing
 * `documentElement.dataset.theme`, and it is what lets ~16 team surfaces mark
 * themselves with nothing but a `data-team` attribute.
 *
 * See specs/team-colors.md.
 */
export function useTeamColorVars(colors: TeamColors | undefined): void {
  // Tolerates a missing map rather than requiring one. `GlobalSettings` declares
  // the field, but a settings object can still arrive without it — a payload
  // cached by an older build, or a partial test fixture — and "no map" means
  // exactly the same thing as an empty one: mark nothing.
  //
  // Deps are the four primitives, not the object: `SET_SETTINGS` allocates a new
  // `settings` on every settings load (including each `content-changed`
  // re-fetch), so an object dep would rewrite the DOM on every one of them.
  const { team1, team2, team3, team4 } = colors ?? {};
  useEffect(() => {
    const root = document.documentElement;
    const values: TeamColors = { team1, team2, team3, team4 };
    let anySet = false;
    for (const key of ALL_TEAM_KEYS) {
      const value = values[key];
      if (value) {
        root.style.setProperty(teamColorVar(key), value);
        anySet = true;
      } else {
        // removeProperty, NOT setProperty(key, ''): an empty custom property is
        // still a *declared* value, which would make
        // `var(--teamN-color, var(--teamN-house, transparent))` resolve to
        // nothing instead of falling through to the theme's house colour.
        root.style.removeProperty(teamColorVar(key));
      }
    }
    if (anySet) root.dataset.teamColors = 'on';
    else delete root.dataset.teamColors;
  }, [team1, team2, team3, team4]);
}
