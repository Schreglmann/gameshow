import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider } from '@/context/GameContext';
import CorrectAnswersTracker from '@/components/common/CorrectAnswersTracker';
import { __emitChannelForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
    globalRules: [],
  }),
}));

const STORAGE_KEY = 'correctAnswersByQuestion';

/** The tally is stored per question, so a render needs the live question too. */
function renderTracker(gameIndex: number, question = '1') {
  return render(
    <GameProvider>
      <CorrectAnswersTracker gameIndex={gameIndex} question={question} />
    </GameProvider>,
  );
}

function stored() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
}

function countFor(label: string): string | undefined {
  return screen
    .getByLabelText(`${label} plus`)
    .parentElement?.querySelector('.gm-correct-count')?.textContent ?? undefined;
}

describe('CorrectAnswersTracker', () => {
  beforeEach(() => {
    localStorage.clear();
    // Late subscribers replay the client-side last-value cache — clear it so a
    // payload emitted by an earlier test isn't re-applied on the next mount.
    __clearWsCacheForTests();
  });

  it('renders 0/0 with fresh localStorage', () => {
    renderTracker(0);
    const counts = screen.getAllByText('0');
    expect(counts.length).toBeGreaterThanOrEqual(2);
  });

  it('increments Team 1 and persists under the live question', async () => {
    const user = userEvent.setup();
    renderTracker(2, '3');

    await user.click(screen.getByLabelText('Team 1 plus'));

    expect(countFor('Team 1')).toBe('1');
    expect(stored()['2']).toEqual({ '3': { team1: 1, team2: 0 } });
  });

  it('files a tap under the reserved bucket when no question is attributable', async () => {
    const user = userEvent.setup();
    // No `question` prop → the component's `none` default. A tap during a live
    // show must never be dropped just because the question is unknown.
    render(
      <GameProvider>
        <CorrectAnswersTracker gameIndex={0} />
      </GameProvider>,
    );

    await user.click(screen.getByLabelText('Team 1 plus'));

    expect(stored()['0']).toEqual({ none: { team1: 1, team2: 0 } });
    expect(screen.getAllByText(/ohne Frage · 1/).length).toBe(1);
  });

  it('clamps decrement at 0', async () => {
    const user = userEvent.setup();
    renderTracker(0, '1');

    // minus button is disabled at 0, so clicking does nothing
    const minusBtn = screen.getByLabelText('Team 1 minus') as HTMLButtonElement;
    expect(minusBtn.disabled).toBe(true);

    // Force the state above zero, then decrement twice
    await user.click(screen.getByLabelText('Team 1 plus'));
    await user.click(screen.getByLabelText('Team 1 minus'));
    await user.click(screen.getByLabelText('Team 1 minus')); // clamp

    expect(stored()['0']).toEqual({ '1': { team1: 0, team2: 0 } });
  });

  it('shows the DERIVED game total, summed across questions', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      '1': {
        '1': { team1: 1, team2: 0 },
        '2': { team1: 0, team2: 1 },
        '3': { team1: 2, team2: 0 },
      },
    }));

    renderTracker(1, '3');
    expect(countFor('Team 1')).toBe('3');
    expect(countFor('Team 2')).toBe('1');
  });

  it('reads pre-seeded counts for the given gameIndex', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      '0': { '1': { team1: 2, team2: 1 } },
      '1': { '1': { team1: 7, team2: 3 } },
    }));

    const { unmount } = renderTracker(1, '1');
    expect(countFor('Team 1')).toBe('7');
    expect(countFor('Team 2')).toBe('3');
    unmount();

    renderTracker(0, '1');
    expect(countFor('Team 1')).toBe('2');
    expect(countFor('Team 2')).toBe('1');
  });

  // Regression: gating `−` on the GAME total would leave it enabled on a question
  // whose own bucket is 0, where the reducer no-ops — a tap on a visible non-zero
  // number doing nothing. See specs/gamemaster-question-scores.md.
  it('disables − on a question with no count even when the game total is non-zero', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      '0': { '1': { team1: 5, team2: 0 } },
    }));

    renderTracker(0, '2');

    expect(countFor('Team 1')).toBe('5');
    expect((screen.getByLabelText('Team 1 minus') as HTMLButtonElement).disabled).toBe(true);
  });

  it('captions which question the buttons write to and its count', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      '0': { '4': { team1: 1, team2: 0 } },
    }));

    renderTracker(0, '4');
    expect(screen.getAllByText(/Frage 4 · 1/).length).toBe(1);
    expect(screen.getAllByText(/Frage 4 · 0/).length).toBe(1);
  });

  it('labels the example question', () => {
    renderTracker(0, '0');
    expect(screen.getAllByText(/Beispiel · 0/).length).toBe(2);
  });

  it('renders team member names when teams are assigned', () => {
    localStorage.setItem('team1', JSON.stringify(['Anna', 'Ben']));
    localStorage.setItem('team2', JSON.stringify(['Carla']));

    renderTracker(0);
    expect(screen.getByText('Anna, Ben')).toBeInTheDocument();
    expect(screen.getByText('Carla')).toBeInTheDocument();
  });

  it('mirrors the team order on the gamemaster (team 2 in the left cell by default)', async () => {
    localStorage.setItem('team1', JSON.stringify(['Anna']));
    localStorage.setItem('team2', JSON.stringify(['Carla']));

    renderTracker(0);
    // Order depends on teamMirrorEnabled, which loads async from /api/settings.
    await vi.waitFor(() => {
      const teams = document.querySelectorAll('.gm-correct-team');
      expect(teams[0]?.textContent).toContain('Carla');
      expect(teams[1]?.textContent).toContain('Anna');
    });
  });

  it('mirror follows the order swap (team 1 in the left cell when swapped)', async () => {
    localStorage.setItem('team1', JSON.stringify(['Anna']));
    localStorage.setItem('team2', JSON.stringify(['Carla']));
    localStorage.setItem('teamOrderSwapped', 'true');

    renderTracker(0);
    await vi.waitFor(() => {
      const teams = document.querySelectorAll('.gm-correct-team');
      expect(teams[0]?.textContent).toContain('Anna');
      expect(teams[1]?.textContent).toContain('Carla');
    });
  });

  it('flips the mirror when another client swaps the order over the WS', async () => {
    localStorage.setItem('team1', JSON.stringify(['Anna']));
    localStorage.setItem('team2', JSON.stringify(['Carla']));

    renderTracker(0);
    await vi.waitFor(() => {
      expect(document.querySelectorAll('.gm-correct-team')[0]?.textContent).toContain('Carla');
    });

    // The show pressed "Teams tauschen" — the flag rides `gamemaster-team-state`.
    act(() => {
      __emitChannelForTests('gamemaster-team-state', {
        team1: ['Anna'],
        team2: ['Carla'],
        team1Points: 0,
        team2Points: 0,
        team1JokersUsed: [],
        team2JokersUsed: [],
        scoreHistory: [],
        doubleNextGame: null,
        orderSwapped: true,
      });
    });

    const teams = document.querySelectorAll('.gm-correct-team');
    expect(teams[0]?.textContent).toContain('Anna');
    expect(teams[1]?.textContent).toContain('Carla');
  });

  it('updates when a nested tally WS message arrives from another client', () => {
    renderTracker(0, '1');
    expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(2);

    act(() => {
      __emitChannelForTests('gamemaster-question-tally', {
        '0': { '1': { team1: 4, team2: 5 } },
      });
    });

    expect(countFor('Team 1')).toBe('4');
    expect(countFor('Team 2')).toBe('5');
  });

  // The nested shape is why the channel was renamed: a peer still sending the old
  // FLAT payload must not be able to write anything, rather than collapsing every
  // game to 0/0. See specs/gamemaster-question-scores.md.
  it('ignores a legacy flat payload instead of zeroing the map', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      '0': { '1': { team1: 3, team2: 2 } },
    }));

    renderTracker(0, '1');
    expect(countFor('Team 1')).toBe('3');

    act(() => {
      // Old shape: gameIndex → { team1, team2 }. The numbers are not objects, so
      // the nested normalizer yields an empty bucket set for that game.
      __emitChannelForTests('gamemaster-question-tally', { '0': { team1: 9, team2: 9 } });
    });

    expect(screen.queryByText('9')).not.toBeInTheDocument();
  });
});
