/**
 * Known browser-specific bugs we tell the operator about right next to the affected video.
 * Surfaced as a warning banner in both the DAM video-detail modal and the marker editor
 * so the operator doesn't spend 20 minutes debugging a browser limitation.
 *
 * The matrix is hand-maintained from what we've actually reproduced in the wild — keep it
 * targeted rather than speculative, so a warning means "we've seen this break".
 */

export type VideoCompatInfo = {
  codec: string;
  isHdr: boolean;
  width: number;
};

type BrowserName = 'firefox' | 'safari' | 'chromium' | 'other';

function detectBrowser(): BrowserName {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  // Order matters: Edge/Chrome contain "Safari" in their UA; check Firefox + Edge first.
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Edg\//.test(ua) || /Chrome\//.test(ua) || /Chromium\//.test(ua)) return 'chromium';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

/** Human-readable browser label for user-facing warnings. */
export function currentBrowserLabel(): string {
  switch (detectBrowser()) {
    case 'firefox': return 'Firefox';
    case 'safari': return 'Safari';
    case 'chromium': return 'Chrome / Edge';
    default: return 'Dieser Browser';
  }
}

/** Check the file + current browser combo for a known-bad interaction. Returns a German
 *  warning string, or `null` if nothing notable is expected. */
export function getBrowserVideoWarning(info: VideoCompatInfo | null | undefined): string | null {
  if (!info) return null;
  const browser = detectBrowser();
  const codec = info.codec.toLowerCase();
  const isHevc = codec === 'hevc' || codec === 'h265';
  const is4k = info.width >= 3840;

  // Firefox on macOS uses VideoToolbox via its `AppleVTDecoder`, which gets into a
  // non-recoverable state after a few seeks on HEVC 10-bit HDR content. Reproducible
  // with our Harry-Potter HDR rips.
  if (browser === 'firefox' && isHevc && info.isHdr) {
    return 'Firefox auf macOS: Der Hardware-HEVC-Decoder (AppleVT) stürzt reproduzierbar '
      + 'bei Sprüngen in HDR-Inhalt ab (»OnDecodeError: kVTVideoDecoderBadDataErr«). '
      + 'Für stabiles Scrubben: Safari, Chrome oder extern mit VLC / IINA öffnen. Der '
      + 'Gameshow-Cache macht daraus beim Erstellen ohnehin ein SDR-Segment, das jeder '
      + 'Browser problemlos abspielt.';
  }

  // Safari handles HEVC Main 10 natively but some 4K HDR masters stall on the first
  // seek when the mastering metadata pushes the tonemap out of range.
  if (browser === 'safari' && isHevc && info.isHdr && is4k) {
    return 'Safari: 4K HEVC HDR kann bei bestimmten Mastering-Metadaten nach einem Sprung '
      + 'stocken oder schwarz bleiben. Wenn die Vorschau hängt: Chrome öffnen oder extern '
      + 'mit VLC / IINA prüfen. Der Gameshow-Cache ist davon nicht betroffen.';
  }

  // Chromium plays HEVC HDR fine on Apple Silicon but renders colours flat (no HDR
  // tonemap in browsers yet) — we surface that via the existing HDR banner, not here.
  return null;
}
