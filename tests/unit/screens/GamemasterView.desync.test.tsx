import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';
import type { GamemasterAnswerData, GamemasterControlsData } from '@/types/game';

const mockAnswer: { current: GamemasterAnswerData | null } = { current: null };
const mockControls: { current: GamemasterControlsData | null } = { current: null };
const requestShowReemit = vi.fn();

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => mockAnswer.current,
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => () => {},
  requestShowReemit: () => requestShowReemit(),
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

function renderView() {
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

const banner = () => document.querySelector('.gm-desync-banner');

describe('GamemasterView — desync warning', () => {
  beforeEach(() => {
    requestShowReemit.mockClear();
    mockAnswer.current = null;
    mockControls.current = null;
  });

  it('shows the banner when the answer says a non-game screen but controls say in-game', () => {
    // The exact incident: stale "Startseite" answer while controls are phase 'game'.
    mockAnswer.current = { gameTitle: 'Game Show', answer: '', questionNumber: 0, totalQuestions: 0, screenLabel: 'Startseite' };
    mockControls.current = { controls: [], phase: 'game', gameIndex: 2 };
    renderView();
    expect(banner()).not.toBeNull();
  });

  it('clicking "Jetzt synchronisieren" requests a re-emit', () => {
    mockAnswer.current = { gameTitle: 'Game Show', answer: '', questionNumber: 0, totalQuestions: 0, screenLabel: 'Startseite' };
    mockControls.current = { controls: [], phase: 'game', gameIndex: 2 };
    renderView();
    const btn = banner()?.querySelector('button');
    expect(btn).not.toBeNull();
    fireEvent.click(btn!);
    expect(requestShowReemit).toHaveBeenCalledTimes(1);
  });

  it('no banner during a live game question (answer has no screenLabel)', () => {
    mockAnswer.current = { gameTitle: 'Allgemeinwissen', answer: 'Nil', question: 'Längster Fluss?', questionNumber: 3, totalQuestions: 10 };
    mockControls.current = { controls: [], phase: 'game', gameIndex: 2 };
    renderView();
    expect(banner()).toBeNull();
  });

  it('no banner on the genuine title screen (label matches phase landing)', () => {
    mockAnswer.current = { gameTitle: 'Allgemeinwissen', answer: '', questionNumber: 0, totalQuestions: 10, screenLabel: 'Titel' };
    mockControls.current = { controls: [], phase: 'landing', gameIndex: 2 };
    renderView();
    expect(banner()).toBeNull();
  });

  it('no banner during the points phase (label matches phase points)', () => {
    mockAnswer.current = { gameTitle: 'Allgemeinwissen', answer: '', questionNumber: 0, totalQuestions: 10, screenLabel: 'Punktevergabe' };
    mockControls.current = { controls: [], phase: 'points', gameIndex: 2 };
    renderView();
    expect(banner()).toBeNull();
  });

  it('no banner on the real home screen (no phase from controls)', () => {
    mockAnswer.current = { gameTitle: 'Game Show', answer: '', questionNumber: 0, totalQuestions: 0, screenLabel: 'Startseite' };
    mockControls.current = { controls: [] }; // home/rules/summary pass no phase
    renderView();
    expect(banner()).toBeNull();
  });
});
