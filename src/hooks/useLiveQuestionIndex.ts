import { useState, useCallback, useEffect } from 'react';
import type { QuestionOrderHandle } from '@/hooks/useQuestionOrder';

/**
 * The current question index of a playing game, kept attached to its question
 * when the game's questions are edited live.
 *
 * Drop-in replacement for the `useState` every game component used to hold its
 * `qIdx` in. When the deck moves — a question was deleted ahead of or behind the
 * cursor, or one was appended — the index is remapped so the **same question
 * stays on screen**. See specs/live-question-order.md.
 *
 * Returns `[qIdx, setQIdx, qKey]`. `qKey` is the question's stable identity:
 * key per-question effects (audio playback, timers, animations, auto-scroll) on
 * it rather than on `qIdx`, so a compensating shift doesn't restart them. Keep
 * `qIdx` where the index itself is the point — notably the gamemaster payload,
 * whose question number *should* drop when an earlier question is deleted.
 */
export function useLiveQuestionIndex(
  order: QuestionOrderHandle,
  resumeAtEnd?: boolean,
): [number, React.Dispatch<React.SetStateAction<number>>, number] {
  const [state, setState] = useState(() => ({
    idx: resumeAtEnd ? order.resumeIndex : 0,
    rev: order.revision,
  }));

  // Adjusted during render, NOT in an effect: an effect commits after paint, so
  // the shift frame would paint the new question list at the old index — one
  // frame of the wrong question in front of an audience. React re-runs the
  // component immediately on a set-during-render without committing anything.
  let idx = state.idx;
  if (state.rev !== order.revision) {
    idx = order.remap(state.idx);
    setState({ idx, rev: order.revision });
  }

  const setIdx = useCallback<React.Dispatch<React.SetStateAction<number>>>(value => {
    setState(prev => ({
      rev: prev.rev,
      idx: typeof value === 'function' ? value(prev.idx) : value,
    }));
  }, []);

  const { note } = order;
  useEffect(() => {
    note(idx);
  }, [note, idx]);

  return [idx, setIdx, order.slotKeys[idx] ?? idx];
}
