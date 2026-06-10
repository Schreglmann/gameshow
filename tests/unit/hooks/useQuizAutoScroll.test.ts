import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuizAutoScroll } from '@/hooks/useQuizAutoScroll';

// Set up DOM with `<header>` and `<div class="quiz-container">`, where the
// hook's measurement math comes out to a known cardTop / cardH / headerH.
// `offsetTop` / `offsetHeight` are read-only in jsdom, so we define them via
// Object.defineProperty.
function setupDom(opts: { cardTop: number; cardH: number; headerH: number; viewportH: number; answerTop?: number }) {
  const answerHtml = opts.answerTop !== undefined ? '<div class="quiz-answer"></div>' : '';
  document.body.innerHTML = `<header></header><div class="quiz-container">${answerHtml}</div>`;
  const header = document.querySelector('header') as HTMLElement;
  const card = document.querySelector('.quiz-container') as HTMLElement;
  Object.defineProperty(header, 'offsetHeight', { value: opts.headerH, configurable: true });
  Object.defineProperty(card, 'offsetTop', { value: opts.cardTop, configurable: true });
  Object.defineProperty(card, 'offsetHeight', { value: opts.cardH, configurable: true });
  Object.defineProperty(card, 'offsetParent', { value: null, configurable: true });
  const answer = document.querySelector('.quiz-answer') as HTMLElement | null;
  if (answer && opts.answerTop !== undefined) {
    // offsetTop relative to the card (its offsetParent).
    Object.defineProperty(answer, 'offsetTop', { value: opts.answerTop - opts.cardTop, configurable: true });
    Object.defineProperty(answer, 'offsetParent', { value: card, configurable: true });
  }
  Object.defineProperty(window, 'innerHeight', { value: opts.viewportH, configurable: true });
}

describe('useQuizAutoScroll', () => {
  const originalScrollTo = window.scrollTo;
  let scrollCalls: Array<{ top: number }>;

  beforeEach(() => {
    scrollCalls = [];
    window.scrollTo = ((arg: ScrollToOptions | number, _y?: number) => {
      const top = typeof arg === 'number' ? arg : (arg.top ?? 0);
      scrollCalls.push({ top });
      Object.defineProperty(window, 'scrollY', { value: top, configurable: true });
    }) as typeof window.scrollTo;
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
    // ResizeObserver is not implemented in jsdom; provide a no-op stub.
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    window.scrollTo = originalScrollTo;
    document.body.innerHTML = '';
  });

  it('does not scroll when the card fits the viewport', () => {
    setupDom({ cardTop: 150, cardH: 300, headerH: 90, viewportH: 700 });
    renderHook(() => useQuizAutoScroll('q1'));
    // First call is the reset to 0; no scroll past that.
    const after = scrollCalls.slice(1);
    expect(after).toEqual([]);
  });

  it('scrolls by `overflow + 16` when slightly taller than viewport', () => {
    // overflow = 150 + 300 - 400 = 50, maxScroll = 150 - 90 - 8 = 52
    // target = min(50 + 16, 52) = 52
    setupDom({ cardTop: 150, cardH: 300, headerH: 90, viewportH: 400 });
    renderHook(() => useQuizAutoScroll('q1'));
    const lastScroll = scrollCalls.at(-1);
    expect(lastScroll?.top).toBe(52);
  });

  it('caps at maxScroll when card is much taller than fits (was the BetQuiz bug)', () => {
    // overflow = 150 + 724 - 700 = 174, maxScroll = 150 - 90 - 8 = 52
    // OLD behavior: bailed because overflow > maxScroll, scrollY stayed at 0.
    // NEW behavior: target = min(174 + 16, 52) = 52.
    setupDom({ cardTop: 150, cardH: 724, headerH: 90, viewportH: 700 });
    renderHook(() => useQuizAutoScroll('q1'));
    const lastScroll = scrollCalls.at(-1);
    expect(lastScroll?.top).toBe(52);
  });

  it("align 'answer' scrolls the .quiz-answer just below the header", () => {
    // answer absolute top = 600; target = 600 - 90 - 8 = 502
    setupDom({ cardTop: 150, cardH: 900, headerH: 90, viewportH: 700, answerTop: 600 });
    renderHook(() => useQuizAutoScroll('q1:answer', 'answer'));
    expect(scrollCalls.at(-1)?.top).toBe(502);
  });

  it("align 'answer' is a no-op (stays at top) until .quiz-answer exists", () => {
    setupDom({ cardTop: 150, cardH: 900, headerH: 90, viewportH: 700 });
    renderHook(() => useQuizAutoScroll('q1:answer', 'answer'));
    // Only the reset-to-0 happened; no answer element to scroll to yet.
    expect(scrollCalls.slice(1)).toEqual([]);
  });

  it('resets scroll to 0 when triggerKey changes', () => {
    setupDom({ cardTop: 150, cardH: 300, headerH: 90, viewportH: 700 });
    const { rerender } = renderHook(({ key }: { key: string }) => useQuizAutoScroll(key), {
      initialProps: { key: 'q1' },
    });
    scrollCalls.length = 0;
    rerender({ key: 'q2' });
    expect(scrollCalls[0]?.top).toBe(0);
  });
});
