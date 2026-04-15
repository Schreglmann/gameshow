import { useState, useRef, useEffect, useCallback } from 'react';
import type { VideoGuessQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';
import { probeVideo, warmupSdr, checkSdrCache, type VideoTrackInfo } from '@/services/backendApi';
import { checkVideoHdr } from '@/services/api';
import { useVideoPlayback, safeSeek } from '@/services/useVideoPlayback';
import { getBrowserVideoWarning } from '@/services/browserVideoCompat';
import MoveQuestionButton from './MoveQuestionButton';

interface Props {
  questions: VideoGuessQuestion[];
  onChange: (questions: VideoGuessQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
  isArchive?: boolean;
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
// Note: `safeSeek` lives in `@/services/useVideoPlayback` and is shared with the DAM
// preview (both surfaces need keyframe-targeted seeking to dodge HEVC decoder confusion).

function VideoMarkerEditor({ q, onUpdate }: { q: VideoGuessQuestion; onUpdate: (patch: Partial<VideoGuessQuestion>) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | 'minimap' | null>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
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
  // Codec + width are needed to match against the browser-compat matrix (HEVC HDR on
  // Firefox, 4K HEVC HDR on Safari etc.). Kept in small local state rather than passing
  // the entire `videoInfo` around.
  const [videoCodec, setVideoCodec] = useState('');
  const [videoWidth, setVideoWidth] = useState(0);

  // Shared loading/error/decode-recovery — identical to the DAM preview behaviour.
  const { loading: videoLoading, error: videoError } = useVideoPlayback(videoRef, q.video);

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
        setVideoCodec(vi.codec);
        setVideoWidth(vi.width);
      }
    }).catch(() => {}).finally(() => {
      if (!cancelled) setAudioTracksLoading(false);
    });
    return () => { cancelled = true; };
  }, [q.video]);

  // Marker-editor-specific element listeners: current time for the scrubber cursor and
  // play/pause for the transport button. Loading + error + stream notifications are owned
  // by `useVideoPlayback` above — no duplication needed.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => setCurrentTime(v.currentTime);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [q.video]);

  // Marker-editor preview: always play the original file. It's already written to disk and
  // fully seekable — critical for scrubbing through a 2-hour movie to find marker positions.
  //
  // The track-cache endpoint (/videos-track/{N}/) is NOT used here: on first request it has
  // to generate the cache (remux + AAC audio encode), which takes minutes for a long film.
  // Seeking past the already-written bytes during that generation just spins forever. By
  // serving the original, seeking always works; the cost is that AC3/DTS-only files have
  // silent preview, which the hint pill below acknowledges.
  //
  // Language switching in this preview does NOT change the audio — it only updates
  // q.audioTrack, which the segment-cache encoder uses when the operator clicks "Cache
  // erstellen" to bake the clip for the gameshow player.
  const videoSrc = q.video;

  // Ensure the element isn't stuck muted from a previous render cycle (the old audio-sync
  // hack muted it intentionally; new code doesn't, so explicitly unmute on src change).
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = false;
  }, [videoSrc]);

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

  // Decode-error recovery is handled by `useVideoPlayback` (see its call at the top of
  // this component). The hook does the same reload-and-seek-back dance and also surfaces
  // a human-readable error for non-recoverable failures.

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

  // Sync enlarged video with editor video; mute source while enlarged so only one element
  // carries audio (the bigger one the user is focused on).
  useEffect(() => {
    if (!enlarged) return;
    const src = videoRef.current;
    const big = enlargedRef.current;
    if (!src || !big) return;
    big.currentTime = src.currentTime;
    src.muted = true;
    big.muted = false;
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
      {/* Browser-specific compat warning: same check as the DAM modal. Shown when the
       *  current browser is known to break on this codec/profile combo (e.g. Firefox
       *  AppleVT crashing on HEVC HDR seeks). */}
      {(() => {
        const warning = getBrowserVideoWarning({ codec: videoCodec, isHdr, width: videoWidth });
        if (!warning) return null;
        return (
          <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 4, fontSize: 11, color: 'rgba(248,113,113,0.95)', lineHeight: 1.4 }}>
            ⚠ {warning}
          </div>
        );
      })()}

      {/* Language selector — idx = audio-relative index (matches ffmpeg 0:a:idx) */}
      {audioTracksLoading && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Sprache:</span>
          <div className="video-loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
        </div>
      )}
      {!audioTracksLoading && (() => {
        // Three display states:
        //   (a) multiple browser-compatible tracks → show only compatible ones
        //   (b) no browser-compatible tracks but tracks exist → show ALL (cache will
        //       transcode the picked one to AAC so it works in the show) + stronger warning
        //   (c) ≤ 1 browser-compatible and no incompatible → single-track file, no picker
        const compatible = audioTracks.filter(t => t.browserCompatible);
        const hasMultipleCompatible = compatible.length > 1;
        const hasOnlyIncompatible = audioTracks.length > 0 && compatible.length === 0;
        if (!hasMultipleCompatible && !hasOnlyIncompatible) return null;

        const renderButton = (t: VideoTrackInfo, idx: number) => {
          const isSelected = q.audioTrack === idx || (q.audioTrack === undefined && idx === 0);
          const lang = t.language === 'deu' ? 'DE' : t.language === 'eng' ? 'EN' : t.language === 'fra' ? 'FR' : t.language === 'und' ? '?' : t.language.toUpperCase();
          return (
            <button
              key={idx}
              className="audio-trim-btn"
              onClick={() => onUpdate({ audioTrack: idx })}
              style={isSelected ? { borderColor: 'rgba(129,140,248,0.6)', background: 'rgba(129,140,248,0.15)', color: '#a5b4fc' } : undefined}
              title={`${t.name || t.codecLong} — ${t.channels}ch ${t.channelLayout}${!t.browserCompatible ? ' — nicht im Browser abspielbar, wird für den Cache zu AAC konvertiert' : ''}`}
            >
              {lang}{t.name ? ` (${t.name})` : ''}{!t.browserCompatible ? ' ⚠' : ''}
            </button>
          );
        };

        return (
          <>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>Sprache:</span>
              {hasMultipleCompatible
                ? audioTracks.map((t, idx) => t.browserCompatible ? renderButton(t, idx) : null)
                : audioTracks.map((t, idx) => renderButton(t, idx))}
            </div>
            {/* Hint content depends on whether any compatible track exists in the source. */}
            {hasOnlyIncompatible ? (
              <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(251,191,36,0.85)', fontStyle: 'italic' }}>
                ⚠ Keine browserkompatible Tonspur — die Vorschau ist stumm. Die gewählte
                Sprache wird im Cache für die Gameshow zu AAC konvertiert und spielt dort
                korrekt ab.
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 10, color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
                Vorschau spielt immer die Standard-Tonspur. Die gewählte Sprache wird im
                Cache für die Gameshow verwendet.
              </div>
            )}
          </>
        );
      })()}

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
export default function VideoGuessForm({ questions, onChange, otherInstances, onMoveQuestion, isArchive }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  // HDR detection for cache button
  const [hdrVideos, setHdrVideos] = useState<Set<string>>(new Set());
  // Cache state per question: { percent, done, error, preparing }
  // `preparing: true` → zeigt indeterminaten Balken + "Vorbereiten…" bis das erste echte Percent-Event kommt
  const [cacheState, setCacheState] = useState<Map<number, { percent: number; done?: boolean; error?: string; preparing?: boolean }>>(new Map());

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

  // Check existing cache status when markers/track change
  const markerKeys = questions.map((q, i) =>
    `${i}:${q.video}:${q.videoStart}:${q.videoQuestionEnd}:${q.videoAnswerEnd}:${q.audioTrack}`
  ).join('|');

  useEffect(() => {
    let active = true;
    setCacheState(new Map());
    questions.forEach((q, i) => {
      if (!q.video) return;
      const isHdr = hdrVideos.has(q.video);
      const hasTimeRange = q.videoStart !== undefined || q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;
      if (!hasTimeRange && q.audioTrack === undefined) return; // original file, no cache needed
      if (isHdr && hasTimeRange) {
        // Check SDR cache
        const segStart = q.videoStart ?? 0;
        const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0) + 1;
        checkSdrCache(q.video, segStart, segEnd, q.audioTrack).then(cached => {
          if (active && cached) setCacheState(prev => new Map(prev).set(i, { percent: 100, done: true }));
        }).catch(() => {});
      } else if (hasTimeRange) {
        // Check compressed cache — fetch with HEAD-like range to see if it exists
        const segStart = q.videoStart ?? 0;
        const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0) + 1;
        const videoPath = q.video.replace(/^\/videos\//, '');
        const trackParam = q.audioTrack !== undefined ? `?track=${q.audioTrack}` : '';
        fetch(`/api/backend/assets/videos/cache-check?type=compressed&path=${encodeURIComponent(videoPath)}&start=${segStart}&end=${segEnd}${q.audioTrack !== undefined ? `&track=${q.audioTrack}` : ''}`)
          .then(r => r.json()).then((d: { cached: boolean }) => {
            if (active && d.cached) setCacheState(prev => new Map(prev).set(i, { percent: 100, done: true }));
          }).catch(() => {});
      }
      // Track-only cache is fast (stream copy) — no need to pre-check
    });
    return () => { active = false; };
  }, [markerKeys, hdrVideos]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Generate cached file for the gameshow frontend. Returns a promise that resolves when
   *  the cache is ready (or rejects on failure). Uses SSE progress for both HDR and SDR
   *  segment caches so the progress bar fills smoothly; falls back to a range-request
   *  fetch for track-only caches (those are stream-copy + AAC audio, fast enough that
   *  percent progress isn't worth the SSE overhead). */
  const generateCache = useCallback(async (i: number) => {
    const q = questions[i];
    if (!q.video) return;
    const isHdr = hdrVideos.has(q.video);
    const hasTimeRange = q.videoStart !== undefined || q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;
    const segStart = q.videoStart ?? 0;
    const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0) + 1;
    const videoPath = q.video.replace(/^\/videos\//, '');
    const trackParam = q.audioTrack !== undefined ? `?track=${q.audioTrack}` : '';

    // Sofortiges Feedback — noch vor dem ersten await. `preparing: true` rendert einen
    // indeterminaten Balken + "Vorbereiten…", bis ein echtes Percent-Event eintrifft.
    setCacheState(prev => new Map(prev).set(i, { percent: 0, preparing: true }));
    try {
      if (isHdr && hasTimeRange) {
        await warmupSdr(q.video, segStart, segEnd, (ev) => {
          if (ev.percent !== undefined) setCacheState(prev => new Map(prev).set(i, { percent: ev.percent! }));
          if (ev.done || ev.cached) setCacheState(prev => new Map(prev).set(i, { percent: 100, done: true }));
        }, q.audioTrack);
      } else if (hasTimeRange) {
        // SDR with time ranges: fetch the compressed endpoint (generates + caches on demand).
        await fetch(`/videos-compressed/${segStart}/${segEnd}/${videoPath}${trackParam}`, { headers: { Range: 'bytes=0-0' } });
      } else if (q.audioTrack !== undefined) {
        // Track-only cache: fast stream-copy + AAC audio. Range request triggers on-demand gen.
        await fetch(q.video.replace(/^\/videos\//, `/videos-track/${q.audioTrack}/`) + trackParam, { headers: { Range: 'bytes=0-0' } });
      }
      setCacheState(prev => new Map(prev).set(i, { percent: 100, done: true }));
    } catch (err) {
      setCacheState(prev => new Map(prev).set(i, { percent: 0, error: (err as Error).message }));
    }
  }, [questions, hdrVideos]);

  // Auto-warmup: 2 minutes after the user last touched this question's markers/track/video,
  // kick off cache generation automatically. The debounce resets on every change so a user
  // who's still editing doesn't trigger spurious encodes. Skips questions that are already
  // cached, currently generating, or missing the inputs that require a cache.
  //
  // The timer is keyed by markerKeys — when questions change, old timers are cleared via the
  // effect cleanup below. `generateCache` is stable via useCallback so the timer isn't reset
  // every render.
  //
  // Archive-Instanzen werden übersprungen: Archivfragen werden nie gespielt (gameOrder +
  // loadGameConfig() lehnen sie ab), also wäre jedes Encoding verschwendete CPU/Platte.
  useEffect(() => {
    if (isArchive) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    questions.forEach((q, i) => {
      if (!q.video) return;
      const hasTimeRange = q.videoStart !== undefined || q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;
      if (!hasTimeRange && q.audioTrack === undefined) return;
      // cacheState set via the cache-check effect runs independently; to avoid racing we
      // re-check inside the timer callback.
      const t = setTimeout(() => {
        setCacheState(prev => {
          const cur = prev.get(i);
          if (cur?.done || cur?.preparing || (cur && cur.percent > 0 && !cur.error)) return prev;
          // Fire-and-forget — generateCache handles its own state updates.
          void generateCache(i);
          return prev;
        });
      }, 120_000);
      timers.push(t);
    });
    return () => { for (const t of timers) clearTimeout(t); };
  }, [markerKeys, generateCache, isArchive]); // eslint-disable-line react-hooks/exhaustive-deps

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
              {/* Cache button — shown when question needs caching (time ranges or audio track).
                  In der Archiv-Instanz ausgeblendet: Archivfragen werden nie gespielt, also wird
                  auch kein Cache generiert. */}
              {!isArchive && q.video && (hasMarkers(q) || q.audioTrack !== undefined) && (() => {
                const cs = cacheState.get(i);
                if (cs?.error) {
                  return (
                    <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 4, fontSize: 11, color: 'rgba(248,113,113,0.9)' }}>
                      Cache-Fehler: {cs.error}
                    </div>
                  );
                }
                if (cs && !cs.done && (cs.preparing || cs.percent > 0)) {
                  const isPreparing = !!cs.preparing && cs.percent === 0;
                  return (
                    <div style={{ marginTop: 4 }} data-testid={`cache-progress-${i}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(129,140,248,0.9)', marginBottom: 2 }}>
                        <span>{isPreparing ? 'Vorbereiten…' : 'Cache wird erstellt…'}</span>
                        {!isPreparing && <span style={{ fontFamily: 'monospace' }}>{cs.percent}%</span>}
                      </div>
                      <div className="upload-progress-track" style={{ height: 4 }}>
                        {isPreparing ? (
                          <div className="upload-progress-fill upload-progress-indeterminate" />
                        ) : (
                          <div className="upload-progress-fill upload-progress-processing" style={{ width: `${cs.percent}%` }} />
                        )}
                      </div>
                    </div>
                  );
                }
                return (
                  <>
                    <button
                      className="audio-trim-toggle-btn"
                      disabled={!!cs?.done}
                      onClick={() => generateCache(i)}
                      style={{ marginTop: 4, ...(!cs?.done && { borderColor: 'rgba(129,140,248,0.4)', color: 'rgba(129,140,248,0.9)' }), ...(cs?.done && { cursor: 'default', opacity: 0.45, background: 'transparent' }) }}
                      title={cs?.done ? 'Cache für Gameshow vorhanden' : 'Clip für die Gameshow vorberechnen (trimmt und konvertiert den markierten Ausschnitt)'}
                      data-testid={`cache-btn-${i}`}
                    >
                      {cs?.done ? '✅ Cache für Gameshow' : '📦 Cache für Gameshow erstellen'}
                    </button>
                    {!cs?.done && (
                      <div style={{ marginTop: 2, fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                        Wird in 2 Min. automatisch erzeugt
                      </div>
                    )}
                  </>
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
