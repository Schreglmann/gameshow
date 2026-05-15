import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Eager prefetch hook for an image and/or audio URL.
 *
 * Uses `new Image()` and `new Audio()` (with `preload='auto'`) so the browser
 * warms its HTTP cache before the user reaches the asset. Tracks per-asset
 * status. Releases the audio decoder on cleanup so an unused preloaded Audio
 * element doesn't count against the per-page MediaElement budget.
 *
 * Pass `{ image, audio }`. Pass either undefined to skip that type. Status is
 * `'idle'` when no URL is supplied, `'pending'` while loading, `'ok'` on
 * success, `'failed'` after the load errors.
 *
 * Call `retry()` to manually re-fetch — useful when the gamemaster presses an
 * "Asset neu laden" button after an auto-retry has exhausted.
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

  const imageRef = useRef<HTMLImageElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const retry = useCallback(() => setRetryNonce(n => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    if (!asset.image) {
      setImageStatus('idle');
      return;
    }
    setImageStatus('pending');
    const img = new Image();
    imageRef.current = img;
    img.onload = () => { if (!cancelled) setImageStatus('ok'); };
    img.onerror = () => { if (!cancelled) setImageStatus('failed'); };
    img.src = asset.image;
    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
      // Best-effort: drop the in-flight request so we don't keep network/memory
      // pressure for a question the host already advanced past.
      img.src = '';
      imageRef.current = null;
    };
  }, [asset.image, retryNonce]);

  useEffect(() => {
    let cancelled = false;
    if (!asset.audio) {
      setAudioStatus('idle');
      return;
    }
    setAudioStatus('pending');
    const audio = new Audio();
    audioRef.current = audio;
    audio.preload = 'auto';
    const onLoaded = () => { if (!cancelled) setAudioStatus('ok'); };
    const onError = () => { if (!cancelled) setAudioStatus('failed'); };
    audio.addEventListener('canplaythrough', onLoaded, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.src = asset.audio;
    audio.load();
    return () => {
      cancelled = true;
      audio.removeEventListener('canplaythrough', onLoaded);
      audio.removeEventListener('error', onError);
      // Release the decoder. The bytes stay in the browser HTTP cache regardless.
      audio.src = '';
      try { audio.load(); } catch { /* ignore */ }
      audioRef.current = null;
    };
  }, [asset.audio, retryNonce]);

  return { imageStatus, audioStatus, retry };
}
