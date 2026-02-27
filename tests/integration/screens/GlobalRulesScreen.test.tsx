import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import GlobalRulesScreen from '@/components/screens/GlobalRulesScreen';

// Mock the API with custom rules
vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: ['Rule Alpha', 'Rule Beta', 'Rule Gamma'],
  }),
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

  it('navigates to /game?index=0 when Weiter is clicked', async () => {
    const user = userEvent.setup();
    renderGlobalRulesScreen();

    await user.click(screen.getByText('Weiter'));
    expect(mockedNavigate).toHaveBeenCalledWith('/game?index=0');
  });
});
