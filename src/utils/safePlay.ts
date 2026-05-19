/**
 * Resilient HTMLMediaElement.play() helper.
 *
 * Tries to play the media element. Recovers from:
 *   - autoplay blocked → falls back to muted play then unmutes
 *   - transient network/decode errors → retries once after a backoff
 *   - data not yet buffered → waits for `canplay` (up to a timeout)
 *
 * Treats AbortError (caller paused mid-play) as intentional cancellation,
 * not failure — does not retry, returns false.
 *
 * Returns true if playback started, false if all retries exhausted or
 * the play was aborted.
 */
export interface SafePlayOptions {
  /** Max retries after the initial try fails. Default 1 (so 2 attempts total). */
  retries?: number;
  /** Backoff delay before each retry, in ms. Default 200. */
  backoffMs?: number;
  /** Called on each non-abort failure with `(error, attempt)`. */
  onError?: (error: unknown, attempt: number) => void;
  /**
   * Wait for `canplay` if `readyState < HAVE_FUTURE_DATA` before the first
   * play(). Default false — modern browsers buffer-and-play internally, so
   * calling play() on a freshly-set src returns a Promise that resolves once
   * playback starts. Set true for streaming video where the segment may not
   * be readable yet (matches the old VideoGuess behavior).
   */
  waitForReady?: boolean;
  /** Timeout for the `canplay` wait, in ms. Default 3000. */
  readyTimeoutMs?: number;
}

const isAbortError = (e: unknown): boolean => {
  if (e instanceof DOMException) return e.name === 'AbortError';
  if (e instanceof Error) return e.name === 'AbortError';
  return false;
};

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function waitForCanPlay(media: HTMLMediaElement, timeoutMs: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      media.removeEventListener('canplay', onCanPlay);
      media.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const onCanPlay = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('media error before canplay'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('canplay timeout'));
    }, timeoutMs);
    media.addEventListener('canplay', onCanPlay, { once: true });
    media.addEventListener('error', onError, { once: true });
  });
}

async function playWithMutedFallback(media: HTMLMediaElement): Promise<void> {
  try {
    await media.play();
  } catch (err) {
    if (isAbortError(err)) throw err;
    const wasMuted = media.muted;
    try {
      media.muted = true;
      await media.play();
      media.muted = wasMuted;
    } catch (err2) {
      media.muted = wasMuted;
      throw err2;
    }
  }
}

export async function safePlay(
  media: HTMLMediaElement,
  opts: SafePlayOptions = {}
): Promise<boolean> {
  const {
    retries = 1,
    backoffMs = 200,
    onError,
    waitForReady = false,
    readyTimeoutMs = 3000,
  } = opts;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      if (waitForReady && media.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        await waitForCanPlay(media, readyTimeoutMs);
      }
      await playWithMutedFallback(media);
      return true;
    } catch (err) {
      if (isAbortError(err)) return false;
      onError?.(err, attempt);
      if (attempt < retries) {
        await sleep(backoffMs);
      }
    }
  }
  return false;
}
