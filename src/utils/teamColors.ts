import type { AppConfig, TeamColors } from '../types/config.js';
import { ALL_TEAM_KEYS, isTeamKey, type TeamKey } from './teams.js';
import { isValidHex, normalizeHex } from './hexColor.js';

/**
 * Per-team colours — the operator picks one per team in the admin, and every
 * surface that renders a team marks it with an accent edge plus a dot.
 *
 * The master switch is applied in exactly ONE place, `resolveTeamColors()`,
 * called by `GET /api/settings` — the same discipline as `resolveShowTitle`,
 * `normalizePointMode` and `effectiveTeamCount`. Clients therefore never see the
 * flag: an empty map already means "mark nothing".
 *
 * From here the colour travels through CSS, not props: `useTeamColorVars`
 * publishes `--team1-color` … `--team4-color` on `<html>` and each team element
 * carries `data-team`, which resolves
 * `--team-color: var(--teamN-color, var(--teamN-house, transparent))`. That is
 * what lets a configured colour override a theme's house colour while a blank
 * one falls back to it.
 *
 * See specs/team-colors.md.
 */

export type { TeamColors };

/**
 * The palette the admin fields prefill with.
 *
 * Teams 1-3 are the Atlas `--team1-house` … `--team3-house` values from
 * `themes.css`, so the default look with the feature ON largely matches the
 * default theme's existing accents rather than introducing a second set of
 * "default" team colours. Team 4 deliberately does NOT: its house colour is a
 * violet that reads as a third cool hue next to the blue and green, so the
 * default is a yellow that separates from all three at a distance. The theme
 * keeps its violet ring — that is the theme's own design, and it still applies
 * wherever the operator clears team 4's colour.
 *
 * The yellow is a LEMON one (hue ~53°), not the gold it would naturally drift
 * to, and darkened to L*~81. Two reasons, both about not lying to the audience:
 * gold is this app's "selected / winner" signal (`--gold` #ffd45e on the award
 * card, the winning guess row and the quizjagd team label), so a gold-ish team
 * colour would read as a result AND disappear against those surfaces; and a
 * full-brightness yellow (L*>90) shouts over the other three, which sit at
 * L* 58-77. L*81 puts it beside the green.
 */
export const DEFAULT_TEAM_COLORS: Readonly<Record<TeamKey, string>> = {
  team1: '#ff5d6c',
  team2: '#4f8af0',
  team3: '#3ed79a',
  team4: '#e0c918',
};

/** `'team3'` → `'--team3-color'` — the custom property the stylesheet reads. */
export function teamColorVar(key: TeamKey): string {
  return `--${key}-color`;
}

/**
 * Tolerant read of untrusted input (config.json, the API payload): keeps only the
 * four known keys, lower-cases valid `#rrggbb` values, and drops anything else.
 *
 * An empty string is KEPT rather than dropped — blank is the operator's explicit
 * "no colour, use the theme", which is a different thing from a key that was
 * never touched (that one gets the default). Dropping it here would silently turn
 * a cleared field back into a default colour.
 */
export function normalizeTeamColors(value: unknown): TeamColors {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: TeamColors = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isTeamKey(key)) continue;
    if (raw === '') { out[key] = ''; continue; }
    if (isValidHex(raw)) out[key] = normalizeHex(raw);
  }
  return out;
}

/**
 * The palette the clients get, with the master switch applied.
 *
 * Off (the default) → `{}`, so every zone renders exactly as it did before the
 * feature existed. On → the configured colours, with `DEFAULT_TEAM_COLORS` filling
 * in every key the operator never touched.
 */
export function resolveTeamColors(config: AppConfig): TeamColors {
  if (config.teamColorsEnabled !== true) return {};
  const configured = normalizeTeamColors(config.teamColors);
  const out: TeamColors = {};
  for (const key of ALL_TEAM_KEYS) {
    out[key] = configured[key] ?? DEFAULT_TEAM_COLORS[key];
  }
  return out;
}

/**
 * The colour marking one team, or `''` when the theme should decide. For the
 * non-DOM consumers (tests, an admin preview swatch) — the render sites use
 * `data-team` and let CSS resolve it.
 */
export function resolveTeamColor(key: TeamKey, colors: TeamColors): string {
  return normalizeHex(colors[key]);
}
