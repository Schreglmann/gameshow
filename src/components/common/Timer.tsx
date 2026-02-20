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
          // Play timer end sound
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

  return (
    <div
      className={`timer-display${isCritical ? ' shake' : ''}`}
      style={{
        fontSize: '3em',
        fontWeight: 'bold',
        padding: '15px 30px',
        borderRadius: 15,
        background: isLow
          ? 'rgba(255, 59, 48, 0.2)'
          : 'rgba(74, 222, 128, 0.2)',
        border: `2px solid ${isLow ? 'rgba(255, 59, 48, 0.5)' : 'rgba(74, 222, 128, 0.5)'}`,
        color: isLow ? '#ff3b30' : '#4ade80',
        animation: isCritical ? 'pulse 1s ease-in-out infinite' : undefined,
        transition: 'all 0.5s ease',
        margin: '20px 0',
      }}
    >
      {timeLeft}s
    </div>
  );
}
