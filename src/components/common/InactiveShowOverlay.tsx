import { useEffect, useRef, type MouseEvent } from 'react';
import '@/styles/inactive-show-overlay.css';

interface InactiveShowOverlayProps {
  onClaim: () => void;
}

export default function InactiveShowOverlay({ onClaim }: InactiveShowOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Several screens attach window-level `keydown` listeners to advance the
  // game. Swallow keys at the capture phase so they can't navigate the
  // inactive show underneath. We deliberately DON'T do the same for clicks
  // — stopping a click in the capture phase also stops the button's own
  // onClick handler, which would leave the claim button inoperative.
  // Click propagation is handled by the React onClick stopPropagation
  // below, which still reaches the button.
  useEffect(() => {
    const stopKey = (e: KeyboardEvent) => {
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', stopKey, true);
    return () => { window.removeEventListener('keydown', stopKey, true); };
  }, []);

  const handleClaim = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onClaim();
  };

  return (
    <div
      ref={rootRef}
      className="inactive-show-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="inactive-show-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="inactive-show-card">
        <h2 id="inactive-show-title">Dieses Frontend ist nicht aktiv</h2>
        <p>Ein anderes Frontend ist aktuell als Haupt-Frontend registriert. Um Inhalte hier anzuzeigen und zu kontrollieren, musst du übernehmen.</p>
        <button type="button" className="inactive-show-claim-btn" onClick={handleClaim}>
          Als Haupt-Frontend übernehmen
        </button>
      </div>
    </div>
  );
}
