import { useLayoutEffect, useRef } from 'react';

interface TeamHeaderNameProps {
  name: string;
}

// Font-size steps (em, relative to the header label). A long team name shrinks
// just enough to fit a few more characters before the ellipsis takes over —
// capped at 0.76em so it stays clearly readable ("a bit smaller", never tiny).
// Short names that already fit keep the full 1em (the loop stops at the first
// step that fits). `NAME_MIN_FONT_SCALE` in utils/teamNames.ts mirrors the floor.
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

    // The first fit can run on the FALLBACK font (the theme's web font is still
    // loading), whose metrics differ enough to pick the wrong step — and the
    // swap resizes nothing the observer below watches. Re-fit once it is in.
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => { if (!cancelled) fit(); });
    }

    // Re-fit when the room for the name changes. Two boxes matter: the label
    // (viewport changes, the pill being capped or wrapping) and the name span
    // ITSELF — when the score grows to two digits the label keeps its width in a
    // capped pill and only the name's box shrinks, so watching the parent alone
    // left the name at its old size, cut shorter than it had to be. Observing
    // the span does not loop: a re-fit lands on the same step, so the box does
    // not change again and the observer stays quiet.
    if (typeof ResizeObserver === 'undefined') return () => { cancelled = true; };
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => { cancelled = true; ro.disconnect(); };
  }, [name]);

  return (
    <span ref={ref} className="team-header-name">
      {name}
    </span>
  );
}
