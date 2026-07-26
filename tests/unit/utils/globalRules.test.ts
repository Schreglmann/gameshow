import { describe, it, expect } from 'vitest';
import { hasGlobalRulesContent } from '@/utils/globalRules';

describe('hasGlobalRulesContent', () => {
  it('is true when there are global rules but no jokers', () => {
    expect(hasGlobalRulesContent({ globalRules: ['Rule 1'], enabledJokers: [] })).toBe(true);
  });

  it('is true when there are jokers but no global rules', () => {
    expect(hasGlobalRulesContent({ globalRules: [], enabledJokers: ['ask-ai'] })).toBe(true);
  });

  it('is true when both are present', () => {
    expect(hasGlobalRulesContent({ globalRules: ['Rule 1'], enabledJokers: ['ask-ai'] })).toBe(true);
  });

  it('is false when both are empty', () => {
    expect(hasGlobalRulesContent({ globalRules: [], enabledJokers: [] })).toBe(false);
  });
});
