/**
 * Frontend fallback for the "Asset neu laden" recovery action.
 *
 * Mirrors the gamemaster control button: each audio/video game renders this
 * only when (a) an auto-retry has exhausted for the current question and
 * (b) no gamemaster PWA is currently connected. When a GM is connected, the
 * recovery action lives there instead so the projector UI stays clean.
 */
export interface AssetReloadButtonProps {
  onClick: () => void;
}

export default function AssetReloadButton({ onClick }: AssetReloadButtonProps) {
  return (
    <button
      type="button"
      className="asset-reload-button"
      onClick={onClick}
      aria-label="Asset neu laden"
    >
      <span className="asset-reload-button-icon" aria-hidden="true">↻</span>
      <span className="asset-reload-button-label">Asset neu laden</span>
    </button>
  );
}
