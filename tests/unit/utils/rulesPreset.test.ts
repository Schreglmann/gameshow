import { describe, it, expect } from 'vitest';
import {
  resolveRulesPreset,
  presetRulesForTeamCount,
  rulesTeamBand,
  PLACEHOLDER_TASK_LINE,
} from '@/utils/rulesPreset';
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

// ── Team-count bands (specs/rules-presets.md) ──

const banded: RulesPreset = {
  id: 'race',
  name: 'Race',
  rules: ['Beide Teams raten gleichzeitig.', 'Antwortet ein Team falsch, darf das andere Team antworten.'],
  rulesSolo: ['Die erste genannte Antwort zählt.'],
  rulesMulti: ['Alle Teams raten gleichzeitig.', 'Antwortet ein Team falsch, dürfen die anderen Teams antworten.'],
};

describe('rulesTeamBand', () => {
  it('maps 0 and 1 teams to solo', () => {
    expect(rulesTeamBand(0)).toBe('solo');
    expect(rulesTeamBand(1)).toBe('solo');
  });

  it('maps 2 teams to pair', () => {
    expect(rulesTeamBand(2)).toBe('pair');
  });

  it('maps 3 and 4 teams to multi', () => {
    expect(rulesTeamBand(3)).toBe('multi');
    expect(rulesTeamBand(4)).toBe('multi');
  });
});

describe('presetRulesForTeamCount', () => {
  it('serves the solo band below two teams', () => {
    expect(presetRulesForTeamCount(banded, 1)).toEqual(banded.rulesSolo);
    expect(presetRulesForTeamCount(banded, 0)).toEqual(banded.rulesSolo);
  });

  it('serves the pair band at two teams', () => {
    expect(presetRulesForTeamCount(banded, 2)).toEqual(banded.rules);
  });

  it('serves the multi band above two teams', () => {
    expect(presetRulesForTeamCount(banded, 3)).toEqual(banded.rulesMulti);
    expect(presetRulesForTeamCount(banded, 4)).toEqual(banded.rulesMulti);
  });

  it('falls back to `rules` for an unauthored band', () => {
    const partial: RulesPreset = { id: 'p', name: 'P', rules: ['Zwei-Team-Text.'] };
    expect(presetRulesForTeamCount(partial, 1)).toEqual(['Zwei-Team-Text.']);
    expect(presetRulesForTeamCount(partial, 4)).toEqual(['Zwei-Team-Text.']);
  });

  it('honours an intentionally empty band', () => {
    const emptySolo: RulesPreset = { id: 'p', name: 'P', rules: ['Zwei.'], rulesSolo: [] };
    expect(presetRulesForTeamCount(emptySolo, 1)).toEqual([]);
  });
});

describe('resolveRulesPreset — team bands', () => {
  it('defaults to the two-team band when no count is given', () => {
    expect(resolveRulesPreset({ rules: ['Task'], rulesPreset: 'race' }, [banded]))
      .toEqual(['Task', ...banded.rules!]);
  });

  it('merges the task line with the band matching the team count', () => {
    expect(resolveRulesPreset({ rules: ['Task'], rulesPreset: 'race' }, [banded], 4))
      .toEqual(['Task', ...banded.rulesMulti!]);
    expect(resolveRulesPreset({ rules: ['Task'], rulesPreset: 'race' }, [banded], 1))
      .toEqual(['Task', ...banded.rulesSolo!]);
  });

  it('keeps the task line when the band is empty', () => {
    const emptySolo: RulesPreset = { id: 'race', name: 'Race', rules: ['Zwei.'], rulesSolo: [] };
    expect(resolveRulesPreset({ rules: ['Task'], rulesPreset: 'race' }, [emptySolo], 0))
      .toEqual(['Task']);
  });
});
