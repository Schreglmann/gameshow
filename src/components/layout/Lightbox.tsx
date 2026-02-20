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
      style={{
        display: 'flex',
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'rgba(0,0,0,0.9)',
        zIndex: 10000,
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'pointer',
      }}
      onClick={e => {
        e.stopPropagation();
        onClose();
      }}
    >
      <img
        src={src}
        alt=""
        style={{
          maxWidth: '90%',
          maxHeight: '90%',
          objectFit: 'contain',
          borderRadius: 15,
          boxShadow: '0 0 50px rgba(255,255,255,0.3)',
        }}
      />
    </div>
  );
}

/** Small hook to control the lightbox from game components. */
export function useLightbox() {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const openLightbox = useCallback((src: string) => setLightboxSrc(src), []);
  const closeLightbox = useCallback(() => setLightboxSrc(null), []);
  return { lightboxSrc, openLightbox, closeLightbox };
}
