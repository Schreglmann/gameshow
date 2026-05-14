import { describe, it, expect } from 'vitest';
import { resolveRulesPreset, PLACEHOLDER_TASK_LINE } from '@/utils/rulesPreset';
import type { RulesPreset } from '@/types/config';

const presets: RulesPreset[] = [
  { id: 'race', name: 'Race', rules: ['Beide Teams raten gleichzeitig.', 'Die erste Antwort eines Teams zählt.'] },
  { id: 'alt', name: 'Alternating', rules: ['Die Teams raten abwechselnd.'] },
];

describe('resolveRulesPreset', () => {
  it('returns null when no rulesPreset is set', () => {
    const result = resolveRulesPreset({ rules: ['Task'] }, presets);
    expect(result).toBeNull();
  });

  it('returns null when the referenced preset is missing', () => {
    const result = resolveRulesPreset({ rules: ['Task'], rulesPreset: 'unknown' }, presets);
    expect(result).toBeNull();
  });

  it('returns null when presets are undefined', () => {
    const result = resolveRulesPreset({ rules: ['Task'], rulesPreset: 'race' }, undefined);
    expect(result).toBeNull();
  });

  it('merges task line + preset rules when the reference resolves', () => {
    const result = resolveRulesPreset({ rules: ['Task'], rulesPreset: 'alt' }, presets);
    expect(result).toEqual(['Task', 'Die Teams raten abwechselnd.']);
  });

  it('falls back to the placeholder when the game has no task line', () => {
    const result = resolveRulesPreset({ rulesPreset: 'alt' }, presets);
    expect(result).toEqual([PLACEHOLDER_TASK_LINE, 'Die Teams raten abwechselnd.']);
  });

  it('falls back to the placeholder when rules array is empty', () => {
    const result = resolveRulesPreset({ rules: [], rulesPreset: 'alt' }, presets);
    expect(result).toEqual([PLACEHOLDER_TASK_LINE, 'Die Teams raten abwechselnd.']);
  });

  it('preserves the task line even when the preset has no rules', () => {
    const result = resolveRulesPreset(
      { rules: ['Task'], rulesPreset: 'empty' },
      [{ id: 'empty', name: 'Empty', rules: [] }],
    );
    expect(result).toEqual(['Task']);
  });
});
