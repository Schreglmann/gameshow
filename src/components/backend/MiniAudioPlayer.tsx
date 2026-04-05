import { useState, useEffect, useRef } from 'react';

interface Props {
  src: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// Module-level: pause any other player when a new one starts
let currentlyPlaying: HTMLAudioElement | null = null;

function startAudio(audio: HTMLAudioElement) {
  if (currentlyPlaying && currentlyPlaying !== audio) {
    currentlyPlaying.pause();
    currentlyPlaying.currentTime = 0;
  }
  currentlyPlaying = audio;
  audio.play().catch(() => {});
}

export default function MiniAudioPlayer({ src, className, style, onClick }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const audio = new Audio(src);
    audio.preload = 'none';
    audioRef.current = audio;

    const onMeta = () => { if (isFinite(audio.duration)) setDuration(audio.duration); };
    const onTime = () => setCurrentTime(audio.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      setIsPlaying(false);
      if (currentlyPlaying === audio) currentlyPlaying = null;
    };

    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('durationchange', onMeta);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    // Lazy-load metadata only when the player scrolls into view
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { audio.load(); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    if (containerRef.current) observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      audio.pause();
      audio.src = ''; // release network connection
      if (currentlyPlaying === audio) currentlyPlaying = null;
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('durationchange', onMeta);
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audioRef.current = null;
    };
  }, [src]);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) startAudio(audio);
    else audio.pause();
  };

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
    audio.currentTime = t;
    setCurrentTime(t);
    startAudio(audio);
  };

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      className={`mini-player${className ? ` ${className}` : ''}`}
      style={style}
      onClick={e => { e.stopPropagation(); onClick?.(e); }}
    >
      <div
        className="mini-player-btn"
        role="button"
        tabIndex={0}
        onClick={togglePlay}
        onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); togglePlay(e as unknown as React.MouseEvent); } }}
        title={isPlaying ? 'Pause' : 'Abspielen'}
      >
        {isPlaying ? (
          <svg width="8" height="8" viewBox="0 0 12 14" fill="currentColor">
            <rect x="0" y="0" width="4" height="14" rx="1" />
            <rect x="8" y="0" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg width="7" height="8" viewBox="0 0 12 14" fill="currentColor">
            <polygon points="0,0 12,7 0,14" />
          </svg>
        )}
      </div>
      <span className="mini-player-time">
        {fmt(currentTime)}{duration > 0 ? ` / ${fmt(duration)}` : ''}
      </span>
      <div className="mini-player-bar" onClick={handleBarClick}>
        <div className="mini-player-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
