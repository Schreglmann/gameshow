import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';
import * as backendSocket from '@/services/useBackendSocket';

const mockAnswer: { current: unknown } = {
  current: { gameTitle: 'Test Game', answer: 'A', questionNumber: 1, totalQuestions: 5 },
};
const mockControls: { current: unknown } = { current: null };
vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => mockAnswer.current,
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => (controlId: string, value?: unknown) => {
    backendSocket.sendWs('gamemaster-command', { controlId, value });
  },
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: ['call-friend', 'double-answer'],
  }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

function renderGM() {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('GamemasterView — joker controls', () => {
  let sendWsSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    mockAnswer.current = { gameTitle: 'Test Game', answer: 'A', questionNumber: 1, totalQuestions: 5 };
    mockControls.current = null;
    sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
  });

  function lastCommand(): { controlId?: string; value?: unknown } {
    const calls = sendWsSpy.mock.calls.filter(([channel]) => channel === 'gamemaster-command');
    const last = calls[calls.length - 1];
    return (last?.[1] ?? {}) as { controlId?: string; value?: unknown };
  }

  async function expandJokerSection(user: ReturnType<typeof userEvent.setup>) {
    await vi.waitFor(() => {
      expect(document.querySelector('.gm-jokers-header')).not.toBeNull();
    });
    const header = document.querySelector('.gm-jokers-header') as HTMLButtonElement;
    await user.click(header);
  }

  it('joker section is collapsed by default (no toggles visible)', async () => {
    renderGM();
    await vi.waitFor(() => {
      expect(document.querySelector('.gm-jokers')).not.toBeNull();
    });
    // Header button is always rendered; body (toggles) is not.
    expect(document.querySelector('.gm-jokers-header')).not.toBeNull();
    expect(document.querySelectorAll('.gm-joker-toggle').length).toBe(0);
    expect(document.querySelector('.gm-jokers')?.classList.contains('collapsed')).toBe(true);
  });

  it('expanding the section reveals one toggle per enabled joker per team', async () => {
    const user = userEvent.setup();
    renderGM();
    await expandJokerSection(user);
    const toggles = document.querySelectorAll('.gm-joker-toggle');
    // 2 enabled × 2 teams = 4
    expect(toggles.length).toBe(4);
    // Each toggle is a button (role="switch"), not a checkbox — so it gets
    // excluded by the GM screen's global click-to-nav-forward listener.
    toggles.forEach(t => {
      expect(t.tagName).toBe('BUTTON');
      expect(t.getAttribute('role')).toBe('switch');
    });
  });

  it('clicking a toggle writes a use-joker command with the correct value', async () => {
    const user = userEvent.setup();
    renderGM();
    await expandJokerSection(user);
    const firstToggle = document.querySelectorAll('.gm-joker-toggle')[0] as HTMLButtonElement;
    await user.click(firstToggle);
    const cmd = lastCommand();
    expect(cmd.controlId).toBe('use-joker');
    // GM mirrors the frontend order, so with no swap team 2's card is first.
    expect(cmd.value).toEqual({ team: 'team2', jokerId: 'call-friend', used: 'true' });
  });

  it('clicking an already-used toggle reverts it', async () => {
    const user = userEvent.setup();
    // First card on the GM is team 2's (mirror, no swap), so seed team 2 here.
    localStorage.setItem('team2JokersUsed', JSON.stringify(['call-friend']));
    renderGM();
    await expandJokerSection(user);
    const firstToggle = document.querySelectorAll('.gm-joker-toggle')[0] as HTMLButtonElement;
    expect(firstToggle.getAttribute('aria-checked')).toBe('true');
    await user.click(firstToggle);
    const cmd = lastCommand();
    expect(cmd.value).toEqual({ team: 'team2', jokerId: 'call-friend', used: 'false' });
  });

  it('mirrors the joker cards on the gamemaster (team 2 card first by default)', async () => {
    const user = userEvent.setup();
    renderGM();
    await expandJokerSection(user);
    const labels = Array.from(document.querySelectorAll('.gm-joker-team-label')).map(el => el.textContent);
    // GM faces the crowd → mirror of frontend order: team 2 sits left.
    expect(labels[0]).toContain('Team 2');
    expect(labels[1]).toContain('Team 1');
  });

  it('joker-card mirror follows the order swap (team 1 card first when swapped)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('teamOrderSwapped', 'true');
    renderGM();
    await expandJokerSection(user);
    const labels = Array.from(document.querySelectorAll('.gm-joker-team-label')).map(el => el.textContent);
    expect(labels[0]).toContain('Team 1');
    expect(labels[1]).toContain('Team 2');
  });

  it('does not mirror the joker cards when teamMirrorEnabled is false (team 1 card first)', async () => {
    const api = await import('@/services/api');
    (api.fetchSettings as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
      enabledJokers: ['call-friend', 'double-answer'],
      teamMirrorEnabled: false,
    });
    const user = userEvent.setup();
    renderGM();
    await expandJokerSection(user);
    const labels = Array.from(document.querySelectorAll('.gm-joker-team-label')).map(el => el.textContent);
    // Feature off → natural order, no mirror.
    expect(labels[0]).toContain('Team 1');
    expect(labels[1]).toContain('Team 2');
  });

  it('renders nothing when GM waiting screen is shown (no frontend active)', async () => {
    mockAnswer.current = null;
    renderGM();
    await new Promise(r => setTimeout(r, 20));
    expect(document.querySelector('.gm-jokers')).toBeNull();
  });

  it('renders nothing when no jokers are enabled', async () => {
    const api = await import('@/services/api');
    (api.fetchSettings as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
      enabledJokers: [],
    });
    renderGM();
    // Wait a tick so settings load
    await new Promise(r => setTimeout(r, 20));
    expect(document.querySelector('.gm-jokers')).toBeNull();
  });

  it('hides the joker section in the last game by default (jokersInLastGame off)', async () => {
    // Last game broadcast over the WS-backed controls; default settings leave
    // jokersInLastGame off, so the whole section is hidden.
    mockControls.current = { gameIndex: 4, totalGames: 5 };
    renderGM();
    await new Promise(r => setTimeout(r, 20));
    expect(document.querySelector('.gm-jokers')).toBeNull();
  });

  it('keeps the joker section visible in the last game when jokersInLastGame is on', async () => {
    const api = await import('@/services/api');
    (api.fetchSettings as unknown as { mockResolvedValueOnce: (v: unknown) => void }).mockResolvedValueOnce({
      pointSystemEnabled: true,
      teamRandomizationEnabled: true,
      globalRules: [],
      enabledJokers: ['call-friend', 'double-answer'],
      jokersInLastGame: true,
    });
    mockControls.current = { gameIndex: 4, totalGames: 5 };
    renderGM();
    await vi.waitFor(() => {
      expect(document.querySelector('.gm-jokers')).not.toBeNull();
    });
  });
});
