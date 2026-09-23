import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import BaseGameWrapper from '@/components/games/BaseGameWrapper';

const fetchSettings = vi.fn();
vi.mock('@/services/api', () => ({
  fetchSettings: (...a: unknown[]) => fetchSettings(...a),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/services/useBackendSocket', () => ({
  sendWs: () => true,
  onWsOpen: () => () => {},
  useWsChannel: () => {},
  __emitChannelForTests: () => {},
}));

/**
 * The award screen decides WHICH team won the round. At `teamCount: 1` there is
 * nothing to decide, so the screen still appears but arrives with its one card
 * already selected: the host confirms and moves on. See specs/team-count.md.
 */
function renderWrapper(teamCount: number) {
  fetchSettings.mockResolvedValue({
    pointSystemEnabled: teamCount > 0,
    teamCount,
    teamRandomizationEnabled: false,
    globalRules: [],
    enabledJokers: [],
  });
  const onNextGame = vi.fn();
  const onAwardPoints = vi.fn();
  render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <BaseGameWrapper
            title="Testspiel"
            rules={['Regel eins']}
            totalQuestions={2}
            pointSystemEnabled={teamCount > 0}
            currentIndex={2}
            pointValue={3}
            onAwardPoints={onAwardPoints}
            onNextGame={onNextGame}
          >
            {({ onGameComplete }) => (
              <div>
                <div>Spielinhalt</div>
                <button onClick={onGameComplete}>Spiel beenden</button>
              </div>
            )}
          </BaseGameWrapper>
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>,
  );
  return { onNextGame, onAwardPoints };
}

function pressArrowRight() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
}

/** Landing → rules → game, so `onGameComplete` is reachable. */
async function playToGame() {
  await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());
  pressArrowRight(); // landing → rules
  pressArrowRight(); // rules → game
  await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
}

beforeEach(() => localStorage.clear());

const card = () => document.querySelector('.award-team-card')!;
const confirm = () => screen.getByRole('button', { name: 'Punkte vergeben & weiter' });

describe('award screen per team count', () => {
  it('arrives with the single card already selected at 1 team', async () => {
    const user = userEvent.setup();
    renderWrapper(1);
    await playToGame();

    await user.click(screen.getByText('Spiel beenden'));

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
    // Preselected, so confirm is live immediately — one press ends the game.
    expect(document.querySelectorAll('.award-team-card')).toHaveLength(1);
    expect(card().getAttribute('aria-pressed')).toBe('true');
    expect(confirm()).toBeEnabled();
  });

  it('books the points and advances on that single confirm', async () => {
    const user = userEvent.setup();
    const { onNextGame, onAwardPoints } = renderWrapper(1);
    await playToGame();
    await user.click(screen.getByText('Spiel beenden'));
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());

    await user.click(confirm());

    await waitFor(() => expect(onNextGame).toHaveBeenCalled());
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 3);
  });

  it('still lets the host deselect a round the audience did not win', async () => {
    const user = userEvent.setup();
    renderWrapper(1);
    await playToGame();
    await user.click(screen.getByText('Spiel beenden'));
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());

    await user.click(card());

    expect(card().getAttribute('aria-pressed')).toBe('false');
    expect(confirm()).toBeDisabled();
  });

  it('starts empty at 2 teams — there the screen is a real decision', async () => {
    // The regression bar: only the solo count arrives preselected (absent a tally).
    const user = userEvent.setup();
    renderWrapper(2);
    await playToGame();

    await user.click(screen.getByText('Spiel beenden'));

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
    expect(document.querySelectorAll('.award-team-card[aria-pressed="true"]')).toHaveLength(0);
    expect(confirm()).toBeDisabled();
  });
});
