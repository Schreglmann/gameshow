import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReplaceImageModal from './ReplaceImageModal';
// AssetPicker also imports this file. The cycle is safe: both sides only use
// the other's export while rendering, never while the module is evaluated.
import { PickerModal } from './AssetPicker';
import { RENDER_BOX_QUIZ, isLowResolution } from './assetFolders';
import { recordImageRename, recordImageReplace, resolveReplacedImage, useImageSrc } from './replacedImages';
import { moveAsset } from '@/services/backendApi';

/** Path relative to `images/` for a DAM image path like `/images/Logos/a.png`, else null. */
export function damImagePath(path: string | undefined): string | null {
  const m = path ? /^\/?images\/(.+)$/.exec(path) : null;
  return m?.[1] ?? null;
}

const UPSCALE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

interface Props {
  /** Raw logical image path, e.g. `/images/Logos/foo.png`. */
  path: string;
  onClose: () => void;
  /**
   * Sets the question's image to the path picked in "↻ Ersetzen" — the same
   * thing the image field's "Ändern" does. Without it there is no Ersetzen.
   */
  onChange?: (path: string) => void;
  /** Show "✨ Hochskalieren" (only for low-resolution DAM images in an upscalable format). */
  canUpscale?: boolean;
  /** Render box for the picker's online search and the upscale/replace modal. */
  renderBox?: { w: number; h: number };
  /** Pre-fills the picker's 🌐 Online search in "↻ Ersetzen" — question text or answer. */
  searchQuery?: string;
}

// Enlarged view of an image used in a game: swap the question's image through
// the picker, rename or AI-upscale the file. Shared by every image lightbox in
// the game editor — see specs/dam-image-replace.md "Ersetzen aus dem Frage-Editor".
export default function AssetImageLightbox({ path, onClose, onChange, canUpscale = true, renderBox, searchQuery }: Props) {
  const imageSrc = useImageSrc();
  const shownPath = resolveReplacedImage(path).path;
  const src = imageSrc(path);
  // Natural size, keyed by the src it was measured from so a reload re-measures.
  const [measured, setMeasured] = useState<{ src: string; w: number; h: number } | null>(null);
  const dims = measured && measured.src === src ? { w: measured.w, h: measured.h } : null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  // Inline rename of the file: the base name being typed (null = not editing).
  const [renameValue, setRenameValue] = useState<string | null>(null);
  const [renameError, setRenameError] = useState<string | null>(null);
  const renameBusy = useRef(false);
  const fileName = shownPath.split('/').pop() ?? shownPath;
  // Renaming changes the file for every game, so it follows Ersetzen's
  // read-only rule (`onChange`) and needs a DAM path.
  const renameTarget = onChange ? damImagePath(shownPath) : null;
  const lowerPath = shownPath.toLowerCase();
  const isSvg = lowerPath.endsWith('.svg');
  const box = renderBox ?? RENDER_BOX_QUIZ;
  // Only offered once the image is measured and would be upscaled in this
  // game's render box — the DAM's "Niedrige Auflösung" rule.
  const upscaleTarget = canUpscale && UPSCALE_EXTS.some(ext => lowerPath.endsWith(ext)) && dims && isLowResolution(dims, box)
    ? damImagePath(shownPath)
    : null;

  const cancelRename = () => { setRenameValue(null); setRenameError(null); };

  const commitRename = async () => {
    if (renameValue === null || renameBusy.current || !renameTarget) return;
    const ext = /\.[^.]+$/.exec(fileName)?.[0] ?? '';
    // Users edit the base name and the extension is kept. Retyping the same
    // extension is tolerated; any other dot ("Dr. Who") is part of the name.
    let base = renameValue.trim();
    if (ext && base.toLowerCase().endsWith(ext.toLowerCase())) base = base.slice(0, -ext.length).trim();
    if (!base || `${base}${ext}` === fileName) { cancelRename(); return; }
    if (/[/\\]/.test(base)) { setRenameError('Der Name darf kein „/“ oder „\\“ enthalten'); return; }
    const folder = renameTarget.includes('/') ? renameTarget.slice(0, renameTarget.lastIndexOf('/') + 1) : '';
    const to = `${folder}${base}${ext}`;
    renameBusy.current = true;
    try {
      await moveAsset('images', renameTarget, to);
      recordImageRename(renameTarget, to);
      cancelRename();
    } catch (e) {
      setRenameError((e as Error).message);
    } finally {
      renameBusy.current = false;
    }
  };

  // The picker handles its own Esc (capture phase, stops propagation).
  useEffect(() => {
    if (pickerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (upscaleOpen) setUpscaleOpen(false);
      else if (renameValue !== null) { setRenameValue(null); setRenameError(null); }
      else onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pickerOpen, upscaleOpen, renameValue, onClose]);

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className={`image-lightbox${isSvg ? ' image-lightbox--svg' : ''}`} onClick={e => e.stopPropagation()}>
          <div className="image-lightbox-header">
            {renameTarget ? (
              <span className="image-lightbox-name image-lightbox-name--media">
                <span className="image-lightbox-icon">🖼</span>
                {renameValue !== null ? (
                  <input
                    className="be-input asset-folder-rename-input"
                    value={renameValue}
                    autoFocus
                    aria-label="Dateiname"
                    aria-invalid={renameError ? true : undefined}
                    title={renameError ?? 'Enter speichert, Esc bricht ab'}
                    onChange={e => { setRenameValue(e.target.value); setRenameError(null); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
                      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); }
                    }}
                    onBlur={() => { if (!renameError) void commitRename(); }}
                  />
                ) : (
                  <span className="image-lightbox-filename">
                    <span
                      className="asset-file-name-text"
                      role="button"
                      tabIndex={0}
                      title="Klicken zum Umbenennen — alle Spiele, die das Bild nutzen, werden angepasst"
                      onClick={() => setRenameValue(fileName.replace(/\.[^.]+$/, ''))}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setRenameValue(fileName.replace(/\.[^.]+$/, '')); }
                      }}
                    >{fileName}</span>
                  </span>
                )}
              </span>
            ) : (
              <span className="image-lightbox-name">🖼 {fileName}</span>
            )}
            {renameError && <span className="image-lightbox-rename-error" role="alert" title={renameError}>{renameError}</span>}
            {dims && !isSvg && <span className="image-lightbox-dims">{dims.w} × {dims.h}px</span>}
            {onChange && (
              <button
                className="be-icon-btn"
                style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                onClick={() => setPickerOpen(true)}
                title="Anderes Bild für diese Frage wählen — DAM, Online-Suche oder Einfügen"
                aria-label="Ersetzen"
              >↻ Ersetzen</button>
            )}
            {upscaleTarget && (
              <button
                className="be-icon-btn"
                style={{ fontSize: 'var(--admin-sz-11, 11px)' }}
                onClick={() => setUpscaleOpen(true)}
                title="Bild mit lokaler AI hochskalieren"
                aria-label="Hochskalieren"
              >✨ Hochskalieren</button>
            )}
            <button className="be-icon-btn" onClick={onClose} aria-label="Schließen">✕</button>
          </div>
          <div className="image-lightbox-body">
            <img
              src={src}
              alt=""
              onLoad={e => {
                const img = e.currentTarget;
                if (src) setMeasured({ src, w: img.naturalWidth, h: img.naturalHeight });
              }}
            />
          </div>
        </div>
      </div>
      {pickerOpen && onChange && (
        <PickerModal
          category="images"
          renderBox={renderBox}
          searchQuery={searchQuery}
          onSelect={url => {
            setPickerOpen(false);
            onChange(url);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {upscaleOpen && upscaleTarget && (
        <ReplaceImageModal
          target={upscaleTarget}
          initialTab="ai"
          currentDims={dims}
          renderBox={box}
          onCancel={() => setUpscaleOpen(false)}
          onReplaced={result => {
            recordImageReplace(result.target, result.newFilename, result.version);
            setUpscaleOpen(false);
          }}
        />
      )}
    </>,
    document.body,
  );
}
