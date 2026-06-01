import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';
import type { GamemasterAnswerData, GamemasterControlsData } from '@/types/game';

const mockAnswer: { current: GamemasterAnswerData | null } = { current: null };
const mockControls: { current: GamemasterControlsData | null } = { current: null };

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

function renderView(props?: { showNextAnswer?: boolean }) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView showNextAnswer={props?.showNextAnswer} />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('GamemasterView — next-answer preview', () => {
  beforeEach(() => {
    mockAnswer.current = {
      gameTitle: 'Allgemeinwissen',
      answer: 'Nil',
      questionNumber: 3,
      totalQuestions: 10,
      nextAnswer: { question: 'Wie viele Planeten?', answer: '8' },
    };
    mockControls.current = { controls: [], answerRevealed: true };
  });

  it('shows the next answer + question when revealed and the toggle is on (default)', () => {
    renderView();
    const block = document.querySelector('.gamemaster-next');
    expect(block).not.toBeNull();
    expect(block?.textContent).toContain('Nächste Frage');
    expect(document.querySelector('.gamemaster-next-question')?.textContent).toBe('Wie viele Planeten?');
    expect(document.querySelector('.gamemaster-next-answer')?.textContent).toBe('8');
  });

  it('hides the preview when the toggle is off', () => {
    renderView({ showNextAnswer: false });
    expect(document.querySelector('.gamemaster-next')).toBeNull();
  });

  it('hides the preview while the answer is not yet revealed', () => {
    mockControls.current = { controls: [], answerRevealed: false };
    renderView();
    expect(document.querySelector('.gamemaster-next')).toBeNull();
  });

  it('hides the preview on the last question (no nextAnswer)', () => {
    mockAnswer.current = {
      gameTitle: 'Allgemeinwissen',
      answer: 'Nil',
      questionNumber: 10,
      totalQuestions: 10,
    };
    renderView();
    expect(document.querySelector('.gamemaster-next')).toBeNull();
  });

  it('omits the question line when the next answer has no question text', () => {
    mockAnswer.current = {
      gameTitle: 'Bandle',
      answer: 'Song A',
      questionNumber: 2,
      totalQuestions: 6,
      nextAnswer: { answer: 'Song B' },
    };
    renderView();
    expect(document.querySelector('.gamemaster-next')).not.toBeNull();
    expect(document.querySelector('.gamemaster-next-question')).toBeNull();
    expect(document.querySelector('.gamemaster-next-answer')?.textContent).toBe('Song B');
  });
});
