import { useLayoutEffect, useRef } from 'react';

// Font-size steps (fractions of the heading's CSS size) tried in order — the
// first one whose wrapped text fits the heading box wins, so a short name keeps
// the full size and only a long one shrinks. Everything down to 0.6 is still one
// line; 0.5 and 0.4 buy a SECOND line inside the same box. The floor is where
// the name stops being readable from the back of the room — below it the name
// truncates instead.
const STEPS = [1, 0.86, 0.72, 0.6, 0.5, 0.4];

/**
 * Fits a team card heading into the one line of height every card gets.
 *
 * Team names are free text, so one can be far longer than its card. The heading
 * box is pinned to a single full-size line (`.team-card-name`), which is what
 * keeps the rosters of all the cards in a row starting at the same height. At
 * the full heading size that line is barely a dozen characters, and a
 * clamped line that has to truncate can come out as nothing but the ellipsis
 * (Chrome drops the text of a truncated line when its only break opportunities
 * come from `overflow-wrap: anywhere`) — which is how a long name managed to
 * disappear completely.
 *
 * So instead of truncating at full size, the name steps DOWN through `STEPS`
 * until it fits the box, and the line clamp is recomputed for the size that won:
 * a name too long for one full-size line becomes two half-size lines in exactly
 * the same box. Only a name that still overflows at the floor truncates, and it
 * is marked `data-name-clipped` so the stylesheet can switch it to
 * `word-break: break-all` — which truncates with text in front of the ellipsis
 * instead of swallowing the line.
 *
 * The ref goes on the text span; its parent (the `<h2>`) is the box, and the one
 * the size is written to — the colour dot is a sibling of the span and has to
 * scale with the name. The header pill has its own, width-based variant of this
 * — `TeamHeaderName`. See specs/team-management.md.
 */
export function useFitTeamName(name: string) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;

    const fit = () => {
      // Start from the stylesheet's own size/clamp so a re-fit is never biased
      // by the previous one (the fluid heading size moves with the viewport).
      // The size goes on the HEADING, not the span, so the colour dot beside it
      // scales along with the name.
      box.style.fontSize = '';
      box.style.height = '';
      el.style.setProperty('-webkit-line-clamp', '1');
      el.style.setProperty('line-clamp', '1');
      delete el.dataset.nameClipped;
      // No measurable box (hidden, pre-layout, jsdom) — leave the CSS as is.
      if (!el.clientWidth) return;

      // One line of the UNSHRUNK name, whatever the theme's font makes that —
      // the clamp above means this is one line box even for a long name. It is
      // both the height budget and, pinned onto the heading, what keeps every
      // card in the row the same height however far its own name had to shrink.
      const oneLine = el.getBoundingClientRect().height;
      const basePx = parseFloat(getComputedStyle(box).fontSize);
      if (!oneLine || !basePx) return;
      box.style.height = `${oneLine}px`;

      // Measure unclamped — a clamped box reports no overflow at all.
      el.style.setProperty('-webkit-line-clamp', 'none');
      el.style.setProperty('line-clamp', 'none');
      let scale = 1;
      let fits = false;
      for (const step of STEPS) {
        scale = step;
        box.style.fontSize = `${basePx * step}px`;
        fits = el.scrollHeight <= oneLine + 1;
        if (fits) break;
      }

      // How many lines of the chosen size the box holds (one at full size, two
      // at the half-size steps) — the clamp that puts the ellipsis on the last
      // line that is actually visible. A line box scales with the font, so the
      // fitted one is `oneLine * scale`.
      const lines = Math.max(1, Math.floor((oneLine + 1) / (oneLine * scale)));
      el.style.setProperty('-webkit-line-clamp', String(lines));
      el.style.setProperty('line-clamp', String(lines));
      if (!fits) el.dataset.nameClipped = 'true';
    };

    fit();

    // The first fit can run on the FALLBACK font (the theme's web font is still
    // loading), whose metrics differ enough to pick the wrong step — and the
    // swap resizes no box the observer below watches, so re-fit once the real
    // font is in. Same reason `isTeamNameLong` waits for it.
    let cancelled = false;
    if (typeof document !== 'undefined' && document.fonts && document.fonts.status !== 'loaded') {
      void document.fonts.ready.then(() => { if (!cancelled) fit(); });
    }

    // Re-fit when the card is resized (viewport, team count, roster changes).
    // Observe the CARD: the fit writes the heading's font-size and height, so
    // watching the heading itself would feed back into it.
    const card = box.parentElement;
    if (typeof ResizeObserver === 'undefined' || !card) return () => { cancelled = true; };
    const ro = new ResizeObserver(fit);
    ro.observe(card);
    return () => { cancelled = true; ro.disconnect(); };
  }, [name]);

  return ref;
}
