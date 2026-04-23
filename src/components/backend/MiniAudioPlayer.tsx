import { useCallback, useEffect, useRef } from 'react';
import { useSharedAudio } from './useSharedAudio';
import { useAudioSpaceToggle } from './useAudioSpaceToggle';

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

export default function MiniAudioPlayer({ src, className, style, onClick }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { isPlaying, currentTime, duration, play, pause, seek, ensureLoaded } = useSharedAudio(src);

  // Lazy-load metadata only when scrolled into view (keeps long picker lists light)
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { ensureLoaded('metadata'); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [ensureLoaded]);

  const toggle = useCallback(() => {
    if (isPlaying) pause();
    else { ensureLoaded('metadata'); play(); }
  }, [isPlaying, pause, play, ensureLoaded]);

  useAudioSpaceToggle(containerRef, toggle);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggle();
  };

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
    seek(t);
    play();
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
