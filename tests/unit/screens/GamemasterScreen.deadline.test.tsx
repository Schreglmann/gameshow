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

describe('GamemasterScreen — deadline timer buttons', () => {
  beforeEach(() => {
    localStorage.clear();
    sendCommandMock.mockClear();
    controlsValue = null;
  });

  const ALL_DURATIONS = ['5s', '10s', '30s', '60s', '90s', '120s'];

  it('hides the duration buttons entirely outside game phase', () => {
    controlsValue = { controls: [], phase: 'landing' };
    renderScreen();
    for (const label of ALL_DURATIONS) {
      expect(screen.queryByRole('button', { name: label })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Weiter' })).toBeNull();
  });

  it('enables all six duration buttons during the game phase', () => {
    controlsValue = { controls: [], phase: 'game' };
    renderScreen();
    for (const label of ALL_DURATIONS) {
      expect(screen.getByRole('button', { name: label })).not.toBeDisabled();
    }
  });

  it('does not show the Pause/Stop buttons while no timer is running', () => {
    controlsValue = { controls: [], phase: 'game', timerActive: false };
    renderScreen();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('shows both Pause and Stop buttons while a timer is running', () => {
    controlsValue = { controls: [], phase: 'game', timerActive: true, timerPaused: false };
    renderScreen();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('shows Weiter (and still Stop) while the timer is paused', () => {
    controlsValue = { controls: [], phase: 'game', timerActive: true, timerPaused: true };
    renderScreen();
    expect(screen.getByRole('button', { name: 'Weiter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('hides Pause and Stop as soon as the timer expires (timerActive false)', () => {
    controlsValue = { controls: [], phase: 'game', deadlineActive: true, timerActive: false };
    renderScreen();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Weiter' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('hides the entire deadline-button row during the answer phase', () => {
    controlsValue = { controls: [], phase: 'game', timerActive: true, answerRevealed: true };
    renderScreen();
    expect(screen.queryByRole('button', { name: '30s' })).toBeNull();
    expect(screen.queryByRole('button', { name: '90s' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('sends the matching deadline-N command on click (incl. the new 5/10/120 presets)', async () => {
    const user = userEvent.setup();
    controlsValue = { controls: [], phase: 'game' };
    renderScreen();
    for (const secs of [5, 10, 30, 60, 90, 120]) {
      await user.click(screen.getByRole('button', { name: `${secs}s` }));
      expect(sendCommandMock).toHaveBeenLastCalledWith(`deadline-${secs}`);
    }
  });

  it('shows the +10s extend button and sends deadline-extend while a GM deadline runs', async () => {
    const user = userEvent.setup();
    controlsValue = { controls: [], phase: 'game', timerActive: true, deadlineEndsAt: Date.now() + 30000, deadlineTotalSeconds: 30 };
    renderScreen();
    const extend = screen.getByRole('button', { name: '+10s' });
    await user.click(extend);
    expect(sendCommandMock).toHaveBeenCalledWith('deadline-extend');
  });

  it('does not show +10s when the running timer is a per-question timer (no GM deadline)', () => {
    controlsValue = { controls: [], phase: 'game', timerActive: true };
    renderScreen();
    expect(screen.queryByRole('button', { name: '+10s' })).toBeNull();
  });

  it('sends timer-pause on Pause click and timer-resume on Weiter click', async () => {
    const user = userEvent.setup();
    controlsValue = { controls: [], phase: 'game', timerActive: true, timerPaused: false };
    renderScreen();
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(sendCommandMock).toHaveBeenCalledWith('timer-pause');
    sendCommandMock.mockClear();
    controlsValue = { controls: [], phase: 'game', timerActive: true, timerPaused: true };
    renderScreen();
    await user.click(screen.getByRole('button', { name: 'Weiter' }));
    expect(sendCommandMock).toHaveBeenCalledWith('timer-resume');
  });

  it('sends timer-stop on Stop click', async () => {
    const user = userEvent.setup();
    controlsValue = { controls: [], phase: 'game', timerActive: true, timerPaused: false };
    renderScreen();
    await user.click(screen.getByRole('button', { name: 'Stop' }));
    expect(sendCommandMock).toHaveBeenCalledWith('timer-stop');
  });
});
