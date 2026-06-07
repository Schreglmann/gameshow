import { useLayoutEffect } from 'react';

// Position the page so the `.quiz-container` card sits just below the sticky
// header (with a small margin) when it's taller than the viewport. Re-evaluates
// on `triggerKey` change and whenever the card's or header's height changes
// (audio metadata loading, images loading, answer reveal, phase transitions).
// Instant scroll — no smooth animation — so the first paint already shows the
// final position.
//
// Pass `triggerKey` as whatever should reset scroll: e.g. just `qIdx` for
// SimpleQuiz, or a combined `${qIdx}:${phase}` for games with multiple phases
// per question.
//
// `align` controls where an overflowing card is anchored:
//  - 'top' (default): card top sits just below the sticky header. Best when the
//    important content is at the top of the card.
//  - 'bottom': the card's *bottom* is brought into view (top may slide under the
//    header). Use when the actionable content — e.g. an inline scoring panel — is
//    at the bottom and must stay visible even when the card is far taller than the
//    viewport. Re-fires on height changes keep the bottom in view instead of
//    snapping back to the top.
export function useQuizAutoScroll(triggerKey: unknown, align: 'top' | 'bottom' = 'top'): void {
  useLayoutEffect(() => {
    const card = document.querySelector('.quiz-container') as HTMLElement | null;
    const header = document.querySelector('header') as HTMLElement | null;
    // Reset scroll on every trigger so measurements start from a known
    // baseline (rect.top + scrollY == absolute card top).
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    if (!card) return;
    const absoluteOffsetTop = (el: HTMLElement): number => {
      let top = 0;
      let node: HTMLElement | null = el;
      while (node) {
        top += node.offsetTop;
        node = node.offsetParent as HTMLElement | null;
      }
      return top;
    };
    const applyScroll = () => {
      const headerH = header?.offsetHeight ?? 0;
      // Use offsetTop/offsetHeight instead of getBoundingClientRect — the card
      // has a `scaleIn` CSS animation on mount and getBoundingClientRect
      // reports transformed coordinates, which are smaller/shifted during the
      // animation. offsetTop/offsetHeight give the final layout dimensions.
      const cardTop = absoluteOffsetTop(card);
      const cardH = card.offsetHeight;
      const overflow = cardTop + cardH - window.innerHeight;
      const maxScroll = Math.max(0, cardTop - headerH - 8);
      // Card fits — leave scroll alone.
      if (overflow <= 0) return;
      // 'bottom': scroll so the card's bottom (the scoring panel) comes just
      // into view, even if the top slides under the header. No maxScroll cap —
      // that cap is what keeps the bottom hidden on a very tall card.
      // 'top' (default): cap at maxScroll so the card top stays just below the
      // sticky header; when only slightly taller, `overflow + 16` brings the
      // bottom just into view.
      const target = Math.round(
        align === 'bottom' ? overflow + 16 : Math.min(overflow + 16, maxScroll),
      );
      if (Math.abs(window.scrollY - target) > 0.5) {
        window.scrollTo({ top: target, behavior: 'instant' as ScrollBehavior });
      }
    };
    applyScroll();
    // Observe both the card and the header — jokers render asynchronously on
    // first paint and the header's height settles after the card's. Without
    // observing the header, the first scroll uses an undersized header and
    // the example question ends up at a different offset than subsequent
    // ones, where the header is already at its final size.
    const observer = new ResizeObserver(applyScroll);
    observer.observe(card);
    if (header) observer.observe(header);
    return () => observer.disconnect();
  }, [triggerKey, align]);
}
