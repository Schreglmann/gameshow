import { useEffect, useRef, useState } from 'react';
import { isInactiveShowTab } from '@/services/showPresenceState';

export interface ScoreRevealResult {
  /** Animating display value for team 1 (counts up/down toward the real total). */
  team1: number;
  /** Animating display value for team 2. */
  team2: number;
  /**
   * Increments on each genuine lead flip (one team overtakes the other).
   * Establishing a lead from a tie, or settling into a tie, is NOT a flip.
   * Consumers watch this to fire a "Führungswechsel!" banner + sting.
   */
  leadChangeKey: number;
}

const DURATION_MS = 600;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Presentational score-reveal: animates the displayed team totals from their
 * previous values to the current ones (count up AND down, so a corrected/undo
 * award animates back down), and signals a lead change. Purely derived — holds
 * previous totals in refs and computes the flip at update time; it stores
 * NOTHING in app state and never dispatches (the reducer/broadcast path is
 * untouched, so the gamemaster is never slowed). Snaps instantly under
 * prefers-reduced-motion or on an inactive show tab. See specs/score-reveal.md.
 */
export function useScoreReveal(team1: number, team2: number): ScoreRevealResult {
  const [display, setDisplay] = useState({ team1, team2 });
  const [leadChangeKey, setLeadChangeKey] = useState(0);
  const displayRef = useRef({ team1, team2 });
  const prevTargetRef = useRef({ team1, team2 });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = prevTargetRef.current;
    const target = { team1, team2 };
    if (prev.team1 === target.team1 && prev.team2 === target.team2) return;

    // Lead flip: the leading team changed. Both diffs must be non-zero and of
    // opposite sign — establishing a lead from a tie or settling to a tie is
    // not a flip.
    const prevDiff = prev.team1 - prev.team2;
    const newDiff = target.team1 - target.team2;
    if (Math.sign(prevDiff) !== 0 && Math.sign(newDiff) !== 0 && Math.sign(prevDiff) !== Math.sign(newDiff)) {
      setLeadChangeKey(k => k + 1);
    }
    prevTargetRef.current = target;

    if (prefersReducedMotion() || isInactiveShowTab()) {
      displayRef.current = target;
      setDisplay(target);
      return;
    }

    const start = { ...displayRef.current };
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTime) / DURATION_MS);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const cur = {
        team1: Math.round(start.team1 + (target.team1 - start.team1) * ease),
        team2: Math.round(start.team2 + (target.team2 - start.team2) * ease),
      };
      displayRef.current = cur;
      setDisplay(cur);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        displayRef.current = target;
        setDisplay(target);
        rafRef.current = null;
      }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [team1, team2]);

  return { team1: display.team1, team2: display.team2, leadChangeKey };
}
