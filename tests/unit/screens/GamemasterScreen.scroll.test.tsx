import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterScreen from '@/components/screens/GamemasterScreen';
import type { GamemasterControlsData } from '@/types/game';

const sendCommandMock = vi.fn();
let controlsValue: GamemasterControlsData | null = null;

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => null,
  useGamemasterControls: () => controlsValue,
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

describe('GamemasterScreen — show-scroll buttons', () => {
  beforeEach(() => {
    localStorage.clear();
    sendCommandMock.mockClear();
    controlsValue = null;
  });

  it('hides the scroll row when no scrollAnchors are reported', () => {
    controlsValue = { controls: [], phase: 'game' };
    renderScreen();
    expect(screen.queryByRole('group', { name: 'Show scrollen' })).toBeNull();
  });

  it('hides the scroll row outside the game phase even if anchors are present', () => {
    controlsValue = { controls: [], phase: 'points', scrollAnchors: ['top', 'bottom'] };
    renderScreen();
    expect(screen.queryByRole('group', { name: 'Show scrollen' })).toBeNull();
  });

  it('renders only the reported anchors in order', () => {
    controlsValue = { controls: [], phase: 'game', scrollAnchors: ['top', 'bottom'] };
    renderScreen();
    expect(screen.getByRole('button', { name: '⤒ Anfang' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '⤓ Ende' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Antwort' })).toBeNull();
  });

  it('renders all three jump-points when reported', () => {
    controlsValue = { controls: [], phase: 'game', scrollAnchors: ['top', 'answer', 'bottom'] };
    renderScreen();
    for (const name of ['⤒ Anfang', 'Antwort', '⤓ Ende']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('sends the matching scroll-to:<anchor> command on click', async () => {
    const user = userEvent.setup();
    controlsValue = { controls: [], phase: 'game', scrollAnchors: ['top', 'answer', 'bottom'] };
    renderScreen();
    await user.click(screen.getByRole('button', { name: '⤒ Anfang' }));
    await user.click(screen.getByRole('button', { name: 'Antwort' }));
    await user.click(screen.getByRole('button', { name: '⤓ Ende' }));
    expect(sendCommandMock).toHaveBeenNthCalledWith(1, 'scroll-to:top');
    expect(sendCommandMock).toHaveBeenNthCalledWith(2, 'scroll-to:answer');
    expect(sendCommandMock).toHaveBeenNthCalledWith(3, 'scroll-to:bottom');
  });
});
