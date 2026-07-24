import { useEffect, useRef, useState } from 'react';
import { playTimerTick, playTimerEnd } from '@/utils/timerSound';

interface DeadlineTimerProps {
  /** Absolute epoch-ms when the timer expires, or null when no timer. Driving
   *  off an absolute deadline (not a local counter) is what makes a reconnecting
   *  show/GM tab show the correct remaining time. */
  endsAt: number | null;
  /** Total duration in seconds, for the ring fraction. */
  totalSeconds: number;
  /** When true, the display freezes at its current value (GM pressed Pause). */
  paused?: boolean;
  /** When true, suppress tick + buzzer audio (used for the GM-side mirror so
   *  only the projector makes sound). */
  silent?: boolean;
  /** When true, suppress only the per-second tick (the "time's up" finish motif
   *  still plays). Driven by the GM's per-game mute-ticking toggle. */
  muteTicks?: boolean;
  /** Fired once when the countdown reaches zero. */
  onComplete?: () => void;
}

const RING_RADIUS = 52;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/**
 * Stage countdown timer for the GM deadline feature. Rendered large on both the
 * show (projector) and the gamemaster screen. Absolute-deadline based so a
 * reconnecting tab shows the correct remaining time; a shrinking ring goes
 * green → yellow → red, an escalating tick plays, and a synthesized "time's up"
 * motif fires at zero. The LOW tick starts once 30s remain (HIGH in the final
 * 10s). See specs/gamemaster-deadline-timer.md.
 */
export default function DeadlineTimer({ endsAt, totalSeconds, paused = false, silent = false, muteTicks = false, onComplete }: DeadlineTimerProps) {
  const [remainingMs, setRemainingMs] = useState<number>(() =>
    endsAt === null ? 0 : Math.max(0, endsAt - Date.now()),
  );
  const completedRef = useRef(false);
  const lastTickSecondRef = useRef<number>(-1);

  // Reset the one-shot completion + tick guards whenever a new deadline starts
  // (endsAt moves forward) so a restarted/extended timer rings and ticks again.
  useEffect(() => {
    completedRef.current = false;
    lastTickSecondRef.current = -1;
    if (endsAt !== null) setRemainingMs(Math.max(0, endsAt - Date.now()));
  }, [endsAt]);

  useEffect(() => {
    if (endsAt === null || paused) return;
    const tick = () => {
      const rem = Math.max(0, endsAt - Date.now());
      setRemainingMs(rem);
      const secs = Math.ceil(rem / 1000);
      // The soft LOW pulse starts once 30 seconds remain, the louder HIGH tick
      // takes over in the final 10 seconds. One tick per whole second (guarded
      // by lastTickSecond). Durations ≤30s therefore tick from the start.
      const inHigh = secs <= 10;
      if (!silent && !muteTicks && rem > 0 && secs <= 30 && secs !== lastTickSecondRef.current) {
        lastTickSecondRef.current = secs;
        playTimerTick(inHigh);
      }
      if (rem <= 0 && !completedRef.current) {
        completedRef.current = true;
        if (!silent) playTimerEnd();
        onComplete?.();
      }
    };
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [endsAt, paused, onComplete, silent, muteTicks]);

  if (endsAt === null) return null;

  const secondsLeft = Math.ceil(remainingMs / 1000);
  const fraction = totalSeconds > 0 ? Math.max(0, Math.min(1, remainingMs / (totalSeconds * 1000))) : 0;
  const isDone = remainingMs <= 0;
  const isCritical = !isDone && secondsLeft <= 5;
  const isLow = !isDone && !isCritical && fraction <= 0.3;

  const className = [
    'deadline-timer',
    isDone && 'deadline-timer--done',
    isLow && 'deadline-timer--low',
    isCritical && 'deadline-timer--critical',
    paused && 'deadline-timer--paused',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} role="timer" aria-label="Countdown">
      <svg className="deadline-timer-ring" viewBox="0 0 120 120" aria-hidden="true">
        <circle className="deadline-timer-ring-track" cx="60" cy="60" r={RING_RADIUS} />
        <circle
          className="deadline-timer-ring-progress"
          cx="60"
          cy="60"
          r={RING_RADIUS}
          style={{
            strokeDasharray: RING_CIRCUMFERENCE,
            strokeDashoffset: RING_CIRCUMFERENCE * (1 - fraction),
          }}
        />
      </svg>
      <div className="deadline-timer-label">
        {isDone ? 'Zeit abgelaufen!' : secondsLeft}
      </div>
    </div>
  );
}
