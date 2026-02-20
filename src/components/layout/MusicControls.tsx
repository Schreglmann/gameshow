import { useState, useEffect, useRef, useCallback } from 'react';
import type { MusicPlayerControls } from '@/hooks/useBackgroundMusic';

interface MusicControlsProps {
  player: MusicPlayerControls;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function MusicControls({ player }: MusicControlsProps) {
  const [visible, setVisible] = useState(false);
  const controlsRef = useRef<HTMLDivElement>(null);
  const lastMouse = useRef({ x: 0, y: 0 });
  const movedDist = useRef(0);

  const progress = player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0;

  const handleToggleHover = useCallback(() => {
    setVisible(true);
    movedDist.current = 0;
  }, []);

  // Auto-hide on click outside or mouse moved away
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (visible && controlsRef.current && !controlsRef.current.contains(e.target as Node)) {
        setVisible(false);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!visible) return;
      const rect = controlsRef.current?.getBoundingClientRect();
      if (!rect) return;

      const isOver =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;

      if (isOver) {
        lastMouse.current = { x: e.clientX, y: e.clientY };
        movedDist.current = 0;
      } else {
        const dx = e.clientX - lastMouse.current.x;
        const dy = e.clientY - lastMouse.current.y;
        movedDist.current += Math.sqrt(dx * dx + dy * dy);
        lastMouse.current = { x: e.clientX, y: e.clientY };
        if (movedDist.current > 200) {
          setVisible(false);
          movedDist.current = 0;
        }
      }
    };

    document.addEventListener('click', handleClick);
    document.addEventListener('mousemove', handleMouseMove);
    return () => {
      document.removeEventListener('click', handleClick);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [visible]);

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (player.isPlaying) {
      player.pause();
    } else if (player.currentSong) {
      player.resume();
    } else {
      player.start();
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!player.isPlaying || !player.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    player.seekTo(fraction);
  };

  return (
    <div
      ref={controlsRef}
      className={`music-controls${visible ? ' visible' : ''}`}
      onClick={e => e.stopPropagation()}
    >
      <button
        className="music-toggle"
        onMouseEnter={handleToggleHover}
        onClick={e => e.stopPropagation()}
      >
        {visible ? '▶' : '◀'}
      </button>
      <div className="music-controls-content">
        <div className="music-song-info">
          <span
            className={`song-name${player.currentSong.length > 20 ? ' scrolling' : ''}`}
            data-text={player.currentSong || 'No track loaded'}
          >
            {/* text rendered via CSS ::before with data-text */}
          </span>
          <span className="song-time">
            {formatTime(player.currentTime)} / {formatTime(player.duration)}
          </span>
        </div>
        <div className="music-controls-row">
          <button onClick={handlePlayPause} title="Play/Pause">
            {player.isPlaying ? '⏸' : '▶'}
          </button>
          <div className="volume-control">
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(player.volume * 100)}
              onChange={e => player.setVolume(Number(e.target.value) / 100)}
              title="Volume"
            />
            <span className="volume-label">{Math.round(player.volume * 100)}%</span>
          </div>
          <button
            onClick={e => {
              e.stopPropagation();
              player.skipToNext();
            }}
            title="Next Track"
          >
            ⏭
          </button>
        </div>
        <div className="music-timeline" onClick={handleTimelineClick} style={{ cursor: 'pointer' }}>
          <div className="timeline-bar">
            <div className="timeline-progress" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
