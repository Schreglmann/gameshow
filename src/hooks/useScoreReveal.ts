import { useEffect, useRef, useState } from 'react';
import { isInactiveShowTab } from '@/services/showPresenceState';
import { ALL_TEAM_KEYS, type TeamKey } from '@/utils/teams';

/** Points per team, for however many teams are in play. */
export type TeamPoints = Record<TeamKey, number>;

export interface ScoreRevealResult {
  /** Animating display values (count up/down toward the real totals), per team. */
  points: TeamPoints;
  /**
   * Increments on each genuine lead flip — the SET of leading teams changed to a
   * different set of teams. Establishing a lead from an all-tie, or settling
   * into an all-tie, is NOT a flip. With two teams this is exactly the old rule
   * (the sign of `team1 - team2` flipped). Consumers watch this to fire a
   * "Führungswechsel!" banner + sting. See specs/score-reveal.md.
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
 * Who is in front, as a stable, comparable string. `''` when every active team
 * is level — a universal tie is "no leader", so moving out of it (or into it)
 * never counts as a flip.
 */
function leaderSignature(points: TeamPoints, keys: readonly TeamKey[]): string {
  if (keys.length === 0) return '';
  const max = Math.max(...keys.map(k => points[k]));
  const leaders = keys.filter(k => points[k] === max);
  return leaders.length === keys.length ? '' : leaders.join(',');
}

function samePoints(a: TeamPoints, b: TeamPoints, keys: readonly TeamKey[]): boolean {
  return keys.every(k => a[k] === b[k]);
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
export function useScoreReveal(points: TeamPoints, keys: readonly TeamKey[]): ScoreRevealResult {
  const [display, setDisplay] = useState<TeamPoints>(points);
  const [leadChangeKey, setLeadChangeKey] = useState(0);
  const displayRef = useRef<TeamPoints>(points);
  const prevTargetRef = useRef<TeamPoints>(points);
  const rafRef = useRef<number | null>(null);

  // The effect must re-run when any active total changes, but `points` is a
  // fresh object every render — depend on the VALUES, not the reference, or the
  // animation restarts on every unrelated re-render (background music re-renders
  // the whole show tree ~10×/s).
  const signature = ALL_TEAM_KEYS.map(k => points[k]).join(',');
  const keySignature = keys.join(',');

  useEffect(() => {
    const prev = prevTargetRef.current;
    const target = { ...points };
    if (samePoints(prev, target, keys)) return;

    if (leaderSignature(prev, keys) !== leaderSignature(target, keys)
      && leaderSignature(prev, keys) !== ''
      && leaderSignature(target, keys) !== '') {
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
      const cur = { ...target };
      for (const k of ALL_TEAM_KEYS) {
        cur[k] = Math.round(start[k] + (target[k] - start[k]) * ease);
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, keySignature]);

  return { points: display, leadChangeKey };
}
