import { describe, it, expect } from 'vitest';
import {
  ALL_POINT_MODES,
  DEFAULT_POINT_MODE,
  gamePointValue,
  normalizePointMode,
  pointModeLabel,
  pointModeRule,
  POINT_MODE_RULE_DEFAULTS,
} from '@/utils/pointMode';

/**
 * The point-mode helper: how a gameshow turns a game result into points.
 * See specs/point-system.md.
 */
describe('normalizePointMode', () => {
  it('passes every known mode through unchanged', () => {
    for (const mode of ALL_POINT_MODES) expect(normalizePointMode(mode)).toBe(mode);
  });

  it('falls back to the historic positional mode for anything unknown', () => {
    // Config files and API payloads are untrusted — an unreadable value must never
    // change how a live show scores.
    for (const bad of [undefined, null, '', 'Positional', 'per_correct_answer', 3, {}, []]) {
      expect(normalizePointMode(bad)).toBe('positional');
    }
    expect(DEFAULT_POINT_MODE).toBe('positional');
  });
});

describe('gamePointValue', () => {
  it('scores by position in positional mode', () => {
    expect(gamePointValue('positional', 0)).toBe(1);
    expect(gamePointValue('positional', 2)).toBe(3);
    expect(gamePointValue('positional', 13)).toBe(14);
  });

  it('scores every game as 1 in flat mode, whatever its position', () => {
    expect(gamePointValue('flat', 0)).toBe(1);
    expect(gamePointValue('flat', 7)).toBe(1);
  });

  it('falls back to the positional value in per-correct-answer mode', () => {
    // The mode has no fixed value — games WITH a tally pay that out instead. This
    // is what the four types hiding the tracker fall back to.
    expect(gamePointValue('per-correct-answer', 2)).toBe(3);
  });
});

describe('German labels', () => {
  it('names every mode and states its rule', () => {
    expect(pointModeLabel('positional')).toBe('Nach Spielreihenfolge');
    expect(pointModeLabel('flat')).toBe('Jedes Spiel zählt 1 Punkt');
    expect(pointModeLabel('per-correct-answer')).toBe('1 Punkt pro richtiger Antwort');
    expect(pointModeRule('flat')).toBe('Jedes Spiel ist 1 Punkt wert.');
    expect(pointModeRule('per-correct-answer')).toBe('Jede richtige Antwort ist 1 Punkt wert.');
    expect(pointModeRule('positional')).toContain('erste Spiel ist 1 Punkt wert');
  });
});

describe('pointModeRule overrides (AppConfig.pointModeRules, operator-editable)', () => {
  it('uses the operator override when present for that mode', () => {
    expect(pointModeRule('flat', { flat: 'Eigener Text' })).toBe('Eigener Text');
  });

  it('leaves other modes on the built-in default', () => {
    expect(pointModeRule('positional', { flat: 'Eigener Text' })).toBe(POINT_MODE_RULE_DEFAULTS.positional);
  });

  it('falls back to the default when the override is blank or whitespace-only', () => {
    expect(pointModeRule('flat', { flat: '' })).toBe(POINT_MODE_RULE_DEFAULTS.flat);
    expect(pointModeRule('flat', { flat: '   ' })).toBe(POINT_MODE_RULE_DEFAULTS.flat);
  });

  it('falls back to the default when no overrides are given at all', () => {
    for (const mode of ALL_POINT_MODES) expect(pointModeRule(mode)).toBe(POINT_MODE_RULE_DEFAULTS[mode]);
  });
});
