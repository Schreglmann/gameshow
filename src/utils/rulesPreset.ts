import type { BaseGameConfig, RulesPreset } from '../types/config.js';

export const PLACEHOLDER_TASK_LINE = 'Beschreibe die Aufgabe der Runde.';

/**
 * If the game references a preset id present in `presets`, returns a flat rules array
 * `[taskLine, ...preset.rules]` (where taskLine is `game.rules[0]` or the placeholder).
 *
 * Returns `null` when no resolution is needed:
 *   - the game has no `rulesPreset`, or
 *   - the referenced preset is missing (caller is responsible for logging/warning).
 */
export function resolveRulesPreset(
  game: Pick<BaseGameConfig, 'rules' | 'rulesPreset'>,
  presets: RulesPreset[] | undefined,
): string[] | null {
  if (!game.rulesPreset) return null;
  const preset = presets?.find(p => p.id === game.rulesPreset);
  if (!preset) return null;
  const taskLine = game.rules?.[0] ?? PLACEHOLDER_TASK_LINE;
  return [taskLine, ...preset.rules];
}
