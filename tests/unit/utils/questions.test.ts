import { describe, it, expect, vi } from 'vitest';
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
});

describe('formatNumber', () => {
  it('formats small numbers without separator', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1)).toBe('1');
    expect(formatNumber(999)).toBe('999');
  });

  it('formats thousands with dot separator', () => {
    expect(formatNumber(1000)).toBe('1.000');
    expect(formatNumber(1234)).toBe('1.234');
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
    expect(formatNumber(-1234)).toBe('-1.234');
  });
});
