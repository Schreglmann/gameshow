import { useEffect, useState } from 'react';

// Chromium-only event; TypeScript doesn't ship a type for it.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Module-level cache: Chrome can fire `beforeinstallprompt` before React mounts.
// Capture it on module load so the hook can read the cached value synchronously.
let cachedEvent: BeforeInstallPromptEvent | null = null;
const listeners = new Set<(e: BeforeInstallPromptEvent | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    cachedEvent = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn(cachedEvent));
  });
  window.addEventListener('appinstalled', () => {
    cachedEvent = null;
    listeners.forEach((fn) => fn(null));
  });
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true;
  // iOS Safari exposes this non-standard flag instead of display-mode.
  return (window.navigator as unknown as { standalone?: boolean }).standalone === true;
}

const hasBeforeInstallPrompt =
  typeof window !== 'undefined' && 'onbeforeinstallprompt' in window;

export interface BrowserInstallInfo {
  readonly family: 'chromium' | 'safari-ios' | 'safari-macos' | 'firefox-android' | 'firefox-desktop' | 'other';
  /** Installation is possible on this platform (either via prompt or menu). */
  readonly installable: boolean;
  /** Localized German instructions for manual install (null when the browser
   *  uses a programmatic prompt instead). */
  readonly manualInstructions: string | null;
}

function detectBrowser(): BrowserInstallInfo {
  if (typeof navigator === 'undefined') {
    return { family: 'other', installable: false, manualInstructions: null };
  }
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const android = /Android/.test(ua);
  const firefox = /Firefox|FxiOS/.test(ua);
  const chromium = hasBeforeInstallPrompt && !firefox;

  if (chromium) {
    return { family: 'chromium', installable: true, manualInstructions: null };
  }
  if (iOS) {
    return {
      family: 'safari-ios',
      installable: true,
      manualInstructions: 'Zum Installieren: unten „Teilen“ antippen → „Zum Home-Bildschirm“.',
    };
  }
  if (firefox && android) {
    return {
      family: 'firefox-android',
      installable: true,
      manualInstructions: 'Zum Installieren: Menü (⋮) → „App installieren“.',
    };
  }
  if (firefox) {
    // Firefox desktop has no PWA install support, so there's nothing to
    // instruct the user to do — hide the button entirely.
    return { family: 'firefox-desktop', installable: false, manualInstructions: null };
  }
  // Safari on macOS (no UA-based toggle; assume macOS WebKit).
  if (/Mac OS X/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg/.test(ua)) {
    return {
      family: 'safari-macos',
      installable: true,
      manualInstructions: 'Zum Installieren in Safari 17+: Menü „Ablage“ → „Zum Dock hinzufügen…“.',
    };
  }
  return { family: 'other', installable: false, manualInstructions: null };
}

export function useInstallPrompt(): {
  /** Button should be rendered (either a prompt is available or manual instructions apply). */
  canInstall: boolean;
  /** App is already installed (running in standalone mode). */
  installed: boolean;
  /** Info about the user's browser — `manualInstructions` is non-null when the
   *  browser can only be installed via a user-visible menu. */
  browser: BrowserInstallInfo;
  /** Call to trigger the install flow:
   *  - On Chromium with a deferred prompt, shows the native dialog.
   *  - Otherwise, returns `'manual'` so the caller can show the manual instructions.
   *  - Returns `'unavailable'` if this browser can't install at all. */
  prompt: () => Promise<'accepted' | 'dismissed' | 'manual' | 'unavailable'>;
} {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(cachedEvent);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [browser] = useState<BrowserInstallInfo>(() => detectBrowser());

  useEffect(() => {
    const sync = (e: BeforeInstallPromptEvent | null) => {
      setDeferred(e);
      if (e === null && isStandalone()) setInstalled(true);
    };
    listeners.add(sync);
    return () => { listeners.delete(sync); };
  }, []);

  const prompt = async (): Promise<'accepted' | 'dismissed' | 'manual' | 'unavailable'> => {
    if (deferred) {
      await deferred.prompt();
      const { outcome } = await deferred.userChoice;
      cachedEvent = null;
      setDeferred(null);
      return outcome;
    }
    if (browser.manualInstructions) return 'manual';
    return 'unavailable';
  };

  const chromiumReady = browser.family === 'chromium' && !!deferred;
  const canInstall = !installed && (chromiumReady || browser.manualInstructions !== null);

  return { canInstall, installed, browser, prompt };
}
