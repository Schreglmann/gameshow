import { useState, useCallback } from 'react';

interface LightboxProps {
  src: string | null;
  onClose: () => void;
}

export function Lightbox({ src, onClose }: LightboxProps) {
  if (!src) return null;
  return (
    <div
      id="imageLightbox"
      className="lightbox-overlay"
      onClick={e => {
        e.stopPropagation();
        onClose();
      }}
    >
      <img src={src} alt="" className="lightbox-image" />
    </div>
  );
}

/** Hook to control the lightbox from game components. */
export function useLightbox() {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const openLightbox = useCallback((src: string) => setLightboxSrc(src), []);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);
  return { lightboxSrc, openLightbox, closeLightbox };
}
