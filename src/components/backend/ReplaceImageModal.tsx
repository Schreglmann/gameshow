import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  replaceImageFromUrl,
  replaceImageFromFile,
  ApiError,
  type ImageSearchResult,
  type ImageReplaceResponse,
  type ImageReplaceResult,
} from '../../services/backendApi';
import ImageSearchPanel from './ImageSearchPanel';

// Modal for replacing an image's bytes in the DAM with a higher-res or
// better-fitting one. Three tabs:
//   - "Suchen"             — server-side search via DuckDuckGo / Wikimedia / OpenVerse
//   - "URL einfügen"       — paste any image URL (Google/Bing redirect-unwrapped server-side)
//   - "Datei / Einfügen"   — drag-and-drop, file picker, or Strg+V from clipboard
//
// Strg+V works on every tab — a document-level paste listener is mounted on
// open and removed on close so it doesn't collide with the global DAM
// paste-to-upload handler.

type Tab = 'search' | 'url' | 'file';

interface Props {
  target: string;                // relative path of the image being replaced, e.g. "Logos/foo.png"
  currentDims?: { w: number; h: number } | null;
  currentSizeBytes?: number;
  // Frontend render box for this image (1920×540 for quiz games, 1920×648 for
  // image-guess). Used by the resolution filter so it shares the predicate
  // with the DAM's "Niedrige Auflösung" filter — see specs/admin-backend.md.
  renderBox?: { w: number; h: number };
  onCancel: () => void;
  onReplaced: (result: ImageReplaceResult) => void;
}

interface Candidate {
  type: 'search' | 'url' | 'file';
  search?: ImageSearchResult;
  url?: string;
  file?: File;
  // local preview URL (object URL for file, candidate URL otherwise)
  previewUrl: string;
}

function deriveDefaultQuery(target: string): string {
  const base = target.split('/').pop() || target;
  return base
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function fmtBytes(n: number | undefined): string {
  if (!n || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDims(d: { w: number; h: number } | null | undefined): string {
  if (!d || (d.w === 0 && d.h === 0)) return '—';
  return `${d.w} × ${d.h}px`;
}

export default function ReplaceImageModal({
  target,
  currentDims,
  currentSizeBytes,
  renderBox,
  onCancel,
  onReplaced,
}: Props) {
  const [tab, setTab] = useState<Tab>('search');
  // Search panel state is now owned by <ImageSearchPanel>; only the picked
  // candidate flows back via onSelect. The low-res filter is lifted here so
  // the panel can render its inline toggle while the upload modal renders
  // an external one — both follow the same controlled-prop API.
  const defaultQuery = useMemo(() => deriveDefaultQuery(target), [target]);
  const [hideSmallerResults, setHideSmallerResults] = useState(true);

  const [urlInput, setUrlInput] = useState('');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [dryRun, setDryRun] = useState<ImageReplaceResult | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [smallerWarning, setSmallerWarning] = useState<{ oldDims: { w: number; h: number }; newDims: { w: number; h: number } } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [enlarged, setEnlarged] = useState<{ src: string; name: string } | null>(null);

  const dropzoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enlarged) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setEnlarged(null);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [enlarged]);

  // Revoke any object URLs we created when the candidate changes or unmounts.
  useEffect(() => {
    return () => {
      if (candidate?.type === 'file' && candidate.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(candidate.previewUrl);
      }
    };
  }, [candidate]);

  const clearCandidate = useCallback(() => {
    setCandidate(prev => {
      if (prev?.type === 'file' && prev.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
    setDryRun(null);
    setDryRunError(null);
    setSmallerWarning(null);
    setSubmitError(null);
  }, []);

  const pickCandidate = useCallback((next: Candidate) => {
    setCandidate(prev => {
      if (prev?.type === 'file' && prev.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return next;
    });
    setDryRun(null);
    setDryRunError(null);
    setSmallerWarning(null);
    setSubmitError(null);
  }, []);

  // Trigger a dryRun whenever a new candidate is picked.
  useEffect(() => {
    if (!candidate) return;
    let cancelled = false;
    (async () => {
      setDryRun(null);
      setDryRunError(null);
      setSmallerWarning(null);
      try {
        let resp: ImageReplaceResponse;
        if (candidate.type === 'file' && candidate.file) {
          resp = await replaceImageFromFile(target, candidate.file, { dryRun: true });
        } else if ((candidate.type === 'url' || candidate.type === 'search') && (candidate.url || candidate.search?.url)) {
          resp = await replaceImageFromUrl(target, (candidate.url || candidate.search!.url)!, { dryRun: true });
        } else {
          return;
        }
        if (cancelled) return;
        if ('noChange' in resp) {
          setDryRunError('Identischer Inhalt — Bytes sind gleich.');
          return;
        }
        setDryRun(resp);
      } catch (err) {
        if (cancelled) return;
        // Smaller-image is a 409; the structured body carries oldDims+newDims
        // so we can offer "Trotzdem ersetzen" without parsing the message.
        if (err instanceof ApiError) {
          const body = err.body as { error?: string; oldDims?: { w: number; h: number }; newDims?: { w: number; h: number } };
          if (body?.error === 'smaller' && body.oldDims && body.newDims) {
            setSmallerWarning({ oldDims: body.oldDims, newDims: body.newDims });
            return;
          }
        }
        setDryRunError((err as Error).message || 'Vorschau fehlgeschlagen.');
      }
    })();
    return () => { cancelled = true; };
  }, [candidate, target]);

  const handleUrlPick = useCallback(() => {
    if (!urlInput.trim()) return;
    pickCandidate({ type: 'url', url: urlInput.trim(), previewUrl: urlInput.trim() });
  }, [urlInput, pickCandidate]);

  const handleFile = useCallback((file: File) => {
    const previewUrl = URL.createObjectURL(file);
    pickCandidate({ type: 'file', file, previewUrl });
  }, [pickCandidate]);

  // The replace endpoint keeps the target's existing basename, so the search
  // term is intentionally ignored here. Clicking the already-selected
  // candidate deselects it (toggle), so the user can back out of a pick
  // without committing to one of the other results.
  const handleSearchPick = useCallback((r: ImageSearchResult, _query: string) => {
    if (candidate?.type === 'search' && candidate.search?.url === r.url) {
      clearCandidate();
      return;
    }
    pickCandidate({ type: 'search', search: r, previewUrl: r.thumbnailUrl || r.url });
  }, [candidate, pickCandidate, clearCandidate]);

  // Submitting a new search invalidates any current search-pick — the chosen
  // candidate may not even appear in the new result set.
  const handleSearchSubmit = useCallback(() => {
    if (candidate?.type === 'search') clearCandidate();
  }, [candidate, clearCandidate]);

  // Mount document-level paste listener while the modal is open.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          const f = item.getAsFile();
          if (f) {
            // Block the global DAM paste-to-upload handler from also firing.
            e.stopImmediatePropagation();
            e.preventDefault();
            handleFile(f);
            return;
          }
        }
      }
    };
    // useCapture: true so we run before the global handler attached on document.
    document.addEventListener('paste', onPaste, true);
    return () => document.removeEventListener('paste', onPaste, true);
  }, [handleFile]);

  // Drag-and-drop on the dropzone.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) handleFile(f);
  }, [handleFile]);

  const onConfirm = useCallback(async (force = false) => {
    if (!candidate) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      let resp: ImageReplaceResponse;
      if (candidate.type === 'file' && candidate.file) {
        resp = await replaceImageFromFile(target, candidate.file, { force });
      } else if ((candidate.type === 'url' || candidate.type === 'search') && (candidate.url || candidate.search?.url)) {
        resp = await replaceImageFromUrl(target, (candidate.url || candidate.search!.url)!, { force });
      } else {
        return;
      }
      if ('noChange' in resp) {
        setSubmitError('Identischer Inhalt — Bytes sind gleich.');
        return;
      }
      onReplaced(resp);
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [candidate, onReplaced, target]);

  const headerSummary = useMemo(() => {
    const parts = [target.split('/').pop() || target];
    if (currentDims) parts.push(fmtDims(currentDims));
    if (currentSizeBytes) parts.push(fmtBytes(currentSizeBytes));
    return parts.join('  ·  ');
  }, [target, currentDims, currentSizeBytes]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="replace-modal" onClick={e => e.stopPropagation()}>
        <div className="replace-modal-header">
          <span className="replace-modal-title">Bild ersetzen</span>
          <span className="replace-modal-subtitle">{headerSummary}</span>
          <button className="be-icon-btn" onClick={onCancel} aria-label="Schließen">✕</button>
        </div>
        <div className="replace-modal-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'search'}
            className={`replace-modal-tab${tab === 'search' ? ' is-active' : ''}`}
            onClick={() => setTab('search')}
          >Suchen</button>
          <button
            role="tab"
            aria-selected={tab === 'url'}
            className={`replace-modal-tab${tab === 'url' ? ' is-active' : ''}`}
            onClick={() => setTab('url')}
          >URL einfügen</button>
          <button
            role="tab"
            aria-selected={tab === 'file'}
            className={`replace-modal-tab${tab === 'file' ? ' is-active' : ''}`}
            onClick={() => setTab('file')}
          >Datei / Einfügen</button>
        </div>

        <div className="replace-modal-body">
          {tab === 'search' && (
            <>
              <ImageSearchPanel
                defaultQuery={defaultQuery}
                renderBox={renderBox}
                selectedUrl={candidate?.search?.url}
                onSelect={handleSearchPick}
                onSearch={handleSearchSubmit}
                hideSmallerResults={hideSmallerResults}
                onHideSmallerResultsChange={setHideSmallerResults}
              />
              <div className="replace-paste-hint">Tipp: Bild mit Strg+V direkt einfügen.</div>
            </>
          )}

          {tab === 'url' && (
            <div className="replace-url">
              <label className="replace-url-label">
                Bild-URL einfügen:
                <input
                  type="url"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="https://…"
                  className="replace-url-input"
                />
              </label>
              <button
                type="button"
                className="be-btn-primary"
                onClick={handleUrlPick}
                disabled={!urlInput.trim()}
              >Vorschau</button>
              <div className="replace-url-hint">
                Google- oder Bing-Suchergebnis-Links werden serverseitig entpackt.
              </div>
              <div className="replace-paste-hint">Tipp: Bild mit Strg+V direkt einfügen.</div>
            </div>
          )}

          {tab === 'file' && (
            <div className="replace-file">
              <div
                ref={dropzoneRef}
                className="replace-dropzone"
                onDragOver={onDragOver}
                onDrop={onDrop}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.accept = 'image/*';
                  input.onchange = () => { if (input.files?.[0]) handleFile(input.files[0]); };
                  input.click();
                }}
              >
                <span>Bild hierher ziehen, klicken zum Auswählen, oder Strg+V zum Einfügen</span>
              </div>
              <div className="replace-paste-hint">Tipp: Bild mit Strg+V direkt einfügen.</div>
            </div>
          )}
        </div>

        {/* Comparison + dry-run preview */}
        {candidate && (() => {
          const targetName = target.split('/').pop() || target;
          const currentSrc = `/images/${target}`;
          // For enlargement prefer the original full-resolution URL over the
          // thumbnail that drives the small comparison preview.
          const newFullSrc = candidate.search?.url || candidate.url || candidate.previewUrl;
          const newName =
            candidate.type === 'file' ? candidate.file?.name || 'Neues Bild'
            : candidate.search?.title || targetName;
          return (
            <div className="replace-compare">
              <div className="replace-compare-pane">
                <div className="replace-compare-label">Aktuell</div>
                <img
                  src={currentSrc}
                  alt="aktuell"
                  className="replace-compare-img"
                  onClick={() => setEnlarged({ src: currentSrc, name: targetName })}
                  title="Größer anzeigen"
                />
                <div className="replace-compare-meta">{fmtDims(currentDims)} · {fmtBytes(currentSizeBytes)}</div>
              </div>
              <div className="replace-compare-arrow" aria-hidden>→</div>
              <div className="replace-compare-pane">
                <div className="replace-compare-label">Neu</div>
                <img
                  src={candidate.previewUrl}
                  alt="neu"
                  referrerPolicy="no-referrer"
                  className="replace-compare-img"
                  onClick={() => setEnlarged({ src: newFullSrc, name: newName })}
                  title="Größer anzeigen"
                />
                <div className="replace-compare-meta">
                  {dryRun ? `${fmtDims(dryRun.newDims)} · ${fmtBytes(dryRun.newSize)}` : (smallerWarning ? fmtDims(smallerWarning.newDims) : 'Lade Vorschau…')}
                </div>
                {dryRun?.extensionChanged && (
                  <div className="replace-extension-warning">
                    ⚠ Format ändert sich. {dryRun.rewrittenGames > 0 ? `Spielreferenzen werden aktualisiert.` : ''}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

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

        {dryRunError && <div className="replace-error">{dryRunError}</div>}
        {smallerWarning && (
          <div className="replace-warning">
            Neues Bild ist kleiner ({fmtDims(smallerWarning.newDims)}) als das aktuelle ({fmtDims(smallerWarning.oldDims)}).
          </div>
        )}
        {submitError && <div className="replace-error">{submitError}</div>}

        <div className="replace-modal-actions">
          <button className="be-btn-secondary" onClick={onCancel} disabled={submitting}>Abbrechen</button>
          {smallerWarning ? (
            <button
              className="be-btn-warning"
              onClick={() => onConfirm(true)}
              disabled={!candidate || submitting}
            >
              {submitting ? 'Ersetze…' : 'Trotzdem ersetzen — neues Bild ist kleiner'}
            </button>
          ) : (
            <button
              className="be-btn-primary"
              onClick={() => onConfirm(false)}
              disabled={!candidate || submitting || !!dryRunError}
            >
              {submitting ? 'Ersetze…' : '✓ Ersetzen'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
