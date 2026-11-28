import { describe, it, expect } from 'vitest';
import { layoutVenn, wrapVennLabel, VENN_WIDTH } from '@/utils/vennLayout';

describe('wrapVennLabel', () => {
  it('keeps a short name on one line', () => {
    expect(wrapVennLabel('Planet')).toEqual(['Planet']);
    expect(wrapVennLabel('  Römischer Gott ')).toEqual(['Römischer Gott']);
  });

  it('breaks a long name at the space nearest the middle', () => {
    expect(wrapVennLabel('Deutscher Bundeskanzler')).toEqual(['Deutscher', 'Bundeskanzler']);
    expect(wrapVennLabel('Nachname einer Sängerin')).toEqual(['Nachname einer', 'Sängerin']);
  });

  it('breaks after a hyphen and keeps the hyphen on the first line', () => {
    expect(wrapVennLabel('Harry-Potter-Schauspieler')).toEqual(['Harry-Potter-', 'Schauspieler']);
  });

  it('leaves a long compound without a break point on one line', () => {
    expect(wrapVennLabel('Programmiersprache')).toEqual(['Programmiersprache']);
  });
});

describe('layoutVenn', () => {
  it('places two circles side by side, overlapping, with the focus between them', () => {
    const layout = layoutVenn(['Planet', 'Schokoriegel']);
    expect(layout.circles).toHaveLength(2);
    const [a, b] = layout.circles as [typeof layout.circles[number], typeof layout.circles[number]];
    expect(a.cy).toBe(b.cy);
    expect(b.cx - a.cx).toBeLessThan(a.r + b.r); // they overlap
    expect(layout.focus[2]).toEqual({ x: VENN_WIDTH / 2, y: a.cy });
  });

  it('adds the third circle below, with the focus inside all three', () => {
    const layout = layoutVenn(['Planet', 'Schokoriegel', 'Römischer Gott']);
    expect(layout.circles).toHaveLength(3);
    const focus = layout.focus[3]!;
    for (const c of layout.circles) {
      expect(Math.hypot(focus.x - c.cx, focus.y - c.cy)).toBeLessThan(c.r);
    }
  });

  it('is taller for a question with a hint circle, whatever is revealed', () => {
    const two = layoutVenn(['A', 'B']);
    const three = layoutVenn(['A', 'B', 'C']);
    expect(three.height).toBeGreaterThan(two.height);
  });

  it('keeps every circle and label inside the canvas', () => {
    const layout = layoutVenn(['Programmiersprache', 'Stadt im Burgenland', 'Nachname einer Sängerin']);
    for (const c of layout.circles) {
      expect(c.cx - c.r).toBeGreaterThanOrEqual(0);
      expect(c.cx + c.r).toBeLessThanOrEqual(layout.width);
      expect(c.cy - c.r).toBeGreaterThanOrEqual(0);
      expect(c.cy + c.r).toBeLessThanOrEqual(layout.height);
      for (const y of c.label.ys) {
        expect(y - c.label.fontSize).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(layout.height);
      }
    }
  });

  it('shrinks the label font for a long single-line name', () => {
    const short = layoutVenn(['Planet', 'Insel']).circles[0]!.label.fontSize;
    const long = layoutVenn(['Programmiersprache', 'Insel']).circles[0]!.label.fontSize;
    expect(long).toBeLessThan(short);
  });

  it('ignores a fourth set', () => {
    expect(layoutVenn(['A', 'B', 'C', 'D']).circles).toHaveLength(3);
  });

  it('returns a pill only when there is a solution to show', () => {
    expect(layoutVenn(['A', 'B']).pill).toBeNull();
    const pill = layoutVenn(['A', 'B'], { solutionLabel: 'Mars' }).pill;
    expect(pill).not.toBeNull();
    expect(pill!.width).toBeLessThanOrEqual(VENN_WIDTH);
  });

  it('shrinks the pill font for a long answer instead of leaving the canvas', () => {
    const short = layoutVenn(['A', 'B'], { solutionLabel: 'Mars' }).pill!;
    const long = layoutVenn(['A', 'B'], { solutionLabel: 'Ein ziemlich langer Lösungsbegriff mit vielen Wörtern' }).pill!;
    expect(long.fontSize).toBeLessThan(short.fontSize);
    expect(long.width).toBeLessThanOrEqual(VENN_WIDTH);
  });
});
