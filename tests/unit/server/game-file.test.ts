import { describe, it, expect } from 'vitest';
import { convertToMultiInstance } from '../../../server/game-file.js';

/** Mirror the server's instance-resolution merge so we can assert the round-trip. */
function mergeInstance(multi: Record<string, any>, key: string): Record<string, unknown> {
  const { instances, ...base } = multi;
  return { ...base, ...instances[key] };
}

describe('convertToMultiInstance', () => {
  it('moves questions into instance v1, keeping base fields at the top', () => {
    const single = {
      type: 'simple-quiz',
      title: 'Allgemeinwissen',
      rules: ['Regel A'],
      randomizeQuestions: true,
      questions: [{ question: 'Q1', answer: 'A1' }],
    };
    const converted = convertToMultiInstance(single);
    expect(converted).toEqual({
      type: 'simple-quiz',
      title: 'Allgemeinwissen',
      rules: ['Regel A'],
      randomizeQuestions: true,
      instances: { v1: { questions: [{ question: 'Q1', answer: 'A1' }] } },
    });
  });

  it('round-trips: merging base + v1 reconstructs the original config', () => {
    const single = {
      type: 'simple-quiz',
      title: 'Trump oder Hitler',
      rules: ['Regel A', 'Regel B'],
      questions: [{ question: 'Q', answer: 'A', info: 'i' }],
    };
    const converted = convertToMultiInstance(single);
    expect(mergeInstance(converted, 'v1')).toEqual(single);
  });

  it('keeps non-questions content (quizjagd shape, _players) inside v1', () => {
    const single = {
      type: 'quizjagd',
      title: 'Jagd',
      easy: [{ question: 'e' }],
      medium: [{ question: 'm' }],
      hard: [{ question: 'h' }],
      _players: ['Anna'],
    };
    const converted = convertToMultiInstance(single);
    expect(converted.instances).toEqual({
      v1: {
        easy: [{ question: 'e' }],
        medium: [{ question: 'm' }],
        hard: [{ question: 'h' }],
        _players: ['Anna'],
      },
    });
    expect(mergeInstance(converted, 'v1')).toEqual(single);
  });

  it('omits absent optional base fields (no rules / randomizeQuestions key)', () => {
    const converted = convertToMultiInstance({ type: 'simple-quiz', title: 'X', questions: [] });
    expect(converted).not.toHaveProperty('rules');
    expect(converted).not.toHaveProperty('randomizeQuestions');
    expect(converted).toEqual({ type: 'simple-quiz', title: 'X', instances: { v1: { questions: [] } } });
  });

  it('is idempotent — a file that already has instances is returned unchanged', () => {
    const multi = {
      type: 'simple-quiz',
      title: 'X',
      instances: { v1: { questions: [] }, v2: { questions: [] } },
    };
    expect(convertToMultiInstance(multi)).toBe(multi);
  });
});
