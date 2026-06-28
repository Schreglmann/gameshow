import { useState } from 'react';
import { useWsChannel } from '@/services/useBackendSocket';
import type { ShowHoldState } from '@/types/game';
import '@/styles/show-hold.css';

/**
 * Panic/pause hold overlay for the show (projector). The gamemaster toggles it
 * via the cached `show-hold` WS channel; when active it covers the entire
 * projector with a branded "Gleich geht's weiter" hold (plus an optional custom
 * message) so the next answer/slide isn't exposed during a dispute or break.
 * Cached channel → a projector reload mid-hold immediately re-receives it.
 * Sits above all show content (incl. fullscreen lightbox + music controls).
 * See specs/gamemaster-cockpit.md.
 */
export default function ShowHoldOverlay() {
  const [hold, setHold] = useState<ShowHoldState | null>(null);
  useWsChannel<ShowHoldState | null>('show-hold', (next) => setHold(next ?? null));

  if (!hold?.active) return null;

  return (
    <div className="show-hold-overlay" role="status" aria-live="polite">
      <div className="show-hold-card">
        <div className="show-hold-icon" aria-hidden="true">⏸</div>
        <div className="show-hold-title">Gleich geht&apos;s weiter</div>
        {hold.message && hold.message.trim() && (
          <div className="show-hold-message">{hold.message}</div>
        )}
      </div>
    </div>
  );
}
