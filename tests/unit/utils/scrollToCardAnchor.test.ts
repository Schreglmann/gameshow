import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { absoluteOffsetTop, detectShowScrollAnchors, scrollShowToAnchor } from '@/utils/scrollToCardAnchor';

// offsetTop / offsetHeight are read-only in jsdom — define them explicitly.
function defineGeom(el: HTMLElement, top: number, height: number) {
  Object.defineProperty(el, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: height, configurable: true });
  Object.defineProperty(el, 'offsetParent', { value: null, configurable: true });
}

// Build a show DOM: <header> + <div.quiz-container> optionally containing
// .quiz-answer and/or .bet-quiz-host-panel landmarks.
function setupDom(opts: {
  cardTop: number;
  cardH: number;
  headerH: number;
  viewportH: number;
  answer?: boolean;
  scrollHeight?: number;
}) {
  const answerHtml = opts.answer ? '<div class="quiz-answer"></div>' : '';
  document.body.innerHTML = `<header></header><div class="quiz-container">${answerHtml}</div>`;
  const header = document.querySelector('header') as HTMLElement;
  const card = document.querySelector('.quiz-container') as HTMLElement;
  Object.defineProperty(header, 'offsetHeight', { value: opts.headerH, configurable: true });
  defineGeom(card, opts.cardTop, opts.cardH);
  const answer = document.querySelector('.quiz-answer') as HTMLElement | null;
  // Landmark offsetTop is relative to the card (its offsetParent); set a chain.
  if (answer) {
    Object.defineProperty(answer, 'offsetTop', { value: 40, configurable: true });
    Object.defineProperty(answer, 'offsetParent', { value: card, configurable: true });
  }
  Object.defineProperty(window, 'innerHeight', { value: opts.viewportH, configurable: true });
  Object.defineProperty(document.documentElement, 'scrollHeight', {
    value: opts.scrollHeight ?? opts.cardTop + opts.cardH,
    configurable: true,
  });
}

describe('scrollToCardAnchor', () => {
  const originalScrollTo = window.scrollTo;
  let scrollCalls: Array<{ top: number }>;

  beforeEach(() => {
    scrollCalls = [];
    window.scrollTo = ((arg: ScrollToOptions | number) => {
      const top = typeof arg === 'number' ? arg : (arg.top ?? 0);
      scrollCalls.push({ top });
    }) as typeof window.scrollTo;
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    document.body.innerHTML = '';
  });

  describe('absoluteOffsetTop', () => {
    it('sums the offsetTop chain', () => {
      setupDom({ cardTop: 150, cardH: 300, headerH: 90, viewportH: 700, answer: true });
      const answer = document.querySelector('.quiz-answer') as HTMLElement;
      // 40 (answer) + 150 (card) = 190
      expect(absoluteOffsetTop(answer)).toBe(190);
    });
  });

  describe('detectShowScrollAnchors', () => {
    it('returns [] when the card fits the viewport', () => {
      setupDom({ cardTop: 150, cardH: 300, headerH: 90, viewportH: 700, answer: true });
      expect(detectShowScrollAnchors()).toEqual([]);
    });

    it('returns top + bottom for an overflowing card with no answer landmark', () => {
      setupDom({ cardTop: 150, cardH: 800, headerH: 90, viewportH: 700 });
      expect(detectShowScrollAnchors()).toEqual(['top', 'bottom']);
    });

    it('includes answer when the .quiz-answer landmark is present', () => {
      setupDom({ cardTop: 150, cardH: 800, headerH: 90, viewportH: 700, answer: true });
      expect(detectShowScrollAnchors()).toEqual(['top', 'answer', 'bottom']);
    });

    it('returns [] when no card is present', () => {
      document.body.innerHTML = '';
      expect(detectShowScrollAnchors()).toEqual([]);
    });
  });

  describe('scrollShowToAnchor', () => {
    it('scrolls top to the very top of the page (0)', () => {
      setupDom({ cardTop: 150, cardH: 800, headerH: 90, viewportH: 700 });
      scrollShowToAnchor('top');
      expect(scrollCalls.at(-1)?.top).toBe(0);
    });

    it('scrolls bottom to the very bottom of the page (document scrollHeight)', () => {
      setupDom({ cardTop: 150, cardH: 800, headerH: 90, viewportH: 700, scrollHeight: 1500 });
      scrollShowToAnchor('bottom');
      expect(scrollCalls.at(-1)?.top).toBe(1500);
    });

    it('scrolls to the answer landmark below the header', () => {
      setupDom({ cardTop: 150, cardH: 800, headerH: 90, viewportH: 700, answer: true });
      scrollShowToAnchor('answer');
      // absoluteOffsetTop(answer)=190; 190 - 90 - 8 = 92
      expect(scrollCalls.at(-1)?.top).toBe(92);
    });

    it('is a no-op for answer when the landmark is absent', () => {
      setupDom({ cardTop: 150, cardH: 800, headerH: 90, viewportH: 700 });
      scrollShowToAnchor('answer');
      expect(scrollCalls).toEqual([]);
    });

    it('clamps a negative answer target to 0', () => {
      setupDom({ cardTop: 10, cardH: 800, headerH: 90, viewportH: 700, answer: true });
      // absoluteOffsetTop(answer)=10+40=50; 50 - 90 - 8 = -48 → clamped to 0
      scrollShowToAnchor('answer');
      expect(scrollCalls.at(-1)?.top).toBe(0);
    });
  });
});
