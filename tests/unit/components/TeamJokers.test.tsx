import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider, useGameContext } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import TeamJokers from '@/components/common/TeamJokers';
import * as backendSocket from '@/services/useBackendSocket';
import type { ReactNode } from 'react';
import { useEffect } from 'react';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: ['call-friend', 'double-answer', 'ask-ai'],
  }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

function Harness({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>{children}</GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

/** Reads state so tests can assert on it. */
function StateProbe({ setLastGame = false }: { setLastGame?: boolean }) {
  const { state, dispatch } = useGameContext();

  useEffect(() => {
    dispatch({
      type: 'SET_CURRENT_GAME',
      payload: setLastGame
        ? { currentIndex: 4, totalGames: 5 }
        : { currentIndex: 0, totalGames: 5 },
    });
  }, [dispatch, setLastGame]);

  return (
    <>
      <div data-testid="t1">{JSON.stringify(state.teams.team1JokersUsed)}</div>
      <div data-testid="t2">{JSON.stringify(state.teams.team2JokersUsed)}</div>
      <div data-testid="settings-loaded">{String(state.settingsLoaded)}</div>
      <div data-testid="current-game">{JSON.stringify(state.currentGame)}</div>
    </>
  );
}

function renderBothTeams({ setLastGame = false }: { setLastGame?: boolean } = {}) {
  return render(
    <Harness>
      <div data-testid="team1-slot">
        <TeamJokers team="team1" />
      </div>
      <div data-testid="team2-slot">
        <TeamJokers team="team2" />
      </div>
      <StateProbe setLastGame={setLastGame} />
    </Harness>
  );
}

async function waitForLoad() {
  await vi.waitFor(() => {
    expect(screen.getByTestId('settings-loaded').textContent).toBe('true');
  });
}

describe('TeamJokers', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders one button per enabled joker for the team', async () => {
    renderBothTeams();
    await waitForLoad();
    // 3 enabled × 2 teams = 6 buttons total
    expect(screen.getAllByRole('button').length).toBe(6);
    // First 3 buttons belong to team1 slot
    const team1Buttons = screen.getByTestId('team1-slot').querySelectorAll('button');
    const team2Buttons = screen.getByTestId('team2-slot').querySelectorAll('button');
    expect(team1Buttons.length).toBe(3);
    expect(team2Buttons.length).toBe(3);
  });

  it('renders nothing when no jokers are enabled', async () => {
    const api = await import('@/services/api');
    (api.fetchSettings as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
      enabledJokers: [],
    });
    const { container } = renderBothTeams();
    await waitForLoad();
    expect(container.querySelector('.header-jokers')).toBeNull();
  });

  it('clicking an available joker marks it used for the clicked team only', async () => {
    const user = userEvent.setup();
    renderBothTeams();
    await waitForLoad();
    const team1Buttons = screen.getByTestId('team1-slot').querySelectorAll('button');
    await user.click(team1Buttons[0] as HTMLButtonElement);
    expect(screen.getByTestId('t1').textContent).toBe('["call-friend"]');
    expect(screen.getByTestId('t2').textContent).toBe('[]');
  });

  it('clicking a used joker reverts it to available', async () => {
    const user = userEvent.setup();
    renderBothTeams();
    await waitForLoad();
    const btn = screen.getByTestId('team1-slot').querySelector('button') as HTMLButtonElement;
    await user.click(btn); // activate → used
    expect(JSON.parse(screen.getByTestId('t1').textContent || '[]')).toEqual(['call-friend']);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('false');

    await user.click(btn); // revert → available
    expect(JSON.parse(screen.getByTestId('t1').textContent || '[]')).toEqual([]);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('last-game locks activation for unused jokers but not reverts', async () => {
    const user = userEvent.setup();
    renderBothTeams({ setLastGame: true });
    await waitForLoad();
    await vi.waitFor(() => {
      const cg = JSON.parse(screen.getByTestId('current-game').textContent || 'null');
      expect(cg?.currentIndex).toBe(4);
    });
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]);
    expect(screen.getByTestId('t1').textContent).toBe('[]');
    for (const b of buttons) {
      expect(b.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('last-game still allows reverting a joker that was already used', async () => {
    const user = userEvent.setup();
    localStorage.setItem('team1JokersUsed', JSON.stringify(['call-friend']));
    renderBothTeams({ setLastGame: true });
    await waitForLoad();
    await vi.waitFor(() => {
      const cg = JSON.parse(screen.getByTestId('current-game').textContent || 'null');
      expect(cg?.currentIndex).toBe(4);
    });
    const btn = screen.getByTestId('team1-slot').querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.getAttribute('aria-disabled')).toBe('false');
    await user.click(btn);
    expect(JSON.parse(screen.getByTestId('t1').textContent || '[]')).toEqual([]);
  });

  it('tooltip label contains name and description', async () => {
    renderBothTeams();
    await waitForLoad();
    const btn = screen.getByTestId('team1-slot').querySelector('button') as HTMLButtonElement;
    const tooltip = btn.getAttribute('data-tooltip') || '';
    expect(tooltip).toContain('Telefonjoker');
    expect(tooltip).toContain('—');
  });

  it('last-game tooltip includes "gesperrt" hint', async () => {
    renderBothTeams({ setLastGame: true });
    await waitForLoad();
    await vi.waitFor(() => {
      const cg = JSON.parse(screen.getByTestId('current-game').textContent || 'null');
      expect(cg?.currentIndex).toBe(4);
    });
    const btn = screen.getByTestId('team1-slot').querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('data-tooltip') || '').toContain('gesperrt');
  });

  it('sends a gamemaster command when a joker is consumed', async () => {
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    const user = userEvent.setup();
    renderBothTeams();
    await waitForLoad();
    const btn = screen.getByTestId('team1-slot').querySelector('button') as HTMLButtonElement;
    await user.click(btn);
    const calls = sendWsSpy.mock.calls.filter(([channel]) => channel === 'gamemaster-command');
    expect(calls.length).toBeGreaterThan(0);
    const cmd = calls[calls.length - 1][1] as { controlId?: string; value?: unknown };
    expect(cmd.controlId).toBe('use-joker');
    expect(cmd.value).toMatchObject({ team: 'team1', jokerId: 'call-friend', used: 'true' });
  });
});
