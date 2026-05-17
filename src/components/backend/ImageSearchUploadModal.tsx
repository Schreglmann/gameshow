import { useCallback, useState } from 'react';
import { downloadImageFromUrl, type ImageSearchResult } from '../../services/backendApi';
import ImageSearchPanel from './ImageSearchPanel';

// "Online suchen" modal for the DAM upload zone. Renders the shared
// <ImageSearchPanel> plus an optional subfolder dropdown (mirrors the
// existing "Von URL" modal). Clicking a candidate downloads it to the active
// images category via the existing /api/backend/assets/images/download-url
// endpoint and closes the modal. URL pasting, file picking, and clipboard
// paste are deliberately not in this modal — those flows are covered by
// "Von URL" and the upload zone itself.

interface Props {
  allFolderPaths: string[];      // populated from AssetsTab subfolders
  defaultSubfolder?: string;     // pre-selected subfolder
  renderBox?: { w: number; h: number };  // default to RENDER_BOX_QUIZ (1920×540)
  onCancel: () => void;
  onUploaded: (fileName: string, subfolder: string) => void;
}

export default function ImageSearchUploadModal({
  allFolderPaths,
  defaultSubfolder = '',
  renderBox,
  onCancel,
  onUploaded,
}: Props) {
  const [subfolder, setSubfolder] = useState(defaultSubfolder);
  const [busyUrl, setBusyUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = useCallback(async (r: ImageSearchResult) => {
    setBusyUrl(r.url);
    setError(null);
    try {
      const fileName = await downloadImageFromUrl('images', r.url, subfolder || undefined);
      onUploaded(fileName, subfolder);
    } catch (err) {
      setError((err as Error).message);
      setBusyUrl(undefined);
    }
  }, [subfolder, onUploaded]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="replace-modal" onClick={e => e.stopPropagation()}>
        <div className="replace-modal-header">
          <span className="replace-modal-title">Bild online suchen</span>
          <span className="replace-modal-subtitle">
            {allFolderPaths.length > 0
              ? `Speichern in: ${subfolder ? `Bilder / ${subfolder}` : 'Bilder (Hauptordner)'}`
              : 'Speichern in: Bilder'}
          </span>
          <button className="be-icon-btn" onClick={onCancel} aria-label="Schließen" disabled={!!busyUrl}>✕</button>
        </div>

        {allFolderPaths.length > 0 && (
          <div className="replace-modal-subfolder">
            <label>
              Unterordner:
              <select
                value={subfolder}
                onChange={e => setSubfolder(e.target.value)}
                disabled={!!busyUrl}
              >
                <option value="">— (Hauptordner)</option>
                {allFolderPaths.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="replace-modal-body">
          <ImageSearchPanel
            defaultQuery=""
            renderBox={renderBox}
            busyUrl={busyUrl}
            onSelect={handleSelect}
          />
        </div>

        {error && <div className="replace-error">{error}</div>}

        <div className="replace-modal-actions">
          <button className="be-btn-secondary" onClick={onCancel} disabled={!!busyUrl}>
            {busyUrl ? 'Lade…' : 'Abbrechen'}
          </button>
        </div>
      </div>
    </div>
  );
}
