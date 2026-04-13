import { useEffect, useRef, useState } from 'react';
import { warmupSdr, warmupCompressed } from './backendApi';

/**
 * Shared cache-readiness hook used by both the in-game player (`VideoGuess.tsx`) and the
 * DAM video-detail modal (`AssetsTab.tsx`). Given the inputs that identify a segment cache,
 * it returns the playable `src`, plus live warmup progress if the cache has to be generated.
 *
 * Flow:
 *   1. Compute the cache URL — `/videos-sdr/{start}/{end}/{path}?track=…&strict=1` for HDR,
 *      `/videos-compressed/…` for SDR. `strict=1` makes the server 404 on cache miss instead
 *      of silently transcoding on-the-fly during critical live playback.
 *   2. HEAD-probe the URL. If it returns 404 + `X-Cache-Status: missing`, kick off the
 *      matching warmup SSE (`warmupSdr`/`warmupCompressed`) and stream percent into
 *      `warmupProgress`.
 *   3. When warmup completes, clear progress so the caller can proceed with `video.load()`.
 *
 * Callers consume `{ src, ready, warmupProgress, warmupError }`:
 *   - `src`: URL to put in the `<source>` element (empty string while inputs resolving).
 *   - `ready`: true when the cache exists and the video element can load. Becomes false
 *     while a warmup is in flight.
 *   - `warmupProgress`: 0–100 while warmup runs; `null` when no warmup in flight.
 *   - `warmupError`: message if warmup failed, else `null`.
 */
export interface EnsureSegmentCacheInput {
  video: string | undefined;
  start: number;
  end: number;
  track?: number;
  isHdr: boolean;
  /** Set to false to pause the hook (e.g. modal closed, question not mounted yet). */
  enabled?: boolean;
}

export interface EnsureSegmentCacheState {
  src: string;
  ready: boolean;
  warmupProgress: number | null;
  warmupError: string | null;
}

/** Build the segment-cache URL the in-game player uses (`strict=1` gate). */
export function segmentCacheUrl(video: string, start: number, end: number, track: number | undefined, isHdr: boolean): string {
  const videoPath = video.replace(/^\/videos\//, '');
  const trackQuery = track !== undefined ? `track=${track}&` : '';
  const endpoint = isHdr ? 'videos-sdr' : 'videos-compressed';
  return `/${endpoint}/${start}/${end}/${videoPath}?${trackQuery}strict=1`;
}

export function useEnsureSegmentCache(input: EnsureSegmentCacheInput): EnsureSegmentCacheState {
  const { video, start, end, track, isHdr, enabled = true } = input;
  const [warmupProgress, setWarmupProgress] = useState<number | null>(null);
  const [warmupError, setWarmupError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Stable key for the effect dependency array — `useRef` on the last-seen key isn't needed
  // because React compares primitives in the dep list.
  const src = video ? segmentCacheUrl(video, start, end, track, isHdr) : '';

  // Track whether a warmup is in flight so we don't double-fire on React double-invocation.
  const inflightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled || !video) {
      setReady(false);
      setWarmupProgress(null);
      setWarmupError(null);
      return;
    }

    let cancelled = false;
    const ac = new AbortController();
    inflightRef.current?.abort();
    inflightRef.current = ac;

    setWarmupError(null);

    // Fast path: HEAD probes whether the cache file is present. When the `strict=1` endpoint
    // returns 200 the cache exists and we mark ready immediately — no progress overlay.
    fetch(src, { method: 'HEAD', signal: ac.signal })
      .then(r => {
        if (cancelled) return;
        const missing = r.status === 404 && r.headers.get('X-Cache-Status') === 'missing';
        if (!missing) {
          setWarmupProgress(null);
          setReady(true);
          return;
        }

        // Slow path: run the matching warmup SSE. `warmupSdr` and `warmupCompressed` share
        // the same server endpoint shape, so the only difference is the URL they hit.
        setReady(false);
        setWarmupProgress(0);
        const warmer = isHdr ? warmupSdr : warmupCompressed;
        warmer(video, start, end, (ev) => {
          if (cancelled) return;
          if (typeof ev.percent === 'number') setWarmupProgress(ev.percent);
        }, track).then(() => {
          if (cancelled) return;
          setWarmupProgress(100);
          setReady(true);
          // Drop progress after a tick so the UI briefly shows "100%" before the overlay
          // disappears.
          setTimeout(() => {
            if (!cancelled) setWarmupProgress(null);
          }, 200);
        }).catch((err: Error) => {
          if (cancelled || ac.signal.aborted) return;
          setWarmupProgress(null);
          setWarmupError(err.message || 'Cache konnte nicht erzeugt werden');
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Network error on the HEAD probe — treat as "cache unknown but try anyway"; the
        // caller's video element will surface a real error if playback can't start.
        setReady(true);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [video, start, end, track, isHdr, enabled, src]);

  return { src, ready, warmupProgress, warmupError };
}
