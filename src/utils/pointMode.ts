import type { PointMode } from '../types/config.js';

/**
 * How a gameshow turns a game result into points.
 *
 * The rule used to be hardcoded ("game N is worth N points") and duplicated in
 * every game component. It is now a per-gameshow setting resolved in exactly one
 * place — `BaseGameWrapper` — so no game can opt out of it.
 *
 * See specs/point-system.md.
 */

/** What a gameshow without an explicit `pointMode` uses — the historic behaviour. */
export const DEFAULT_POINT_MODE: PointMode = 'positional';

export const ALL_POINT_MODES: readonly PointMode[] = ['positional', 'flat', 'per-correct-answer'];

/** Coerce anything off the wire or out of config.json to a valid mode. */
export function normalizePointMode(value: unknown): PointMode {
  return (ALL_POINT_MODES as readonly unknown[]).includes(value)
    ? (value as PointMode)
    : DEFAULT_POINT_MODE;
}

/**
 * The fixed value one game is worth under `mode`.
 *
 * `per-correct-answer` has no fixed value — a game WITH a correct-answer tally
 * pays out `tallyTotals` per team instead. This returns the positional fallback
 * for the four types that hide the tracker and therefore have no tally to read
 * (see specs/point-system.md "Limitation — games without a tally").
 */
export function gamePointValue(mode: PointMode, currentIndex: number): number {
  return mode === 'flat' ? 1 : currentIndex + 1;
}

/** German label for the admin select and the generated global rule line. */
export function pointModeLabel(mode: PointMode): string {
  switch (mode) {
    case 'flat':
      return 'Jedes Spiel zählt 1 Punkt';
    case 'per-correct-answer':
      return '1 Punkt pro richtiger Antwort';
    default:
      return 'Nach Spielreihenfolge';
  }
}

/**
 * The global-rules line describing the mode, shown on the rules screen when the
 * operator has not authored their own `globalRules`.
 */
export function pointModeRule(mode: PointMode): string {
  switch (mode) {
    case 'flat':
      return 'Jedes Spiel ist 1 Punkt wert.';
    case 'per-correct-answer':
      return 'Jede richtige Antwort ist 1 Punkt wert.';
    default:
      return 'Das erste Spiel ist 1 Punkt wert, das zweite 2 Punkte, etc.';
  }
}
