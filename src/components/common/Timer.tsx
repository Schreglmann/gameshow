import { useState, useEffect, useRef } from 'react';
import { playTimerTick, playTimerEnd } from '@/utils/timerSound';

interface TimerProps {
  seconds: number;
  onComplete?: () => void;
  running: boolean;
}

export default function Timer({ seconds, onComplete, running }: TimerProps) {
  const [timeLeft, setTimeLeft] = useState(seconds);
  const intervalRef = useRef<number | null>(null);

  // Keep the latest onComplete in a ref so the countdown effect does NOT depend
  // on its identity. Callers pass an inline arrow that changes every render;
  // when a fast re-render source is mounted (e.g. background music updates the
  // MusicContext currentTime every 100ms, re-rendering the whole route subtree),
  // an `onComplete` dependency would clear + restart the 1s interval before it
  // ever fires — freezing the timer at its full value (looks like it "never
  // started"). The effect now runs only on `running`.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    setTimeLeft(seconds);
  }, [seconds]);

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return;
    }

    intervalRef.current = window.setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          // Synthesized "time's up" — same sound theme as the GM countdown.
          playTimerEnd();
          onCompleteRef.current?.();
          return 0;
        }
        const next = prev - 1;
        // Game-set timer: soft LOW tick from 30s in, louder HIGH tick in the
        // final 10 seconds (shared synth with the GM deadline timer).
        if (next <= 30 && next > 0) playTimerTick(next <= 10);
        return next;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running]);

  const fraction = timeLeft / seconds;
  const isLow = fraction <= 0.3;
  const isCritical = timeLeft <= 5;

  const isDone = timeLeft === 0 && !running;

  const className = [
    'timer-display',
    isDone && 'timer-display--done',
    !isDone && isLow && 'timer-display--low',
    !isDone && isCritical && 'timer-display--critical',
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      {isDone ? 'Zeit abgelaufen!' : timeLeft}
    </div>
  );
}
