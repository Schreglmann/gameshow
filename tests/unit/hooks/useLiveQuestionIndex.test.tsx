import { describe, it, expect, beforeEach } from 'vitest';
import { StrictMode } from 'react';
import { renderHook, act } from '@testing-library/react';
import { useQuestionOrder } from '@/hooks/useQuestionOrder';
import { useLiveQuestionIndex } from '@/hooks/useLiveQuestionIndex';
import { clearPlaythroughStore } from '@/utils/gamePlaythroughStore';

interface Q { question: string; disabled?: boolean }

const q = (question: string, disabled?: boolean): Q =>
  disabled === undefined ? { question } : { question, disabled };

const src = (...names: string[]): Q[] => [q('Beispiel'), ...names.map(n => q(n))];

interface HarnessProps {
  questions: Q[];
  randomize?: boolean;
  limit?: number;
  gameId?: string;
  resumeAtEnd?: boolean;
}

/** Mirrors how a game component wires the two hooks together. */
function useHarness({ questions, randomize, limit, gameId, resumeAtEnd }: HarnessProps) {
  const { questions: played, order } = useQuestionOrder(questions, randomize, limit, gameId);
  const [qIdx, setQIdx, qKey] = useLiveQuestionIndex(order, resumeAtEnd);
  return { played, order, qIdx, setQIdx, qKey, onScreen: played[qIdx]?.question };
}

describe('useLiveQuestionIndex', () => {
  beforeEach(() => clearPlaythroughStore());

  it('starts at the example question', () => {
    const questions = src('A', 'B');
    const { result } = renderHook(useHarness, { initialProps: { questions } });
    expect(result.current.qIdx).toBe(0);
    expect(result.current.onScreen).toBe('Beispiel');
  });

  it('advances and reports a stable key per question', () => {
    const questions = src('A', 'B');
    const { result } = renderHook(useHarness, { initialProps: { questions } });
    const exampleKey = result.current.qKey;

    act(() => result.current.setQIdx(p => p + 1));
    expect(result.current.onScreen).toBe('A');
    expect(result.current.qKey).not.toBe(exampleKey);
  });

  it('keeps the same question on screen when an earlier one is deleted', () => {
    const questions = src('A', 'B', 'C', 'D');
    const { result, rerender } = renderHook(useHarness, { initialProps: { questions } });

    act(() => result.current.setQIdx(3)); // on 'C'
    expect(result.current.onScreen).toBe('C');
    const keyBefore = result.current.qKey;

    rerender({ questions: [q('Beispiel'), q('A'), q('C'), q('D')] }); // 'B' deleted

    expect(result.current.qIdx).toBe(2);        // question number dropped by one
    expect(result.current.onScreen).toBe('C');  // ...but the question did not move
    expect(result.current.qKey).toBe(keyBefore); // ...and per-question effects don't re-run
  });

  it('leaves the position alone when a later question is deleted', () => {
    const questions = src('A', 'B', 'C', 'D');
    const { result, rerender } = renderHook(useHarness, { initialProps: { questions } });

    act(() => result.current.setQIdx(1)); // on 'A'
    rerender({ questions: [q('Beispiel'), q('A'), q('B'), q('C')] }); // 'D' deleted

    expect(result.current.qIdx).toBe(1);
    expect(result.current.onScreen).toBe('A');
  });

  it('slides the next question in when the on-screen one is deleted', () => {
    const questions = src('A', 'B', 'C');
    const { result, rerender } = renderHook(useHarness, { initialProps: { questions } });

    act(() => result.current.setQIdx(2)); // on 'B'
    const keyBefore = result.current.qKey;
    rerender({ questions: [q('Beispiel'), q('A'), q('C')] }); // 'B' deleted

    expect(result.current.qIdx).toBe(2);
    expect(result.current.onScreen).toBe('C');
    expect(result.current.qKey).not.toBe(keyBefore); // per-question state must reset here
  });

  it('never paints an intermediate wrong question during a shift', () => {
    const questions = src('A', 'B', 'C', 'D');
    const seen: Array<string | undefined> = [];
    const { result, rerender } = renderHook(
      (props: HarnessProps) => {
        const state = useHarness(props);
        seen.push(state.onScreen);
        return state;
      },
      { initialProps: { questions } },
    );

    act(() => result.current.setQIdx(3)); // on 'C'
    seen.length = 0;
    rerender({ questions: [q('Beispiel'), q('A'), q('C'), q('D')] });

    // Every render during the transition shows 'C' — the adjust-during-render
    // remap means the old index is never combined with the new list.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(name => name === 'C')).toBe(true);
  });

  it('clamps when the deck shrinks past the cursor', () => {
    const questions = src('A', 'B', 'C');
    const { result, rerender } = renderHook(useHarness, { initialProps: { questions } });

    act(() => result.current.setQIdx(3)); // on 'C', the last question
    rerender({ questions: [q('Beispiel'), q('A')] }); // 'B' and 'C' deleted

    expect(result.current.qIdx).toBe(1);
    expect(result.current.onScreen).toBe('A');
  });

  it('survives every question being deleted', () => {
    const questions = src('A', 'B');
    const { result, rerender } = renderHook(useHarness, { initialProps: { questions } });

    act(() => result.current.setQIdx(2));
    rerender({ questions: [] as Q[] });

    expect(result.current.qIdx).toBe(0);
    expect(result.current.onScreen).toBeUndefined(); // components null-guard on this
  });

  it('holds position when a question is appended', () => {
    const questions = src('A', 'B');
    const { result, rerender } = renderHook(useHarness, {
      initialProps: { questions, randomize: true, gameId: 'g/v1' },
    });

    act(() => result.current.setQIdx(1));
    const before = result.current.onScreen;
    const keyBefore = result.current.qKey;
    rerender({ questions: [...questions, q('NEU')], randomize: true, gameId: 'g/v1' });

    expect(result.current.qIdx).toBe(1);
    expect(result.current.onScreen).toBe(before);
    expect(result.current.qKey).toBe(keyBefore);
    expect(result.current.played.at(-1)!.question).toBe('NEU');
  });

  it('is stable under StrictMode double rendering', () => {
    const questions = src('A', 'B', 'C', 'D');
    const { result, rerender } = renderHook(useHarness, {
      initialProps: { questions, randomize: true, gameId: 'strict/v1' },
      wrapper: StrictMode,
    });
    const dealt = result.current.played.map(x => x.question);

    act(() => result.current.setQIdx(2));
    const onScreen = result.current.onScreen;

    rerender({ questions, randomize: true, gameId: 'strict/v1' }); // no-op re-fetch
    expect(result.current.played.map(x => x.question)).toEqual(dealt);
    expect(result.current.qIdx).toBe(2);
    expect(result.current.onScreen).toBe(onScreen);
  });

  it('reports where a deleted question went via order.moved', () => {
    const questions = src('A', 'B', 'C');
    const { result, rerender } = renderHook(useHarness, { initialProps: { questions } });

    rerender({ questions: [q('Beispiel'), q('A'), q('C')] }); // 'B' (play index 2) deleted
    expect(result.current.order.moved).toEqual([0, 1, null, 2]);
  });

  describe('resumeAtEnd (back-review)', () => {
    it('opens at the last question', () => {
      const questions = src('A', 'B', 'C');
      const { result } = renderHook(useHarness, { initialProps: { questions, resumeAtEnd: true } });
      expect(result.current.qIdx).toBe(3);
    });

    it('does not open on a question appended after the game was played', () => {
      const questions = src('A', 'B');
      const gameId = 'played/v1';
      // Play the game to the end, then leave it.
      const first = renderHook(useHarness, { initialProps: { questions, gameId } });
      act(() => first.result.current.setQIdx(2));
      first.unmount();

      // A question is appended, then the host back-navigates into the game.
      const after = [...questions, q('NEU')];
      const second = renderHook(useHarness, {
        initialProps: { questions: after, gameId, resumeAtEnd: true },
      });
      expect(second.result.current.qIdx).toBe(2);
      expect(second.result.current.onScreen).toBe('B');
    });
  });
});
