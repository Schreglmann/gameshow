import { useState, useMemo } from 'react';
import { randomizeQuestions } from '@/utils/questions';
import { getStableSeed } from '@/utils/gamePlaythroughStore';

/**
 * Returns the shuffled question list for a playing game with a **stable** order.
 *
 * The seed is generated once per component mount (lazy `useState` initializer),
 * so it survives same-`gameId` live re-fetches (the component does not remount).
 * That keeps the randomized order fixed for the whole playthrough: a live edit to
 * a question's content updates that question in place instead of re-shuffling the
 * deck. The seed only regenerates on a real remount / page reload, where the
 * current question index resets anyway. See specs/live-config-reload.md.
 *
 * When a `gameId` is passed, the seed is instead sourced from the session
 * playthrough store, so it survives a REMOUNT too: re-entering the game via
 * back-navigation reproduces the exact order it was played in. See
 * specs/game-back-review.md.
 */
export function useShuffledQuestions<T extends { disabled?: boolean }>(
  questions: T[],
  shouldRandomize?: boolean,
  limit?: number,
  gameId?: string,
): T[] {
  const [seed] = useState(() => {
    const gen = () => Math.floor(Math.random() * 0xffffffff);
    return gameId ? getStableSeed(gameId, gen) : gen();
  });
  return useMemo(
    () => randomizeQuestions(questions, shouldRandomize, limit, seed),
    [questions, shouldRandomize, limit, seed],
  );
}
