import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterScreen from '@/components/screens/GamemasterScreen';
import type { GamemasterAnswerData } from '@/types/game';

const sendCommandMock = vi.fn();

const answerData: GamemasterAnswerData = {
  gameTitle: 'Test',
  questionNumber: 1,
  totalQuestions: 5,
  question: 'Was?',
  answer: 'Tesla',
  answerImage: '/images/tesla.jpg',
};

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => answerData,
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

describe('GamemasterScreen — hide-answers toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    sendCommandMock.mockClear();
  });

  it('shows answers by default and offers to hide them', () => {
    renderScreen();

    const toggle = screen.getByRole('button', { name: 'Antworten verstecken' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    expect(document.querySelector('.gamemaster-answer')?.textContent).toBe('Tesla');
  });

  it('hides the answer when clicked, and persists the choice', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: 'Antworten verstecken' }));

    const onToggle = screen.getByRole('button', { name: 'Antworten zeigen' });
    expect(onToggle.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('gm-hide-answers')).toBe('true');

    expect(document.querySelector('.gamemaster-answer')?.textContent).toBe('Antworten versteckt');
    expect(document.body.textContent).not.toContain('Tesla');
  });

  it('restores "hidden" state from localStorage', () => {
    localStorage.setItem('gm-hide-answers', 'true');
    renderScreen();

    const toggle = screen.getByRole('button', { name: 'Antworten zeigen' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    expect(document.querySelector('.gamemaster-answer--hidden')).not.toBeNull();
  });

  it('hides the answer image even while "Bilder einblenden" is on', async () => {
    const user = userEvent.setup();
    localStorage.setItem('gm-show-answer-images', 'true');
    renderScreen();

    expect(screen.getByAltText('Antwort')).toBeInstanceOf(HTMLImageElement);

    await user.click(screen.getByRole('button', { name: 'Antworten verstecken' }));
    expect(screen.queryByAltText('Antwort')).toBeNull();
  });
});
