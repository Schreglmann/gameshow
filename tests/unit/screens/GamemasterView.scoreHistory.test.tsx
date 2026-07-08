import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';

const mockAnswer: { current: unknown } = {
  current: { gameTitle: 'Test Game', answer: 'A', questionNumber: 1, totalQuestions: 5 },
};
const mockControls: { current: unknown } = { current: null };
vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => mockAnswer.current,
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => () => {},
  requestShowReemit: () => {},
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

function renderGM() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function seedHistory() {
  localStorage.setItem('scoreHistory', JSON.stringify([
    { id: 'a', team: 'team1', delta: 3, pointsAfter: 3, ts: 1, gameIndex: 0 },
  ]));
}

function panel(): Element | null {
  return document.querySelector('.gm-score-history');
}

describe('GamemasterView — "Letzte Wertungen" visibility', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAnswer.current = { gameTitle: 'Test Game', answer: 'A', questionNumber: 1, totalQuestions: 5 };
    mockControls.current = null;
    seedHistory();
  });

  it('shows on the title (landing) screen', async () => {
    mockControls.current = { phase: 'landing' };
    renderGM();
    await waitFor(() => expect(panel()).not.toBeNull());
  });

  it('shows during a points-changing game (hideCorrectTracker set)', async () => {
    mockControls.current = { phase: 'game', hideCorrectTracker: true };
    renderGM();
    await waitFor(() => expect(panel()).not.toBeNull());
  });

  it('hides during a normal game (host awards at the end)', async () => {
    mockControls.current = { phase: 'game', hideCorrectTracker: false };
    renderGM();
    // Give effects a tick — the panel must NOT appear.
    await new Promise(r => setTimeout(r, 20));
    expect(panel()).toBeNull();
  });

  it('hides on the rules screen', async () => {
    mockControls.current = { phase: 'rules' };
    renderGM();
    await new Promise(r => setTimeout(r, 20));
    expect(panel()).toBeNull();
  });

  it('hides on the award-points screen', async () => {
    mockControls.current = { phase: 'points' };
    renderGM();
    await new Promise(r => setTimeout(r, 20));
    expect(panel()).toBeNull();
  });

  it('stays hidden with no active game/phase', async () => {
    mockControls.current = null;
    renderGM();
    await new Promise(r => setTimeout(r, 20));
    expect(panel()).toBeNull();
  });
});
