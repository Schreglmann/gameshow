/**
 * Watches an HTMLMediaElement (audio or video) for the first sign that its
 * load is making progress. If no `canplay` / `loadedmetadata` / `error` event
 * fires within `timeoutMs`, calls `onSlow()`. Useful for surfacing a
 * gamemaster recovery button when a fetch hangs without erroring — Firefox
 * frequently leaves slow fetches pending for minutes before timing out.
 *
 * Returns a cleanup function that detaches listeners and clears the timer.
 *
 * Behavioral notes:
 * - `canplay` is preferred over `canplaythrough` because the latter requires
 *   the entire file to be buffered; we only care that playback could start.
 * - `error` cancels the timeout immediately (and does NOT call `onSlow`) so a
 *   normal failure path (handled elsewhere via `safePlay`) doesn't double-fire.
 * - The watcher is single-shot: once any of the three events fires, the
 *   timer is cleared and listeners are removed.
 */
export function watchMediaLoad(
  media: HTMLMediaElement,
  timeoutMs: number,
  onSlow: () => void,
): () => void {
  let cleared = false;
  const settle = () => {
    if (cleared) return;
    cleared = true;
    clearTimeout(timer);
    media.removeEventListener('canplay', settle);
    media.removeEventListener('loadedmetadata', settle);
    media.removeEventListener('error', settle);
  };
  const timer = window.setTimeout(() => {
    if (cleared) return;
    cleared = true;
    media.removeEventListener('canplay', settle);
    media.removeEventListener('loadedmetadata', settle);
    media.removeEventListener('error', settle);
    onSlow();
  }, timeoutMs);
  media.addEventListener('canplay', settle, { once: true });
  media.addEventListener('loadedmetadata', settle, { once: true });
  media.addEventListener('error', settle, { once: true });
  return settle;
}

/** Default slow-load threshold for media elements during live play (10s). */
export const MEDIA_SLOW_LOAD_MS = 10_000;

/** Default slow-load threshold for images (8s; smaller files, faster TTFB). */
export const IMAGE_SLOW_LOAD_MS = 8_000;
