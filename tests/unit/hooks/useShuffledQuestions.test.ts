import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useShuffledQuestions } from '@/hooks/useShuffledQuestions';
import { clearPlaythroughStore } from '@/utils/gamePlaythroughStore';

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

  describe('stable order across remounts with a gameId', () => {
    beforeEach(() => clearPlaythroughStore());

    it('reproduces the SAME randomized order when re-mounted with the same gameId', () => {
      // Simulates back-navigating into a previous game: the component fully
      // remounts, but the stored seed reproduces the played order.
      const questions = makeQuestions(20);
      const first = renderHook(() => useShuffledQuestions(questions, true, undefined, 'georgs-quiz/v1'));
      const firstOrder = first.result.current.map(q => q.id);
      first.unmount();

      const second = renderHook(() => useShuffledQuestions(questions, true, undefined, 'georgs-quiz/v1'));
      expect(second.result.current.map(q => q.id)).toEqual(firstOrder);
    });

    it('without a gameId, a fresh mount re-shuffles (probabilistic)', () => {
      const questions = makeQuestions(30);
      const first = renderHook(() => useShuffledQuestions(questions, true));
      const firstOrder = first.result.current.map(q => q.id);
      first.unmount();
      const second = renderHook(() => useShuffledQuestions(questions, true));
      // Two independent 29-item shuffles are astronomically unlikely to match.
      expect(second.result.current.map(q => q.id)).not.toEqual(firstOrder);
    });
  });
});
