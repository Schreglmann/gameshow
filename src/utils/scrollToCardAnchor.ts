import type { GamemasterScrollAnchor } from '@/types/game';

// Shared geometry for positioning the `.quiz-container` card in the viewport.
// Used both by `useQuizAutoScroll` (auto-anchoring on phase change) and by the
// gamemaster scroll-to commands handled in `BaseGameWrapper`.

// Small gap left between the sticky header and the card top when scrolling.
const HEADER_MARGIN = 8;

// CSS landmark the `answer` jump-point resolves to — the answer area shared by
// SimpleQuiz / BetQuiz / WerKenntMehr.
const ANSWER_SELECTOR = '.quiz-answer';

// Transform-safe absolute offset from the top of the document. We avoid
// getBoundingClientRect because the card runs a `scaleIn` mount animation and
// rect coordinates are transformed (smaller/shifted) mid-animation; the
// offsetTop chain reports final layout dimensions regardless.
export function absoluteOffsetTop(el: HTMLElement): number {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

// Which jump-points exist on the show right now — but only while the card
// actually overflows its viewport (scrolling a card that fits is pointless, and
// the GM toolbar hides the button row when this returns []). `top`/`bottom`
// always apply to an overflowing card; `answer` only when the `.quiz-answer`
// landmark is on screen.
export function detectShowScrollAnchors(): GamemasterScrollAnchor[] {
  const card = document.querySelector('.quiz-container') as HTMLElement | null;
  if (!card) return [];
  const overflow = absoluteOffsetTop(card) + card.offsetHeight - window.innerHeight;
  if (overflow <= 0) return [];
  const anchors: GamemasterScrollAnchor[] = ['top'];
  if (document.querySelector(ANSWER_SELECTOR)) anchors.push('answer');
  anchors.push('bottom');
  return anchors;
}

// Scroll the window to the requested jump-point. `top`/`bottom` go to the very
// top / bottom of the page; `answer` brings the answer area just below the
// sticky header (no-op when it isn't present).
export function scrollShowToAnchor(anchor: GamemasterScrollAnchor): void {
  if (anchor === 'top') {
    window.scrollTo({ top: 0, behavior: 'smooth' as ScrollBehavior });
    return;
  }
  if (anchor === 'bottom') {
    const max = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    window.scrollTo({ top: max, behavior: 'smooth' as ScrollBehavior });
    return;
  }
  const el = document.querySelector(ANSWER_SELECTOR) as HTMLElement | null;
  if (!el) return;
  const header = document.querySelector('header') as HTMLElement | null;
  const headerH = header?.offsetHeight ?? 0;
  const top = absoluteOffsetTop(el) - headerH - HEADER_MARGIN;
  window.scrollTo({ top: Math.max(0, Math.round(top)), behavior: 'smooth' as ScrollBehavior });
}
