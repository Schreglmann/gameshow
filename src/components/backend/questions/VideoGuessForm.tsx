import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo, Fragment } from 'react';
import { createPortal } from 'react-dom';
import type { VideoGuessQuestion } from '@/types/config';
import { useDragReorder } from '../useDragReorder';
import { AssetField } from '../AssetPicker';
import { probeVideo, warmupSdr, checkSdrCache, type VideoTrackInfo, type SystemStatusResponse } from '@/services/backendApi';
import { checkVideoHdr } from '@/services/api';
import { useVideoPlayback, safeSeek } from '@/services/useVideoPlayback';
import { getBrowserVideoWarning } from '@/services/browserVideoCompat';
import { useWsChannel } from '@/services/useBackendSocket';
import MoveQuestionButton from './MoveQuestionButton';

interface Props {
  questions: VideoGuessQuestion[];
  onChange: (questions: VideoGuessQuestion[]) => void;
  otherInstances?: string[];
  onMoveQuestion?: (questionIndex: number, targetInstance: string) => void;
  isArchive?: boolean;
  /** ISO 639-2 default audio language for the instance. Questions without an explicit
   *  `audioTrack` use the first audio stream tagged with this language. */
  instanceLanguage?: string;
  /** Update the instance-level default language. `undefined` clears it. Only wired up
   *  for non-archive instances. */
  onInstanceLanguageChange?: (language: string | undefined) => void;
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

// Snap a time to the frame PTS the browser preview is currently showing. The <video>
// element renders the frame whose PTS ≤ currentTime (floor semantics); rounding would
// sometimes bump the marker to the *next* frame which the operator never saw, and the
// cache would then start one frame late. The server's `frameFloor` uses the same rule,
// so markers round-trip through ffmpeg without drift. Fallback to centisecond precision
// when fps is still being probed.
function snapTime(t: number, fps: number): number {
  return fps > 0 ? Math.floor(t * fps) / fps : Math.round(t * 100) / 100;
}

// ── Marker definitions ──
const MARKER_DEFS = [
  { key: 'videoStart' as const, label: 'Start', color: 'rgba(74, 222, 128, 0.9)' },
  { key: 'videoQuestionEnd' as const, label: 'Frage', color: 'rgba(251, 191, 36, 0.9)' },
  { key: 'videoAnswerEnd' as const, label: 'Antwort', color: 'rgba(248, 113, 113, 0.9)' },
];
type MarkerKey = typeof MARKER_DEFS[number]['key'];

// Module-level tracker for the currently "active" marker editor. When multiple editors
// are expanded, we only want the last-interacted one to react to the space key — otherwise
// every open video toggles play/pause at once.
const activeEditorRef: { current: HTMLElement | null } = { current: null };

// Stable cache identifier for a question — keyed by the inputs that determine the cache
// file path on the server (video + markers + audio track). When a question is moved to
// another instance or its index shifts after a reorder, the cacheKey stays the same, so
// in-flight cache state and abort controllers remain correctly associated with the work.
// `effectiveTrack` is the resolved audio-track index for cache purposes — either
// `q.audioTrack` (explicit override) or the index resolved from the instance's default
// language; may be undefined when neither applies.
function cacheKeyOf(q: VideoGuessQuestion, effectiveTrack: number | undefined): string | null {
  if (!q.video) return null;
  const hasTimeRange = q.videoStart !== undefined || q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;
  if (!hasTimeRange && effectiveTrack === undefined) return null;
  const start = q.videoStart ?? '';
  const qEnd = q.videoQuestionEnd ?? '';
  const aEnd = q.videoAnswerEnd ?? '';
  const track = effectiveTrack ?? '';
  return `${q.video}|${start}|${qEnd}|${aEnd}|${track}`;
}

// ── Video marker editor: video player + zoomable timeline + marker buttons ──
// Note: `safeSeek` lives in `@/services/useVideoPlayback` and is shared with the DAM
// preview (both surfaces need keyframe-targeted seeking to dodge HEVC decoder confusion).

function VideoMarkerEditor({ q, onUpdate, instanceLanguage }: { q: VideoGuessQuestion; onUpdate: (patch: Partial<VideoGuessQuestion>) => void; instanceLanguage?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<MarkerKey | 'minimap' | null>(null);
  // While a marker is being dragged we buffer the new value locally instead of calling
  // onUpdate on every mousemove. That would propagate to the parent 60×/sec, re-render
  // the entire question list, and make the page shake. We commit the final value to the
  // parent on mouseup.
  const [dragValues, setDragValues] = useState<Partial<Record<MarkerKey, number>>>({});
  const dragValuesRef = useRef<Partial<Record<MarkerKey, number>>>({});

  const [duration, setDuration] = useState(0);
  // Probed frame rate — drives marker snapping + frame indicator ticks. 0 means
  // "not probed yet" (fall back to centisecond rounding until we know the fps).
  const [fps, setFps] = useState(0);
  const fpsRef = useRef(0);
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
  // Remembered "auto-zoom to markers" viewport from initial load — reused when the user
  // clicks a marker button for a marker that's currently outside the visible timeline range.
  const initialZoomRef = useRef<{ zoom: number; offset: number } | null>(null);

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

  // Defer video loading until the user explicitly interacts (play/seek/timeline click).
  // Large MKV/HEVC files cause heavy main-thread work during browser metadata parsing +
  // codec initialisation, freezing the entire admin UI. With preload="none" the <video>
  // element is inert on mount; we flip this flag on first interaction so the spinner only
  // appears once the browser is actually fetching data.
  const [videoActive, setVideoActive] = useState(false);
  const activateVideo = useCallback(() => setVideoActive(true), []);

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
        if (vi.fps > 0 && isFinite(vi.fps)) {
          setFps(vi.fps);
          fpsRef.current = vi.fps;
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
    // Throttle timeupdate → setCurrentTime to once per animation frame. The browser fires
    // timeupdate 4–15×/sec; each call would re-render the entire marker editor (timeline
    // cursor, ticks, markers). Coalescing via rAF keeps renders at ≤1 per frame.
    let rafId = 0;
    const onTime = () => {
      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          setCurrentTime(v.currentTime);
        });
      }
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [q.video]);

  // Marker-editor preview: always play the original file. It's already written to disk and
  // fully seekable — critical for scrubbing through a 2-hour movie to find marker positions.
  //
  // Language switching in this preview does NOT change the audio — it only updates
  // q.audioTrack, which the segment-cache encoder uses when the operator clicks "Cache
  // erstellen" to bake the clip for the gameshow player. The cost is that AC3/DTS-only files
  // have silent preview, which the hint pill below acknowledges.
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
      // Zoom so that the marker range fills ~33% of the visible timeline
      const range = maxT - minT;
      const viewSpan = range / 0.33; // markers occupy 33% of view
      const zoom = Math.max(1, Math.min(1000, duration / viewSpan));
      const center = ((minT + maxT) / 2) / duration;
      const offset = clampOffset(center - 0.5 / zoom, zoom);
      setZoomLevel(zoom);
      setViewOffset(offset);
      initialZoomRef.current = { zoom, offset };
    } else {
      // Single marker: show ~10s around it, at least 5% of duration
      const viewSpan = Math.max(10, duration * 0.05);
      const zoom = Math.max(1, Math.min(1000, duration / viewSpan));
      const offset = clampOffset(vals[0] / duration - 0.5 / zoom, zoom);
      setZoomLevel(zoom);
      setViewOffset(offset);
      initialZoomRef.current = { zoom, offset };
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
      const nz = Math.max(1, Math.min(1000, zoomRef.current * factor));
      const no = clampOffset(mouseTime - mouseX / nz, nz);
      zoomRef.current = nz;
      viewOffsetRef.current = no;
      setZoomLevel(nz);
      setViewOffset(no);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Drag marker on timeline. During drag we keep the candidate value in local state only,
  // and we seek the preview video to that time so the user sees the exact frame under the
  // marker. The parent state (and the downstream cache-check / HDR-probe effects) is only
  // updated once on mouseup — 60 Hz parent updates caused the whole list to re-layout and
  // made the page visibly shake.
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
    const raw = Math.max(0, Math.min(durationRef.current, tr * durationRef.current));
    const t = snapTime(raw, fpsRef.current);
    const key = draggingRef.current as MarkerKey;
    dragValuesRef.current = { ...dragValuesRef.current, [key]: t };
    setDragValues(dragValuesRef.current);
    // Seek preview video to the dragged frame — gives the user frame-perfect feedback
    // on where the marker is landing.
    const v = videoRef.current;
    if (v) {
      // Direct assignment (not safeSeek) — we want exact frame, and the video is already
      // paused on drag start so HEVC decoder confusion is not an issue here.
      v.currentTime = t;
      setCurrentTime(t);
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    const key = draggingRef.current;
    draggingRef.current = null;
    if (key && key !== 'minimap') {
      const pending = dragValuesRef.current;
      const committed: Partial<VideoGuessQuestion> = {};
      (Object.keys(pending) as MarkerKey[]).forEach(k => {
        const v = pending[k];
        if (v !== undefined) committed[k] = v;
      });
      dragValuesRef.current = {};
      setDragValues({});
      if (Object.keys(committed).length > 0) onUpdate(committed);
    }
  }, [onUpdate]);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => { document.removeEventListener('mousemove', handleMouseMove); document.removeEventListener('mouseup', handleMouseUp); };
  }, [handleMouseMove, handleMouseUp]);

  // Helper: read the effective marker value — drag-in-progress local override wins over
  // the committed value from the parent question. Used everywhere the timeline renders.
  const effectiveMarker = (key: MarkerKey) => dragValues[key] ?? q[key];

  // Click timeline to seek
  const handleTimelineClick = (e: React.MouseEvent) => {
    if (draggingRef.current) return;
    const el = timelineRef.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const cr = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const tr = cr / zoomLevel + viewOffset;
    const t = Math.max(0, Math.min(duration, tr * duration));
    const v = videoRef.current;
    if (!v) return;
    activateVideo();
    // With preload="none" the element has no media data yet, so setting currentTime is
    // a no-op and no frame is decoded. Force metadata to load, then seek once ready so
    // the preview frame appears on the first click instead of requiring play/pause.
    if (v.readyState < 1 /* HAVE_METADATA */) {
      try { v.load(); } catch { /* noop */ }
      const onReady = () => { safeSeek(v, t); setCurrentTime(t); };
      v.addEventListener('loadedmetadata', onReady, { once: true });
    } else {
      safeSeek(v, t);
      setCurrentTime(t);
    }
  };

  const timeToPercent = (t: number) => duration > 0 ? ((t / duration) - viewOffset) * zoomLevel * 100 : 0;
  const isVisible = (t: number) => { const p = ((t / duration) - viewOffset) * zoomLevel; return p >= -0.02 && p <= 1.02; };

  // Zoom controls
  const getZoomTarget = () => {
    if (duration <= 0) return 0.5;
    if (isPlaying || currentTime > 0) return currentTime / duration;
    const vals = MARKER_DEFS.map(d => effectiveMarker(d.key)).filter((v): v is number => v !== undefined);
    if (vals.length >= 2) return ((Math.min(...vals) + Math.max(...vals)) / 2) / duration;
    if (vals.length === 1) return vals[0] / duration;
    return viewOffset + 0.5 / zoomLevel;
  };
  const zoomIn = () => { const nz = Math.min(1000, zoomLevel * 1.5); setViewOffset(clampOffset(getZoomTarget() - 0.5 / nz, nz)); setZoomLevel(nz); };
  const zoomOut = () => { const nz = Math.max(1, zoomLevel / 1.5); setViewOffset(clampOffset(getZoomTarget() - 0.5 / nz, nz)); setZoomLevel(nz); };
  const resetZoom = () => { setZoomLevel(1); setViewOffset(0); };

  // Timestamp ticks — memoized so a re-render from currentTime (cursor movement) doesn't
  // recompute the tick array when the timeline viewport hasn't actually changed.
  const ticks = useMemo(() => {
    const result: { time: number; label: string }[] = [];
    if (duration > 0) {
      const visibleDur = duration / zoomLevel;
      const rawInterval = visibleDur / 8;
      const niceIntervals = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
      const tickInterval = niceIntervals.find(i => i >= rawInterval) ?? 600;
      const visStart = viewOffset * duration;
      const visEnd = visStart + visibleDur;
      const first = Math.ceil(visStart / tickInterval) * tickInterval;
      for (let t = first; t <= visEnd; t += tickInterval) {
        result.push({ time: t, label: formatTime(t) });
      }
    }
    return result;
  }, [duration, zoomLevel, viewOffset]);

  // Frame ticks — thin dim lines between the second labels so the operator can see how
  // far one frame moves at the current zoom. Only rendered when the visible viewport
  // holds ≤ 400 frames (otherwise they'd fill as a solid band). Hidden entirely until
  // the probe reports a valid fps.
  const frameTicks = useMemo(() => {
    if (duration <= 0 || fps <= 0) return [] as number[];
    const visibleDur = duration / zoomLevel;
    if (visibleDur * fps > 400) return [];
    const visStart = viewOffset * duration;
    const visEnd = visStart + visibleDur;
    const step = 1 / fps;
    const firstFrame = Math.ceil(visStart * fps);
    const lastFrame = Math.floor(visEnd * fps);
    const out: number[] = [];
    for (let f = firstFrame; f <= lastFrame; f++) out.push(f * step);
    return out;
  }, [duration, zoomLevel, viewOffset, fps]);

  const handlePlayPause = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    activateVideo();
    v.paused ? v.play().catch(() => {}) : v.pause();
  }, [activateVideo]);

  // Space key toggles play/pause — but only on the marker editor the user last interacted
  // with. Without this guard every open editor (archive scenario: multiple expanded) would
  // respond to the same key press and all their videos would toggle in lockstep.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (activeEditorRef.current !== containerRef.current) return;
      e.preventDefault();
      handlePlayPause();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [handlePlayPause]);

  // Mark this editor as "active" on any mousedown within it, so the Space key handler
  // above can route the keypress to the right instance. Clear on unmount if we were
  // holding the slot. If no other editor currently holds the slot on mount, claim it —
  // that way the common "only one editor expanded" case works without requiring the user
  // to click inside first.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (activeEditorRef.current === null) activeEditorRef.current = el;
    const onMouseDown = () => { activeEditorRef.current = el; };
    el.addEventListener('mousedown', onMouseDown, true);
    return () => {
      el.removeEventListener('mousedown', onMouseDown, true);
      if (activeEditorRef.current === el) activeEditorRef.current = null;
    };
  }, []);

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
    activateVideo();
    // Use exact seek (not safeSeek/fastSeek) so we land precisely on the marker
    v.currentTime = t;
    setCurrentTime(t);
    v.play().catch(() => {});
    // If the marker is off-screen (zoomed in elsewhere), snap the timeline back to the
    // initial "fit all markers" viewport so the user can see where they jumped to.
    if (duration > 0 && !isVisible(t)) {
      const initial = initialZoomRef.current;
      if (initial) {
        setZoomLevel(initial.zoom);
        setViewOffset(initial.offset);
        zoomRef.current = initial.zoom;
        viewOffsetRef.current = initial.offset;
      } else {
        // Fallback: centre the target at the current zoom
        const offset = clampOffset(t / duration - 0.5 / zoomRef.current, zoomRef.current);
        setViewOffset(offset);
        viewOffsetRef.current = offset;
      }
    }
  };

  return (
    <div className="video-marker-editor" ref={containerRef}>
      {/* Video player */}
      <div
        style={{ position: 'relative', width: '100%', aspectRatio: containerAspect, background: '#000', borderRadius: 6, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        onClick={() => setEnlarged(true)}
        title="Klicken zum Vergrößern"
      >
        <video
          ref={videoRef}
          src={videoSrc}
          preload="none"
          disablePictureInPicture
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }}
        />
        {!videoActive && !videoError && (
          <div
            style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 1 }}
            onClick={(e) => { e.stopPropagation(); activateVideo(); videoRef.current?.play().catch(() => {}); }}
            title="Klicken zum Laden"
          >
            <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)' }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><polygon points="6,3 20,12 6,21" /></svg>
            </div>
          </div>
        )}
        {videoActive && videoLoading && !videoError && (
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
          <div style={{ marginTop: 6, padding: '6px 10px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 4, fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(248,113,113,0.95)', lineHeight: 1.4 }}>
            ⚠ {warning}
          </div>
        );
      })()}

      {/* Language selector — idx = audio-relative index (matches ffmpeg 0:a:idx) */}
      {audioTracksLoading && (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(255,255,255,0.5)' }}>Sprache:</span>
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

        // Highlight only the explicit per-question override — never the inherited-from-
        // instance case. When the question follows the instance default we still mark
        // which track the default resolves to (★) so the operator sees at a glance what
        // would play without committing the question to that track.
        const inheritedIdx = instanceLanguage
          ? audioTracks.findIndex(t => t.language === instanceLanguage)
          : -1;

        const isInherited = q.audioTrack === undefined;

        const renderButton = (t: VideoTrackInfo, idx: number) => {
          const isExplicitlySelected = q.audioTrack === idx;
          const isDefaultTrack = inheritedIdx === idx;
          const lang = t.language === 'deu' ? 'DE' : t.language === 'eng' ? 'EN' : t.language === 'fra' ? 'FR' : t.language === 'und' ? '?' : t.language.toUpperCase();
          const selectedStyle = { borderColor: 'rgba(var(--admin-accent-rgb),0.6)', background: 'rgba(var(--admin-accent-rgb),0.15)', color: 'var(--admin-accent-light)' };
          const mutedStyle = { opacity: 0.4 };
          const title = [
            `${t.name || t.codecLong} — ${t.channels}ch ${t.channelLayout}`,
            !t.browserCompatible ? 'nicht im Browser abspielbar, wird für den Cache zu AAC konvertiert' : '',
            isDefaultTrack ? 'Instanz-Standard' : '',
          ].filter(Boolean).join(' — ');
          return (
            <button
              key={idx}
              className="audio-trim-btn"
              onClick={() => onUpdate({ audioTrack: idx })}
              style={isExplicitlySelected ? selectedStyle : isInherited ? mutedStyle : undefined}
              title={title}
            >
              {isDefaultTrack && <span style={{ marginRight: 4, color: 'var(--admin-accent-light)' }} aria-hidden="true">★</span>}
              {lang}{t.name ? ` (${t.name})` : ''}{!t.browserCompatible ? ' ⚠' : ''}
            </button>
          );
        };

        const standardStyle = { borderColor: 'rgba(var(--admin-accent-rgb),0.6)', background: 'rgba(var(--admin-accent-rgb),0.15)', color: 'var(--admin-accent-light)' };

        return (
          <>
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(255,255,255,0.5)' }}>Sprache:</span>
              <button
                className="audio-trim-btn"
                onClick={() => onUpdate({ audioTrack: undefined })}
                style={isInherited ? standardStyle : undefined}
                title={isInherited
                  ? 'Dieser Clip folgt dem Instanz-Standard. Klicke eine Sprache, um sie für diese Frage fest zu setzen.'
                  : 'Explizite Sprach-Auswahl entfernen und Instanz-Standard verwenden'}
              >
                Standard
              </button>
              {hasMultipleCompatible
                ? audioTracks.map((t, idx) => t.browserCompatible ? renderButton(t, idx) : null)
                : audioTracks.map((t, idx) => renderButton(t, idx))}
            </div>
            {/* Hint content depends on whether any compatible track exists in the source. */}
            {hasOnlyIncompatible ? (
              <div style={{ marginTop: 4, fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(251,191,36,0.85)', fontStyle: 'italic' }}>
                ⚠ Keine browserkompatible Tonspur — die Vorschau ist stumm. Die gewählte
                Sprache wird im Cache für die Gameshow zu AAC konvertiert und spielt dort
                korrekt ab.
              </div>
            ) : (
              <div style={{ marginTop: 4, fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(255,255,255,0.45)', fontStyle: 'italic' }}>
                Vorschau spielt immer die Standard-Tonspur. Die gewählte Sprache wird im
                Cache für die Gameshow verwendet.
                {inheritedIdx >= 0 && ' ★ markiert den Instanz-Standard.'}
              </div>
            )}
          </>
        );
      })()}

      {/* Transport */}
      <div className="audio-trim-controls" style={{ marginTop: 6 }}>
        <button className="audio-trim-btn" onClick={() => seekTo(effectiveMarker('videoStart') ?? 0)} title="Zum Start">
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
            <button className="audio-trim-btn" onClick={zoomIn} disabled={zoomLevel >= 1000} title="Reinzoomen">+</button>
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
            <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(255,255,255,0.4)' }}>Timeline laden…</span>
          </div>
        )}
        {/* Frame ticks — rendered before second ticks so the labelled seconds stay on top */}
        {frameTicks.map(t => {
          const pct = timeToPercent(t);
          if (pct < -1 || pct > 101) return null;
          return (
            <div
              key={`f-${t}`}
              style={{ position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, width: 1, background: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }}
            />
          );
        })}
        {/* Tick marks + labels */}
        {ticks.map(tick => {
          const pct = timeToPercent(tick.time);
          if (pct < -1 || pct > 101) return null;
          return (
            <div key={tick.time} style={{ position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, pointerEvents: 'none' }}>
              <div style={{ width: 1, height: '100%', background: 'rgba(255,255,255,0.1)' }} />
              <span style={{ position: 'absolute', bottom: 2, left: 3, fontSize: 'var(--admin-sz-9, 9px)', color: 'rgba(255,255,255,0.35)', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{tick.label}</span>
            </div>
          );
        })}

        {/* Segment region fills between markers */}
        {duration > 0 && [
          { from: effectiveMarker('videoStart'), to: effectiveMarker('videoQuestionEnd'), color: 'rgba(74, 222, 128, 0.12)' },
          { from: effectiveMarker('videoQuestionEnd'), to: effectiveMarker('videoAnswerEnd'), color: 'rgba(251, 191, 36, 0.10)' },
        ].map((seg, idx) => {
          if (seg.from === undefined || seg.to === undefined) return null;
          const leftPct = Math.max(0, timeToPercent(seg.from));
          const rightPct = Math.min(100, timeToPercent(seg.to));
          if (rightPct <= leftPct) return null;
          return (
            <div
              key={`seg-${idx}`}
              style={{ position: 'absolute', left: `${leftPct}%`, width: `${rightPct - leftPct}%`, top: 0, bottom: 0, background: seg.color, pointerEvents: 'none', zIndex: 1 }}
            />
          );
        })}

        {/* Marker lines (draggable) */}
        {MARKER_DEFS.map(def => {
          const val = effectiveMarker(def.key);
          if (val === undefined || duration <= 0 || !isVisible(val)) return null;
          return (
            <div
              key={def.key}
              className="audio-trim-marker"
              style={{ left: `${timeToPercent(val)}%`, '--marker-color': def.color } as React.CSSProperties}
              onMouseDown={e => {
                e.preventDefault();
                e.stopPropagation();
                draggingRef.current = def.key;
                // Pause preview so the seek-per-mousemove below isn't fighting playback
                const v = videoRef.current;
                if (v && !v.paused) v.pause();
                // Seed the drag with the marker's current value + seek to that exact frame
                // so the preview shows where we're starting from.
                dragValuesRef.current = { ...dragValuesRef.current, [def.key]: val };
                setDragValues(dragValuesRef.current);
                if (v) {
                  v.currentTime = val;
                  setCurrentTime(val);
                }
              }}
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
          {/* Minimap segment fills */}
          {[
            { from: effectiveMarker('videoStart'), to: effectiveMarker('videoQuestionEnd'), color: 'rgba(74, 222, 128, 0.15)' },
            { from: effectiveMarker('videoQuestionEnd'), to: effectiveMarker('videoAnswerEnd'), color: 'rgba(251, 191, 36, 0.12)' },
          ].map((seg, idx) => {
            if (seg.from === undefined || seg.to === undefined) return null;
            return (
              <div
                key={`mseg-${idx}`}
                style={{ position: 'absolute', left: `${(seg.from / duration) * 100}%`, width: `${((seg.to - seg.from) / duration) * 100}%`, top: 0, bottom: 0, background: seg.color, pointerEvents: 'none', zIndex: 0 }}
              />
            );
          })}
          {MARKER_DEFS.map(def => {
            const val = effectiveMarker(def.key);
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
          const val = effectiveMarker(def.key);
          // When setting a marker, reset any later markers that would end up before it
          const setMarkerAt = (t: number) => {
            const rounded = snapTime(t, fpsRef.current);
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
                ● {def.label} <span style={{ fontFamily: 'monospace', fontSize: 'var(--admin-sz-10, 10px)', opacity: 0.7 }}>{formatTime(val)}</span>
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

// ── Module-level helpers used by both the row and the main form ──
function hasMarkers(q: VideoGuessQuestion) {
  return q.videoStart !== undefined || q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;
}

type CacheEntry = { percent: number; done?: boolean; error?: string; preparing?: boolean; queued?: boolean };

/** Match-key used to correlate server bgTask.meta to a question. Must match the
 *  tuple the server records in `handleSegmentWarmup` / `cache-warm-all`: the
 *  relative video path (minus `/videos/`), segStart, segEnd, and track. */
function makeRemoteMatchKey(video: string, start: number, end: number, track: number | undefined): string {
  const rel = video.replace(/^\/videos\//, '');
  return `${rel}|${start}|${end}|${track ?? ''}`;
}

/** Compute the match-key for a question the same way `handleGenerate` /
 *  `cache-warm-all` derive `segStart` / `segEnd`. Returns null when the question
 *  has no cacheable segment. */
function questionMatchKey(q: VideoGuessQuestion, effectiveTrack: number | undefined): string | null {
  if (!q.video) return null;
  const hasTimeRange = q.videoStart !== undefined || q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;
  if (!hasTimeRange) return null;
  const segStart = q.videoStart ?? 0;
  const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0);
  return makeRemoteMatchKey(q.video, segStart, segEnd, effectiveTrack);
}

// Modal that plays the cached gameshow segment for a question. Auto-pauses at
// `videoQuestionEnd` (the question marker) so the operator hears/sees exactly what the
// players will hear/see before the reveal. The rest of the cached segment (up to
// `videoAnswerEnd`) is reachable by pressing play again — the pause is one-shot.
function CachePreviewModal({
  q, effectiveTrack, isHdr, onClose,
}: { q: VideoGuessQuestion; effectiveTrack: number | undefined; isHdr: boolean; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const segStart = q.videoStart ?? 0;
  const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0);
  const videoPath = q.video.replace(/^\/videos\//, '');
  const base = isHdr ? '/videos-sdr' : '/videos-compressed';
  const trackParam = effectiveTrack !== undefined ? `?track=${effectiveTrack}` : '';
  const src = `${base}/${segStart}/${segEnd}/${videoPath}${trackParam}`;
  const questionEndRel = q.videoQuestionEnd !== undefined ? q.videoQuestionEnd - segStart : undefined;
  const answerEndRel = q.videoAnswerEnd !== undefined ? q.videoAnswerEnd - segStart : undefined;

  // Pause once at the question marker so the operator hears/sees exactly what the
  // players will see before the reveal. The answer marker doesn't need its own pause:
  // the cache ends exactly there (no trailing buffer), so the video naturally ends on
  // the marker frame. Scrubbing backwards re-arms the stop. Only install the handler
  // when both markers exist — otherwise either there's nothing to split (answer-only)
  // or the cache already ends at the question marker (no answer segment).
  useEffect(() => {
    const v = videoRef.current;
    if (!v || questionEndRel === undefined || answerEndRel === undefined) return;
    let armed = v.currentTime < questionEndRel - 0.05;
    const onTime = () => {
      if (armed && !v.paused && v.currentTime >= questionEndRel) {
        armed = false;
        v.pause();
      }
    };
    const onSeeked = () => {
      if (v.currentTime < questionEndRel - 0.05) armed = true;
    };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onSeeked);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onSeeked);
    };
  }, [questionEndRel, answerEndRel]);

  // The enclosing question-block has `contain: layout style`, which traps `position: fixed`
  // descendants inside its box. Portaling to <body> escapes that containing-block so the
  // overlay fills the viewport and intercepts clicks/closes on the backdrop correctly.
  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="video-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="image-lightbox-header">
          <span className="image-lightbox-name">{q.video.split('/').pop()} — Cache-Vorschau</span>
          <button className="be-icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="video-detail-player" style={{ flexDirection: 'column' }}>
          <video
            ref={videoRef}
            src={src}
            autoPlay
            controls
            disablePictureInPicture
            style={{ maxWidth: '100%', maxHeight: '60vh', borderRadius: 4 }}
          />
          {questionEndRel !== undefined && answerEndRel !== undefined && (
            <div style={{ marginTop: 6, fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(255,255,255,0.55)', textAlign: 'center' }}>
              Stoppt bei der Frage-Marke ({formatTime(questionEndRel)}). Play erneut klicken spielt den Antwort-Teil weiter.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

interface QuestionBlockProps {
  q: VideoGuessQuestion;
  i: number;
  cs: CacheEntry | undefined;
  isExpanded: boolean;
  isDraggingOver: boolean;
  otherInstances: string[] | undefined;
  isArchive: boolean;
  /** Resolved audio-track index for this question — `q.audioTrack` when explicitly set,
   *  otherwise the index matching the instance's default language, or undefined. */
  effectiveTrack: number | undefined;
  /** HDR flag for this question's video — selects `/videos-sdr/` vs `/videos-compressed/`
   *  for cache preview playback. */
  isHdr: boolean;
  /** Instance-level default language (ISO 639-2) passed down so the marker editor's
   *  language picker can visually distinguish "inherited default" from "explicit override". */
  instanceLanguage: string | undefined;
  refCallback: (el: HTMLElement | null) => void;
  onUpdate: (i: number, patch: Partial<VideoGuessQuestion>) => void;
  onRemove: (i: number) => void;
  onDuplicate: (i: number) => void;
  onToggle: (i: number) => void;
  onClearExpanded: (i: number) => void;
  onGenerateCache: (i: number) => void;
  onMoveQuestion: ((i: number, target: string) => void) | undefined;
  onDragStart: (i: number, e: React.DragEvent) => void;
  onDragOver: (i: number, e: React.DragEvent) => void;
  onDragEnd: () => void;
}

// Extracted as its own memoized component so a list-wide re-render (e.g. `seenIndices`
// growing during fast scroll, or `cacheState` adding a single entry) only re-renders the
// row whose props actually changed. The parent stabilizes every callback via ref-based
// useCallback so the shallow compare below holds across renders.
const QuestionBlock = memo(function QuestionBlock({
  q, i, cs, isExpanded, isDraggingOver, otherInstances, isArchive,
  effectiveTrack, isHdr, instanceLanguage,
  refCallback,
  onUpdate, onRemove, onDuplicate, onToggle, onClearExpanded, onGenerateCache, onMoveQuestion,
  onDragStart, onDragOver, onDragEnd,
}: QuestionBlockProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  // Track whether this block's marker editor has ever been expanded. Once true, we keep
  // the VideoMarkerEditor mounted (but hidden via display:none) so the <video> element
  // retains its buffered data and probe results — re-expanding is instant instead of
  // re-downloading the entire video metadata from scratch.
  const [wasExpanded, setWasExpanded] = useState(false);
  useEffect(() => {
    if (isExpanded) setWasExpanded(true);
  }, [isExpanded]);
  // Build a stable identity for this question slot. When the identity changes (e.g. a
  // question was deleted and a different one slid into this index), reset wasExpanded so
  // the stale hidden editor is unmounted. Uses video + answer as the identity — NOT
  // markers, because marker changes happen during normal editing and must not unmount
  // the editor (that would lose zoom state and buffered video data).
  const questionIdentity = `${q.video}|${q.answer}`;
  const identityRef = useRef(questionIdentity);
  useEffect(() => {
    if (identityRef.current !== questionIdentity) {
      identityRef.current = questionIdentity;
      if (!isExpanded) setWasExpanded(false);
    }
  }, [questionIdentity, isExpanded]);

  const handleAnswerChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => onUpdate(i, { answer: e.target.value }), [i, onUpdate]);
  const handleToggleDisabled = useCallback(() => onUpdate(i, { disabled: !q.disabled || undefined }), [i, onUpdate, q.disabled]);
  const handleDuplicate = useCallback(() => onDuplicate(i), [i, onDuplicate]);
  const handleRemove = useCallback(() => onRemove(i), [i, onRemove]);
  const handleToggle = useCallback(() => onToggle(i), [i, onToggle]);
  const handleGenerate = useCallback(() => onGenerateCache(i), [i, onGenerateCache]);
  const handleMove = useCallback((target: string) => onMoveQuestion?.(i, target), [i, onMoveQuestion]);
  const handleDragStartEvt = useCallback((e: React.DragEvent) => onDragStart(i, e), [i, onDragStart]);
  const handleDragOverEvt = useCallback((e: React.DragEvent) => onDragOver(i, e), [i, onDragOver]);
  const handleVideoChange = useCallback((v: string | undefined) => {
    onUpdate(i, { video: v ?? '', videoStart: undefined, videoQuestionEnd: undefined, videoAnswerEnd: undefined });
    if (v === undefined) onClearExpanded(i);
  }, [i, onUpdate, onClearExpanded]);
  const handleAnswerImageChange = useCallback((v: string | undefined) => onUpdate(i, { answerImage: v }), [i, onUpdate]);
  const handleMarkerPatch = useCallback((patch: Partial<VideoGuessQuestion>) => onUpdate(i, patch), [i, onUpdate]);

  return (
    <div
      ref={refCallback}
      className={`question-block ${isDraggingOver ? 'be-dragging' : ''} ${q.disabled ? 'question-disabled' : ''}`}
      data-question-index={i}
      onDragOver={handleDragOverEvt}
      onDragEnd={onDragEnd}
    >
      <div className="question-block-row">
        <span className="drag-handle" draggable onDragStart={handleDragStartEvt} title="Ziehen zum Sortieren">⠿</span>
        <span className="question-num">{i === 0 ? 'Beispiel' : `#${i}`}</span>
        <div className="question-block-inputs">
          <input
            className="be-input"
            value={q.answer}
            placeholder="Antwort..."
            onChange={handleAnswerChange}
          />
        </div>
        {q.answerImage && (
          <img src={q.answerImage} alt="" loading="lazy" decoding="async" style={{ height: 40, width: 40, objectFit: 'contain', borderRadius: 4, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.3)', opacity: 0.6, flexShrink: 0 }} title={`Bild: ${q.answerImage}`} />
        )}
        {q.video && hasMarkers(q) && (
          <span style={{ fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.07)', padding: '2px 6px', borderRadius: 3, flexShrink: 0 }}>
            🎬 ✂
          </span>
        )}
        <button className="be-delete-btn" onClick={handleToggleDisabled} title={q.disabled ? 'Aktivieren' : 'Deaktivieren'} style={{ width: 30, height: 30, borderRadius: 5, fontSize: 'var(--admin-sz-17, 17px)', border: '1px solid rgba(255,255,255,0.12)', background: q.disabled ? 'rgba(239,68,68,0.12)' : 'rgba(255,255,255,0.06)', color: q.disabled ? 'rgba(239,68,68,0.7)' : 'rgba(255,255,255,0.6)' }}>{q.disabled ? (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>) : (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>)}</button>
        <button className="be-delete-btn" onClick={handleDuplicate} title="Duplizieren" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
        {otherInstances && otherInstances.length > 0 && onMoveQuestion && <MoveQuestionButton otherInstances={otherInstances} onMove={handleMove} />}
        <button className="be-delete-btn" onClick={handleRemove} title="Löschen" style={{ width: 30, height: 30, borderRadius: 5, border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.07)', color: 'rgba(239,68,68,0.7)' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg></button>
      </div>

      <div className="question-fields" style={{ marginTop: 8 }}>
        <div className="full-width">
          <AssetField
            label="Video-Datei"
            value={q.video || undefined}
            category="videos"
            onChange={handleVideoChange}
          />
          {q.video && (
            <button
              className={`audio-trim-toggle-btn${isExpanded ? ' active' : ''}${hasMarkers(q) ? ' has-trim' : ''}`}
              onClick={handleToggle}
              style={{ marginTop: 4 }}
            >
              🎬 Marker {isExpanded ? 'ausblenden' : 'bearbeiten'}
            </button>
          )}
          {q.video && (isExpanded || wasExpanded) && (
            <div style={isExpanded ? undefined : { display: 'none' }}>
              <VideoMarkerEditor q={q} onUpdate={handleMarkerPatch} instanceLanguage={instanceLanguage} />
            </div>
          )}
          {q.video && (hasMarkers(q) || effectiveTrack !== undefined) && (() => {
            if (cs?.error) {
              return (
                <div style={{ marginTop: 4, padding: '4px 8px', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 4, fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(248,113,113,0.9)' }}>
                  Cache-Fehler: {cs.error}
                </div>
              );
            }
            if (cs && !cs.done && (cs.preparing || cs.queued || cs.percent > 0)) {
              const isQueued = !!cs.queued;
              const isPreparing = !isQueued && !!cs.preparing && cs.percent === 0;
              const showBar = !isQueued && !isPreparing;
              const label = isQueued ? 'In Warteschlange' : isPreparing ? 'Vorbereiten…' : 'Cache wird erstellt…';
              return (
                <div style={{ marginTop: 4 }} data-testid={`cache-progress-${i}`}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--admin-accent-rgb),0.9)', marginBottom: 2 }}>
                    <span>{label}</span>
                    {showBar && <span style={{ fontFamily: 'monospace' }}>{cs.percent}%</span>}
                  </div>
                  <div className="upload-progress-track" style={{ height: 4 }}>
                    {showBar ? (
                      <div className="upload-progress-fill upload-progress-processing" style={{ width: `${cs.percent}%` }} />
                    ) : (
                      <div className="upload-progress-fill upload-progress-indeterminate" />
                    )}
                  </div>
                </div>
              );
            }
            return (
              <>
                {cs?.done ? (
                  <button
                    className="audio-trim-toggle-btn"
                    onClick={() => setPreviewOpen(true)}
                    title="Cache-Datei vorschauen (stoppt an der Frage-Marke)"
                    data-testid={`cache-btn-${i}`}
                    style={{ marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 6, borderColor: 'rgba(var(--admin-accent-rgb),0.4)', color: 'rgba(var(--admin-accent-rgb),0.9)' }}
                  >
                    <span>✅ Cache für Gameshow</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                ) : (
                  <button
                    className="audio-trim-toggle-btn"
                    onClick={handleGenerate}
                    style={{ marginTop: 4, borderColor: 'rgba(var(--admin-accent-rgb),0.4)', color: 'rgba(var(--admin-accent-rgb),0.9)' }}
                    title="Clip für die Gameshow vorberechnen (trimmt und konvertiert den markierten Ausschnitt)"
                    data-testid={`cache-btn-${i}`}
                  >
                    📦 Cache für Gameshow erstellen
                  </button>
                )}
                {!cs?.done && !isArchive && (
                  <div style={{ marginTop: 2, fontSize: 'var(--admin-sz-10, 10px)', color: 'rgba(255,255,255,0.4)' }}>
                    Wird in 2 Min. automatisch erzeugt
                  </div>
                )}
                {previewOpen && (
                  <CachePreviewModal q={q} effectiveTrack={effectiveTrack} isHdr={isHdr} onClose={() => setPreviewOpen(false)} />
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
            onChange={handleAnswerImageChange}
          />
        </div>
      </div>
    </div>
  );
});

// ── Main form ──
export default function VideoGuessForm({ questions, onChange, otherInstances, onMoveQuestion, isArchive, instanceLanguage, onInstanceLanguageChange }: Props) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  // HDR detection for cache button
  const [hdrVideos, setHdrVideos] = useState<Set<string>>(new Set());
  // Probed audio tracks per video (keyed by full `q.video` path). Populated lazily as the
  // form discovers new video paths. Used together with `instanceLanguage` to resolve the
  // effective audio-track index for questions that don't have an explicit `audioTrack`
  // override, so cache URLs / cache keys match what the server will ask for at play time.
  const [videoTracksMap, setVideoTracksMap] = useState<Map<string, VideoTrackInfo[]>>(() => new Map());
  const resolveEffectiveTrack = useCallback((q: VideoGuessQuestion): number | undefined => {
    if (q.audioTrack !== undefined) return q.audioTrack;
    if (!instanceLanguage) return undefined;
    const tracks = q.video ? videoTracksMap.get(q.video) : undefined;
    if (!tracks) return undefined;
    const idx = tracks.findIndex(t => t.language === instanceLanguage);
    return idx >= 0 ? idx : undefined;
  }, [instanceLanguage, videoTracksMap]);
  // Cache state keyed by cacheKey (video + markers + track), NOT by index. When a question
  // is moved to another instance or reordered, the index shifts but the cacheKey stays
  // stable, so in-flight progress/done state continues to apply to the right work.
  const [cacheState, setCacheState] = useState<Map<string, CacheEntry>>(new Map());
  // Remote bgTask snapshot from the system-status websocket — lets the per-question
  // button reflect progress when the cache is being generated elsewhere (warm-all,
  // auto-warmup, a second operator). Keyed by the match-key derived from bgTask.meta.
  const [remoteBgTasks, setRemoteBgTasks] = useState<Map<string, { status: 'queued' | 'running'; percent: number | null }>>(new Map());
  useWsChannel<SystemStatusResponse>('system-status', (status) => {
    const next = new Map<string, { status: 'queued' | 'running'; percent: number | null }>();
    for (const task of status.processes.backgroundTasks) {
      if (task.type !== 'sdr-warmup' && task.type !== 'compressed-warmup') continue;
      if (task.status !== 'queued' && task.status !== 'running') continue;
      const meta = task.meta;
      if (!meta || meta.video === undefined || meta.start === undefined || meta.end === undefined) continue;
      const key = makeRemoteMatchKey(meta.video, meta.start, meta.end, meta.track);
      const m = task.detail?.match(/(\d{1,3})\s*%/);
      const percent = m ? parseInt(m[1], 10) : null;
      next.set(key, { status: task.status, percent });
    }
    setRemoteBgTasks(next);
  });
  // AbortController per in-flight cache generation, keyed by cacheKey. Lets us cancel the
  // fetch / SSE stream when the user moves the question away, changes its markers, or
  // unmounts the form.
  const abortControllersRef = useRef<Map<string, AbortController>>(new Map());
  // Set of question indices that have scrolled (or are scrolled) near the viewport at least
  // once. Used to gate the cache-existence fetch so a 100-question archive doesn't fire 100
  // parallel HTTP checks on mount — the shell renders instantly, and each question's cache
  // status resolves as the user scrolls to it (or slightly before, thanks to rootMargin).
  const [seenIndices, setSeenIndices] = useState<Set<number>>(() => new Set());
  const seenIndicesRef = useRef(seenIndices);
  seenIndicesRef.current = seenIndices;
  // Flipped by the drag handlers so the virtualization below can bypass itself while a
  // drag is in flight (HTML5 DnD needs the target block in DOM to fire `onDragOver`).
  const [isDragging, setIsDragging] = useState(false);
  const blockObserverRef = useRef<IntersectionObserver | null>(null);
  const blockRefs = useRef<Map<number, HTMLElement>>(new Map());

  // One shared IntersectionObserver for all question blocks. When a block comes within
  // 400 px of the viewport we mark its index as "seen"; once seen it stays seen, so the
  // per-question cache check only ever runs once for a given cacheKey lifetime.
  useEffect(() => {
    // Batch observer callbacks through a single rAF: during a fast scroll the observer
    // fires 30-80 times in quick succession (once per block entering the rootMargin),
    // and each `setSeenIndices` call re-renders the entire question list. That main-
    // thread storm is what made Chrome's compositor blank the viewport — Firefox happens
    // to cope with the same work. Accumulate new indices in a ref and flush once per
    // animation frame; scrolling then triggers at most one re-render per frame.
    const pendingRef = { current: null as Set<number> | null };
    let rafHandle = 0;
    const flush = () => {
      rafHandle = 0;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (!pending || pending.size === 0) return;
      setSeenIndices(prev => {
        let changed = false;
        const next = new Set(prev);
        for (const idx of pending) {
          if (!next.has(idx)) { next.add(idx); changed = true; }
        }
        return changed ? next : prev;
      });
    };
    const observer = new IntersectionObserver(entries => {
      let any = false;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idx = Number((entry.target as HTMLElement).dataset.questionIndex);
        if (!Number.isFinite(idx)) continue;
        if (seenIndicesRef.current.has(idx)) continue;
        if (!pendingRef.current) pendingRef.current = new Set();
        pendingRef.current.add(idx);
        any = true;
      }
      if (any && !rafHandle) rafHandle = requestAnimationFrame(flush);
    }, { rootMargin: '400px' });
    blockObserverRef.current = observer;
    for (const el of blockRefs.current.values()) observer.observe(el);
    return () => {
      if (rafHandle) cancelAnimationFrame(rafHandle);
      observer.disconnect();
      blockObserverRef.current = null;
    };
  }, []);

  // Ref callback factory — attaches each question-block element to the shared observer
  // on mount and cleans up on unmount. Returned function is stable per index so React
  // doesn't re-run it on every render.
  const blockSizeObserverRef = useRef<ResizeObserver | null>(null);
  const blockRefFactories = useRef<Map<number, (el: HTMLElement | null) => void>>(new Map());
  const getBlockRef = (i: number) => {
    let fn = blockRefFactories.current.get(i);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        const existing = blockRefs.current.get(i);
        if (existing && existing !== el) {
          blockObserverRef.current?.unobserve(existing);
          blockSizeObserverRef.current?.unobserve(existing);
        }
        if (el) {
          blockRefs.current.set(i, el);
          blockObserverRef.current?.observe(el);
          blockSizeObserverRef.current?.observe(el);
        } else {
          blockRefs.current.delete(i);
        }
      };
      blockRefFactories.current.set(i, fn);
    }
    return fn;
  };

  // Unique video paths the form currently references. Used to debounce the HDR probe so it
  // only fires when the set of videos changes, not on every unrelated question edit (e.g.
  // typing in the answer field, which previously re-probed every video on every keystroke
  // and contributed to jank during long-list scrolling).
  const uniquePathsKey = [...new Set(questions.map(q => q.video).filter(Boolean))].sort().join('|');

  useEffect(() => {
    if (!uniquePathsKey) { setHdrVideos(new Set()); return; }
    const paths = uniquePathsKey.split('|');
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
  }, [uniquePathsKey]);

  // Probe audio tracks for each unique video. The result drives two things:
  //   1. Language → track resolution so cache URLs match what the game player will ask for.
  //   2. The "Sprache (Standard)" picker options, which are restricted to languages the
  //      probes actually report for the instance's videos (no point offering Spanish if no
  //      video has a Spanish audio stream). Skipped for archive instances — they aren't
  //      played, so there's no cache to build and the picker isn't shown.
  // A ref tracks which paths are already probed (or probing) so the effect doesn't kick
  // off the same fetch twice — important under React StrictMode, which invokes the effect
  // twice back-to-back in dev. We deliberately skip an `active` cleanup flag: the .then
  // below always merges into the shared state map, which is safe regardless of which
  // effect invocation resolves first, and React 18 silently drops setState on unmounted
  // components so there's no leak to clean up.
  const probedPathsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (isArchive || !uniquePathsKey) return;
    const paths = uniquePathsKey.split('|');
    paths.forEach(videoPath => {
      if (!videoPath || probedPathsRef.current.has(videoPath)) return;
      probedPathsRef.current.add(videoPath);
      const relPath = videoPath.replace(/^\/videos\//, '');
      probeVideo(relPath).then(r => {
        setVideoTracksMap(prev => {
          const next = new Map(prev);
          next.set(videoPath, r.tracks);
          return next;
        });
      }).catch(() => {
        // Probe failed — drop from the probed set so a later re-render can retry.
        probedPathsRef.current.delete(videoPath);
      });
    });
  }, [uniquePathsKey, isArchive]);

  // Cache status check: re-runs whenever the set of cache keys across questions changes.
  // Also aborts any in-flight cache generation whose key is no longer present (covers the
  // "move question to another instance while cache is generating" case — without this the
  // SSE events would land on whatever question happened to slide into the vacated index).
  const cacheKeysList = questions.map(q => cacheKeyOf(q, resolveEffectiveTrack(q)) ?? '').join('\n');

  useEffect(() => {
    let active = true;
    const currentKeys = new Set(cacheKeysList.split('\n').filter(Boolean));

    // Abort any controller whose key is no longer in the current question list.
    for (const [key, controller] of abortControllersRef.current) {
      if (!currentKeys.has(key)) {
        controller.abort();
        abortControllersRef.current.delete(key);
      }
    }

    // Drop state for keys that are no longer present; preserve everything else so a
    // marker drag that only touches ONE question doesn't wipe the other questions'
    // "done" state (and flash them back to the erstellen button).
    setCacheState(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const key of prev.keys()) {
        if (!currentKeys.has(key)) { next.delete(key); changed = true; }
      }
      return changed ? next : prev;
    });

    // Only run the cache-existence fetch for blocks the user has actually scrolled near —
    // a fresh archive with 100 questions should not fire 100 parallel HTTP checks on mount.
    // Each block's `data-question-index` is picked up by the shared IntersectionObserver
    // above and flipped into `seenIndices`, at which point we fetch its cache status.
    const pending: Promise<[string, boolean]>[] = [];
    questions.forEach((q, i) => {
      if (!seenIndices.has(i)) return;
      const effTrack = resolveEffectiveTrack(q);
      const key = cacheKeyOf(q, effTrack);
      if (!key) return;
      if (!q.video) return;
      const isHdr = hdrVideos.has(q.video);
      const hasTimeRange = q.videoStart !== undefined || q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;
      if (!hasTimeRange && effTrack === undefined) return;
      // Skip the check if we already know the state for this key (already done, currently
      // generating, or errored). Prevents redundant network calls when the list re-renders
      // because of an unrelated change.
      if (cacheState.has(key)) return;
      if (isHdr && hasTimeRange) {
        const segStart = q.videoStart ?? 0;
        const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0);
        pending.push(checkSdrCache(q.video, segStart, segEnd, effTrack).then(c => [key, c] as [string, boolean]).catch(() => [key, false] as [string, boolean]));
      } else if (hasTimeRange) {
        const segStart = q.videoStart ?? 0;
        const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0);
        const videoPath = q.video.replace(/^\/videos\//, '');
        pending.push(
          fetch(`/api/backend/assets/videos/cache-check?type=compressed&path=${encodeURIComponent(videoPath)}&start=${segStart}&end=${segEnd}${effTrack !== undefined ? `&track=${effTrack}` : ''}`)
            .then(r => r.json()).then((d: { cached: boolean }) => [key, d.cached] as [string, boolean])
            .catch(() => [key, false] as [string, boolean])
        );
      }
    });
    if (pending.length > 0) {
      Promise.all(pending).then(results => {
        if (!active) return;
        const cached = results.filter(([, c]) => c);
        if (cached.length === 0) return;
        setCacheState(prev => {
          const next = new Map(prev);
          for (const [key] of cached) next.set(key, { percent: 100, done: true });
          return next;
        });
      });
    }
    return () => { active = false; };
  }, [cacheKeysList, hdrVideos, seenIndices]); // eslint-disable-line react-hooks/exhaustive-deps

  // On unmount: abort every in-flight cache generation so a closed/navigated-away form
  // doesn't keep the server encoding video nobody is waiting for.
  useEffect(() => {
    const controllers = abortControllersRef.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  // When the operator wipes caches from the System tab the server clears its
  // readiness sets but our local `cacheState` map still remembers {done:true}
  // per question, which keeps the "Cache erstellen" button hidden and prevents
  // a fresh generate. Drop the local state + abort any in-flight warmup so the
  // next render re-fetches cache-check and shows the button again.
  useWsChannel<unknown>('caches-cleared', () => {
    for (const controller of abortControllersRef.current.values()) controller.abort();
    abortControllersRef.current.clear();
    setCacheState(new Map());
  });

  // Match a cache-start/ready WS payload against the currently-rendered questions.
  // Both events carry the same tuple (video, start, end, track) the cache URL uses, so
  // a question is a match when its derived segStart/segEnd/effectiveTrack agree.
  const matchingCacheKeys = useCallback((payload: { video: string; start: number; end: number; track?: number }): string[] => {
    return questions
      .map(q => {
        const effTrack = resolveEffectiveTrack(q);
        const key = cacheKeyOf(q, effTrack);
        if (!key) return null;
        const segStart = q.videoStart ?? 0;
        const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0);
        const rel = q.video.replace(/^\/videos\//, '');
        if (rel !== payload.video) return null;
        if (segStart !== payload.start || segEnd !== payload.end) return null;
        if ((effTrack ?? undefined) !== (payload.track ?? undefined)) return null;
        return key;
      })
      .filter((k): k is string => k !== null);
  }, [questions, resolveEffectiveTrack]);

  // Encode started (this tab OR anywhere else). Flip the local cacheState to
  // preparing immediately — the 500 ms system-status debounce otherwise leaves
  // a window where a second click can spawn a redundant request.
  useWsChannel<{ video: string; start: number; end: number; track?: number }>('cache-started', (payload) => {
    if (!payload || typeof payload.video !== 'string') return;
    const keys = matchingCacheKeys(payload);
    if (keys.length === 0) return;
    setCacheState(prev => {
      const next = new Map(prev);
      for (const key of keys) {
        const cur = next.get(key);
        // Don't overwrite if the local generator already tracked this encode (keeps
        // AbortController ownership clean); only populate for remote-started encodes.
        if (!cur) next.set(key, { percent: 0, preparing: true });
      }
      return next;
    });
  });

  // Encode finished. Mark the matching cacheKey done immediately so the per-question
  // button reflects the new ready state without waiting for the next cache-check poll
  // or a form remount.
  useWsChannel<{ video: string; start: number; end: number; track?: number }>('cache-ready', (payload) => {
    if (!payload || typeof payload.video !== 'string') return;
    const keys = matchingCacheKeys(payload);
    if (keys.length === 0) return;
    setCacheState(prev => {
      const next = new Map(prev);
      for (const key of keys) next.set(key, { percent: 100, done: true });
      return next;
    });
  });

  /** Generate cached file for the gameshow frontend. Keys all bookkeeping by cacheKey so
   *  a reorder or instance-move while the work is in flight doesn't cause progress events
   *  to land on the wrong question. */
  const generateCache = useCallback(async (i: number) => {
    const q = questions[i];
    if (!q.video) return;
    const effTrack = resolveEffectiveTrack(q);
    const key = cacheKeyOf(q, effTrack);
    if (!key) return;
    const isHdr = hdrVideos.has(q.video);
    const hasTimeRange = q.videoStart !== undefined || q.videoQuestionEnd !== undefined || q.videoAnswerEnd !== undefined;
    const segStart = q.videoStart ?? 0;
    const segEnd = Math.max(q.videoQuestionEnd ?? segStart, q.videoAnswerEnd ?? 0);
    const videoPath = q.video.replace(/^\/videos\//, '');
    const trackParam = effTrack !== undefined ? `?track=${effTrack}` : '';

    // Replace any existing controller for this key (shouldn't normally happen since the
    // button is disabled while generating, but guards against double-clicks).
    const existing = abortControllersRef.current.get(key);
    if (existing) existing.abort();
    const controller = new AbortController();
    abortControllersRef.current.set(key, controller);

    setCacheState(prev => new Map(prev).set(key, { percent: 0, preparing: true }));
    try {
      if (isHdr && hasTimeRange) {
        await warmupSdr(q.video, segStart, segEnd, (ev) => {
          if (ev.percent !== undefined) setCacheState(prev => new Map(prev).set(key, { percent: ev.percent! }));
          if (ev.done || ev.cached) setCacheState(prev => new Map(prev).set(key, { percent: 100, done: true }));
        }, effTrack, controller.signal);
      } else if (hasTimeRange) {
        await fetch(`/videos-compressed/${segStart}/${segEnd}/${videoPath}${trackParam}`, { headers: { Range: 'bytes=0-0' }, signal: controller.signal });
      }
      // No time range: nothing to cache — the in-game player streams the original file.
      setCacheState(prev => new Map(prev).set(key, { percent: 100, done: true }));
    } catch (err) {
      // Aborted generations (user moved the question, unmounted, etc.) should silently
      // drop their state rather than surface as an error.
      if ((err as Error).name === 'AbortError' || controller.signal.aborted) {
        setCacheState(prev => { const next = new Map(prev); next.delete(key); return next; });
      } else {
        setCacheState(prev => new Map(prev).set(key, { percent: 0, error: (err as Error).message }));
      }
    } finally {
      if (abortControllersRef.current.get(key) === controller) {
        abortControllersRef.current.delete(key);
      }
    }
  }, [questions, hdrVideos, resolveEffectiveTrack]);

  // Auto-warmup: 2 minutes after the user last touched this question's markers/track/video,
  // kick off cache generation automatically. Keyed by cacheKey so a reorder doesn't restart
  // the timer. Archive-Instanzen: automatisches Caching ist deaktiviert (Archivfragen werden
  // nicht gespielt), aber manuelles Cachen über den Button bleibt möglich.
  useEffect(() => {
    if (isArchive) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    questions.forEach((q, i) => {
      const effTrack = resolveEffectiveTrack(q);
      const key = cacheKeyOf(q, effTrack);
      if (!key) return;
      const remoteKey = questionMatchKey(q, effTrack);
      const t = setTimeout(() => {
        // Skip if the server already has a queued/running task for this cache —
        // warm-all or another operator is handling it.
        if (remoteKey && remoteBgTasks.has(remoteKey)) return;
        setCacheState(prev => {
          const cur = prev.get(key);
          if (cur?.done || cur?.preparing || cur?.queued || (cur && cur.percent > 0 && !cur.error)) return prev;
          void generateCache(i);
          return prev;
        });
      }, 120_000);
      timers.push(t);
    });
    return () => { for (const t of timers) clearTimeout(t); };
  }, [cacheKeysList, generateCache, isArchive]); // eslint-disable-line react-hooks/exhaustive-deps

  const drag = useDragReorder(questions, onChange);
  // Same ref pattern for the drag handlers — useDragReorder returns fresh closures every
  // render, so we proxy through refs to expose stable (i, e) => void callbacks. We also
  // flip an `isDragging` state on dragstart / dragend so the virtualization below can
  // bypass itself while a drag is in progress (HTML5 DnD needs the target block in DOM
  // to fire `onDragOver`).
  const dragRef = useRef(drag);
  dragRef.current = drag;
  // Snapshot of the dragged block's on-screen position, captured right before every
  // `isDragging` transition. Consumed by the useLayoutEffect below, which re-aligns
  // scrollTop so the dragged block stays anchored across both transitions:
  //
  //  - drag start  (virtualized → full DOM): off-screen blocks switch from the 215-px
  //    estimate to their real measured heights, inflating content above the viewport
  //    and making the page appear to jump up by several questions.
  //  - drop / drag end  (full DOM → virtualized): off-screen blocks unmount and are
  //    replaced by spacers sized by the height map. Even with measured heights that
  //    generally match, the list can drift a few pixels and hide the question the
  //    user just dropped.
  //
  // We track the live drag index in a ref so the drop-time snapshot can target the
  // block at its new (post-reorder) index rather than the start-time index.
  const dragScrollSnapRef = useRef<{ idx: number; blockTopBefore: number } | null>(null);
  const currentDragIdxRef = useRef<number | null>(null);
  const captureDragSnap = (idx: number) => {
    const scroller = scrollerRef.current;
    const blockEl = blockRefs.current.get(idx);
    if (!scroller || !blockEl) return;
    dragScrollSnapRef.current = {
      idx,
      blockTopBefore: blockEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
    };
  };
  const stableDragStart = useCallback((i: number, e: React.DragEvent) => {
    currentDragIdxRef.current = i;
    captureDragSnap(i);
    setIsDragging(true);
    dragRef.current.onDragStart(i)(e);
  }, []);
  const stableDragOver = useCallback((i: number, e: React.DragEvent) => {
    currentDragIdxRef.current = i;
    dragRef.current.onDragOver(i)(e);
  }, []);
  const stableDragEnd = useCallback(() => {
    const finalIdx = currentDragIdxRef.current;
    // Force a synchronous re-measure of every currently-mounted block before we flip
    // virtualization back on. During drag the questions array mutated as the user
    // hovered over other indices, which changed the content of already-mounted blocks
    // and therefore their heights. ResizeObserver callbacks run asynchronously, so
    // without this refresh the heights map (used to size the spacers that replace
    // unmounted blocks on re-virtualize) is slightly stale — enough to shift the list
    // by ~half a question. getBoundingClientRect triggers a synchronous layout flush
    // so the numbers are accurate for the virtualization recalc that follows.
    for (const [idx, el] of blockRefs.current) {
      heightsRef.current.set(idx, el.getBoundingClientRect().height);
    }
    if (finalIdx !== null) captureDragSnap(finalIdx);
    currentDragIdxRef.current = null;
    setIsDragging(false);
    dragRef.current.onDragEnd();
  }, []);

  // Re-align scrollTop synchronously after either virtualization transition so the
  // dragged/dropped block stays exactly where the user last saw it. We run the
  // correction across a short rAF loop rather than once — on drop the virtualization
  // recalc can still shift by sub-pixel amounts when a ResizeObserver entry settles a
  // frame later (e.g. a video element's intrinsic size changes as metadata loads).
  // Repeating until the delta is zero absorbs that residual movement.
  useLayoutEffect(() => {
    const snap = dragScrollSnapRef.current;
    if (!snap) return;
    dragScrollSnapRef.current = null;
    let cancelled = false;
    let frames = 0;
    const adjust = () => {
      if (cancelled) return;
      const scroller = scrollerRef.current;
      const blockEl = blockRefs.current.get(snap.idx);
      if (!scroller || !blockEl) return;
      const blockTopNow = blockEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const delta = blockTopNow - snap.blockTopBefore;
      if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
      if (++frames < 6) requestAnimationFrame(adjust);
    };
    adjust();
    return () => { cancelled = true; };
  }, [isDragging]);

  // Auto-scroll the admin tab-pane while a drag is in flight and the cursor nears the
  // top or bottom edge. HTML5 DnD doesn't auto-scroll scrollable ancestors — without
  // this the user can't reach the first or last questions in a long list.
  useEffect(() => {
    if (!isDragging) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const EDGE = 80;
    const MAX_SPEED = 24;
    let rafId: number | null = null;
    let clientY = 0;
    let active = false;

    const step = () => {
      rafId = null;
      if (!active) return;
      const rect = scroller.getBoundingClientRect();
      const distFromTop = clientY - rect.top;
      const distFromBottom = rect.bottom - clientY;
      let dy = 0;
      if (distFromTop >= 0 && distFromTop < EDGE) {
        dy = -MAX_SPEED * (1 - distFromTop / EDGE);
      } else if (distFromBottom >= 0 && distFromBottom < EDGE) {
        dy = MAX_SPEED * (1 - distFromBottom / EDGE);
      }
      if (dy !== 0) {
        scroller.scrollTop += dy;
        rafId = requestAnimationFrame(step);
      } else {
        active = false;
      }
    };

    const onDragOver = (e: DragEvent) => {
      clientY = e.clientY;
      const rect = scroller.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) return;
      const near = (clientY - rect.top < EDGE) || (rect.bottom - clientY < EDGE);
      if (near && !active) {
        active = true;
        if (rafId === null) rafId = requestAnimationFrame(step);
      } else if (!near) {
        active = false;
      }
    };

    window.addEventListener('dragover', onDragOver);
    return () => {
      window.removeEventListener('dragover', onDragOver);
      if (rafId !== null) cancelAnimationFrame(rafId);
      active = false;
    };
  }, [isDragging]);

  // Stable refs over the reactive values that the row callbacks need to read. This lets
  // every per-row handler below be wrapped in useCallback with empty deps, which is what
  // makes the `QuestionBlock` memo actually pay off: otherwise each re-render would hand
  // the memoized child a fresh onUpdate/onRemove/etc. and defeat the shallow compare.
  const questionsRef = useRef(questions);
  questionsRef.current = questions;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const update = useCallback((i: number, patch: Partial<VideoGuessQuestion>) => {
    const qs = questionsRef.current;
    const next = [...qs];
    next[i] = { ...next[i], ...patch };
    (Object.keys(next[i]) as (keyof VideoGuessQuestion)[]).forEach(k => {
      if (next[i][k] === undefined) delete next[i][k];
    });
    onChangeRef.current(next);
  }, []);

  const remove = useCallback((i: number) => {
    if (!confirm('Frage löschen?')) return;
    setExpanded(prev => {
      const n = new Set<number>();
      prev.forEach(idx => { if (idx < i) n.add(idx); else if (idx > i) n.add(idx - 1); });
      return n;
    });
    onChangeRef.current(questionsRef.current.filter((_, idx) => idx !== i));
  }, []);

  const duplicate = useCallback((i: number) => {
    const qs = questionsRef.current;
    const next = [...qs];
    next.splice(i + 1, 0, { ...qs[i] });
    onChangeRef.current(next);
  }, []);

  const toggle = useCallback((i: number) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(i) ? n.delete(i) : n.add(i);
    return n;
  }), []);

  const clearExpandedAt = useCallback((i: number) => setExpanded(prev => {
    const n = new Set(prev); n.delete(i); return n;
  }), []);

  // Parent-side onMoveQuestion is passed through as-is; capture it in a ref so the
  // memoized row's handler can stay stable even if the parent reprops the callback.
  const onMoveQuestionRef = useRef(onMoveQuestion);
  onMoveQuestionRef.current = onMoveQuestion;
  const stableMoveQuestion = useCallback((i: number, target: string) => {
    onMoveQuestionRef.current?.(i, target);
  }, []);

  const generateCacheRef = useRef(generateCache);
  generateCacheRef.current = generateCache;
  const stableGenerateCache = useCallback((i: number) => { void generateCacheRef.current(i); }, []);

  const overIdx = drag.overIdx;

  // ── Virtualization ─────────────────────────────────────────────────────────
  // Long video-guess archives (80+ blocks with complex content) exceeded Chrome's
  // per-frame paint budget — during fast scroll the compositor skipped paint and you saw
  // raw background. Firefox happens to paint a larger margin and avoids this, but Chrome
  // needs the DOM to be smaller. We keep an in-viewport window of blocks mounted (plus
  // a generous overscan on both sides) and replace everything before/after with a single
  // height-matched spacer. Scroll height and scroll position remain exactly as if every
  // block were rendered, so the UX is indistinguishable from "complete DOM".
  //
  // Expanded blocks are pinned into the rendered set (even if off-screen) so the marker
  // editor stays mounted and retains its video buffer / zoom / probe state. Virtualization
  // is only fully bypassed during drag-reorder (HTML5 DnD needs target blocks in DOM).
  const DEFAULT_BLOCK_HEIGHT = 215;
  const OVERSCAN_PX = 800;
  const listRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const heightsRef = useRef<Map<number, number>>(new Map());
  const [heightVersion, setHeightVersion] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(900);

  // Find the scrolling ancestor (`.admin-tab-pane`) and wire up passive scroll +
  // resize listeners. Scroll is raf-throttled so a wheel spin updates state at most
  // once per frame; without this Chrome gets a flood of scroll events and the render
  // work falls behind the compositor — exactly the pattern we're trying to fix.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const scroller = el.closest('.admin-tab-pane') as HTMLElement | null;
    if (!scroller) return;
    scrollerRef.current = scroller;
    setScrollTop(scroller.scrollTop);
    setViewportHeight(scroller.clientHeight);
    // Force a second render so the computation below sees `listRef.current` and picks up
    // the correct list-to-scroller offset — setScrollTop with an unchanged value is a
    // React no-op and wouldn't re-render on its own.
    setHeightVersion(v => v + 1);
    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => { rafId = 0; setScrollTop(scroller.scrollTop); });
    };
    const onResize = () => setViewportHeight(scroller.clientHeight);
    scroller.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      scroller.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Measure each rendered block so the spacer heights match real content. We coalesce
  // via a single `heightVersion` bump per frame and ignore sub-pixel noise — otherwise
  // a ResizeObserver feedback loop is easy to trigger when fonts settle.
  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      let changed = false;
      for (const entry of entries) {
        const el = entry.target as HTMLElement;
        const idx = Number(el.dataset.questionIndex);
        if (!Number.isFinite(idx)) continue;
        const h = entry.contentRect.height;
        const prev = heightsRef.current.get(idx);
        if (prev === undefined || Math.abs(prev - h) > 0.5) {
          heightsRef.current.set(idx, h);
          changed = true;
        }
      }
      if (changed) setHeightVersion(v => v + 1);
    });
    blockSizeObserverRef.current = observer;
    for (const el of blockRefs.current.values()) observer.observe(el);
    return () => { observer.disconnect(); blockSizeObserverRef.current = null; };
  }, []);

  // Compute which indices fall within the rendered window. `beforeHeight` and
  // `afterHeight` are the sums of estimated-or-measured heights outside that window and
  // become the two spacer divs in the render.
  //
  // Virtualization stays active even when blocks are expanded — disabling it for 80+
  // questions dumps the entire DOM and triggers an IntersectionObserver / cache-check
  // storm that freezes the browser for seconds. Instead, expanded indices are pinned
  // into the rendered set (see `renderedIndices` below) so their marker editors stay
  // mounted while the rest of the list remains virtualized.
  const shouldVirtualize = !isDragging;
  const getHeight = (i: number) => heightsRef.current.get(i) ?? DEFAULT_BLOCK_HEIGHT;
  let startIdx = 0;
  let endIdx = questions.length;
  // heightVersion is read here purely so this recomputes when measurements update.
  void heightVersion;
  if (shouldVirtualize && questions.length > 0) {
    const listEl = listRef.current;
    const scroller = scrollerRef.current;
    // Offset of the list's top inside the scroller. Recomputed each render; cheap.
    let listOffsetFromScroller = 0;
    if (listEl && scroller) {
      listOffsetFromScroller =
        listEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    }
    const topBound = scrollTop - listOffsetFromScroller - OVERSCAN_PX;
    const bottomBound = scrollTop - listOffsetFromScroller + viewportHeight + OVERSCAN_PX;
    let offset = 0;
    let i = 0;
    for (; i < questions.length; i++) {
      const h = getHeight(i);
      if (offset + h > topBound) break;
      offset += h;
    }
    startIdx = i;
    for (; i < questions.length; i++) {
      if (offset > bottomBound) break;
      offset += getHeight(i);
    }
    endIdx = i;
  }

  // Build the set of indices to render: the viewport window plus any expanded indices
  // (pinned so their VideoMarkerEditor stays mounted and retains video buffer / zoom state).
  const renderedIndices = useMemo(() => {
    const indices: number[] = [];
    const inViewport = new Set<number>();
    for (let i = startIdx; i < endIdx; i++) inViewport.add(i);
    // Add expanded indices that fall outside the viewport window
    for (const idx of expanded) {
      if (!inViewport.has(idx) && idx >= 0 && idx < questions.length) indices.push(idx);
    }
    for (let i = startIdx; i < endIdx; i++) indices.push(i);
    indices.sort((a, b) => a - b);
    return indices;
  }, [startIdx, endIdx, expanded, questions.length]);

  // Spacer heights between rendered blocks. Must be computed from gaps in
  // `renderedIndices` — NOT as a single `beforeHeight`/`afterHeight` around the viewport —
  // because expanded-but-out-of-viewport blocks are pinned inline. Counting their heights
  // in a single before-spacer double-counts the pixels (spacer + rendered block), inflating
  // the document and shifting visible content so e.g. question #50 ends up rendered where
  // the user's viewport is actually showing the uppermost expanded question's slot.
  const spacers: number[] = [];
  {
    let prevIdx = -1;
    for (const i of renderedIndices) {
      let h = 0;
      for (let j = prevIdx + 1; j < i; j++) h += getHeight(j);
      spacers.push(h);
      prevIdx = i;
    }
    let trailing = 0;
    for (let j = prevIdx + 1; j < questions.length; j++) trailing += getHeight(j);
    spacers.push(trailing);
  }

  // Available languages = union across every unique video that's been probed. Every language
  // tagged on any video is offered; languages not present in every video are flagged partial
  // in the UI. Videos without a matching track fall back to their default audio stream via
  // `resolveEffectiveTrack` returning `undefined`, so partial selection is safe.
  // Untagged streams ("und") are excluded: they offer no match anyway.
  const uniquePaths = uniquePathsKey ? uniquePathsKey.split('|').filter(Boolean) : [];
  const allProbed = uniquePaths.length > 0 && uniquePaths.every(p => videoTracksMap.has(p));
  const { availableLanguages, partialLanguages } = (() => {
    if (!allProbed) return { availableLanguages: [] as string[], partialLanguages: new Set<string>() };
    const sets = uniquePaths.map(p => {
      const tracks = videoTracksMap.get(p) ?? [];
      return new Set(tracks.map(t => t.language).filter(l => l && l !== 'und'));
    });
    const union = new Set<string>();
    for (const s of sets) for (const l of s) union.add(l);
    const partial = new Set<string>();
    for (const l of union) if (!sets.every(s => s.has(l))) partial.add(l);
    return { availableLanguages: Array.from(union).sort(), partialLanguages: partial };
  })();

  const langDisplay: Record<string, string> = { deu: 'Deutsch', eng: 'Englisch', fra: 'Französisch', spa: 'Spanisch', ita: 'Italienisch', por: 'Portugiesisch', nld: 'Niederländisch', jpn: 'Japanisch', rus: 'Russisch' };
  const showLanguagePicker = !isArchive && !!onInstanceLanguageChange && uniquePaths.length > 0;
  const currentLangMissing = !!instanceLanguage && allProbed && !availableLanguages.includes(instanceLanguage);
  const currentLangPartial = !!instanceLanguage && partialLanguages.has(instanceLanguage);
  const missingCount = (!allProbed || !instanceLanguage)
    ? 0
    : uniquePaths.reduce((n, p) => {
        const tracks = videoTracksMap.get(p) ?? [];
        return tracks.some(t => t.language === instanceLanguage) ? n : n + 1;
      }, 0);

  return (
    <div ref={listRef}>
      {showLanguagePicker && (
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label className="be-label" style={{ margin: 0 }}>Sprache (Standard):</label>
          {!allProbed ? (
            <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>Tonspuren werden ermittelt…</span>
          ) : availableLanguages.length === 0 ? (
            <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(255,255,255,0.5)', fontStyle: 'italic' }}>Keine Sprach-Tags in den Videos — Datei-Standard wird verwendet</span>
          ) : (
            <>
              <select
                className="be-input"
                style={{ width: 'auto', minWidth: 180 }}
                value={instanceLanguage ?? ''}
                onChange={e => onInstanceLanguageChange!(e.target.value || undefined)}
              >
                {!instanceLanguage && <option value="" disabled>— Sprache wählen —</option>}
                {availableLanguages.map(lang => {
                  const label = langDisplay[lang] ?? lang.toUpperCase();
                  const isPartial = partialLanguages.has(lang);
                  return (
                    <option key={lang} value={lang}>
                      {isPartial ? `⚠ ${label} (nicht in allen Videos)` : label}
                    </option>
                  );
                })}
                {currentLangMissing && (
                  <option value={instanceLanguage}>⚠ {langDisplay[instanceLanguage!] ?? instanceLanguage!.toUpperCase()} (nicht in allen Videos)</option>
                )}
              </select>
              {instanceLanguage && (
                <button
                  className="be-icon-btn"
                  style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                  onClick={() => onInstanceLanguageChange!(undefined)}
                  title="Sprach-Auswahl entfernen — jede Datei spielt ihre Standard-Tonspur"
                >
                  Entfernen
                </button>
              )}
              {(currentLangPartial || currentLangMissing) && missingCount > 0 ? (
                <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(var(--warning-rgb, 255, 180, 60), 0.95)' }}>
                  ⚠ {missingCount} {missingCount === 1 ? 'Video hat' : 'Videos haben'} keine {langDisplay[instanceLanguage!] ?? instanceLanguage!.toUpperCase()}-Tonspur — Datei-Standard wird verwendet.
                </span>
              ) : (
                <span style={{ fontSize: 'var(--admin-sz-11, 11px)', color: 'rgba(255,255,255,0.5)' }}>
                  Wird pro Frage überschrieben, wenn eine Tonspur manuell gewählt ist.
                </span>
              )}
            </>
          )}
        </div>
      )}
      {renderedIndices.map((i, pos) => {
        const q = questions[i];
        const spacerBefore = spacers[pos];
        const effTrack = resolveEffectiveTrack(q);
        const qKey = cacheKeyOf(q, effTrack);
        const localCs = qKey ? cacheState.get(qKey) : undefined;
        // Remote bgTask fallback: when no local state exists (this tab didn't trigger
        // the cache), surface the server's queued/running task so the button disables
        // and progress is visible even if warm-all or auto-warmup fired elsewhere.
        const matchKey = questionMatchKey(q, effTrack);
        const remote = matchKey ? remoteBgTasks.get(matchKey) : undefined;
        const cs: CacheEntry | undefined = localCs ?? (remote
          ? (remote.status === 'queued'
              ? { percent: 0, queued: true }
              : { percent: remote.percent ?? 0, preparing: remote.percent === null })
          : undefined);
        return (
          <Fragment key={i}>
            {spacerBefore > 0 && <div aria-hidden="true" style={{ height: spacerBefore }} />}
            <QuestionBlock
              q={q}
              i={i}
              cs={cs}
              isExpanded={expanded.has(i)}
              isDraggingOver={overIdx === i}
              otherInstances={otherInstances}
              isArchive={!!isArchive}
              effectiveTrack={effTrack}
              isHdr={hdrVideos.has(q.video)}
              instanceLanguage={instanceLanguage}
              refCallback={getBlockRef(i)}
              onUpdate={update}
              onRemove={remove}
              onDuplicate={duplicate}
              onToggle={toggle}
              onClearExpanded={clearExpandedAt}
              onGenerateCache={stableGenerateCache}
              onMoveQuestion={onMoveQuestion ? stableMoveQuestion : undefined}
              onDragStart={stableDragStart}
              onDragOver={stableDragOver}
              onDragEnd={stableDragEnd}
            />
          </Fragment>
        );
      })}
      {spacers[spacers.length - 1] > 0 && <div aria-hidden="true" style={{ height: spacers[spacers.length - 1] }} />}
      <button className="be-icon-btn" onClick={() => onChange([...questions, empty()])} style={{ marginTop: 4 }}>
        + Frage hinzufügen
      </button>
    </div>
  );
}
