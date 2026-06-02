interface Props {
  /** What changed, e.g. "Dieses Spiel" or "Die Konfiguration". */
  what: string;
  onReload: () => void;
  onDismiss: () => void;
}

/**
 * Non-blocking banner shown inside an admin editor when the file it's editing was
 * changed in another admin instance WHILE this tab has unsaved edits. Lets the user
 * decide between keeping their edits or reloading the remote version — neither side
 * is ever silently lost. See specs/live-config-reload.md (admin multi-instance sync).
 */
export default function ConflictBanner({ what, onReload, onDismiss }: Props) {
  return (
    <div className="be-conflict-banner" role="alert">
      <span className="be-conflict-banner-icon" aria-hidden>⚠</span>
      <span className="be-conflict-banner-text">
        {what} wurde in einem anderen Tab geändert.
      </span>
      <button type="button" className="be-conflict-banner-reload" onClick={onReload}>
        Neu laden
      </button>
      <button
        type="button"
        className="be-conflict-banner-dismiss"
        onClick={onDismiss}
        aria-label="Hinweis schließen"
      >
        ×
      </button>
    </div>
  );
}
