import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TEAM_COLORS,
  normalizeTeamColors,
  resolveTeamColor,
  resolveTeamColors,
  teamColorVar,
} from '@/utils/teamColors';
import type { AppConfig } from '@/types/config';

// See specs/team-colors.md — the operator-configurable per-team accent colours.
const baseConfig: AppConfig = {
  activeGameshow: 'gs1',
  gameshows: { gs1: { name: 'Gameshow 1', gameOrder: [] } },
};

describe('DEFAULT_TEAM_COLORS', () => {
  // Teams 1-3 are the Atlas --teamN-house values in themes.css, so switching the
  // feature on does not introduce a second set of "default" team colours that
  // disagrees with the default theme. Team 4 is the deliberate exception: the
  // theme's violet is a third cool hue next to the blue and green, so the
  // default is yellow. See specs/team-colors.md.
  it('pairs three Atlas house colours with a yellow team 4', () => {
    expect(DEFAULT_TEAM_COLORS).toEqual({
      team1: '#ff5d6c',
      team2: '#4f8af0',
      team3: '#3ed79a',
      team4: '#e0c918',
    });
  });

  it('is four distinct colours, all lower-case #rrggbb', () => {
    const values = Object.values(DEFAULT_TEAM_COLORS);
    expect(new Set(values).size).toBe(4);
    for (const v of values) expect(v).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('teamColorVar', () => {
  it('names the custom property the stylesheet reads', () => {
    expect(teamColorVar('team1')).toBe('--team1-color');
    expect(teamColorVar('team4')).toBe('--team4-color');
  });
});

describe('normalizeTeamColors', () => {
  it('keeps the four known keys and lower-cases their values', () => {
    expect(normalizeTeamColors({ team1: '#FF0000', team4: '#00ff00' })).toEqual({
      team1: '#ff0000',
      team4: '#00ff00',
    });
  });

  it('keeps an empty value — blank is an explicit "use the theme", not "unset"', () => {
    expect(normalizeTeamColors({ team2: '' })).toEqual({ team2: '' });
  });

  it('drops unknown keys, malformed colours and non-strings', () => {
    expect(normalizeTeamColors({
      team1: '#ff0000',
      team5: '#ff0000',
      teamX: '#ff0000',
      team2: '#abc',
      team3: 42,
      team4: null,
    })).toEqual({ team1: '#ff0000' });
  });

  it('returns an empty map for anything that is not a plain object', () => {
    expect(normalizeTeamColors(undefined)).toEqual({});
    expect(normalizeTeamColors(null)).toEqual({});
    expect(normalizeTeamColors('#ff0000')).toEqual({});
    expect(normalizeTeamColors(['#ff0000'])).toEqual({});
  });
});

describe('resolveTeamColors', () => {
  it('yields an empty map while the master switch is off', () => {
    // The whole point of the single gate: with the feature off every client
    // renders exactly as it did before the feature existed.
    expect(resolveTeamColors(baseConfig)).toEqual({});
    expect(resolveTeamColors({ ...baseConfig, teamColorsEnabled: false })).toEqual({});
    expect(resolveTeamColors({
      ...baseConfig,
      teamColors: { team1: '#ff0000' },
    })).toEqual({});
  });

  it('serves the default palette when the switch is on but nothing was picked', () => {
    expect(resolveTeamColors({ ...baseConfig, teamColorsEnabled: true }))
      .toEqual(DEFAULT_TEAM_COLORS);
  });

  it('overrides only the teams the operator touched', () => {
    expect(resolveTeamColors({
      ...baseConfig,
      teamColorsEnabled: true,
      teamColors: { team2: '#123456' },
    })).toEqual({ ...DEFAULT_TEAM_COLORS, team2: '#123456' });
  });

  it('preserves a deliberately blank team so it can fall back to the theme', () => {
    const resolved = resolveTeamColors({
      ...baseConfig,
      teamColorsEnabled: true,
      teamColors: { team3: '' },
    });
    expect(resolved.team3).toBe('');
    expect(resolved.team1).toBe(DEFAULT_TEAM_COLORS.team1);
  });

  it('ignores a malformed stored colour and falls back to the default for that team', () => {
    expect(resolveTeamColors({
      ...baseConfig,
      teamColorsEnabled: true,
      teamColors: { team1: 'not-a-colour' } as Record<'team1', string>,
    }).team1).toBe(DEFAULT_TEAM_COLORS.team1);
  });
});

describe('resolveTeamColor', () => {
  it('returns the colour for a marked team and an empty string otherwise', () => {
    expect(resolveTeamColor('team1', { team1: '#ff0000' })).toBe('#ff0000');
    expect(resolveTeamColor('team2', { team1: '#ff0000' })).toBe('');
    expect(resolveTeamColor('team3', { team3: '' })).toBe('');
  });
});
