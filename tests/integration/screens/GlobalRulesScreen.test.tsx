import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import GlobalRulesScreen from '@/components/screens/GlobalRulesScreen';
import { GENERIC_JOKER_RULES } from '@/data/jokers';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import type { SettingsResponse } from '@/types/config';

// Mutable settings the mocked fetchSettings resolves to. Reset per test.
let mockSettings: Partial<SettingsResponse>;
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockImplementation(() => Promise.resolve(mockSettings)),
}));

const mockedNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockedNavigate,
  };
});

function renderGlobalRulesScreen() {
  return render(
    <BrowserRouter>
      <GameProvider>
        <GlobalRulesScreen />
      </GameProvider>
    </BrowserRouter>
  );
}

describe('GlobalRulesScreen', () => {
  beforeEach(() => {
    mockedNavigate.mockClear();
    mockSettings = {
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: ['Rule Alpha', 'Rule Beta', 'Rule Gamma'],
    };
  });

  it('renders the Regelwerk heading', () => {
    renderGlobalRulesScreen();
    expect(screen.getByText('Regelwerk')).toBeInTheDocument();
  });

  it('displays all global rules from settings', async () => {
    renderGlobalRulesScreen();
    await waitFor(() => {
      expect(screen.getByText('Rule Alpha')).toBeInTheDocument();
      expect(screen.getByText('Rule Beta')).toBeInTheDocument();
      expect(screen.getByText('Rule Gamma')).toBeInTheDocument();
    });
  });

  it('navigates to /game?index=0 on click', async () => {
    const user = userEvent.setup();
    renderGlobalRulesScreen();

    await user.click(screen.getByText('Regelwerk'));
    expect(mockedNavigate).toHaveBeenCalledWith('/game?index=0');
  });

  it('navigates back to the start page on ArrowLeft', async () => {
    renderGlobalRulesScreen();
    await waitFor(() => expect(screen.getByText('Rule Alpha')).toBeInTheDocument());

    mockedNavigate.mockClear();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    expect(mockedNavigate).toHaveBeenCalledWith('/');
  });

  it('navigates back to the start page on the gamemaster nav-back command', async () => {
    renderGlobalRulesScreen();
    await waitFor(() => expect(screen.getByText('Rule Alpha')).toBeInTheDocument());

    mockedNavigate.mockClear();
    await act(async () => {
      __emitChannelForTests('gamemaster-command', { controlId: 'nav-back', timestamp: 1 });
    });
    expect(mockedNavigate).toHaveBeenCalledWith('/');
  });

  it('does NOT show the generic joker explanation when no jokers are enabled', async () => {
    renderGlobalRulesScreen();
    await waitFor(() => expect(screen.getByText('Rule Alpha')).toBeInTheDocument());
    expect(screen.queryByText(GENERIC_JOKER_RULES[0])).not.toBeInTheDocument();
  });

  it('appends the generic joker explanation when the active gameshow has jokers', async () => {
    mockSettings.enabledJokers = ['ask-ai', 'double-answer'];
    renderGlobalRulesScreen();
    await waitFor(() => {
      // Configured rules still render...
      expect(screen.getByText('Rule Alpha')).toBeInTheDocument();
      // ...plus every generic joker line, and none of the specific joker names.
      for (const line of GENERIC_JOKER_RULES) {
        expect(screen.getByText(line)).toBeInTheDocument();
      }
    });
    expect(screen.queryByText(/KI-Joker/)).not.toBeInTheDocument();
    // The joker list carries the divider modifier because global rules exist above it.
    expect(document.getElementById('globalRulesJokerList')?.className).toContain('rules-joker-list--divided');
  });

  it('renders operator-configured jokerRules instead of the built-in default', async () => {
    mockSettings.enabledJokers = ['ask-ai'];
    mockSettings.jokerRules = ['Eigene Joker-Regel A', 'Eigene Joker-Regel B'];
    renderGlobalRulesScreen();
    await waitFor(() => {
      expect(screen.getByText('Eigene Joker-Regel A')).toBeInTheDocument();
      expect(screen.getByText('Eigene Joker-Regel B')).toBeInTheDocument();
    });
    // The built-in default text must NOT appear when a custom text is configured.
    expect(screen.queryByText(GENERIC_JOKER_RULES[0])).not.toBeInTheDocument();
  });

  it('falls back to the built-in default when jokerRules is empty but jokers are enabled', async () => {
    mockSettings.enabledJokers = ['ask-ai'];
    mockSettings.jokerRules = [];
    renderGlobalRulesScreen();
    await waitFor(() => {
      for (const line of GENERIC_JOKER_RULES) {
        expect(screen.getByText(line)).toBeInTheDocument();
      }
    });
  });

  it('still renders (no auto-forward) with empty globalRules when jokers are enabled', async () => {
    mockSettings.globalRules = [];
    mockSettings.enabledJokers = ['ask-ai'];
    renderGlobalRulesScreen();
    await waitFor(() => {
      expect(screen.getByText(GENERIC_JOKER_RULES[0])).toBeInTheDocument();
    });
    expect(mockedNavigate).not.toHaveBeenCalledWith('/game?index=0');
    // No global rules above → no divider modifier.
    expect(document.getElementById('globalRulesJokerList')?.className).not.toContain('rules-joker-list--divided');
  });

  it('auto-forwards to game 0 when there are neither global rules nor jokers', async () => {
    mockSettings.globalRules = [];
    mockSettings.enabledJokers = [];
    renderGlobalRulesScreen();
    await waitFor(() => expect(mockedNavigate).toHaveBeenCalledWith('/game?index=0'));
  });
});
