import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { useTeamNameCheck } from '@/hooks/useTeamNameCheck';

/**
 * The admin measures in a font it does not otherwise use, so the first check
 * starts the font download and `document.fonts.status` reads `loading` — the
 * plain check then answers `false` until something re-renders. The hook has to
 * re-render its component once `document.fonts.ready` resolves.
 */
describe('useTeamNameCheck', () => {
  const realFonts = Object.getOwnPropertyDescriptor(document, 'fonts');

  afterEach(() => {
    if (realFonts) Object.defineProperty(document, 'fonts', realFonts);
    else delete (document as { fonts?: unknown }).fonts;
  });

  function mockFonts(status: 'loading' | 'loaded') {
    let resolveReady!: () => void;
    const fonts = {
      status,
      ready: new Promise<void>(resolve => { resolveReady = () => { fonts.status = 'loaded'; resolve(); }; }),
    };
    Object.defineProperty(document, 'fonts', { configurable: true, value: fonts });
    return resolveReady;
  }

  function Probe({ onRender }: { onRender: (check: (n: string) => boolean) => void }) {
    const check = useTeamNameCheck({ jokerCount: 0, teamCount: 4, totalGames: 5, theme: 'pub-quiz' });
    onRender(check);
    return null;
  }

  it('re-renders with a fresh checker once the fonts have loaded', async () => {
    const resolveReady = mockFonts('loading');
    const renders: Array<(n: string) => boolean> = [];
    render(<Probe onRender={c => renders.push(c)} />);
    expect(renders).toHaveLength(1);
    await act(async () => { resolveReady(); await Promise.resolve(); });
    expect(renders.length).toBeGreaterThan(1);
    // A new function, so memoised consumers (the gamemaster controls) re-run it.
    expect(renders[renders.length - 1]).not.toBe(renders[0]);
  });

  it('does not re-render when the fonts are already loaded', async () => {
    mockFonts('loaded');
    const onRender = vi.fn();
    render(<Probe onRender={onRender} />);
    await act(async () => { await Promise.resolve(); });
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('answers like isTeamNameLong (false without layout)', () => {
    mockFonts('loaded');
    let check: ((n: string) => boolean) | undefined;
    render(<Probe onRender={c => { check = c; }} />);
    expect(check!('w'.repeat(40))).toBe(false);
    expect(check!('')).toBe(false);
  });
});
