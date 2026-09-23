import { useEffect, type RefObject } from 'react';

/**
 * Publish the sticky header's rendered height as `--header-h` on `<html>`.
 *
 * The header is `position: sticky` with fluid `clamp()` padding and font size,
 * so its height is only known at runtime — and full-viewport `position: fixed`
 * theme layers need it to stop at the header instead of disappearing behind it
 * (the pub-quiz wooden frame's top bar is the reason this exists: without the
 * offset the content area was left open at the top).
 *
 * Measured with a `ResizeObserver`, so a viewport resize, a font swap or the
 * scrolled-state restyle all keep it accurate. Reset to `0px` on unmount: a
 * screen without a header must let those layers reach the top of the viewport.
 *
 * See specs/themes.md.
 */
export function useHeaderHeightVar(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    const root = document.documentElement;
    if (!el) {
      root.style.setProperty('--header-h', '0px');
      return;
    }
    const apply = () => root.style.setProperty('--header-h', `${el.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.setProperty('--header-h', '0px');
    };
  }, [ref]);
}
