import { useEffect, useRef, useState, type RefObject } from 'react';
import { notifyStreamStart, notifyStreamEnd } from './networkPriority';

/**
 * Shared playback-lifecycle logic for raw-file `<video>` elements. Used by both the marker
 * editor (`VideoGuessForm.tsx`) and the DAM video-detail modal (`AssetsTab.tsx`) so their
 * loading/error behaviour stays identical.
 *
 * The hook owns three cross-cutting concerns:
 *
 *   1. **Loading state** — reflects buffering (`waiting` / `canplay` / `playing` / `seeked`).
 *      Starts `true` on mount; flips to `false` once the element is ready. The caller
 *      renders a spinner when `loading` is true.
 *   2. **Error surfacing** — translates `MediaError.code` into a human-readable German
 *      message for the caller to render as an overlay. This hook deliberately does *not*
 *      try to auto-recover (e.g. by calling `video.load()` on decode errors) because that
 *      used to intercept normal seeks: a brief transient decode event during a seek would
 *      trigger a reload + restore-to-pre-seek, making the video appear to "jump back" on
 *      every user jump. Modern browsers handle transient decode hiccups on their own.
 *   3. **Stream notifications** — `notifyStreamStart` / `notifyStreamEnd` so the NAS sync
 *      throttles bandwidth while a video is actively playing.
 *
 * Callers still own the `<video>` element, its `src`, and any UI-specific state. This hook
 * only attaches lifecycle listeners; it does not touch `src` or call `load()`.
 */

/** Seek robustly. Uses `fastSeek` (keyframe-targeted, no per-frame decode) for large jumps
 *  to avoid HEVC decoder confusion on 4K HDR content. Kept as an export because the marker
 *  editor's timeline click / marker-seek handlers call it directly. */
export function safeSeek(v: HTMLVideoElement, t: number): void {
  const delta = Math.abs(v.currentTime - t);
  if (delta > 30 && typeof v.fastSeek === 'function') {
    v.fastSeek(t);
  } else {
    v.currentTime = t;
  }
}

export interface VideoPlaybackState {
  loading: boolean;
  error: string | null;
}

export function useVideoPlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  /** Identifies the current source. Re-attaches listeners + resets state on change. */
  srcKey: string,
): VideoPlaybackState {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Last known-good currentTime — updated on every timeupdate. Used as the restore target
  // after a decode-error `load()` since `video.currentTime` often reports 0 after crashes.
  const lastKnownTimeRef = useRef(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setLoading(true);
    setError(null);
    lastKnownTimeRef.current = 0;

    let notified = false;
    // Debounce `waiting` → `setLoading(true)` to prevent render storms during buffering.
    // When a large video is loading, the browser fires `waiting` ↔ `canplay` in rapid
    // alternation. Each flip causes a re-render of the (heavy) marker editor. By delaying
    // the `loading=true` flip by 200ms, we skip transient buffering hiccups entirely and
    // only show the spinner for genuine stalls. The `canplay`/`playing` handler cancels
    // the pending timer so no stale flip lands.
    let waitingTimer = 0;

    const onTimeUpdate = () => {
      if (!Number.isNaN(video.currentTime) && video.currentTime > 0) {
        lastKnownTimeRef.current = video.currentTime;
      }
    };
    const onWaiting = () => {
      if (!waitingTimer) {
        waitingTimer = window.setTimeout(() => { waitingTimer = 0; setLoading(true); }, 200);
      }
    };
    const onReady = () => {
      if (waitingTimer) { clearTimeout(waitingTimer); waitingTimer = 0; }
      setLoading(false); setError(null);
    };
    const onPlay = () => { if (!notified) { notifyStreamStart(); notified = true; } };
    const onPause = () => { if (notified) { notifyStreamEnd(); notified = false; } };

    // No auto-recovery on decode errors. Earlier versions of this hook called `video.load()`
    // on every `error` event and re-seeked to the last known-good position — which wrecked
    // normal seeks in Firefox (H264 included): any brief decode hiccup during a seek was
    // intercepted, the element was reset, and the user was silently teleported back to the
    // pre-jump position. Browsers handle transient decode hiccups on their own; intercepting
    // them here hurt more than it helped. We only surface unrecoverable error codes.
    const onError = () => {
      const err = video.error;
      if (!err) return;
      if (err.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
        setError('Video konnte nicht dekodiert werden — Format nicht browserkompatibel. Der Gameshow-Cache konvertiert beim Erstellen automatisch zu H.264/AAC; extern mit VLC / IINA abspielbar.');
        return;
      }
      if (err.code === MediaError.MEDIA_ERR_DECODE) {
        setError('Browser-Decoder hat an dieser Position aufgegeben — das ist bei langen HEVC/HDR-Dateien in Firefox/Safari bekannt. Im Gameshow-Cache ist das Segment H.264/SDR, spielt also sauber. Extern mit VLC / IINA prüfen.');
        return;
      }
      if (err.code === MediaError.MEDIA_ERR_NETWORK) {
        setError('Netzwerkfehler beim Laden — Verbindung prüfen oder neu öffnen.');
        return;
      }
      // MEDIA_ERR_ABORTED (code 1) is benign (user-initiated abort); don't surface.
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onReady);
    video.addEventListener('playing', onReady);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onPause);
    video.addEventListener('error', onError);
    return () => {
      if (waitingTimer) clearTimeout(waitingTimer);
      if (notified) notifyStreamEnd();
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onReady);
      video.removeEventListener('playing', onReady);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onPause);
      video.removeEventListener('error', onError);
    };
  }, [videoRef, srcKey]);

  return { loading, error };
}
