import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider, useGameContext } from '@/context/GameContext';
import JokerBar from '@/components/common/JokerBar';
import type { ReactNode } from 'react';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: ['call-friend', 'double-answer', 'ask-ai'],
  }),
}));

function Harness({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <GameProvider>{children}</GameProvider>
    </MemoryRouter>
  );
}

/** Reads state so tests can assert on it */
function StateProbe() {
  const { state } = useGameContext();
  return (
    <>
      <div data-testid="t1">{JSON.stringify(state.teams.team1JokersUsed)}</div>
      <div data-testid="t2">{JSON.stringify(state.teams.team2JokersUsed)}</div>
      <div data-testid="settings-loaded">{String(state.settingsLoaded)}</div>
    </>
  );
}

async function waitForLoad() {
  await vi.waitFor(() => {
    expect(screen.getByTestId('settings-loaded').textContent).toBe('true');
  });
}

describe('JokerBar', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders one icon per enabled joker for each team', async () => {
    render(
      <Harness>
        <JokerBar isLastGame={false} />
        <StateProbe />
      </Harness>
    );
    await waitForLoad();
    // 3 enabled × 2 teams = 6 buttons
    expect(screen.getAllByRole('button').length).toBe(6);
  });

  it('renders nothing when no jokers are enabled', async () => {
    // Override the mock for this test to return empty enabledJokers
    const api = await import('@/services/api');
    (api.fetchSettings as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
      enabledJokers: [],
    });
    const { container } = render(
      <Harness>
        <JokerBar isLastGame={false} />
        <StateProbe />
      </Harness>
    );
    await waitForLoad();
    expect(container.querySelector('.joker-bar')).toBeNull();
  });

  it('clicking an available joker marks it used for the clicked team only', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <JokerBar isLastGame={false} />
        <StateProbe />
      </Harness>
    );
    await waitForLoad();
    const buttons = screen.getAllByRole('button');
    // First three buttons are team1 (in order of enabledJokers)
    await user.click(buttons[0]);
    expect(screen.getByTestId('t1').textContent).toBe('["call-friend"]');
    expect(screen.getByTestId('t2').textContent).toBe('[]');
  });

  it('used joker is not clickable', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <JokerBar isLastGame={false} />
        <StateProbe />
      </Harness>
    );
    await waitForLoad();
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]);
    await user.click(buttons[0]); // second click should do nothing
    expect(JSON.parse(screen.getByTestId('t1').textContent || '[]')).toEqual(['call-friend']);
    expect(buttons[0].getAttribute('aria-disabled')).toBe('true');
  });

  it('last-game disables all unused jokers', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <JokerBar isLastGame={true} />
        <StateProbe />
      </Harness>
    );
    await waitForLoad();
    const buttons = screen.getAllByRole('button');
    await user.click(buttons[0]);
    expect(screen.getByTestId('t1').textContent).toBe('[]');
    for (const btn of buttons) {
      expect(btn.getAttribute('aria-disabled')).toBe('true');
    }
  });

  it('tooltip label contains name and description', async () => {
    render(
      <Harness>
        <JokerBar isLastGame={false} />
        <StateProbe />
      </Harness>
    );
    await waitForLoad();
    const firstBtn = screen.getAllByRole('button')[0];
    const tooltip = firstBtn.getAttribute('data-tooltip') || '';
    expect(tooltip).toContain('Telefonjoker');
    expect(tooltip).toContain('—');
  });

  it('last-game tooltip includes "gesperrt" hint', async () => {
    render(
      <Harness>
        <JokerBar isLastGame={true} />
        <StateProbe />
      </Harness>
    );
    await waitForLoad();
    const firstBtn = screen.getAllByRole('button')[0];
    expect(firstBtn.getAttribute('data-tooltip') || '').toContain('gesperrt');
  });

  it('sends a gamemaster command when a joker is consumed', async () => {
    const user = userEvent.setup();
    render(
      <Harness>
        <JokerBar isLastGame={false} />
        <StateProbe />
      </Harness>
    );
    await waitForLoad();
    await user.click(screen.getAllByRole('button')[0]);
    const cmdRaw = localStorage.getItem('gamemasterCommand');
    expect(cmdRaw).not.toBeNull();
    const cmd = JSON.parse(cmdRaw || '{}');
    expect(cmd.controlId).toBe('use-joker');
    expect(cmd.value).toMatchObject({ team: 'team1', jokerId: 'call-friend', used: 'true' });
  });
});
