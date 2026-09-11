/**
 * `#rrggbb` colour handling — the one format the app accepts anywhere a colour is
 * authored: it is what the native `<input type="color">` emits, so the admin's
 * swatch and its text field can never disagree.
 *
 * Shared by the colorguess question colours
 * ([src/components/backend/questions/SimpleQuizForm.tsx](../components/backend/questions/SimpleQuizForm.tsx))
 * and the per-team colours ([teamColors.ts](./teamColors.ts)).
 */

/** Six hex digits with a leading `#` — no 3-digit shorthand, no alpha. */
export const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isValidHex(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value);
}

/**
 * Lower-cased `#rrggbb`, or `''` for anything that is not one. Normalizing the
 * case keeps `config.json` diffs stable when the same colour is re-picked — the
 * native picker emits lower case, a hand-typed value may not.
 */
export function normalizeHex(value: unknown): string {
  return isValidHex(value) ? value.toLowerCase() : '';
}
