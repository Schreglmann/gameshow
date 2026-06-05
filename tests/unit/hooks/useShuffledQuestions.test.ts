import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';

type Q = { id: number; text: string };

const makeQuestions = (n: number): Q[] =>
  Array.from({ length: n }, (_, i) => ({ id: i, text: `q${i}` }));

describe('useShuffledQuestions', () => {
  it('keeps the shuffled order stable across re-renders with a new questions reference', () => {
    // Mirrors the live-edit bug: the parent re-fetches and passes a fresh array
    // (new identity) of equal length. The hook must NOT re-shuffle.
    const initial = makeQuestions(12);
    const { result, rerender } = renderHook(
      ({ questions }) => useShuffledQuestions(questions, true),
      { initialProps: { questions: initial } },
    );
    const firstOrder = result.current.map(q => q.id);

    // New array, same length, one question's content edited.
    const edited = initial.map(q => ({ ...q }));
    edited[5] = { id: 5, text: 'edited' };
    rerender({ questions: edited });

    expect(result.current.map(q => q.id)).toEqual(firstOrder);
    const slot = result.current.findIndex(q => q.id === 5);
    expect(result.current[slot].text).toBe('edited');
  });

  it('does not shuffle when randomization is disabled', () => {
    const questions = makeQuestions(8);
    const { result } = renderHook(() => useShuffledQuestions(questions, false));
    expect(result.current.map(q => q.id)).toEqual(questions.map(q => q.id));
  });

  it('actually randomizes the order when enabled (probabilistic)', () => {
    // A single mount with 20 items is astronomically unlikely to stay in order.
    const questions = makeQuestions(20);
    const { result } = renderHook(() => useShuffledQuestions(questions, true));
    const rest = result.current.slice(1);
    const inOrder = rest.every((q, i) => q.id === i + 1);
    expect(result.current[0].id).toBe(0); // example fixed
    expect([...result.current].sort((a, b) => a.id - b.id)).toEqual(questions);
    expect(inOrder).toBe(false);
  });
});
