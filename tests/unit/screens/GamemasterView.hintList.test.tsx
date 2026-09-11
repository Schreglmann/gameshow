import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';
import type { GamemasterAnswerData, GamemasterControlsData } from '@/types/game';

const mockAnswer: { current: GamemasterAnswerData | null } = { current: null };
const mockControls: { current: GamemasterControlsData | null } = { current: null };
const sendCommandMock = vi.fn();

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => mockAnswer.current,
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => sendCommandMock,
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

function renderView(hideAnswers?: boolean) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView hideAnswers={hideAnswers} />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

function hintTexts(): string[] {
  return Array.from(document.querySelectorAll('.gamemaster-hints .gamemaster-answer-text')).map(
    el => el.textContent ?? '',
  );
}

// A hint list is what the audience is looking at, not the solution — so unlike
// `answerList` it must not displace the plain answer. See specs/games/city-compass.md.
describe('GamemasterView — hint list', () => {
  beforeEach(() => {
    sendCommandMock.mockClear();
    mockAnswer.current = {
      gameTitle: 'Städte-Kompass',
      questionNumber: 2,
      totalQuestions: 8,
      question: 'Welche Stadt liegt im Zentrum?',
      answer: 'Wien · AT',
      hintList: [
        { rank: 1, text: 'Budapest · 210 km', revealed: true },
        { rank: 2, text: 'Prag · 250 km', revealed: true },
        { rank: 3, text: 'Berlin · 520 km', revealed: false },
      ],
    };
    mockControls.current = { controls: [], answerRevealed: false };
  });

  it('keeps the answer visible next to the hints', () => {
    renderView();

    expect(document.querySelector('.gamemaster-answer')?.textContent).toBe('Wien · AT');
    expect(hintTexts()).toEqual(['Budapest · 210 km', 'Prag · 250 km', 'Berlin · 520 km']);
    expect(document.querySelector('.gamemaster-hints-label')?.textContent).toBe('Hinweise');
  });

  it('marks each row by whether the audience already sees it', () => {
    renderView();

    const states = Array.from(document.querySelectorAll('.gamemaster-hints .gamemaster-answer-item')).map(
      el => (el.classList.contains('revealed') ? 'revealed' : 'pending'),
    );
    expect(states).toEqual(['revealed', 'revealed', 'pending']);
  });

  it('renders the rows as static elements, not reveal controls', () => {
    renderView();

    expect(document.querySelectorAll('.gamemaster-hints button')).toHaveLength(0);
    expect(document.querySelectorAll('.gamemaster-answer-item--static')).toHaveLength(3);
  });

  it('masks only the pending hints while answers are hidden', () => {
    renderView(true);

    // The revealed cities are on the projector already; the answer is not.
    expect(hintTexts()).toEqual(['Budapest · 210 km', 'Prag · 250 km', '•••••']);
    expect(document.querySelector('.gamemaster-answer--hidden')?.textContent).toBe('Antworten versteckt');
    expect(document.body.textContent).not.toContain('Wien');
  });

  it('leaves a plain answer alone when no hint list is present', () => {
    mockAnswer.current = { ...mockAnswer.current!, hintList: undefined };
    renderView();

    expect(document.querySelector('.gamemaster-hints')).toBeNull();
    expect(document.querySelector('.gamemaster-answer')?.textContent).toBe('Wien · AT');
  });
});
