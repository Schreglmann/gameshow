import { describe, it, expect } from 'vitest';
import { randomizeQuestions, formatNumber } from '@/utils/questions';

describe('randomizeQuestions', () => {
  it('returns a copy of the original array when shouldRandomize is false', () => {
    const questions = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = randomizeQuestions(questions, false);
    expect(result).toEqual(questions);
    expect(result).not.toBe(questions); // new array
  });

  it('returns a copy of the original array when shouldRandomize is undefined', () => {
    const questions = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const result = randomizeQuestions(questions);
    expect(result).toEqual(questions);
  });

  it('returns a copy unchanged when there is only one question', () => {
    const questions = [{ id: 1 }];
    const result = randomizeQuestions(questions, true);
    expect(result).toEqual([{ id: 1 }]);
  });

  it('returns empty array for empty input', () => {
    const result = randomizeQuestions([], true);
    expect(result).toEqual([]);
  });

  it('preserves the first element (example question) when randomizing', () => {
    const questions = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    const result = randomizeQuestions(questions, true);
    expect(result[0]).toEqual({ id: 0 });
    expect(result).toHaveLength(20);
  });

  it('contains all original elements after randomization', () => {
    const questions = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = randomizeQuestions(questions, true);
    const sortedResult = [...result].sort((a, b) => a.id - b.id);
    expect(sortedResult).toEqual(questions);
  });

  it('does not mutate the original array', () => {
    const questions = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    const original = [...questions];
    randomizeQuestions(questions, true);
    expect(questions).toEqual(original);
  });

  it('limits questions to the specified count (no randomization)', () => {
    const questions = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    const result = randomizeQuestions(questions, false, 3);
    expect(result).toHaveLength(4); // 1 example + 3 limited
    expect(result[0]).toEqual({ id: 0 }); // example preserved
    expect(result[1]).toEqual({ id: 1 });
    expect(result[2]).toEqual({ id: 2 });
    expect(result[3]).toEqual({ id: 3 });
  });

  it('limits questions to the specified count (with randomization)', () => {
    const questions = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    const result = randomizeQuestions(questions, true, 5);
    expect(result).toHaveLength(6); // 1 example + 5 limited
    expect(result[0]).toEqual({ id: 0 }); // example preserved
  });

  it('returns all questions when limit exceeds available count', () => {
    const questions = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const result = randomizeQuestions(questions, false, 100);
    expect(result).toHaveLength(5); // all questions returned
  });

  it('ignores limit when undefined', () => {
    const questions = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const result = randomizeQuestions(questions, false, undefined);
    expect(result).toHaveLength(5);
  });

  it('actually shuffles the rest of the elements (probabilistic)', () => {
    // With 20 elements, it's astronomically unlikely to stay in order
    const questions = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    let wasShuffled = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      const result = randomizeQuestions(questions, true);
      const rest = result.slice(1);
      const isInOrder = rest.every((item, idx) => item.id === idx + 1);
      if (!isInOrder) {
        wasShuffled = true;
        break;
      }
    }
    expect(wasShuffled).toBe(true);
  });

  it('produces an unbiased distribution (no item over-represented at first position)', () => {
    // Regression: `.sort(() => Math.random() - 0.5)` is biased and leaves
    // items near their original positions far more often than chance.
    const n = 10;
    const trials = 5000;
    const questions = Array.from({ length: n + 1 }, (_, i) => ({ id: i }));
    const firstSlotCounts = new Array<number>(n).fill(0);
    for (let t = 0; t < trials; t++) {
      const result = randomizeQuestions(questions, true);
      firstSlotCounts[result[1].id - 1]++;
    }
    const expected = trials / n;
    // Allow ±30% deviation — biased shuffle peaks >2× expected at id=1
    for (const count of firstSlotCounts) {
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(expected * 1.3);
    }
  });

  describe('with a deterministic seed', () => {
    it('produces an identical permutation for the same seed and length', () => {
      const questions = Array.from({ length: 12 }, (_, i) => ({ id: i }));
      const a = randomizeQuestions(questions, true, undefined, 12345);
      const b = randomizeQuestions(questions, true, undefined, 12345);
      expect(a.map(q => q.id)).toEqual(b.map(q => q.id));
    });

    it('keeps every question at the same position when content is edited (same length, new objects)', () => {
      // Simulates a live content edit: a fresh array of equal length where the
      // question at one position has new content. With a stable seed the shuffled
      // ORDER (by stable key) must be unchanged so the edit lands in place.
      const original = Array.from({ length: 10 }, (_, i) => ({ id: i, text: `q${i}` }));
      const seed = 0xabcdef;
      const before = randomizeQuestions(original, true, undefined, seed);

      const edited = original.map(q => ({ ...q })); // new object identities
      edited[4] = { id: 4, text: 'edited' };        // content change at position 4
      const after = randomizeQuestions(edited, true, undefined, seed);

      // Same order of ids; only the edited question's text differs at its slot.
      expect(after.map(q => q.id)).toEqual(before.map(q => q.id));
      const editedSlot = after.findIndex(q => q.id === 4);
      expect(after[editedSlot].text).toBe('edited');
    });

    it('seeded output is still a valid permutation with the example fixed at index 0', () => {
      const questions = Array.from({ length: 15 }, (_, i) => ({ id: i }));
      const result = randomizeQuestions(questions, true, undefined, 777);
      expect(result[0]).toEqual({ id: 0 }); // example preserved
      expect([...result].sort((a, b) => a.id - b.id)).toEqual(questions);
    });

    it('different seeds generally produce different orders', () => {
      const questions = Array.from({ length: 15 }, (_, i) => ({ id: i }));
      const a = randomizeQuestions(questions, true, undefined, 1);
      const b = randomizeQuestions(questions, true, undefined, 2);
      expect(a.map(q => q.id)).not.toEqual(b.map(q => q.id));
    });

    it('still respects the limit deterministically', () => {
      const questions = Array.from({ length: 20 }, (_, i) => ({ id: i }));
      const a = randomizeQuestions(questions, true, 5, 42);
      const b = randomizeQuestions(questions, true, 5, 42);
      expect(a).toHaveLength(6); // 1 example + 5
      expect(a.map(q => q.id)).toEqual(b.map(q => q.id));
    });
  });
});

describe('formatNumber', () => {
  it('formats small numbers without separator', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(999)).toBe('999');
  });

  it('leaves numbers below 2050 ungrouped so years read correctly', () => {
    expect(formatNumber(1000)).toBe('1000');
    expect(formatNumber(1492)).toBe('1492');
    expect(formatNumber(2000)).toBe('2000');
    expect(formatNumber(2049)).toBe('2049');
  });

  it('groups numbers from 2050 upward with dot separator', () => {
    expect(formatNumber(2050)).toBe('2.050');
    expect(formatNumber(9999)).toBe('9.999');
  });

  it('formats millions with dot separators', () => {
    expect(formatNumber(1000000)).toBe('1.000.000');
    expect(formatNumber(1234567)).toBe('1.234.567');
  });

  it('formats large numbers correctly', () => {
    expect(formatNumber(1000000000)).toBe('1.000.000.000');
  });

  it('handles negative numbers', () => {
    expect(formatNumber(-1234)).toBe('-1234');
    expect(formatNumber(-12345)).toBe('-12.345');
  });
});
