import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  src: string;
  start?: number;
  end?: number;
  loop?: boolean;
  readOnly?: boolean;
  onChange: (start: number | undefined, end: number | undefined) => void;
  onLoopChange?: (loop: boolean) => void;
  onLoaded?: (duration: number) => void;
}

const SAMPLES = 600;

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

export default function AudioTrimTimeline({ src, start, end, loop, readOnly, onChange, onLoopChange, onLoaded }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const draggingRef = useRef<'start' | 'end' | null>(null);

  // Stable refs for use in event handlers
  const startRef = useRef(start);
  const endRef = useRef(end);
  const loopRef = useRef(loop);
  const durationRef = useRef(0);
  const onChangeRef = useRef(onChange);

  useEffect(() => { startRef.current = start; }, [start]);
  useEffect(() => { endRef.current = end; }, [end]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => { durationRef.current = duration; }, [duration]);

  // Load and decode audio for waveform
  useEffect(() => {
    setLoading(true);
    setError(false);
    setWaveformData(null);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);

    const audioCtx = new AudioContext();
    let cancelled = false;

    fetch(src)
      .then(r => r.arrayBuffer())
      .then(buf => audioCtx.decodeAudioData(buf))
      .then(decoded => {
        if (cancelled) return;
        const channelData = decoded.getChannelData(0);
        const blockSize = Math.max(1, Math.floor(channelData.length / SAMPLES));
        const raw = new Float32Array(SAMPLES);
        for (let i = 0; i < SAMPLES; i++) {
          let sum = 0;
          for (let j = 0; j < blockSize; j++) {
            sum += Math.abs(channelData[i * blockSize + j] ?? 0);
          }
          raw[i] = sum / blockSize;
        }
        const maxAmp = Math.max(...raw, 0.001);
        const data = raw.map(v => v / maxAmp);
        setWaveformData(data);
        setDuration(decoded.duration);
        durationRef.current = decoded.duration;
        onLoaded?.(decoded.duration);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      audioCtx.close();
    };
  }, [src]);

  // Audio element for preview playback
  useEffect(() => {
    const audio = new Audio(src);
    audioRef.current = audio;
    setCurrentTime(0);
    setIsPlaying(false);

    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
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
    const onDuration = () => {
      if (audio.duration && isFinite(audio.duration)) {
        setDuration(d => d || audio.duration);
        durationRef.current = durationRef.current || audio.duration;
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      if (loopRef.current) {
        audio.currentTime = startRef.current ?? 0;
        audio.play().catch(() => {});
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onDuration);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.pause();
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onDuration);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
      audioRef.current = null;
    };
  }, [src]);

  // Draw waveform
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData || duration <= 0) return;

    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, W, H);

    const startRatio = start !== undefined ? start / duration : 0;
    const endRatio = end !== undefined ? end / duration : 1;
    const barW = W / SAMPLES;

    for (let i = 0; i < SAMPLES; i++) {
      const ratio = i / SAMPLES;
      const inRange = ratio >= startRatio && ratio <= endRatio;
      const amp = waveformData[i];
      const barH = Math.max(2, amp * H * 0.92);
      const y = (H - barH) / 2;
      const x = i * barW;

      ctx.fillStyle = inRange
        ? 'rgba(129, 140, 248, 0.82)'
        : 'rgba(255, 255, 255, 0.18)';
      ctx.fillRect(x, y, Math.max(1, barW - 0.8), barH);
    }

    // Cursor
    if (currentTime > 0 || isPlaying) {
      const cx = (currentTime / duration) * W;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fillRect(cx - 1, 0, 2, H);
    }
  }, [waveformData, start, end, currentTime, duration, isPlaying]);

  // Drag handlers
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = ratio * durationRef.current;
    const cur = draggingRef.current;
    const s = startRef.current;
    const en = endRef.current;

    if (cur === 'start') {
      const max = en !== undefined ? en - 0.05 : durationRef.current;
      onChangeRef.current(Math.max(0, Math.min(t, max)), en);
    } else {
      const min = s !== undefined ? s + 0.05 : 0;
      onChangeRef.current(s, Math.max(min, Math.min(t, durationRef.current)));
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    draggingRef.current = null;
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const startDrag = (which: 'start' | 'end') => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = which;
  };

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (draggingRef.current) return;
    const container = containerRef.current;
    if (!container || duration <= 0) return;
    const rect = container.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const t = ratio * duration;

    if (start !== undefined && t < start) {
      onChange(t, end);
      return;
    }
    if (end !== undefined && t > end) {
      onChange(start, t);
      return;
    }

    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = t;
      setCurrentTime(t);
    }
  };

  // Transport controls
  const handlePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      if (start !== undefined && audio.currentTime < start) {
        audio.currentTime = start;
      } else if (end !== undefined && audio.currentTime >= end) {
        audio.currentTime = start ?? 0;
      }
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const handleJumpToFileStart = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    setCurrentTime(0);
  };

  const handleJumpToStartMarker = () => {
    const audio = audioRef.current;
    if (!audio || start === undefined) return;
    audio.currentTime = start;
    setCurrentTime(start);
  };

  const handleSetStart = () => onChange(currentTime, end);
  const handleSetEnd = () => onChange(start, currentTime);
  const handleRemoveStart = () => onChange(undefined, end);
  const handleRemoveEnd = () => onChange(start, undefined);

  return (
    <div className="audio-trim-timeline">
      {/* Waveform + handles */}
      <div
        ref={containerRef}
        className="audio-trim-waveform-container"
        onClick={handleCanvasClick}
      >
        {loading && (
          <>
            <div className="audio-trim-canvas-loading">Lade Wellenform…</div>
            <div className="audio-trim-loadbar" />
          </>
        )}
        {error && <div className="audio-trim-canvas-loading" style={{ color: 'rgba(248,113,113,0.7)' }}>Wellenform konnte nicht geladen werden.</div>}
        <canvas ref={canvasRef} className="audio-trim-canvas" width={600} height={58} style={loading || error ? { visibility: 'hidden' } : undefined} />

        {!loading && !readOnly && start !== undefined && duration > 0 && (
          <div
            className="audio-trim-handle audio-trim-handle-start"
            style={{ left: `${(start / duration) * 100}%` }}
            onMouseDown={startDrag('start')}
            onDoubleClick={handleRemoveStart}
            title={`Start: ${formatTime(start)} — ziehen zum Verschieben, Doppelklick zum Entfernen`}
          >
            <div className="audio-trim-handle-line" />
            <div className="audio-trim-handle-tab" />
          </div>
        )}

        {!loading && !readOnly && end !== undefined && duration > 0 && (
          <div
            className="audio-trim-handle audio-trim-handle-end"
            style={{ left: `${(end / duration) * 100}%` }}
            onMouseDown={startDrag('end')}
            onDoubleClick={handleRemoveEnd}
            title={`Ende: ${formatTime(end)} — ziehen zum Verschieben, Doppelklick zum Entfernen`}
          >
            <div className="audio-trim-handle-line" />
            <div className="audio-trim-handle-tab" />
          </div>
        )}
      </div>

      {/* Transport controls row */}
      <div className="audio-trim-controls">
        <button
          className="audio-trim-btn"
          onClick={start !== undefined ? handleJumpToStartMarker : handleJumpToFileStart}
          title={start !== undefined ? `Zum Startmarker (${formatTime(start)})` : 'Zum Dateianfang (0:00)'}
        >
          <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor">
            <rect x="0" y="0" width="2.5" height="14" rx="1" />
            <polygon points="14,0 3,7 14,14" />
          </svg>
        </button>

        <button className="audio-trim-btn" onClick={handlePlayPause} title={isPlaying ? 'Pause' : 'Abspielen'}>
          {isPlaying ? (
            <svg width="8" height="9" viewBox="0 0 12 14" fill="currentColor">
              <rect x="0" y="0" width="4" height="14" rx="1" />
              <rect x="8" y="0" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="8" height="9" viewBox="0 0 12 14" fill="currentColor">
              <polygon points="0,0 12,7 0,14" />
            </svg>
          )}
        </button>

        <span className="audio-trim-time">
          {formatTime(currentTime)}{duration > 0 ? ` / ${formatTime(duration)}` : ''}
        </span>

        {!readOnly && <span className="audio-trim-sep" />}

        {!readOnly && (start === undefined ? (
          <button className="audio-trim-btn audio-trim-btn-add" onClick={handleSetStart} title="Startmarker hier setzen">
            + Start
          </button>
        ) : (
          <button className="audio-trim-btn audio-trim-btn-remove" onClick={handleRemoveStart} title="Startmarker entfernen">
            ✕ Start
          </button>
        ))}

        {!readOnly && (end === undefined ? (
          <button className="audio-trim-btn audio-trim-btn-add" onClick={handleSetEnd} title="Endmarker hier setzen">
            + Ende
          </button>
        ) : (
          <button className="audio-trim-btn audio-trim-btn-remove" onClick={handleRemoveEnd} title="Endmarker entfernen">
            ✕ Ende
          </button>
        ))}

        {!readOnly && onLoopChange && (
          <label className="be-toggle audio-trim-loop-toggle" title="Audio wiederholen">
            <input
              type="checkbox"
              checked={loop ?? false}
              onChange={e => onLoopChange(e.target.checked)}
            />
            <span className="be-toggle-track" />
            <span className="be-toggle-label">Loop</span>
          </label>
        )}
      </div>
    </div>
  );
}
