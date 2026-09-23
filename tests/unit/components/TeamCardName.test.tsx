import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import TeamCardName from '@/components/common/TeamCardName';

// jsdom lays nothing out, so the fit is driven by a stubbed text metric: a
// character is half the font size wide, a line box 1.2× the font size tall, and
// the name wraps into as many lines as the (fixed) box width needs. That is
// enough to exercise the real decision — which step is picked and how many
// lines the box then holds. See specs/team-management.md.
const BOX_WIDTH = 200;

function stubLayout(boxWidth = BOX_WIDTH) {
  const spanOf = () => document.querySelector<HTMLElement>('.team-card-name-text')!;
  const headingOf = () => document.querySelector<HTMLElement>('.team-card-name')!;

  // Base size: what the stylesheet would give the heading (jsdom resolves no
  // CSS, so the hook's own `getComputedStyle` read has to be answered too).
  const BASE = 40;
  const fontSize = () => parseFloat(headingOf().style.fontSize || `${BASE}px`);
  const realComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) =>
    (el as HTMLElement).classList?.contains('team-card-name') && !pseudo
      ? ({ fontSize: `${BASE}px` } as CSSStyleDeclaration)
      : realComputedStyle(el as Element, pseudo));
  const lines = () => {
    const perLine = Math.max(1, Math.floor(boxWidth / (fontSize() * 0.5)));
    return Math.ceil((spanOf().textContent ?? '').length / perLine);
  };

  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(boxWidth);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    // Only the span is measured; the clamp caps how many lines are visible.
    const clamp = this.style.getPropertyValue('-webkit-line-clamp');
    const visible = clamp && clamp !== 'none' ? Math.min(lines(), parseInt(clamp, 10)) : lines();
    return Math.round(visible * fontSize() * 1.2);
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { height: this.scrollHeight, width: boxWidth } as DOMRect;
  });
  return { spanOf, headingOf, BASE };
}

describe('TeamCardName', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('renders the full name — the text is never shortened in the DOM', () => {
    render(<TeamCardName team="team1" name="Donaudampfschifffahrtsgesellschaft" />);
    expect(screen.getByRole('heading')).toHaveTextContent('Donaudampfschifffahrtsgesellschaft');
  });

  it('leaves a name that already fits at the full heading size', () => {
    const { headingOf, spanOf, BASE } = stubLayout();
    render(<TeamCardName team="team1" name="Team 1" />);
    expect(headingOf().style.fontSize).toBe(`${BASE}px`);
    expect(spanOf().style.getPropertyValue('-webkit-line-clamp')).toBe('1');
    expect(spanOf().dataset.nameClipped).toBeUndefined();
  });

  it('shrinks a long name and gives it the lines the smaller size fits', () => {
    const { headingOf, spanOf, BASE } = stubLayout();
    render(<TeamCardName team="team1" name="Die unglaublichen Superhirne" />);
    const fitted = parseFloat(headingOf().style.fontSize);
    expect(fitted).toBeLessThan(BASE);
    // Two lines of the fitted size fit the one-line box only at half size.
    expect(Number(spanOf().style.getPropertyValue('-webkit-line-clamp'))).toBeGreaterThan(1);
    expect(spanOf().dataset.nameClipped).toBeUndefined();
  });

  it('pins the heading to one full-size line, whatever the name did', () => {
    const { headingOf, BASE } = stubLayout();
    render(<TeamCardName team="team1" name="Die absolut unbesiegbaren Adler vom Nordhang" />);
    expect(headingOf().style.height).toBe(`${Math.round(BASE * 1.2)}px`);
  });

  it('marks a name that overflows even at the smallest step', () => {
    const { spanOf } = stubLayout();
    render(<TeamCardName team="team1" name={'x'.repeat(400)} />);
    expect(spanOf().dataset.nameClipped).toBe('true');
  });
});
