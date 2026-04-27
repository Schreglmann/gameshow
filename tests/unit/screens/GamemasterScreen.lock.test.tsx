import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterScreen from '@/components/screens/GamemasterScreen';

const sendCommandMock = vi.fn();

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => null,
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

describe('GamemasterScreen — input lock toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    sendCommandMock.mockClear();
  });

  it('starts unlocked and forwards keyboard + click events', () => {
    renderScreen();

    const toggle = screen.getByRole('button', { name: 'Steuerung sperren' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    });
    expect(sendCommandMock).toHaveBeenCalledWith('nav-forward');

    sendCommandMock.mockClear();
    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(sendCommandMock).toHaveBeenCalledWith('nav-back');
  });

  it('locks and prevents keyboard + document-click events from sending commands', async () => {
    const user = userEvent.setup();
    renderScreen();

    const toggle = screen.getByRole('button', { name: 'Steuerung sperren' });
    await user.click(toggle);

    const lockedToggle = screen.getByRole('button', { name: 'Steuerung gesperrt' });
    expect(lockedToggle.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('gm-input-locked')).toBe('true');

    sendCommandMock.mockClear();

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });

    act(() => {
      const blank = document.createElement('div');
      document.body.appendChild(blank);
      blank.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      blank.remove();
    });

    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('restores locked state from localStorage', () => {
    localStorage.setItem('gm-input-locked', 'true');
    renderScreen();

    const lockedToggle = screen.getByRole('button', { name: 'Steuerung gesperrt' });
    expect(lockedToggle.getAttribute('aria-pressed')).toBe('true');

    act(() => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    });
    expect(sendCommandMock).not.toHaveBeenCalled();
  });

  it('still calls preventDefault for Space when locked (so the page does not scroll)', () => {
    localStorage.setItem('gm-input-locked', 'true');
    renderScreen();

    const event = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
    act(() => {
      document.body.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(sendCommandMock).not.toHaveBeenCalled();
  });
});
