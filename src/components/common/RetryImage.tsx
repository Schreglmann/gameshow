import { useState, useEffect, useCallback, useRef, type ImgHTMLAttributes, type SyntheticEvent } from 'react';
import { IMAGE_SLOW_LOAD_MS } from '@/utils/mediaLoadTimeout';

/**
 * `<img>` wrapper that auto-retries on load failure or slow load.
 *
 * - On `error`, increments an attempt counter and appends `?v={attempt}` cache-buster.
 * - On a slow load (no `onLoad` within `slowLoadMs`), treats the load as failed
 *   so the parent's `onFinalFailure` surfaces the retry button instead of leaving
 *   the projector blank for minutes — Firefox keeps slow fetches pending for a
 *   very long time without ever firing `error`.
 * - Cache-bust is applied ONLY on retry. The initial render uses the URL
 *   verbatim so back-navigation to a previously-played question still hits the
 *   browser's HTTP cache.
 * - After `maxRetries` failures, calls `onFinalFailure` once and keeps the
 *   image at its last attempted URL. Resets on `src` change (new question).
 */
export interface RetryImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError' | 'src'> {
  src: string;
  /** Max retries after the first attempt. Default 2 (so 3 total tries). */
  maxRetries?: number;
  /** Milliseconds before treating an unfinished load as failed. Default 8000. */
  slowLoadMs?: number;
  /** Called once after all retries fail. */
  onFinalFailure?: () => void;
}

function withCacheBust(src: string, attempt: number): string {
  if (attempt === 0) return src;
  return src.includes('?') ? `${src}&v=${attempt}` : `${src}?v=${attempt}`;
}

export default function RetryImage({
  src,
  maxRetries = 2,
  slowLoadMs = IMAGE_SLOW_LOAD_MS,
  onFinalFailure,
  onLoad,
  ...imgProps
}: RetryImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [finalFailed, setFinalFailed] = useState(false);
  const finalFailedRef = useRef(false);
  finalFailedRef.current = finalFailed;
  const loadedRef = useRef(false);

  useEffect(() => {
    setAttempt(0);
    setFinalFailed(false);
    loadedRef.current = false;
  }, [src]);

  const triggerFailure = useCallback(() => {
    if (finalFailedRef.current) return;
    setAttempt(a => {
      if (a >= maxRetries) {
        setFinalFailed(true);
        onFinalFailure?.();
        return a;
      }
      return a + 1;
    });
  }, [maxRetries, onFinalFailure]);

  // Slow-load watchdog: if onLoad hasn't fired within slowLoadMs of this
  // attempt starting, treat as failed so the retry mechanism kicks in.
  useEffect(() => {
    loadedRef.current = false;
    if (finalFailed) return;
    const timer = window.setTimeout(() => {
      if (!loadedRef.current && !finalFailedRef.current) {
        triggerFailure();
      }
    }, slowLoadMs);
    return () => clearTimeout(timer);
  }, [src, attempt, slowLoadMs, triggerFailure, finalFailed]);

  const handleError = useCallback(() => {
    triggerFailure();
  }, [triggerFailure]);

  const handleLoad = useCallback((e: SyntheticEvent<HTMLImageElement>) => {
    loadedRef.current = true;
    onLoad?.(e);
  }, [onLoad]);

  return (
    <img
      {...imgProps}
      src={withCacheBust(src, attempt)}
      onError={handleError}
      onLoad={handleLoad}
    />
  );
}
