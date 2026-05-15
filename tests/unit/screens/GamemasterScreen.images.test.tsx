import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterScreen from '@/components/screens/GamemasterScreen';
import type { GamemasterAnswerData } from '@/types/game';

const sendCommandMock = vi.fn();

const answerWithImage: GamemasterAnswerData = {
  gameTitle: 'Test',
  questionNumber: 1,
  totalQuestions: 5,
  question: 'Was?',
  answer: 'Tesla',
  answerImage: '/images/tesla.jpg',
};

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => answerWithImage,
  useGamemasterControls: () => null,
  useSendGamemasterCommand: () => sendCommandMock,
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

function renderScreen() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterScreen />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('GamemasterScreen — answer-images toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    sendCommandMock.mockClear();
  });

  it('hides answer images by default and shows the toggle in "hidden" state', () => {
    renderScreen();

    const toggle = screen.getByRole('button', { name: 'Bilder einblenden' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    expect(screen.queryByAltText('Antwort')).toBeNull();
  });

  it('reveals the answer image when the toggle is clicked, and persists the choice', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: 'Bilder einblenden' }));

    const onToggle = screen.getByRole('button', { name: 'Bilder ausblenden' });
    expect(onToggle.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('gm-show-answer-images')).toBe('true');

    expect(screen.getByAltText('Antwort')).toBeInstanceOf(HTMLImageElement);
  });

  it('restores "visible" state from localStorage', () => {
    localStorage.setItem('gm-show-answer-images', 'true');
    renderScreen();

    const toggle = screen.getByRole('button', { name: 'Bilder ausblenden' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    expect(screen.getByAltText('Antwort')).toBeInstanceOf(HTMLImageElement);
  });
});
