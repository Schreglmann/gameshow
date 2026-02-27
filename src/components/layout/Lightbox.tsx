import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface LightboxProps {
  src: string | null;
  onClose: () => void;
}

export function Lightbox({ src, onClose }: LightboxProps) {
  useEffect(() => {
    if (!src) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    // useCapture=true so this fires before the navigation listener
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [src, onClose]);

  if (!src) return null;
  return createPortal(
    <div
      id="imageLightbox"
      className="lightbox-overlay"
      onClick={e => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="lightbox-frame">
        <img src={src} alt="" className="lightbox-image" />
      </div>
    </div>,
    document.body
  );
}

/** Hook to control the lightbox from game components. */
export function useLightbox() {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const openLightbox = useCallback((src: string) => setLightboxSrc(src), []);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);
  return { lightboxSrc, openLightbox, closeLightbox };
}
