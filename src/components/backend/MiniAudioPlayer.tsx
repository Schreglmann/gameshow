import { useCallback, useEffect, useRef } from 'react';
import { useSharedAudio } from './useSharedAudio';
import { useAudioSpaceToggle } from './useAudioSpaceToggle';

interface Props {
  /** DOM-ready URL — already run through `toMediaSrc()` / `assetUrl()`. Sharing state
   * with a sibling AudioTrimTimeline requires both to pass the identical string. */
  src: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: (e: React.MouseEvent) => void;
  /** Optional pool scope — pass the same scope here and to a sibling AudioTrimTimeline
   * to share state between them, or distinct scopes between two players that point
   * at the same file but should play independently (e.g. question/answer audio). */
  scope?: string;
  /** Trim of the field this player belongs to (seconds). With either set, the player
   * previews the CLIP: play jumps to `start`, playback stops at `end`, and bar +
   * timestamp are relative to `start` — the same window the show plays. Pass the same
   * values given to the sibling AudioTrimTimeline; the timeline need not be expanded. */
  start?: number;
  end?: number;
  /** Restart at `start` instead of stopping when `end` is reached. */
  loop?: boolean;
}

function fmt(s: number) {
  const m = Math.floor(s / 60);
  return `${m}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

export default function MiniAudioPlayer({ src, className, style, onClick, scope, start, end, loop }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { audio, isPlaying, currentTime, duration, play, pause, seek, ensureLoaded } = useSharedAudio(src, scope);

  const startRef = useRef(start);
  const endRef = useRef(end);
  const loopRef = useRef(loop);
  useEffect(() => { startRef.current = start; }, [start]);
  useEffect(() => { endRef.current = end; }, [end]);
  useEffect(() => { loopRef.current = loop; }, [loop]);

  // Enforce the trim boundary on the shared element. An expanded AudioTrimTimeline
  // runs the identical check on the same element; both re-read `currentTime`, so
  // whichever fires second finds the boundary already handled and does nothing.
  useEffect(() => {
    if (!audio) return;
    const onTimeUpdate = () => {
      if (audio.paused) return;
      const endVal = endRef.current;
      if (endVal !== undefined && audio.currentTime >= endVal) {
        if (loopRef.current) {
          audio.currentTime = startRef.current ?? 0;
        } else {
          audio.pause();
          audio.currentTime = endVal;
        }
      }
    };
    const onEnded = () => {
      if (loopRef.current) {
        audio.currentTime = startRef.current ?? 0;
        audio.play().catch(() => {});
      }
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
    };
  }, [audio]);

  // Lazy-load metadata only when scrolled into view (keeps long picker lists light)
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry!.isIntersecting) { ensureLoaded('metadata'); observer.disconnect(); } },
      { rootMargin: '200px' }
    );
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [ensureLoaded]);

  const toggle = useCallback(() => {
    if (isPlaying) { pause(); return; }
    ensureLoaded('metadata');
    // Start (or resume) inside the trimmed region, never at the file start
    const from = start ?? 0;
    if (currentTime < from || (end !== undefined && currentTime >= end)) seek(from);
    play();
  }, [isPlaying, pause, play, ensureLoaded, seek, currentTime, start, end]);

  useAudioSpaceToggle(containerRef, toggle);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggle();
  };

  // With a trim set the player represents the clip, not the file: the bar spans
  // start → end and the timestamp counts from start.
  const clipStart = start ?? 0;
  const clipEnd = end ?? duration;
  const clipLength = clipEnd - clipStart;

  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (clipLength <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(clipStart + ratio * clipLength);
    play();
  };

  const elapsed = Math.max(0, Math.min(clipLength, currentTime - clipStart));
  const pct = clipLength > 0 ? (elapsed / clipLength) * 100 : 0;

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
        {fmt(elapsed)}{clipLength > 0 ? ` / ${fmt(clipLength)}` : ''}
      </span>
      <div className="mini-player-bar" onClick={handleBarClick}>
        <div className="mini-player-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
