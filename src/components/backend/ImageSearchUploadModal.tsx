import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { downloadImageFromUrl, type ImageSearchResult, type ImageSearchProvider } from '../../services/backendApi';
import { toTitleCaseName } from '@/utils/filename';
import ImageSearchPanel, { ImageSearchFilterToggle } from './ImageSearchPanel';

// "Online suchen" modal for the DAM upload zone. Renders the shared
// <ImageSearchPanel> plus an optional subfolder dropdown (mirrors the
// existing "Von URL" modal). Clicking a candidate selects it and shows a
// large preview pane below the grid; the actual download is gated behind an
// explicit "✓ Herunterladen" confirm button — mirrors the two-step flow of
// ReplaceImageModal so the user can review the image before committing.
// URL pasting, file picking, and clipboard paste are deliberately not in
// this modal — those flows are covered by "Von URL" and the upload zone
// itself.

const SOURCE_LABEL: Record<ImageSearchProvider, string> = {
  ddg: 'DuckDuckGo',
  commons: 'Wikimedia',
  'github-svg': 'Logos',
};

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
  const [candidate, setCandidate] = useState<ImageSearchResult | null>(null);
  const [candidateQuery, setCandidateQuery] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState<{ src: string; name: string } | null>(null);
  const [hideSmallerResults, setHideSmallerResults] = useState(true);
  const [hiddenCount, setHiddenCount] = useState(0);

  // Clicking the already-selected candidate deselects it (toggle), matching
  // ReplaceImageModal's behaviour.
  const handleSelect = useCallback((r: ImageSearchResult, query: string) => {
    setError(null);
    setCandidate(prev => (prev?.url === r.url ? null : r));
    setCandidateQuery(query);
  }, []);

  // Submitting a new search invalidates the current pick — the chosen
  // candidate may not even appear in the new result set.
  const handleSearchSubmit = useCallback(() => {
    setCandidate(null);
    setError(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!candidate) return;
    setDownloading(true);
    setError(null);
    try {
      const desiredName = toTitleCaseName(candidateQuery) || undefined;
      const fileName = await downloadImageFromUrl('images', candidate.url, subfolder || undefined, desiredName);
      onUploaded(fileName, subfolder);
    } catch (err) {
      setError((err as Error).message);
      setDownloading(false);
    }
  }, [candidate, candidateQuery, subfolder, onUploaded]);

  // Single Esc handler with priority: close lightbox → deselect candidate →
  // close the modal. Each branch calls preventDefault + stopPropagation so the
  // browser doesn't also act on the key (e.g. exit fullscreen, dismiss other
  // overlays). While a download is in flight we don't allow deselect/close.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (enlarged) {
        e.preventDefault();
        e.stopPropagation();
        setEnlarged(null);
        return;
      }
      if (downloading) return;
      if (candidate) {
        e.preventDefault();
        e.stopPropagation();
        setCandidate(null);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [enlarged, candidate, downloading, onCancel]);

  const previewName = candidate?.title || candidate?.url.split('/').pop() || 'Neues Bild';
  const previewDims = candidate?.width && candidate?.height ? `${candidate.width} × ${candidate.height}px` : '—';
  const previewSource = candidate ? SOURCE_LABEL[candidate.source] : '';

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
          <button className="be-icon-btn" onClick={onCancel} aria-label="Schließen" disabled={downloading}>✕</button>
        </div>

        <div className="replace-modal-subfolder">
          {allFolderPaths.length > 0 ? (
            <label>
              Unterordner:
              <select
                value={subfolder}
                onChange={e => setSubfolder(e.target.value)}
                disabled={downloading}
              >
                <option value="">— (Hauptordner)</option>
                {allFolderPaths.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          ) : (
            <span />
          )}
          {renderBox && (
            <ImageSearchFilterToggle
              checked={hideSmallerResults}
              onChange={setHideSmallerResults}
              hiddenCount={hiddenCount}
            />
          )}
        </div>

        <div className="replace-modal-body">
          <ImageSearchPanel
            defaultQuery=""
            renderBox={renderBox}
            selectedUrl={candidate?.url}
            busyUrl={downloading ? candidate?.url : undefined}
            onSelect={handleSelect}
            onSearch={handleSearchSubmit}
            hideSmallerResults={hideSmallerResults}
            onHideSmallerResultsChange={setHideSmallerResults}
            renderFilterToggle={false}
            onHiddenCountChange={setHiddenCount}
          />
        </div>

        {candidate && (
          <div className="replace-compare replace-compare--single">
            <div className="replace-compare-pane">
              <div className="replace-compare-label">Vorschau</div>
              <img
                src={candidate.url}
                alt={previewName}
                referrerPolicy="no-referrer"
                className="replace-compare-img"
                onClick={() => setEnlarged({ src: candidate.url, name: previewName })}
                title="Größer anzeigen"
              />
              <div className="replace-compare-meta">
                {previewDims} · Quelle: {previewSource}
                {candidate.title ? ` · ${candidate.title}` : ''}
              </div>
            </div>
          </div>
        )}

        {enlarged && createPortal(
          <div className="modal-overlay" onClick={() => setEnlarged(null)}>
            <div className="image-lightbox" onClick={e => e.stopPropagation()}>
              <div className="image-lightbox-header">
                <span className="image-lightbox-name">🖼 {enlarged.name}</span>
                <button className="be-icon-btn" onClick={() => setEnlarged(null)} aria-label="Schließen">✕</button>
              </div>
              <div className="image-lightbox-body">
                <img src={enlarged.src} alt={enlarged.name} referrerPolicy="no-referrer" />
              </div>
            </div>
          </div>,
          document.body,
        )}

        {error && <div className="replace-error">{error}</div>}

        <div className="replace-modal-actions">
          <button className="be-btn-secondary" onClick={onCancel} disabled={downloading}>
            Abbrechen
          </button>
          {candidate && (
            <button
              className="be-btn-primary"
              onClick={handleConfirm}
              disabled={downloading}
            >
              {downloading ? 'Lade…' : '✓ Herunterladen'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
