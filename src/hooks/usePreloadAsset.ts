import { useEffect, useState, useCallback } from 'react';

/**
 * Eager prefetch hook for an image and/or audio URL.
 *
 * Uses `fetch()` to warm the HTTP cache without allocating a MediaElement /
 * holding a persistent connection. The main game's `<audio>` / `<img>` for
 * the same URL then hits the warm cache (the server sets
 * `Cache-Control: public, max-age=300` on /audio/ + /images/).
 *
 * Why not `new Audio()` / `new Image()`: an Audio element with
 * `preload='auto'` keeps its HTTP/1.1 keep-alive connection open while
 * buffering. Across several question advances those leaked connections
 * accumulate and saturate Firefox's per-origin limit (6), queueing every
 * subsequent audio request for minutes. See [specs/asset-resilience.md].
 *
 * Cancellation: we deliberately do NOT pass an AbortSignal. Letting the
 * fetch run to completion is harmless (it just finishes warming the cache)
 * and avoids Firefox's request-coalescing trap where aborting the preload
 * would also abort the main game's in-flight fetch for the same URL.
 */
export type PreloadStatus = 'idle' | 'pending' | 'ok' | 'failed';

export interface UsePreloadAssetResult {
  imageStatus: PreloadStatus;
  audioStatus: PreloadStatus;
  retry: () => void;
}

export function usePreloadAsset(
  asset: { image?: string; audio?: string }
): UsePreloadAssetResult {
  const [imageStatus, setImageStatus] = useState<PreloadStatus>('idle');
  const [audioStatus, setAudioStatus] = useState<PreloadStatus>('idle');
  const [retryNonce, setRetryNonce] = useState(0);

  const retry = useCallback(() => setRetryNonce(n => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!asset.image) {
      setImageStatus('idle');
      return;
    }
    setImageStatus('pending');
    warmCache(asset.image).then(
      ok => { if (!cancelled) setImageStatus(ok ? 'ok' : 'failed'); },
    );
    return () => { cancelled = true; };
  }, [asset.image, retryNonce]);

  useEffect(() => {
    let cancelled = false;
    if (!asset.audio) {
      setAudioStatus('idle');
      return;
    }
    setAudioStatus('pending');
    warmCache(asset.audio).then(
      ok => { if (!cancelled) setAudioStatus(ok ? 'ok' : 'failed'); },
    );
    return () => { cancelled = true; };
  }, [asset.audio, retryNonce]);

  return { imageStatus, audioStatus, retry };
}

async function warmCache(url: string): Promise<boolean> {
  try {
    const r = await fetch(url);
    if (!r.ok) return false;
    // Drain the body so the browser commits the full response to its HTTP
    // cache before we report success.
    await r.blob();
    return true;
  } catch {
    return false;
  }
}
