import { useState, useRef, useEffect, useCallback } from 'react';
import type { VideoGuessQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';
import { probeVideo, warmupSdr, checkSdrCache, type VideoTrackInfo } from '@/services/backendApi';
import { checkVideoHdr } from '@/services/api';
import MoveQuestionButton from './MoveQuestionButton';

interface Props {
  questions: VideoGuessQuestion[];
  onChange: (questions: VideoGuessQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
}

const empty = (): VideoGuessQuestion => ({ answer: '', video: '' });

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1);
  return `${m}:${sec.padStart(4, '0')}`;
}

function clampOffset(offset: number, zoom: number) {
  return Math.max(0, Math.min(1 - 1 / zoom, offset));
}

// ── Marker definitions ──
const MARKER_DEFS = [
  { key: 'videoStart' as const, label: 'Start', color: 'rgba(74, 222, 128, 0.9)' },
  { key: 'videoQuestionEnd' as const, label: 'Frage', color: 'rgba(251, 191, 36, 0.9)' },
  { key: 'videoAnswerEnd' as const, label: 'Antwort', color: 'rgba(248, 113, 113, 0.9)' },
];

// ── Video marker editor: video player + zoomable timeline + marker buttons ──
/** Seek a video element robustly: use fastSeek for large jumps to avoid HEVC decode errors. */
function safeSeek(v: HTMLVideoElement, t: number) {
  const delta = Math.abs(v.currentTime - t);
  if (delta > 30 && typeof v.fastSeek === 'function') {
    v.fastSeek(t);
  } else {
    v.currentTime = t;
  }
}

function VideoMarkerEditor({ q, onUpdate }: { q: VideoGuessQuestion; onUpdate: (patch: Partial<VideoGuessQuestion>) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | 'minimap' | null>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoLoading, setVideoLoading] = useState(true);
  const [containerAspect, setContainerAspect] = useState('16 / 9');
  const [enlarged, setEnlarged] = useState(false);
  const enlargedRef = useRef<HTMLVideoElement>(null);

  const [zoomLevel, setZoomLevel] = useState(1);
  const [viewOffset, setViewOffset] = useState(0);
  const zoomRef = useRef(1);
  const viewOffsetRef = useRef(0);
  const durationRef = useRef(0);

  // Audio track probing (for language selector)
  const [audioTracks, setAudioTracks] = useState<VideoTrackInfo[]>([]);
  const [audioTracksLoading, setAudioTracksLoading] = useState(false);
  const [isHdr, setIsHdr] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => { zoomRef.current = zoomLevel; }, [zoomLevel]);
  useEffect(() => { viewOffsetRef.current = viewOffset; }, [viewOffset]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // Get true duration + aspect ratio from the server probe (works for all codecs including HDR HEVC)
  // Also sets audio tracks and HDR flag from the same request
  useEffect(() => {
    if (!q.video) return;
    const relPath = q.video.replace(/^\/videos\//, '');
    let cancelled = false;
    setAudioTracksLoading(true);
    probeVideo(relPath).then(result => {
      if (cancelled) return;
      setAudioTracks(result.tracks);
      if (result.videoInfo) {
        const vi = result.videoInfo;
        if (vi.duration && isFinite(vi.duration)) {
          setDuration(vi.duration);
          durationRef.current = vi.duration;
        }
        if (vi.width && vi.height) {
          setContainerAspect(`${vi.width} / ${vi.height}`);
        }
        setIsHdr(vi.isHdr);
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setAudioTracksLoading(false);
    });
    return () => { cancelled = true; };
  }, [q.video]);

  // Track playback + loading state from the actual player element
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setVideoLoading(false);
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setVideoLoading(true);
    const onReady = () => setVideoLoading(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('waiting', onWaiting);
    v.addEventListener('canplay', onReady);
    v.addEventListener('playing', onReady);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('waiting', onWaiting);
      v.removeEventListener('canplay', onReady);
      v.removeEventListener('playing', onReady);
    };
  }, [q.video]);

  // Use track-selected URL when a specific audio track is chosen, original URL otherwise.
  // The remux is cached server-side so only the first request is slow.
  const videoSrc = q.audioTrack !== undefined
    ? q.video.replace(/^\/videos\//, `/videos-track/${q.audioTrack}/`)
    : q.video;

  // Restore playback position + play state when src changes (e.g. language switch)
  const restoreTimeRef = useRef<number | null>(null);
  const restorePlayingRef = useRef(false);
  const prevSrcRef = useRef(videoSrc);
  useEffect(() => {
    if (prevSrcRef.current !== videoSrc) {
      // Use React state instead of videoRef.current.currentTime — by the time
      // this effect runs the browser has already reset the DOM element to 0
      restoreTimeRef.current = currentTime;
      restorePlayingRef.current = isPlaying;
    }
    prevSrcRef.current = videoSrc;
  }, [videoSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = videoRef.current;
    if (!v || restoreTimeRef.current === null) return;
    const t = restoreTimeRef.current;
    const shouldPlay = restorePlayingRef.current;
    const onLoaded = () => {
      safeSeek(v, t);
      restoreTimeRef.current = null;
      if (shouldPlay) v.play().catch(() => {});
    };
    v.addEventListener('loadedmetadata', onLoaded, { once: true });
    return () => v.removeEventListener('loadedmetadata', onLoaded);
  }, [videoSrc]);

  // Listen for video decode errors — for HDR videos, attempt recovery by reloading
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    setVideoError(null);
    let recovering = false;
    let lastFailedTime = -1;
    const onError = () => {
      if (recovering) return;
      const e = v.error;
      if (e?.code === MediaError.MEDIA_ERR_DECODE) {
        const savedTime = v.currentTime || currentTime;
        // If we already failed at this position, don't retry — show brief warning
        if (Math.abs(savedTime - lastFailedTime) < 2) {
          setVideoError('Sprung zu dieser Position fehlgeschlagen — bitte kleinere Sprünge verwenden');
          setTimeout(() => setVideoError(null), 3000);
          return;
        }
        lastFailedTime = savedTime;
        recovering = true;
        const wasPlaying = !v.paused;
        v.load();
        const onLoaded = () => {
          v.removeEventListener('loadedmetadata', onLoaded);
          safeSeek(v, savedTime);
          recovering = false;
          if (wasPlaying) v.play().catch(() => {});
        };
        v.addEventListener('loadedmetadata', onLoaded, { once: true });
        setTimeout(() => {
          v.removeEventListener('loadedmetadata', onLoaded);
          recovering = false;
        }, 5000);
      } else if (e?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setVideoError('Video konnte nicht dekodiert werden');
      }
    };
    v.addEventListener('error', onError);
    return () => v.removeEventListener('error', onError);
  }, [videoSrc]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pre-warm server remux cache for all audio tracks so language switching is instant.
  // Delay 5s so the current video can load without competing for server resources.
  useEffect(() => {
    const compat = audioTracks.filter(t => t.browserCompatible);
    if (compat.length <= 1 || !q.video) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      audioTracks.forEach((t, idx) => {
        if (!t.browserCompatible) return;
        const url = q.video.replace(/^\/videos\//, `/videos-track/${idx}/`);
        fetch(url, { headers: { Range: 'bytes=0-0' }, signal: controller.signal }).catch(() => {});
      });
    }, 5000);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [audioTracks, q.video]);

  // Auto-zoom to markers on load
  const hasAutoZoomedRef = useRef(false);
  useEffect(() => {
    if (hasAutoZoomedRef.current || duration <= 0) return;
    const vals = MARKER_DEFS.map(d => q[d.key]).filter((v): v is number => v !== undefined);
    if (vals.length === 0) return;
    hasAutoZoomedRef.current = true;
    const minT = Math.min(...vals);
    const maxT = Math.max(...vals);
    if (vals.length >= 2) {
      const rangeRatio = (maxT - minT) / duration;
      const zoom = Math.max(1, Math.min(50, 1 / (rangeRatio + 0.16)));
      const center = ((minT + maxT) / 2) / duration;
      setZoomLevel(zoom);
      setViewOffset(clampOffset(center - 0.5 / zoom, zoom));
    } else {
      setZoomLevel(4);
      setViewOffset(clampOffset(vals[0] / duration - 0.15 / 4, 4));
    }
  }, [duration]);

  // Wheel zoom on timeline
  useEffect(() => {
    const el = timelineRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mouseX = (e.clientX - rect.left) / rect.width;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && zoomRef.current > 1) {
        const pan = (e.deltaX / rect.width) / zoomRef.current;
        const o = clampOffset(viewOffsetRef.current + pan, zoomRef.current);
        viewOffsetRef.current = o;
        setViewOffset(o);
        return;
      }
      const factor = Math.exp(-e.deltaY * 0.004);
      const mouseTime = mouseX / zoomRef.current + viewOffsetRef.current;
      const nz = Math.max(1, Math.min(100, zoomRef.current * factor));
      const no = clampOffset(mouseTime - mouseX / nz, nz);
      zoomRef.current = nz;
      viewOffsetRef.current = no;
      setZoomLevel(nz);
      setViewOffset(no);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Drag marker on timeline
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggingRef.current) return;
    if (draggingRef.current === 'minimap') {
      const el = minimapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const o = clampOffset(ratio - 0.5 / zoomRef.current, zoomRef.current);
      viewOffsetRef.current = o;
      setViewOffset(o);
      return;
    }
    const el = timelineRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cr = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const tr = cr / zoomRef.current + viewOffsetRef.current;
    const t = Math.round(Math.max(0, Math.min(durationRef.current, tr * durationRef.current)) * 100) / 100;
    const key = draggingRef.current as keyof VideoGuessQuestion;
    onUpdate({ [key]: t });
  }, [onUpdate]);

  const handleMouseUp = useCallback(() => { draggingRef.current = null; }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, [handleMouseMove, handleMouseUp]);

  // Click timeline to seek
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (draggingRef.current) return;
    const el = timelineRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const cr = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const tr = cr / zoomLevel + viewOffset;
    const t = Math.max(0, Math.min(duration, tr * duration));
    if (videoRef.current) { safeSeek(videoRef.current, t); setCurrentTime(t); }
  };

  const timeToPercent = (t: number) => duration > 0 ? ((t / duration) - viewOffset) * zoomLevel * 100 : 0;
  const isVisible = (t: number) => { const p = ((t / duration) - viewOffset) * zoomLevel; return p >= -0.02 && p <= 1.02; };

  // Zoom controls
  const getZoomTarget = () => {
    if (duration <= 0) return 0.5;
    if (isPlaying || currentTime > 0) return currentTime / duration;
    const vals = MARKER_DEFS.map(d => q[d.key]).filter((v): v is number => v !== undefined);
    if (vals.length >= 2) return ((Math.min(...vals) + Math.max(...vals)) / 2) / duration;
    if (vals.length === 1) return vals[0] / duration;
    return viewOffset + 0.5 / zoomLevel;
  };
  const zoomIn = () => { const nz = Math.min(100, zoomLevel * 1.5); setViewOffset(clampOffset(getZoomTarget() - 0.5 / nz, nz)); setZoomLevel(nz); };
  const zoomOut = () => { const nz = Math.max(1, zoomLevel / 1.5); setViewOffset(clampOffset(getZoomTarget() - 0.5 / nz, nz)); setZoomLevel(nz); };
  const resetZoom = () => { setZoomLevel(1); setViewOffset(0); };

  // Timestamp ticks
  const ticks: { time: number; label: string }[] = [];
  if (duration > 0) {
    const visibleDur = duration / zoomLevel;
    // Pick a nice tick interval
    const rawInterval = visibleDur / 8;
    const niceIntervals = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const tickInterval = niceIntervals.find(i => i >= rawInterval) ?? 600;
    const visStart = viewOffset * duration;
    const visEnd = visStart + visibleDur;
    const first = Math.ceil(visStart / tickInterval) * tickInterval;
    for (let t = first; t <= visEnd; t += tickInterval) {
      ticks.push({ time: t, label: formatTime(t) });
    }
  }

  const handlePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
  }, []);

  // Space key toggles play/pause (only when no input/textarea is focused)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      e.preventDefault();
      handlePlayPause();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handlePlayPause]);

  // Sync enlarged video with editor video; mute source while enlarged
  useEffect(() => {
    if (!enlarged) return;
    const src = videoRef.current;
    const big = enlargedRef.current;
    if (!src || !big) return;
    big.currentTime = src.currentTime;
    src.muted = true;
    if (!src.paused) big.play().catch(() => {});

    const onTimeUpdate = () => {
      if (big && Math.abs(big.currentTime - src.currentTime) > 0.5) {
        big.currentTime = src.currentTime;
      }
    };
    const onPlay = () => big?.play().catch(() => {});
    const onPause = () => big?.pause();
    const onSeek = () => { if (big) big.currentTime = src.currentTime; };
    src.addEventListener('timeupdate', onTimeUpdate);
    src.addEventListener('play', onPlay);
    src.addEventListener('pause', onPause);
    src.addEventListener('seeked', onSeek);
    return () => {
      src.muted = false;
      src.removeEventListener('timeupdate', onTimeUpdate);
      src.removeEventListener('play', onPlay);
      src.removeEventListener('pause', onPause);
      src.removeEventListener('seeked', onSeek);
    };
  }, [enlarged]);

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    safeSeek(v, t);
    setCurrentTime(t);
    v.play().catch(() => {});
  };

  return (
    <div className="video-marker-editor">
      {/* Video player */}
      <div
        style={{ position: 'relative', width: '100%', aspectRatio: containerAspect, background: '#000', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        onClick={() => setEnlarged(true)}
        title="Klicken zum Vergrößern"
      >
        <video
          ref={videoRef}
          src={videoSrc}
          preload="metadata"
          disablePictureInPicture
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
        />
        {videoLoading && !videoError && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <div className="video-loading-spinner" />
          </div>
        )}
        {videoError && !isHdr && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)', padding: '1rem' }}>
            <p style={{ color: 'rgba(251,191,36,0.9)', fontSize: '0.8rem', textAlign: 'center', margin: 0 }}>
              ⚠️ {videoError}
            </p>
          </div>
        )}
      </div>

      {/* Language selector — idx = audio-relative index (matches ffmpeg 0:a:idx) */}
      {audioTracksLoading && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Sprache:</span>
          <div className="video-loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
        </div>
      )}
      {!audioTracksLoading && audioTracks.filter(t => t.browserCompatible).length > 1 && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Sprache:</span>
          {audioTracks.map((t, idx) => {
            if (!t.browserCompatible) return null;
            const isSelected = q.audioTrack === idx || (q.audioTrack === undefined && idx === 0);
            const lang = t.language === 'deu' ? 'DE' : t.language === 'eng' ? 'EN' : t.language === 'fra' ? 'FR' : t.language === 'und' ? '?' : t.language.toUpperCase();
            return (
              <button
                key={idx}
                className="audio-trim-btn"
                onClick={() => onUpdate({ audioTrack: idx })}
                style={isSelected ? { borderColor: 'rgba(129,140,248,0.6)', background: 'rgba(129,140,248,0.15)', color: '#a5b4fc' } : undefined}
                title={`${t.name || t.codecLong} — ${t.channels}ch ${t.channelLayout}`}
              >
                {lang}{t.name ? ` (${t.name})` : ''}
              </button>
            );
          })}
        </div>
      )}

      {/* Transport */}
      <div className="audio-trim-controls" style={{ marginTop: 6 }}>
        <button className="audio-trim-btn" onClick={() => seekTo(q.videoStart ?? 0)} title="Zum Start">
          <svg width="10" height="10" viewBox="0 0 14 14" fill="currentColor"><rect x="0" y="0" width="2.5" height="14" rx="1" /><polygon points="14,0 3,7 14,14" /></svg>
        </button>
        <button className="audio-trim-btn" onClick={handlePlayPause} title={isPlaying ? 'Pause' : 'Abspielen'}>
          {isPlaying ? (
            <svg width="8" height="9" viewBox="0 0 12 14" fill="currentColor"><rect x="0" y="0" width="4" height="14" rx="1" /><rect x="8" y="0" width="4" height="14" rx="1" /></svg>
          ) : (
            <svg width="8" height="9" viewBox="0 0 12 14" fill="currentColor"><polygon points="0,0 12,7 0,14" /></svg>
          )}
        </button>
        <span className="audio-trim-time">{formatTime(currentTime)}{duration > 0 ? ` / ${formatTime(duration)}` : ''}</span>
        {duration > 0 && (
          <>
            <button className="audio-trim-btn" onClick={zoomOut} disabled={zoomLevel <= 1} title="Rauszoomen">−</button>
            <button className="audio-trim-btn" onClick={zoomIn} disabled={zoomLevel >= 100} title="Reinzoomen">+</button>
            {zoomLevel > 1 && <button className="audio-trim-btn" onClick={resetZoom} title="Zoom zurücksetzen">{zoomLevel >= 10 ? zoomLevel.toFixed(0) : zoomLevel.toFixed(1)}×</button>}
          </>
        )}
      </div>

      {/* Zoomable timeline */}
      <div
        ref={timelineRef}
        onClick={handleTimelineClick}
        style={{ position: 'relative', height: 36, marginTop: 4, background: 'rgba(0,0,0,0.3)', borderRadius: 4, cursor: duration > 0 ? 'crosshair' : 'default', userSelect: 'none', overflow: 'hidden' }}
      >
        {duration <= 0 && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <div className="video-loading-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>Timeline laden…</span>
          </div>
        )}
        {/* Tick marks + labels */}
        {ticks.map(tick => {
          const pct = timeToPercent(tick.time);
          if (pct < -1 || pct > 101) return null;
          return (
            <div key={tick.time} style={{ position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, pointerEvents: 'none' }}>
              <div style={{ width: 1, height: '100%', background: 'rgba(255,255,255,0.1)' }} />
              <span style={{ position: 'absolute', bottom: 2, left: 3, fontSize: 9, color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{tick.label}</span>
            </div>
          );
        })}

        {/* Marker lines (draggable) */}
        {MARKER_DEFS.map(def => {
          const val = q[def.key];
          if (val === undefined || duration <= 0 || !isVisible(val)) return null;
          return (
            <div
              key={def.key}
              className="audio-trim-marker"
              style={{ left: `${timeToPercent(val)}%`, '--marker-color': def.color } as React.CSSProperties}
              onMouseDown={e => { e.preventDefault(); e.stopPropagation(); draggingRef.current = def.key; }}
              title={`${def.label}: ${formatTime(val)} — ziehen zum Verschieben`}
            >
              <div className="audio-trim-marker-line" />
              <div className="audio-trim-marker-label">{def.label}</div>
            </div>
          );
        })}

        {/* Playback cursor */}
        {duration > 0 && isVisible(currentTime) && (
          <div style={{ position: 'absolute', left: `${timeToPercent(currentTime)}%`, top: 0, bottom: 0, width: 2, background: 'rgba(255,255,255,0.9)', transform: 'translateX(-1px)', pointerEvents: 'none', zIndex: 5 }} />
        )}
      </div>

      {/* Minimap when zoomed */}
      {zoomLevel > 1 && duration > 0 && (
        <div
          ref={minimapRef}
          className="audio-trim-minimap"
          onClick={e => { const rect = minimapRef.current!.getBoundingClientRect(); setViewOffset(clampOffset((e.clientX - rect.left) / rect.width - 0.5 / zoomLevel, zoomLevel)); }}
        >
          {MARKER_DEFS.map(def => {
            const val = q[def.key];
            return val !== undefined ? <div key={def.key} className="audio-trim-minimap-marker" style={{ left: `${(val / duration) * 100}%`, background: def.color }} /> : null;
          })}
          <div
            className="audio-trim-minimap-viewport"
            style={{ left: `${viewOffset * 100}%`, width: `${(1 / zoomLevel) * 100}%` }}
            onMouseDown={e => { e.preventDefault(); e.stopPropagation(); draggingRef.current = 'minimap'; }}
          />
          {(currentTime > 0 || isPlaying) && (
            <div className="audio-trim-minimap-cursor" style={{ left: `${(currentTime / duration) * 100}%` }} />
          )}
        </div>
      )}

      {/* Marker buttons: set at current time / click to jump */}
      <div className="audio-trim-controls" style={{ marginTop: 4 }}>
        <span className="audio-trim-sep" />
        {MARKER_DEFS.map((def, defIdx) => {
          const val = q[def.key];
          // When setting a marker, reset any later markers that would end up before it
          const setMarkerAt = (t: number) => {
            const rounded = Math.round(t * 100) / 100;
            const patch: Partial<VideoGuessQuestion> = { [def.key]: rounded };
            for (let j = defIdx + 1; j < MARKER_DEFS.length; j++) {
              const laterVal = q[MARKER_DEFS[j].key];
              if (laterVal !== undefined && laterVal <= rounded) {
                patch[MARKER_DEFS[j].key] = undefined;
              }
            }
            onUpdate(patch);
          };
          return val === undefined ? (
            <button
              key={def.key}
              className="audio-trim-btn audio-trim-btn-add"
              onClick={() => setMarkerAt(currentTime)}
              title={`${def.label} an aktueller Position setzen`}
            >
              <span style={{ color: def.color }}>●</span> + {def.label}
            </button>
          ) : (
            <span key={def.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
              <button
                className="audio-trim-btn"
                onClick={() => seekTo(val)}
                title={`${def.label}: ${formatTime(val)} — Klick: springen`}
                style={{ borderColor: `${def.color}44`, color: def.color, background: `${def.color}10`, borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              >
                ● {def.label} <span style={{ fontFamily: 'monospace', fontSize: 10, opacity: 0.7 }}>{formatTime(val)}</span>
              </button>
              <button
                className="audio-trim-btn"
                onClick={() => onUpdate({ [def.key]: undefined })}
                title={`${def.label} entfernen`}
                style={{ borderColor: `${def.color}44`, color: def.color, background: `${def.color}10`, borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 'none', padding: '0 4px' }}
              >
                ✕
              </button>
            </span>
          );
        })}
      </div>

      {/* Enlarged video modal */}
      {enlarged && (
        <div className="modal-overlay" onClick={() => setEnlarged(false)}>
          <div className="video-detail-modal" onClick={e => e.stopPropagation()}>
            <div className="image-lightbox-header">
              <span className="image-lightbox-name">{q.video.split('/').pop()}</span>
              <button className="be-icon-btn" onClick={() => setEnlarged(false)}>✕</button>
            </div>
            <div className="video-detail-player">
              <video
                ref={enlargedRef}
                src={videoSrc}
                disablePictureInPicture
                style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 4 }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main form ──
export default function VideoGuessForm({ questions, onChange, otherInstances, onMoveQuestion }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  // HDR detection: set of video paths that are HDR
  const [hdrVideos, setHdrVideos] = useState<Set<string>>(new Set());
  // Warmup state per question index: { percent, done, error }
  const [warmupState, setWarmupState] = useState<Map<number, { percent: number; done?: boolean; error?: string }>>(new Map());

  // Probe unique video paths for HDR on mount / when questions change
  useEffect(() => {
    const paths = [...new Set(questions.map(q => q.video).filter(Boolean))];
    let active = true;
    Promise.all(paths.map(async p => {
      const isHdr = await checkVideoHdr(p);
      return { path: p, isHdr };
    })).then(results => {
      if (!active) return;
      const hdr = new Set<string>();
      for (const r of results) if (r.isHdr) hdr.add(r.path);
      setHdrVideos(hdr);
    });
    return () => { active = false; };
  }, [questions]);

  // Check SDR cache status for HDR questions — re-checks when markers/track change
  // Uses a stable key per question to detect changes and reset stale warmup state
  const markerKeys = questions.map((q, i) =>
    `${i}:${q.video}:${q.videoStart}:${q.videoQuestionEnd}:${q.videoAnswerEnd}:${q.audioTrack}`
  ).join('|');

  useEffect(() => {
    let active = true;
    // Reset warmup state then re-check cache
    setWarmupState(new Map());
    questions.forEach((q, i) => {
      if (!q.video || !hdrVideos.has(q.video)) return;
      if (q.videoStart === undefined && q.videoQuestionEnd === undefined && q.videoAnswerEnd === undefined) return;
      const segStart = q.videoStart ?? 0;
      const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0) + 1;
      checkSdrCache(q.video, segStart, segEnd, q.audioTrack).then(cached => {
        if (active && cached) {
          setWarmupState(prev => new Map(prev).set(i, { percent: 100, done: true }));
        }
      }).catch(() => {});
    });
    return () => { active = false; };
  }, [markerKeys, hdrVideos]); // eslint-disable-line react-hooks/exhaustive-deps

  const startWarmup = async (i: number) => {
    const q = questions[i];
    if (!q.video) return;
    const segStart = q.videoStart ?? 0;
    const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0) + 1;
    setWarmupState(prev => new Map(prev).set(i, { percent: 0 }));
    try {
      await warmupSdr(q.video, segStart, segEnd, (ev) => {
        if (ev.percent !== undefined) {
          setWarmupState(prev => new Map(prev).set(i, { percent: ev.percent! }));
        }
        if (ev.done || ev.cached) {
          setWarmupState(prev => new Map(prev).set(i, { percent: 100, done: true }));
        }
      }, q.audioTrack);
      setWarmupState(prev => new Map(prev).set(i, { percent: 100, done: true }));
    } catch (err) {
      setWarmupState(prev => new Map(prev).set(i, { percent: 0, error: (err as Error).message }));
    }
  };

  const drag = useDragReorder(questions, onChange);

  const update = (i: number, patch: Partial<VideoGuessQuestion>) => {
    const next = [...questions];
    next[i] = { ...next[i], ...patch };
    (Object.keys(next[i]) as (keyof VideoGuessQuestion)[]).forEach(k => {
      if (next[i][k] === undefined) delete next[i][k];
    });
    onChange(next);
  };

  const remove = (i: number) => { if (confirm('Frage löschen?')) onChange(questions.filter((_, idx) => idx !== i)); };
  const duplicate = (i: number) => { const next = [...questions]; next.splice(i + 1, 0, { ...questions[i] }); onChange(next); };

  const toggle = (i: number) => setExpanded(prev => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; });

  const hasMarkers = (q: VideoGuessQuestion) =>
    q.videoStart !== undefined || q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;

  return (
    <div>
      {questions.map((q, i) => (
        <div
          key={i}
          className={`question-block ${drag.overIdx === i ? 'be-dragging' : ''} ${q.disabled ? 'question-disabled' : ''}`}
          data-question-index={i}
          onDragOver={drag.onDragOver(i)}
          onDragEnd={drag.onDragEnd}
        >
          <div className="question-block-row">
            <span className="drag-handle" draggable onDragStart={drag.onDragStart(i)} title="Ziehen zum Sortieren">⠿</span>
            <span className="question-num">#{i + 1}</span>
            <div className="question-block-inputs">
              <input
                className="be-input"
                value={q.answer}
                placeholder="Antwort..."
                onChange={e => update(i, { answer: e.target.value })}
              />
            </div>
            {q.answerImage && (
              <img src={q.answerImage} alt="" style={{ height: 40, width: 40, objectFit: 'contain', borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)', opacity: 0.6, flexShrink: 0 }} title={`Bild: ${q.answerImage}`} />
            )}
            {q.video && hasMarkers(q) && (
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}>
                🎬 ✂
              </span>
            )}
            <button className="be-delete-btn" onClick={() => update(i, { disabled: !q.disabled || undefined })} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 17, border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
            <button className="be-delete-btn" onClick={() => duplicate(i)} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
            {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={target => onMoveQuestion(i, target)} />}
            <button className="be-delete-btn" onClick={() => remove(i)} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
          </div>

          <div className="question-fields" style={{ marginTop: 8 }}>
            <div className="full-width">
              <AssetField
                label="Video-Datei"
                value={q.video || undefined}
                category="videos"
                onChange={v => {
                  update(i, { video: v ?? '', videoStart: undefined, videoQuestionEnd: undefined, videoAnswerEnd: undefined });
                  if (v === undefined) setExpanded(prev => { const n = new Set(prev); n.delete(i); return n; });
                }}
              />
              {q.video && (
                <button
                  className={`audio-trim-toggle-btn${expanded.has(i) ? ' active' : ''}${hasMarkers(q) ? ' has-trim' : ''}`}
                  onClick={() => toggle(i)}
                  style={{ marginTop: 4 }}
                >
                  🎬 Marker {expanded.has(i) ? 'ausblenden' : 'bearbeiten'}
                </button>
              )}
              {q.video && expanded.has(i) && (
                <VideoMarkerEditor q={q} onUpdate={patch => update(i, patch)} />
              )}
              {/* HDR warmup button — shown when video is HDR and has at least start or end markers */}
              {q.video && hdrVideos.has(q.video) && hasMarkers(q) && (() => {
                const ws = warmupState.get(i);
                if (ws?.error) {
                  return (
                    <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 4, fontSize: 11, color: 'rgba(248,113,113,0.9)' }}>
                      Fehler: {ws.error}
                    </div>
                  );
                }
                if (ws && !ws.done && ws.percent > 0) {
                  return (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(251,191,36,0.9)', marginBottom: 2 }}>
                        <span>HDR→SDR Konvertierung…</span>
                        <span style={{ fontFamily: 'monospace' }}>{ws.percent}%</span>
                      </div>
                      <div className="upload-progress-track" style={{ height: 4 }}>
                        <div className="upload-progress-fill upload-progress-processing" style={{ width: `${ws.percent}%` }} />
                      </div>
                    </div>
                  );
                }
                return (
                  <button
                    className="audio-trim-toggle-btn"
                    disabled={!!ws?.done}
                    onClick={() => startWarmup(i)}
                    style={{ marginTop: 4, ...(!ws?.done && { borderColor: 'rgba(251,191,36,0.4)', color: 'rgba(251,191,36,0.9)' }), ...(ws?.done && { cursor: 'default', opacity: 0.45, background: 'transparent' }) }}
                    title={ws?.done ? 'SDR-Clip bereits im Cache' : 'HDR-Video vorab in SDR konvertieren (nur den markierten Clip)'}
                  >
                    {ws?.done ? '✅ HDR→SDR Warmup' : '🎨 HDR→SDR Warmup'}
                  </button>
                );
              })()}
            </div>
            <div>
              <AssetField
                label="Antwort-Bild (optional)"
                value={q.answerImage}
                category="images"
                onChange={v => update(i, { answerImage: v })}
              />
            </div>
          </div>
        </div>
      ))}
      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Frage hinzufügen
      </button>
    </div>
  );
}
