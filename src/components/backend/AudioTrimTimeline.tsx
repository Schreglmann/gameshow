import { useState, useEffect, useRef, useCallback } from 'react';

export interface TimelineMarker {
  time: number;
  color: string;
  label: string;
  onChange?: (time: number) => void;
  onRemove?: () => void;
}

interface Props {
  src: string;
  start?: number;
  end?: number;
  loop?: boolean;
  readOnly?: boolean;
  markers?: TimelineMarker[];
  onChange: (start: number | undefined, end: number | undefined) => void;
  onLoopChange?: (loop: boolean) => void;
  onLoaded?: (duration: number) => void;
}

const SAMPLES = 600;
const CACHE_DB = 'waveform-cache';
const CACHE_STORE = 'waveforms';
const CACHE_VERSION = 1;

interface CachedWaveform {
  src: string;
  overview: Float32Array;
  raw: Float32Array;
  duration: number;
}

function openCacheDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB, CACHE_VERSION);
    req.onupgradeneeded = () => { req.result.createObjectStore(CACHE_STORE, { keyPath: 'src' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedWaveform(src: string): Promise<CachedWaveform | null> {
  try {
    const db = await openCacheDB();
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const req = tx.objectStore(CACHE_STORE).get(src);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

async function setCachedWaveform(entry: CachedWaveform): Promise<void> {
  try {
    const db = await openCacheDB();
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put(entry);
  } catch { /* ignore cache write errors */ }
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function clampOffset(offset: number, zoom: number) {
  return Math.max(0, Math.min(1 - 1 / zoom, offset));
}

export default function AudioTrimTimeline({ src, start, end, loop, readOnly, markers, onChange, onLoopChange, onLoaded }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<'start' | 'end' | 'minimap' | `marker-${number}` | null>(null);

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

  const markersRef = useRef(markers);
  useEffect(() => { markersRef.current = markers; }, [markers]);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const rawChannelRef = useRef<Float32Array | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Zoom state
  const [zoomLevel, setZoomLevel] = useState(1);
  const [viewOffset, setViewOffset] = useState(0);
  const zoomRef = useRef(1);
  const viewOffsetRef = useRef(0);

  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { zoomRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { viewOffsetRef.current = viewOffset; }, [viewOffset]);

  // Auto-zoom to markers on initial load
  // Priority: both start+end → zoom to region; start only → center on start; end only → center on end
  const hasAutoZoomedRef = useRef(false);
  useEffect(() => {
    if (hasAutoZoomedRef.current || duration <= 0 || !waveformData) return;
    if (start === undefined && end === undefined) return;
    hasAutoZoomedRef.current = true;

    const PADDING = 0.08; // 8% padding on each side

    if (start !== undefined && end !== undefined) {
      const rangeRatio = (end - start) / duration;
      const zoom = Math.max(1, Math.min(50, 1 / (rangeRatio + PADDING * 2)));
      const center = ((start + end) / 2) / duration;
      const offset = clampOffset(center - 0.5 / zoom, zoom);
      setZoomLevel(zoom);
      setViewOffset(offset);
    } else if (start !== undefined) {
      const zoom = Math.min(50, 4);
      const offset = clampOffset(start / duration - 0.15 / zoom, zoom);
      setZoomLevel(zoom);
      setViewOffset(offset);
    } else if (end !== undefined) {
      const zoom = Math.min(50, 4);
      const offset = clampOffset(end / duration - 0.85 / zoom, zoom);
      setZoomLevel(zoom);
      setViewOffset(offset);
    }
  }, [duration, waveformData]);

  // Load and decode audio for waveform (with IndexedDB cache)
  useEffect(() => {
    setLoading(true);
    setError(false);
    setWaveformData(null);
    setDuration(0);
    setCurrentTime(0);
    setIsPlaying(false);
    hasAutoZoomedRef.current = false;

    let cancelled = false;

    const applyData = (raw: Float32Array, overview: Float32Array, dur: number) => {
      if (cancelled) return;
      rawChannelRef.current = raw;
      setWaveformData(overview);
      setDuration(dur);
      durationRef.current = dur;
      onLoaded?.(dur);
      setLoading(false);
    };

    const computeOverview = (channelData: Float32Array): Float32Array => {
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
      return raw.map(v => v / maxAmp);
    };

    // Try cache first, then fetch + decode
    getCachedWaveform(src).then(cached => {
      if (cancelled) return;
      if (cached) {
        applyData(cached.raw, cached.overview, cached.duration);
        return;
      }

      const audioCtx = new AudioContext();
      fetch(src)
        .then(r => r.arrayBuffer())
        .then(buf => audioCtx.decodeAudioData(buf))
        .then(decoded => {
          audioCtx.close();
          if (cancelled) return;
          const channelData = decoded.getChannelData(0);
          const overview = computeOverview(channelData);

          // Store in cache (fire-and-forget)
          setCachedWaveform({ src, raw: channelData, overview, duration: decoded.duration });

          applyData(channelData, overview, decoded.duration);
        })
        .catch(() => {
          audioCtx.close();
          if (cancelled) return;
          setError(true);
          setLoading(false);
        });
    });

    return () => { cancelled = true; };
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

  // Draw waveform (zoom-aware, hi-res from raw channel data)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveformData || duration <= 0) return;

    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d')!;

    ctx.clearRect(0, 0, W, H);

    const startRatio = start !== undefined ? start / duration : 0;
    const endRatio = end !== undefined ? end / duration : 1;

    const rawChannel = rawChannelRef.current;
    const useHiRes = zoomLevel > 1 && rawChannel;

    if (useHiRes) {
      // Hi-res: resample raw channel data at per-pixel resolution
      const totalSamples = rawChannel.length;
      const visibleStart = viewOffset;
      const visibleEnd = viewOffset + 1 / zoomLevel;
      const sampleStart = Math.floor(visibleStart * totalSamples);
      const sampleEnd = Math.ceil(visibleEnd * totalSamples);
      const samplesPerPixel = Math.max(1, (sampleEnd - sampleStart) / W);

      // First pass: compute max amplitude for normalization
      let maxAmp = 0;
      for (let px = 0; px < W; px++) {
        const s0 = Math.floor(sampleStart + px * samplesPerPixel);
        const s1 = Math.min(totalSamples, Math.ceil(sampleStart + (px + 1) * samplesPerPixel));
        let sum = 0;
        let count = 0;
        for (let s = s0; s < s1; s++) {
          sum += Math.abs(rawChannel[s]);
          count++;
        }
        if (count > 0 && sum / count > maxAmp) maxAmp = sum / count;
      }
      if (maxAmp < 0.001) maxAmp = 0.001;

      // Second pass: draw bars
      for (let px = 0; px < W; px++) {
        const s0 = Math.floor(sampleStart + px * samplesPerPixel);
        const s1 = Math.min(totalSamples, Math.ceil(sampleStart + (px + 1) * samplesPerPixel));
        let sum = 0;
        let count = 0;
        for (let s = s0; s < s1; s++) {
          sum += Math.abs(rawChannel[s]);
          count++;
        }
        const amp = count > 0 ? (sum / count) / maxAmp : 0;
        const timeRatio = (sampleStart + px * samplesPerPixel) / totalSamples;
        const inRange = timeRatio >= startRatio && timeRatio <= endRatio;
        const barH = Math.max(1, amp * H * 0.92);
        const y = (H - barH) / 2;

        ctx.fillStyle = inRange
          ? 'rgba(129, 140, 248, 0.82)'
          : 'rgba(255, 255, 255, 0.18)';
        ctx.fillRect(px, y, 1, barH);
      }
    } else {
      // 1x zoom: use pre-computed low-res waveform
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
    }

    // Cursor
    if (currentTime > 0 || isPlaying) {
      const cx = (currentTime / duration - viewOffset) * zoomLevel * W;
      if (cx >= -1 && cx <= W + 1) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        ctx.fillRect(cx - 1, 0, 2, H);
      }
    }
  }, [waveformData, start, end, currentTime, duration, isPlaying, zoomLevel, viewOffset]);

  // Wheel zoom handler
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / rect.width;

      // Horizontal scroll (trackpad two-finger swipe) → pan
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && zoomRef.current > 1) {
        const panAmount = (e.deltaX / rect.width) / zoomRef.current;
        const newOffset = clampOffset(viewOffsetRef.current + panAmount, zoomRef.current);
        viewOffsetRef.current = newOffset;
        setViewOffset(newOffset);
        return;
      }

      // Vertical scroll → zoom
      // Trackpads send small continuous deltas; mice send large discrete ones.
      // Use a continuous factor proportional to deltaY for smooth trackpad zoom.
      const delta = -e.deltaY;
      const speed = 0.004;
      const factor = Math.exp(delta * speed);
      const mouseTimeRatio = mouseX / zoomRef.current + viewOffsetRef.current;

      const newZoom = Math.max(1, Math.min(50, zoomRef.current * factor));
      const newOffset = clampOffset(mouseTimeRatio - mouseX / newZoom, newZoom);

      zoomRef.current = newZoom;
      viewOffsetRef.current = newOffset;
      setZoomLevel(newZoom);
      setViewOffset(newOffset);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, []);

  // Auto-scroll to keep playback cursor visible when zoomed
  useEffect(() => {
    if (!isPlaying || zoomLevel <= 1 || duration <= 0) return;
    const timeRatio = currentTime / duration;
    const visibleEnd = viewOffset + 1 / zoomLevel;
    const margin = 0.05 / zoomLevel;
    if (timeRatio > visibleEnd - margin) {
      setViewOffset(clampOffset(timeRatio - 0.7 / zoomLevel, zoomLevel));
    } else if (timeRatio < viewOffset + margin) {
      setViewOffset(clampOffset(timeRatio - 0.3 / zoomLevel, zoomLevel));
    }
  }, [currentTime, isPlaying, zoomLevel, duration, viewOffset]);

  // Drag handlers
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return;

    // Minimap drag → pan the viewport
    if (draggingRef.current === 'minimap') {
      const el = minimapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newOffset = clampOffset(ratio - 0.5 / zoomRef.current, zoomRef.current);
      viewOffsetRef.current = newOffset;
      setViewOffset(newOffset);
      return;
    }

    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const canvasRatio = (e.clientX - rect.left) / rect.width;

    // Auto-pan when dragging near edges while zoomed
    if (zoomRef.current > 1) {
      const PAN_ZONE = 0.08;
      const PAN_SPEED = 0.008 / zoomRef.current;
      if (canvasRatio < PAN_ZONE) {
        const newOffset = clampOffset(viewOffsetRef.current - PAN_SPEED, zoomRef.current);
        viewOffsetRef.current = newOffset;
        setViewOffset(newOffset);
      } else if (canvasRatio > 1 - PAN_ZONE) {
        const newOffset = clampOffset(viewOffsetRef.current + PAN_SPEED, zoomRef.current);
        viewOffsetRef.current = newOffset;
        setViewOffset(newOffset);
      }
    }

    const clampedCanvasRatio = Math.max(0, Math.min(1, canvasRatio));
    const timeRatio = clampedCanvasRatio / zoomRef.current + viewOffsetRef.current;
    const t = Math.max(0, Math.min(durationRef.current, timeRatio * durationRef.current));
    const cur = draggingRef.current;

    // Marker drag
    if (typeof cur === 'string' && cur.startsWith('marker-')) {
      const idx = parseInt(cur.split('-')[1]);
      const marker = markersRef.current?.[idx];
      if (marker?.onChange) marker.onChange(Math.round(t * 100) / 100);
      return;
    }

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
    const canvasRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const timeRatio = canvasRatio / zoomLevel + viewOffset;
    const t = Math.max(0, Math.min(duration, timeRatio * duration));

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

  // Zoom helpers
  const timeToPercent = (t: number) => {
    if (duration <= 0) return 0;
    return ((t / duration) - viewOffset) * zoomLevel * 100;
  };

  const isTimeVisible = (t: number) => {
    if (duration <= 0) return false;
    const pct = ((t / duration) - viewOffset) * zoomLevel;
    return pct >= -0.02 && pct <= 1.02;
  };

  // Zoom target: prio player position → start marker → end marker → viewport center
  const getZoomTarget = () => {
    if (duration <= 0) return 0.5;
    // If playing or cursor has been placed, target the playback position
    if ((isPlaying || currentTime > 0) && currentTime <= duration) {
      return currentTime / duration;
    }
    // Both markers: center between them
    if (start !== undefined && end !== undefined) {
      return ((start + end) / 2) / duration;
    }
    if (start !== undefined) return start / duration;
    if (end !== undefined) return end / duration;
    // Fallback: current viewport center
    return viewOffset + 0.5 / zoomLevel;
  };

  const zoomIn = () => {
    const newZoom = Math.min(50, zoomLevel * 1.5);
    const target = getZoomTarget();
    setViewOffset(clampOffset(target - 0.5 / newZoom, newZoom));
    setZoomLevel(newZoom);
  };

  const zoomOut = () => {
    const newZoom = Math.max(1, zoomLevel / 1.5);
    const target = getZoomTarget();
    setViewOffset(clampOffset(target - 0.5 / newZoom, newZoom));
    setZoomLevel(newZoom);
  };

  const resetZoom = () => {
    setZoomLevel(1);
    setViewOffset(0);
  };

  const handleMinimapClick = (e: React.MouseEvent) => {
    if (draggingRef.current === 'minimap') return;
    const el = minimapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setViewOffset(clampOffset(ratio - 0.5 / zoomLevel, zoomLevel));
  };

  const startMinimapDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = 'minimap';
  };

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

        {!loading && !readOnly && start !== undefined && duration > 0 && isTimeVisible(start) && (
          <div
            className="audio-trim-handle audio-trim-handle-start"
            style={{ left: `${timeToPercent(start)}%` }}
            onMouseDown={startDrag('start')}
            onDoubleClick={handleRemoveStart}
            title={`Start: ${formatTime(start)} — ziehen zum Verschieben, Doppelklick zum Entfernen`}
          >
            <div className="audio-trim-handle-line" />
            <div className="audio-trim-handle-tab" />
          </div>
        )}

        {!loading && !readOnly && end !== undefined && duration > 0 && isTimeVisible(end) && (
          <div
            className="audio-trim-handle audio-trim-handle-end"
            style={{ left: `${timeToPercent(end)}%` }}
            onMouseDown={startDrag('end')}
            onDoubleClick={handleRemoveEnd}
            title={`Ende: ${formatTime(end)} — ziehen zum Verschieben, Doppelklick zum Entfernen`}
          >
            <div className="audio-trim-handle-line" />
            <div className="audio-trim-handle-tab" />
          </div>
        )}

        {/* Extra markers */}
        {!loading && markers?.map((m, idx) => duration > 0 && isTimeVisible(m.time) && (
          <div
            key={idx}
            className="audio-trim-marker"
            style={{ left: `${timeToPercent(m.time)}%`, '--marker-color': m.color } as React.CSSProperties}
            onMouseDown={m.onChange ? (e) => { e.preventDefault(); e.stopPropagation(); draggingRef.current = `marker-${idx}`; } : undefined}
            onDoubleClick={m.onRemove ? (e) => { e.stopPropagation(); m.onRemove!(); } : undefined}
            title={`${m.label}: ${formatTime(m.time)}${m.onChange ? ' — ziehen zum Verschieben' : ''}${m.onRemove ? ', Doppelklick zum Entfernen' : ''}`}
          >
            <div className="audio-trim-marker-line" />
            <div className="audio-trim-marker-label">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Minimap for zoomed navigation */}
      {zoomLevel > 1 && duration > 0 && (
        <div className="audio-trim-minimap" ref={minimapRef} onClick={handleMinimapClick}>
          {start !== undefined && (
            <div className="audio-trim-minimap-marker audio-trim-minimap-marker-start" style={{ left: `${(start / duration) * 100}%` }} />
          )}
          {end !== undefined && (
            <div className="audio-trim-minimap-marker audio-trim-minimap-marker-end" style={{ left: `${(end / duration) * 100}%` }} />
          )}
          {markers?.map((m, idx) => (
            <div key={idx} className="audio-trim-minimap-marker" style={{ left: `${(m.time / duration) * 100}%`, background: m.color }} />
          ))}
          <div
            className="audio-trim-minimap-viewport"
            style={{ left: `${viewOffset * 100}%`, width: `${(1 / zoomLevel) * 100}%` }}
            onMouseDown={startMinimapDrag}
          />
          {(currentTime > 0 || isPlaying) && (
            <div className="audio-trim-minimap-cursor" style={{ left: `${(currentTime / duration) * 100}%` }} />
          )}
        </div>
      )}

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

        {duration > 0 && (
          <>
            <button className="audio-trim-btn" onClick={zoomOut} disabled={zoomLevel <= 1} title="Rauszoomen">−</button>
            <button className="audio-trim-btn" onClick={zoomIn} disabled={zoomLevel >= 50} title="Reinzoomen (oder Mausrad)">+</button>
            {zoomLevel > 1 && (
              <button className="audio-trim-btn" onClick={resetZoom} title="Zoom zurücksetzen">
                {zoomLevel >= 10 ? zoomLevel.toFixed(0) : zoomLevel.toFixed(1)}×
              </button>
            )}
          </>
        )}

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
