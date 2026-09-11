import type { BaseGameConfig, RulesPreset, RulesTeamBand } from '../types/config.js';
import { DEFAULT_TEAM_COUNT } from './teams.js';

export const PLACEHOLDER_TASK_LINE = 'Beschreibe die Aufgabe der Runde.';

/**
 * Which wording band a team count falls into.
 *
 * `solo` (0-1) has no opponent, so the archetype lines about the other team are
 * dropped entirely; `pair` (2) is the historic "beide Teams" wording; `multi`
 * (3-4) says "alle Teams" / "die anderen Teams". See specs/rules-presets.md.
 */
export function rulesTeamBand(teamCount: number): RulesTeamBand {
  if (teamCount <= 1) return 'solo';
  if (teamCount === 2) return 'pair';
  return 'multi';
}

/**
 * The preset's rules for a given team count. A band the author never filled in
 * falls back to `rules` — a preset added by hand without the variants keeps
 * behaving as it did before bands existed, rather than serving an empty array.
 */
export function presetRulesForTeamCount(preset: RulesPreset, teamCount: number): string[] {
  switch (rulesTeamBand(teamCount)) {
    case 'solo': return preset.rulesSolo ?? preset.rules;
    case 'multi': return preset.rulesMulti ?? preset.rules;
    default: return preset.rules;
  }
}

/**
 * If the game references a preset id present in `presets`, returns a flat rules array
 * `[taskLine, ...bandRules]` (where taskLine is `game.rules[0]` or the placeholder, and
 * the band follows `teamCount` — omitted means the historic two-team wording).
 *
 * Returns `null` when no resolution is needed:
 *   - the game has no `rulesPreset`, or
 *   - the referenced preset is missing (caller is responsible for logging/warning).
 */
export function resolveRulesPreset(
  game: Pick<BaseGameConfig, 'rules' | 'rulesPreset'>,
  presets: RulesPreset[] | undefined,
  teamCount: number = DEFAULT_TEAM_COUNT,
): string[] | null {
  if (!game.rulesPreset) return null;
  const preset = presets?.find(p => p.id === game.rulesPreset);
  if (!preset) return null;
  const taskLine = game.rules?.[0] ?? PLACEHOLDER_TASK_LINE;
  return [taskLine, ...presetRulesForTeamCount(preset, teamCount)];
}
