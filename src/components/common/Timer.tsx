import { useState, useEffect, useRef } from 'react';

interface TimerProps {
  seconds: number;
  onComplete?: () => void;
  running: boolean;
}

export default function Timer({ seconds, onComplete, running }: TimerProps) {
  const [timeLeft, setTimeLeft] = useState(seconds);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<number | null>(null);

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
          try {
            audioRef.current = new Audio('/audio/timer-end.mp3');
            audioRef.current.play().catch(() => {});
          } catch {
            // Ignore audio errors
          }
          onComplete?.();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [running, onComplete]);

  const fraction = timeLeft / seconds;
  const isLow = fraction <= 0.3;
  const isCritical = timeLeft <= 5;

  const className = [
    'timer-display',
    isLow && 'timer-display--low',
    isCritical && 'timer-display--critical',
  ].filter(Boolean).join(' ');

  return (
    <div className={className}>
      {timeLeft}s
    </div>
  );
}
