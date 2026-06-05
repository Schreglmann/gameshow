import { useState, useMemo } from 'react';
import { randomizeQuestions } from '@/utils/questions';

/**
 * Returns the shuffled question list for a playing game with a **stable** order.
 *
 * The seed is generated once per component mount (lazy `useState` initializer),
 * so it survives same-`gameId` live re-fetches (the component does not remount).
 * That keeps the randomized order fixed for the whole playthrough: a live edit to
 * a question's content updates that question in place instead of re-shuffling the
 * deck. The seed only regenerates on a real remount / page reload, where the
 * current question index resets anyway. See specs/live-config-reload.md.
 */
export function useShuffledQuestions<T extends { disabled?: boolean }>(
  questions: T[],
  shouldRandomize?: boolean,
  limit?: number,
): T[] {
  const [seed] = useState(() => Math.floor(Math.random() * 0xffffffff));
  return useMemo(
    () => randomizeQuestions(questions, shouldRandomize, limit, seed),
    [questions, shouldRandomize, limit, seed],
  );
}
