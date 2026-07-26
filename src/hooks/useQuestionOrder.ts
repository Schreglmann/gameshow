import { useState, useMemo, useRef } from 'react';
import {
  reconcileOrder,
  playQuestions,
  playSlotKeys,
  type PlayOrder,
} from '@/utils/questionOrder';
import {
  getStableSeed,
  getPlayOrder,
  setPlayOrder,
  getHighWater,
  noteHighWater,
} from '@/utils/gamePlaythroughStore';

/**
 * The live-stable play order of a game, as consumed by its components.
 * Everything here is expressed in **play indices**: 0 is the example question,
 * 1..n the questions in the order they will be asked.
 */
export interface QuestionOrderHandle {
  /** Bumps only when the deck actually moved, i.e. only when a held question
   *  index needs remapping. A pure content edit leaves it untouched. */
  revision: number;
  /** `slotKeys[playIdx]` — the question's stable identity, unchanged when a
   *  deletion shifts its index. Key per-question effects on this, not on the
   *  index, so a compensating shift doesn't restart audio / re-arm timers. */
  slotKeys: number[];
  /** Where the cursor should follow a question that moved. Clamped into range. */
  remap: (prevPlayIdx: number) => number;
  /** Where each question moved, or `null` if it was deleted. For per-question
   *  data that must not be re-attributed to a neighbour. */
  moved: readonly (number | null)[];
  /** A stable seed for whatever a single question shuffles or picks internally
   *  (clue order, candidate pool, random video frame). Derived from the game
   *  seed and the question's slot, so it is fresh per playthrough but survives
   *  both a live edit and an index shift — the alternative, an unseeded
   *  `useMemo` keyed on the question object, re-rolls on every live re-fetch. */
  slotSeed: (playIdx: number) => number;
  /** Play index a back-review should resume at — never past the furthest
   *  question actually asked, so an appended question is not shown as "played". */
  resumeIndex: number;
  /** Records how far the show has got. Safe to call on every question change. */
  note: (playIdx: number) => void;
}

/**
 * Returns a game's question list in **live-stable play order**, plus the handle
 * needed to keep a held question index attached to its question.
 *
 * The order is not re-derived from `(seed, length)` on every render but
 * reconciled against the previous order, so adding or removing a question while
 * the game is being played no longer re-deals the deck. Pair it with
 * `useLiveQuestionIndex` in any component that tracks a current question.
 * See specs/live-question-order.md.
 *
 * With a `gameId` the order is stored per game for the session, so re-entering
 * the game via back-navigation reproduces the exact deck it was played with
 * (specs/game-back-review.md). Without one it lives for the component's lifetime.
 */
export function useQuestionOrder<T extends { disabled?: boolean }>(
  questions: T[],
  shouldRandomize?: boolean,
  limit?: number,
  gameId?: string,
): { questions: T[]; order: QuestionOrderHandle } {
  const [seed] = useState(() => {
    const gen = () => Math.floor(Math.random() * 0xffffffff);
    return gameId ? getStableSeed(gameId, gen) : gen();
  });
  // Fallback storage for callers without a gameId (tests, and any game rendered
  // outside the show's routing). Per-mount, matching the old seed behaviour.
  const localOrder = useRef<PlayOrder | null>(null);
  const localHighWater = useRef(0);

  const order = useMemo(() => {
    const prev = gameId ? getPlayOrder(gameId, () => seed) : localOrder.current;
    const next = reconcileOrder(prev, questions, { randomize: shouldRandomize, limit, seed });
    // Writing during render is safe here precisely because `reconcileOrder`
    // returns the *same* object when nothing changed — StrictMode's double
    // invocation reconciles the second time against the result of the first and
    // is a no-op. See the idempotence tests in tests/unit/utils/questionOrder.test.ts.
    if (gameId) setPlayOrder(gameId, next);
    else localOrder.current = next;
    return next;
  }, [questions, shouldRandomize, limit, seed, gameId]);

  const played = useMemo(() => playQuestions(order, questions), [order, questions]);
  const slotKeys = useMemo(() => playSlotKeys(order, questions.length), [order, questions.length]);

  const handle = useMemo<QuestionOrderHandle>(() => {
    const lastIdx = Math.max(0, played.length - 1);
    const highWater = gameId ? getHighWater(gameId) : localHighWater.current;
    return {
      revision: order.revision,
      slotKeys,
      moved: order.moved,
      remap: (prevPlayIdx: number) => {
        const mapped = order.remap[prevPlayIdx] ?? prevPlayIdx;
        return Math.min(Math.max(mapped, 0), lastIdx);
      },
      slotSeed: (playIdx: number) =>
        (order.seed ^ Math.imul(slotKeys[playIdx] ?? playIdx, 0x9e3779b1)) >>> 0,
      // Falling back to the last question when nothing was recorded keeps the
      // pre-high-water behaviour for a game entered with a cleared store.
      resumeIndex: highWater > 0 ? Math.min(highWater, lastIdx) : lastIdx,
      note: (playIdx: number) => {
        if (gameId) noteHighWater(gameId, playIdx);
        else if (playIdx > localHighWater.current) localHighWater.current = playIdx;
      },
    };
  }, [order, slotKeys, played.length, gameId]);

  return { questions: played, order: handle };
}
