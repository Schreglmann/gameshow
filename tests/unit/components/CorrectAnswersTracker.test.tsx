import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider } from '@/context/GameContext';
import CorrectAnswersTracker from '@/components/common/CorrectAnswersTracker';
import { __emitChannelForTests } from '@/services/useBackendSocket';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
}));

function renderTracker(gameIndex: number) {
  return render(
    <GameProvider>
      <CorrectAnswersTracker gameIndex={gameIndex} />
    </GameProvider>,
  );
}

describe('CorrectAnswersTracker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders 0/0 with fresh localStorage', () => {
    renderTracker(0);
    const counts = screen.getAllByText('0');
    expect(counts.length).toBeGreaterThanOrEqual(2);
  });

  it('increments Team 1 and persists to localStorage', async () => {
    const user = userEvent.setup();
    renderTracker(2);

    await user.click(screen.getByLabelText('Team 1 plus'));

    expect(screen.getByLabelText('Team 1 plus').parentElement?.querySelector('.gm-correct-count')?.textContent).toBe('1');
    const stored = JSON.parse(localStorage.getItem('correctAnswersByGame') || '{}');
    expect(stored['2']).toEqual({ team1: 1, team2: 0 });
  });

  it('clamps decrement at 0', async () => {
    const user = userEvent.setup();
    renderTracker(0);

    // minus button is disabled at 0, so clicking does nothing
    const minusBtn = screen.getByLabelText('Team 1 minus') as HTMLButtonElement;
    expect(minusBtn.disabled).toBe(true);

    // Force the state above zero, then decrement twice
    await user.click(screen.getByLabelText('Team 1 plus'));
    await user.click(screen.getByLabelText('Team 1 minus'));
    await user.click(screen.getByLabelText('Team 1 minus')); // clamp

    const stored = JSON.parse(localStorage.getItem('correctAnswersByGame') || '{}');
    expect(stored['0']).toEqual({ team1: 0, team2: 0 });
  });

  it('reads pre-seeded counts for the given gameIndex', () => {
    localStorage.setItem('correctAnswersByGame', JSON.stringify({
      '0': { team1: 2, team2: 1 },
      '1': { team1: 7, team2: 3 },
    }));

    const { unmount } = renderTracker(1);
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    unmount();

    renderTracker(0);
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('renders team member names when teams are assigned', () => {
    localStorage.setItem('team1', JSON.stringify(['Anna', 'Ben']));
    localStorage.setItem('team2', JSON.stringify(['Carla']));

    renderTracker(0);
    expect(screen.getByText('Anna, Ben')).toBeInTheDocument();
    expect(screen.getByText('Carla')).toBeInTheDocument();
  });

  it('updates when a correct-answers WS message arrives from another client', () => {
    renderTracker(0);
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);

    act(() => {
      __emitChannelForTests('gamemaster-correct-answers', {
        '0': { team1: 4, team2: 5 },
      });
    });

    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });
});
