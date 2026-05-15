import { useState, useEffect, useCallback, type ImgHTMLAttributes } from 'react';

/**
 * `<img>` wrapper that auto-retries on load failure.
 *
 * On `error`, increments an attempt counter and appends a cache-busting
 * `?v={attempt}` (or `&v={attempt}` if the URL already has a query) — but
 * ONLY on retry. The initial render uses the URL verbatim so back-navigation
 * to a previously-played question still hits the browser's HTTP cache.
 *
 * After `maxRetries` failures, calls `onFinalFailure` once and keeps the
 * image at its last attempted URL. Resets on `src` change (new question).
 */
export interface RetryImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onError' | 'src'> {
  src: string;
  /** Max retries after the first attempt. Default 2 (so 3 total tries). */
  maxRetries?: number;
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
  onFinalFailure,
  ...imgProps
}: RetryImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [finalFailed, setFinalFailed] = useState(false);

  useEffect(() => {
    setAttempt(0);
    setFinalFailed(false);
  }, [src]);

  const handleError = useCallback(() => {
    if (finalFailed) return;
    setAttempt(a => {
      if (a >= maxRetries) {
        setFinalFailed(true);
        onFinalFailure?.();
        return a;
      }
      return a + 1;
    });
  }, [finalFailed, maxRetries, onFinalFailure]);

  return <img {...imgProps} src={withCacheBust(src, attempt)} onError={handleError} />;
}
