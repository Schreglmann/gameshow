import { useEffect, useRef, useState } from 'react';
import '@/styles/connection-status.css';
import { useServerOffline } from '@/hooks/useServerOffline';
import { useDroppedSendCount } from '@/services/useBackendSocket';

/** Delay before the gamemaster banner appears for a lost connection. */
export const GM_OFFLINE_DELAY_MS = 1500;
/** How long "Befehl nicht gesendet" stays after a dropped command. */
export const DROPPED_FLASH_MS = 2500;

/**
 * Banner across the top of the gamemaster screen while the backend is
 * unreachable. A command tapped in that state is never sent (commands are not
 * queued), so the banner also flashes "Befehl nicht gesendet" — immediately,
 * without waiting for the offline delay. See specs/crash-recovery.md.
 *
 * Carries `data-gm-no-nav` so a tap on it never advances the show.
 * `forceState` + `inline` are for the ThemeShowcase.
 */
export default function GmConnectionBanner({
  forceState,
  inline = false,
}: {
  forceState?: 'offline' | 'dropped';
  inline?: boolean;
}) {
  const offline = useServerOffline(GM_OFFLINE_DELAY_MS);
  const dropped = useDroppedSendCount();
  // The count only grows, so "differs from the value at mount" means "a command
  // was dropped since this banner mounted". Comparing against a ref updated in
  // the effect would break under StrictMode's effect re-run (timer never re-armed).
  const droppedAtMount = useRef(dropped);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (dropped === droppedAtMount.current) return;
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), DROPPED_FLASH_MS);
    return () => clearTimeout(timer);
  }, [dropped]);

  const showFlash = flash || forceState === 'dropped';
  if (!offline && !showFlash && !forceState) return null;

  return (
    <div
      className={`gm-connection-banner${inline ? ' gm-connection-banner--inline' : ''}`}
      role="alert"
      data-gm-no-nav
      data-testid="gm-connection-banner"
    >
      <span>Server getrennt – verbinde neu…</span>
      {showFlash && <span className="gm-connection-banner__dropped">Befehl nicht gesendet</span>}
    </div>
  );
}
