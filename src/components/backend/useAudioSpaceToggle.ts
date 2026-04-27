import { useEffect, type RefObject } from 'react';

// Mirrors VideoGuessForm's pattern: Space toggles play/pause on the player the
// user last interacted with, so multiple players on the page don't all fire
// together. Mousedown inside a registered container claims the slot; if no one
// holds it when a player mounts, the player claims it pre-emptively.
const activeAudioEditor: { current: HTMLElement | null } = { current: null };

export function useAudioSpaceToggle(
  containerRef: RefObject<HTMLElement | null>,
  toggle: () => void,
) {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (activeAudioEditor.current === null) activeAudioEditor.current = el;
    const onMouseDown = () => { activeAudioEditor.current = el; };
    el.addEventListener('mousedown', onMouseDown, true);
    return () => {
      el.removeEventListener('mousedown', onMouseDown, true);
      if (activeAudioEditor.current === el) activeAudioEditor.current = null;
    };
  }, [containerRef]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (activeAudioEditor.current !== containerRef.current) return;
      e.preventDefault();
      toggle();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [containerRef, toggle]);
}
