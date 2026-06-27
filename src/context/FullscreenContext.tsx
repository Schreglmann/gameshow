import { createContext, useContext, useEffect, useRef, type RefObject } from 'react';

/**
 * Fullscreen-overlay coordination context.
 *
 * This is a *local UI-coordination* context (like ThemeContext /
 * AudioCoverMetaContext), NOT app/game state — it carries no team/points/
 * settings data, so it does not belong in GameContext.
 *
 * `BaseGameWrapper` owns the state and provides the value; any descendant game
 * component (however deeply nested — e.g. the shared `QuizQuestionView`) can:
 *   - declare the media currently on screen via `useRegisterFullscreenMedia`,
 *     which makes the gamemaster "Vollbild" toggle appear, and
 *   - open the overlay on an on-show click via `useFullscreen().open()`.
 * The gamemaster toggles the very same overlay through the `toggle-fullscreen`
 * command handled in `BaseGameWrapper`. See specs/gamemaster-fullscreen.md.
 */

export type FullscreenMedia =
  | { type: 'image'; src: string }
  | { type: 'video'; src: string; videoRef: RefObject<HTMLVideoElement | null> };

interface FullscreenContextValue {
  currentMedia: FullscreenMedia | null;
  isOpen: boolean;
  registerMedia: (media: FullscreenMedia | null) => void;
  /** Open the overlay. Pass explicit media to enlarge a specific clicked
   *  element; omit it to open the registered media (used by the GM toggle). */
  open: (media?: FullscreenMedia) => void;
  close: () => void;
  toggle: () => void;
}

const FullscreenContext = createContext<FullscreenContextValue | null>(null);

export const FullscreenProvider = FullscreenContext.Provider;

const NOOP_FULLSCREEN = {
  open: () => {},
  close: () => {},
  toggle: () => {},
  isOpen: false,
} as const;

/** Open/close/toggle the shared fullscreen overlay. Safe outside the provider (no-ops). */
export function useFullscreen(): { open: (media?: FullscreenMedia) => void; close: () => void; toggle: () => void; isOpen: boolean } {
  const ctx = useContext(FullscreenContext);
  if (!ctx) return NOOP_FULLSCREEN;
  return { open: ctx.open, close: ctx.close, toggle: ctx.toggle, isOpen: ctx.isOpen };
}

/**
 * Register the media currently visible on the show (or `null` when none).
 * Registers while mounted/visible and clears on unmount or when hidden, so the
 * gamemaster toggle is offered exactly while media is on screen. Safe outside
 * the provider (no-op).
 */
export function useRegisterFullscreenMedia(media: FullscreenMedia | null): void {
  const ctx = useContext(FullscreenContext);
  // The media object is a fresh literal each render; key the effect on its
  // stable identity (type + src) and read the latest object via a ref.
  const key = media ? `${media.type}|${media.src}` : null;
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const register = ctx?.registerMedia;

  useEffect(() => {
    if (!register) return;
    register(mediaRef.current);
    return () => register(null);
  }, [register, key]);
}
