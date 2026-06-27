import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import BaseGameWrapper from '@/components/games/BaseGameWrapper';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

interface RenderOptions {
  pointSystemEnabled?: boolean;
  skipPointsScreen?: boolean;
  pointValue?: number;
  rules?: string[];
  totalQuestions?: number;
  onRulesShow?: () => void;
  onNextShow?: () => void;
  onAwardPoints?: (team: 'team1' | 'team2', points: number) => void;
  onNextGame?: () => void;
}

function renderWrapper(opts: RenderOptions = {}) {
  const onAwardPoints = opts.onAwardPoints ?? vi.fn();
  const onNextGame = opts.onNextGame ?? vi.fn();
  render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <BaseGameWrapper
            title="Testspiel"
            rules={opts.rules ?? ['Regel eins', 'Regel zwei']}
            totalQuestions={opts.totalQuestions ?? 4}
            pointSystemEnabled={opts.pointSystemEnabled ?? true}
            currentIndex={2}
            pointValue={opts.pointValue ?? 3}
            skipPointsScreen={opts.skipPointsScreen}
            onRulesShow={opts.onRulesShow}
            onNextShow={opts.onNextShow}
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
    </MemoryRouter>
  );
  return { onAwardPoints, onNextGame };
}

function pressArrowRight() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
}

function pressArrowLeft() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
}

describe('BaseGameWrapper (shared game shell)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('walks landing → rules → game with keyboard navigation', async () => {
    const onRulesShow = vi.fn();
    renderWrapper({ onRulesShow });

    // Landing: title visible, game content not yet rendered
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());
    expect(screen.queryByText('Spielinhalt')).not.toBeInTheDocument();

    // Rules: rule lines + question count, onRulesShow fired
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Regeln:')).toBeInTheDocument());
    expect(screen.getByText('Regel eins')).toBeInTheDocument();
    expect(screen.getByText('Regel zwei')).toBeInTheDocument();
    expect(screen.getByText('Es gibt insgesamt 4 Fragen.')).toBeInTheDocument();
    expect(onRulesShow).toHaveBeenCalledTimes(1);

    // Game: children rendered
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
  });

  it('navigates back from rules to landing and from game to rules', async () => {
    renderWrapper();
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Regeln:')).toBeInTheDocument());
    pressArrowLeft();
    await waitFor(() => expect(screen.queryByText('Regeln:')).not.toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    pressArrowLeft();
    await waitFor(() => expect(screen.getByText('Regeln:')).toBeInTheDocument());
  });

  it('shows AwardPoints after completion and awards the winner the point value', async () => {
    const user = userEvent.setup();
    const { onAwardPoints, onNextGame } = renderWrapper({ pointValue: 3 });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());

    await user.click(screen.getByText('Spiel beenden'));
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    expect(onAwardPoints).toHaveBeenCalledTimes(1);
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 3);
    expect(onNextGame).toHaveBeenCalledTimes(1);
  });

  it('awards both teams on Unentschieden', async () => {
    const user = userEvent.setup();
    const { onAwardPoints, onNextGame } = renderWrapper({ pointValue: 2 });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    await user.click(screen.getByText('Spiel beenden'));
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Unentschieden' }));
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 2);
    expect(onAwardPoints).toHaveBeenCalledWith('team2', 2);
    expect(onNextGame).toHaveBeenCalledTimes(1);
  });

  it('skips the points screen with skipPointsScreen and goes straight to the next game', async () => {
    const user = userEvent.setup();
    const onNextShow = vi.fn();
    const { onAwardPoints, onNextGame } = renderWrapper({ skipPointsScreen: true, onNextShow });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    await user.click(screen.getByText('Spiel beenden'));

    expect(screen.queryByText('Punkte vergeben')).not.toBeInTheDocument();
    expect(onNextShow).toHaveBeenCalledTimes(1);
    expect(onNextGame).toHaveBeenCalledTimes(1);
    expect(onAwardPoints).not.toHaveBeenCalled();
  });

  it('skips the points screen when the point system is disabled', async () => {
    const user = userEvent.setup();
    const { onAwardPoints, onNextGame } = renderWrapper({ pointSystemEnabled: false });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    await user.click(screen.getByText('Spiel beenden'));

    expect(screen.queryByText('Punkte vergeben')).not.toBeInTheDocument();
    expect(onNextGame).toHaveBeenCalledTimes(1);
    expect(onAwardPoints).not.toHaveBeenCalled();
  });
});
