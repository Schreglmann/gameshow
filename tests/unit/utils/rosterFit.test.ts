import { describe, it, expect } from 'vitest';
import { firstFitting, maxRosterColumns, ROSTER_FONT_STEPS } from '@/utils/rosterFit';

describe('rosterFit helpers', () => {
  it('allows 3 columns with two teams and 2 with three or four', () => {
    expect(maxRosterColumns(2)).toBe(3);
    expect(maxRosterColumns(3)).toBe(2);
    expect(maxRosterColumns(4)).toBe(2);
  });

  it('firstFitting returns the first accepted option, or the last when none fits', () => {
    expect(firstFitting([1, 2, 3], c => c >= 2)).toBe(2);
    expect(firstFitting([1, 2, 3], () => false)).toBe(3);
    expect(firstFitting([1, 2, 3], () => true)).toBe(1);
  });

  it('tries the full font size first and never goes below 50%', () => {
    expect(ROSTER_FONT_STEPS[0]).toBe(1);
    expect(Math.min(...ROSTER_FONT_STEPS)).toBe(0.5);
  });
});
