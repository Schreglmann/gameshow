import { describe, it, expect } from 'vitest';
import { toTitleCaseName } from '@/utils/filename';

describe('toTitleCaseName', () => {
  it('uppercases the first letter of each word', () => {
    expect(toTitleCaseName('matthew mercer')).toBe('Matthew Mercer');
  });

  it('lowercases all-caps input and preserves single spaces', () => {
    expect(toTitleCaseName('MATTHEW MERCER')).toBe('Matthew Mercer');
  });

  it('trims and collapses runs of whitespace', () => {
    expect(toTitleCaseName('  MATTHEW   MERCER  ')).toBe('Matthew Mercer');
  });

  it('handles a single word', () => {
    expect(toTitleCaseName('one')).toBe('One');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(toTitleCaseName('   ')).toBe('');
    expect(toTitleCaseName('')).toBe('');
  });

  it('uppercases Unicode letters (umlauts)', () => {
    expect(toTitleCaseName('mit umlaut äöü')).toBe('Mit Umlaut Äöü');
  });

  it('handles mixed casing input', () => {
    expect(toTitleCaseName('mAtThEw MeRcEr')).toBe('Matthew Mercer');
  });
});
