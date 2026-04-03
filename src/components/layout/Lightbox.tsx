import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { notifyStreamStart, notifyStreamEnd } from '@/services/networkPriority';

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

interface VideoLightboxProps {
  src: string | null;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onClose: () => void;
}

/** Lightbox that shows an enlarged video synced with the source video element.
 *  The source video is muted while open; the enlarged copy carries audio. */
export function VideoLightbox({ src, videoRef, onClose }: VideoLightboxProps) {
  // On mount: mute source, sync enlarged; on unmount: unmute source
  const wasPlayingRef = useRef(false);
  const bigRef = useCallback((node: HTMLVideoElement | null) => {
    const small = videoRef.current;
    if (!node || !small) return;
    wasPlayingRef.current = !small.paused;
    node.currentTime = small.currentTime;
    small.muted = true;
    if (wasPlayingRef.current) node.play().catch(() => {});
  }, [videoRef]);

  // Unmute source on close
  useEffect(() => {
    if (!src) return;
    return () => {
      if (videoRef.current) videoRef.current.muted = false;
    };
  }, [src, videoRef]);

  useEffect(() => {
    if (!src) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [src, onClose]);

  // Keep enlarged video synced with source (source still plays muted for timeupdate markers)
  // + track network priority for the enlarged video
  useEffect(() => {
    if (!src) return;
    const small = videoRef.current;
    if (!small) return;

    let notified = false;
    const getBig = () => document.getElementById('videoLightboxPlayer') as HTMLVideoElement | null;
    const onTime = () => { const b = getBig(); if (b && Math.abs(b.currentTime - small.currentTime) > 0.5) b.currentTime = small.currentTime; };
    const onPlay = () => { getBig()?.play().catch(() => {}); if (!notified) { notifyStreamStart(); notified = true; } };
    const onPause = () => { getBig()?.pause(); if (notified) { notifyStreamEnd(); notified = false; } };
    const onSeek = () => { const b = getBig(); if (b) b.currentTime = small.currentTime; };
    small.addEventListener('timeupdate', onTime);
    small.addEventListener('play', onPlay);
    small.addEventListener('pause', onPause);
    small.addEventListener('seeked', onSeek);
    return () => {
      if (notified) notifyStreamEnd();
      small.removeEventListener('timeupdate', onTime);
      small.removeEventListener('play', onPlay);
      small.removeEventListener('pause', onPause);
      small.removeEventListener('seeked', onSeek);
    };
  }, [src, videoRef]);

  if (!src) return null;
  return createPortal(
    <div
      className="lightbox-overlay"
      onClick={e => { e.stopPropagation(); onClose(); }}
    >
      <div className="lightbox-frame">
        <video
          id="videoLightboxPlayer"
          ref={bigRef}
          src={src}
          className="lightbox-image"
          disablePictureInPicture
        />
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
