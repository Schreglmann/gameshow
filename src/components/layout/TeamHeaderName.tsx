import { useLayoutEffect, useRef } from 'react';

interface TeamHeaderNameProps {
  name: string;
}

// Font-size steps (em, relative to the header label). A long team name shrinks
// just enough to fit a few more characters before the ellipsis takes over —
// capped at 0.76em so it stays clearly readable ("a bit smaller", never tiny).
// Short names that already fit keep the full 1em (the loop stops at the first
// step that fits).
const STEPS = [1, 0.92, 0.84, 0.76];

/**
 * The team name span with adaptive sizing: when the name is too long to fit its
 * allocated width it steps the font down a little (bounded by STEPS) so a few
 * more characters show before `text-overflow: ellipsis` clips the rest.
 */
export default function TeamHeaderName({ name }: TeamHeaderNameProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const fit = () => {
      // Skip until the element has a measurable box (e.g. hidden / pre-layout).
      if (!el.clientWidth) return;
      for (const step of STEPS) {
        el.style.fontSize = `${step}em`;
        // scrollWidth = full text width at this size; clientWidth = box width.
        // Stop at the largest step that fits; the last step is the floor.
        if (el.scrollWidth <= el.clientWidth + 1) break;
      }
    };

    fit();

    // Re-fit when the surrounding cell is resized (viewport changes, the score
    // width changing as points grow, etc.). Observe the PARENT, not `el`:
    // mutating `el`'s font-size mustn't feed back into the observer.
    if (typeof ResizeObserver === 'undefined' || !el.parentElement) return;
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, [name]);

  return (
    <span ref={ref} className="team-header-name">
      {name}
    </span>
  );
}
