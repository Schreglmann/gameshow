import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ReplaceImageModal from './ReplaceImageModal';
// AssetPicker also imports this file. The cycle is safe: both sides only use
// the other's export while rendering, never while the module is evaluated.
import { PickerModal } from './AssetPicker';
import { RENDER_BOX_QUIZ, isLowResolution } from './assetFolders';
import { recordImageReplace, resolveReplacedImage, useImageSrc } from './replacedImages';

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
}

// Enlarged view of an image used in a game: swap the question's image through
// the picker, or AI-upscale the file. Shared by every image lightbox in the
// game editor — see specs/dam-image-replace.md "Ersetzen aus dem Frage-Editor".
export default function AssetImageLightbox({ path, onClose, onChange, canUpscale = true, renderBox }: Props) {
  const imageSrc = useImageSrc();
  const shownPath = resolveReplacedImage(path).path;
  const src = imageSrc(path);
  // Natural size, keyed by the src it was measured from so a reload re-measures.
  const [measured, setMeasured] = useState<{ src: string; w: number; h: number } | null>(null);
  const dims = measured && measured.src === src ? { w: measured.w, h: measured.h } : null;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [upscaleOpen, setUpscaleOpen] = useState(false);
  const lowerPath = shownPath.toLowerCase();
  const isSvg = lowerPath.endsWith('.svg');
  const box = renderBox ?? RENDER_BOX_QUIZ;
  // Only offered once the image is measured and would be upscaled in this
  // game's render box — the DAM's "Niedrige Auflösung" rule.
  const upscaleTarget = canUpscale && UPSCALE_EXTS.some(ext => lowerPath.endsWith(ext)) && dims && isLowResolution(dims, box)
    ? damImagePath(shownPath)
    : null;

  // The picker handles its own Esc (capture phase, stops propagation).
  useEffect(() => {
    if (pickerOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (upscaleOpen) setUpscaleOpen(false);
      else onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [pickerOpen, upscaleOpen, onClose]);

  return createPortal(
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div className={`image-lightbox${isSvg ? ' image-lightbox--svg' : ''}`} onClick={e => e.stopPropagation()}>
          <div className="image-lightbox-header">
            <span className="image-lightbox-name">🖼 {shownPath.split('/').pop()}</span>
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
