// See specs/gamemaster-run-of-show.md — the show side of the jump-to-game panel.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { useShowNavigationCommands } from '@/hooks/useShowNavigationCommands';
import type { GamemasterCommand } from '@/types/game';

/** The listener registered by the hook, so tests can drive it directly. */
let handler: ((cmd: GamemasterCommand) => void) | null = null;

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterCommandListener: (h: (cmd: GamemasterCommand) => void) => { handler = h; },
}));

function Probe() {
  useShowNavigationCommands();
  const location = useLocation();
  return <div data-testid="loc">{location.pathname + location.search}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="*" element={<Probe />} />
      </Routes>
    </MemoryRouter>
  );
}

function send(controlId: string) {
  act(() => { handler?.({ controlId, timestamp: Date.now() }); });
}

function at() {
  return screen.getByTestId('loc').textContent;
}

describe('useShowNavigationCommands', () => {
  beforeEach(() => { handler = null; });

  it('navigates to each framing screen', () => {
    renderAt('/game?index=2');

    send('goto:home');
    expect(at()).toBe('/');

    send('goto:rules');
    expect(at()).toBe('/rules');

    send('goto:summary');
    expect(at()).toBe('/summary');
  });

  it('navigates to an arbitrary game index', () => {
    renderAt('/');

    send('goto:game-3');
    expect(at()).toBe('/game?index=3');

    // Jumping backwards works the same way — it is not a one-step-back path.
    send('goto:game-0');
    expect(at()).toBe('/game?index=0');
  });

  it('ignores commands it does not own', () => {
    renderAt('/summary');

    send('nav-forward');
    send('award-confirm');
    send('scroll-to:top');

    expect(at()).toBe('/summary');
  });

  it('drops a malformed game target rather than navigating somewhere undefined', () => {
    renderAt('/summary');

    send('goto:game-');
    send('goto:game-abc');
    send('goto:game--1');
    send('goto:elsewhere');

    expect(at()).toBe('/summary');
  });
});
