import { describe, it, expect } from 'vitest';
import { convertToMultiInstance, selectableInstanceKeys, gameshowPlayedContent } from '../../../server/game-file.js';

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

  it('keeps non-questions content (quizjagd shape) inside v1', () => {
    const single = {
      type: 'quizjagd',
      title: 'Jagd',
      easy: [{ question: 'e' }],
      medium: [{ question: 'm' }],
      hard: [{ question: 'h' }],
    };
    const converted = convertToMultiInstance(single);
    expect(converted.instances).toEqual({
      v1: {
        easy: [{ question: 'e' }],
        medium: [{ question: 'm' }],
        hard: [{ question: 'h' }],
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

describe('selectableInstanceKeys', () => {
  it('hides the archive when another instance has questions', () => {
    expect(selectableInstanceKeys({
      v1: { questions: [{ question: 'Q' }] },
      archive: { questions: [{ question: 'A' }] },
    })).toEqual(['v1']);
  });

  it('exposes the archive as fallback when no other instance has questions', () => {
    expect(selectableInstanceKeys({
      v1: { questions: [] },
      archive: { questions: [{ question: 'A' }] },
    })).toEqual(['v1', 'archive']);
  });

  it('counts quizjagd-shaped questions', () => {
    expect(selectableInstanceKeys({
      v1: { questions: { easy: [{ question: 'Q' }], medium: [], hard: [] } },
      archive: { questions: [] },
    })).toEqual(['v1']);
  });
});

describe('gameshowPlayedContent', () => {
  const multi = {
    type: 'simple-quiz',
    title: 'Märchen',
    instances: {
      v1: { questions: [{ question: 'Q', answerImage: '/images/a.png' }] },
      v2: { questions: [{ question: 'R', answerImage: '/images/c.png' }] },
      archive: { questions: [{ question: 'A', answerImage: '/images/b.png' }] },
    },
  };

  it('keeps only the instances a gameshow references', () => {
    expect(gameshowPlayedContent(multi, ['v1'])).toEqual({
      type: 'simple-quiz',
      title: 'Märchen',
      instances: { v1: { questions: [{ question: 'Q', answerImage: '/images/a.png' }] } },
    });
  });

  it('keeps the archive when a gameshow references it', () => {
    expect(gameshowPlayedContent(multi, ['archive'])).toEqual({
      type: 'simple-quiz',
      title: 'Märchen',
      instances: { archive: { questions: [{ question: 'A', answerImage: '/images/b.png' }] } },
    });
  });

  it('returns null when no gameshow plays any instance', () => {
    expect(gameshowPlayedContent(multi, [])).toBeNull();
    expect(gameshowPlayedContent(multi, ['v9', null])).toBeNull();
  });

  it('returns a referenced single-instance file whole, an unreferenced one as null', () => {
    const file = { type: 'simple-quiz', questions: [{ question: 'Q' }] };
    expect(gameshowPlayedContent(file, [null])).toBe(file);
    expect(gameshowPlayedContent(file, [])).toBeNull();
  });
});
