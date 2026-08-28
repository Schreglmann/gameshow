import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { render as rtlRender, screen, act, waitFor, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider } from '@/context/GameContext';
import BaseGameWrapper from '@/components/games/BaseGameWrapper';
import { fetchSettings } from '@/services/api';
import * as backendSocket from '@/services/useBackendSocket';
import type { PointMode } from '@/types/config';
import type { AutoAwardVerdict } from '@/components/common/AwardPoints';
import type { ReactElement } from 'react';

/**
 * The two non-positional point modes: `flat` and `per-correct-answer`.
 * See specs/point-system.md.
 */

vi.mock('@/services/api', () => ({ fetchSettings: vi.fn() }));

function mockSettings(pointMode: PointMode) {
  vi.mocked(fetchSettings).mockResolvedValue({
    pointSystemEnabled: true,
    teamCount: 2,
    pointMode,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: false,
    globalRules: [],
    enabledJokers: [],
  });
}

function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, {
    wrapper: ({ children }) => <GameProvider>{children}</GameProvider>,
    ...options,
  });
}

/** The gamemaster's per-question tally for game index 3, before anything mounts. */
function seedTally(team1: number, team2: number) {
  localStorage.setItem('correctAnswersByQuestion', JSON.stringify({ 3: { 1: { team1, team2 } } }));
}

function AutoAwardChildren({ onGameComplete, setAutoAward }: {
  onGameComplete: () => void;
  setAutoAward: (v: AutoAwardVerdict | null) => void;
}) {
  useEffect(() => {
    setAutoAward({ wins: { team1: 0, team2: 2 }, scoredQuestions: 2, winners: { team2: true } });
  }, [setAutoAward]);
  return <button data-testid="complete-game" onClick={onGameComplete}>Complete</button>;
}

const onAwardPoints = vi.fn();
const onNextGame = vi.fn();

/** Game index 3 — positional it would be worth 4 points, so every mode is distinguishable. */
const props = {
  title: 'Test Game',
  rules: [],
  totalQuestions: 2,
  pointSystemEnabled: true,
  currentIndex: 3,
  onAwardPoints,
  onNextGame,
  children: ({ onGameComplete }: { onGameComplete: () => void }) => (
    <button data-testid="complete-game" onClick={onGameComplete}>Complete</button>
  ),
};

async function toAwardScreen(user: ReturnType<typeof userEvent.setup>, extra: object = {}) {
  render(<BaseGameWrapper {...props} {...extra} />);
  // No rules, so one forward press goes straight from landing into the game.
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  await user.click(screen.getByTestId('complete-game'));
  await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
}

beforeEach(() => {
  localStorage.clear();
  onAwardPoints.mockClear();
  onNextGame.mockClear();
});

describe('pointMode: flat', () => {
  it('books 1 point regardless of the game position', async () => {
    mockSettings('flat');
    const user = userEvent.setup();
    await toAwardScreen(user);

    await user.click(screen.getByText('Team 1'));
    // Position 3 would be worth 4 positionally — flat overrides that everywhere,
    // including the card preview, which is built from the same value it books.
    expect(screen.getByText('+1 Punkt')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));
    expect(onAwardPoints).toHaveBeenCalledExactlyOnceWith('team1', 1);
  });

  it('still lets the host pick the winner', async () => {
    mockSettings('flat');
    const user = userEvent.setup();
    await toAwardScreen(user);
    // Only the value changes — the screen is the same pick-a-winner screen.
    expect(screen.getByRole('button', { name: 'Punkte vergeben & weiter' })).toBeDisabled();
  });
});

describe('pointMode: per-correct-answer', () => {
  it('books each team its own correct-answer count, read-only', async () => {
    seedTally(4, 2);
    mockSettings('per-correct-answer');
    const user = userEvent.setup();
    await toAwardScreen(user);

    expect(screen.getByText('Jede richtige Antwort zählt 1 Punkt')).toBeInTheDocument();
    // Both cards state their points immediately — nothing was picked, so a
    // selection-gated display would show nothing at all.
    expect(screen.getByText('+4 Punkte')).toBeInTheDocument();
    expect(screen.getByText('+2 Punkte')).toBeInTheDocument();
    expect(screen.getByText('4 richtige Antworten')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));
    expect(onAwardPoints).toHaveBeenCalledTimes(2);
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 4);
    expect(onAwardPoints).toHaveBeenCalledWith('team2', 2);
  });

  it('renders the cards as inert statements, not toggles', async () => {
    seedTally(3, 1);
    mockSettings('per-correct-answer');
    const user = userEvent.setup();
    await toAwardScreen(user);

    // No button element at all: nothing to focus, nothing announced as pressable.
    expect(screen.queryByRole('button', { name: /Team 1/ })).toBeNull();
    await user.click(screen.getByText('Team 1'));
    expect(screen.getByText('+3 Punkte')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));
    // The tap on the card changed nothing — team1 is still paid its count.
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 3);
  });

  it('confirms an empty tally without booking anything', async () => {
    mockSettings('per-correct-answer');
    const user = userEvent.setup();
    await toAwardScreen(user);

    // Nobody scored. The host must still be able to advance, and no zero-delta
    // entry may reach the score history.
    const confirm = screen.getByRole('button', { name: 'Punkte vergeben & weiter' });
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    expect(onAwardPoints).not.toHaveBeenCalled();
    expect(onNextGame).toHaveBeenCalledTimes(1);
  });

  it('skips a team that scored nothing', async () => {
    seedTally(2, 0);
    mockSettings('per-correct-answer');
    const user = userEvent.setup();
    await toAwardScreen(user);

    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));
    expect(onAwardPoints).toHaveBeenCalledExactlyOnceWith('team1', 2);
  });

  it('leaves a game without a tally on its own scoring', async () => {
    seedTally(4, 2);
    mockSettings('per-correct-answer');
    const user = userEvent.setup();
    // `hideCorrectTracker` marks the four inline-scored types. They have no tally
    // to pay out, so they fall back to the positional value.
    await toAwardScreen(user, { hideCorrectTracker: true });

    // Still the pick-a-winner screen: the tally only preselects the leader here,
    // it does not become the point value.
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));
    expect(onAwardPoints).toHaveBeenCalledExactlyOnceWith('team1', 4);
  });

  it('doubles the armed team’s count for the Aufholjoker', async () => {
    localStorage.setItem('doubleNextGame', 'team1');
    seedTally(3, 1);
    mockSettings('per-correct-answer');
    const user = userEvent.setup();
    await toAwardScreen(user);

    expect(screen.getByText('+6 Punkte')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben & weiter' }));
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 6);
    expect(onAwardPoints).toHaveBeenCalledWith('team2', 1);
  });

  it('states counts only once when the game also reports an auto verdict', async () => {
    // guessing-game's auto scoring writes wins into the SAME tally this mode pays
    // out — the two must not each get their own summary line on the gamemaster.
    seedTally(0, 2);
    mockSettings('per-correct-answer');
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    const user = userEvent.setup();

    // BaseGameWrapper invokes `children` as a plain function call inside its own
    // render — a hook called directly in that function body would be a hook of
    // BaseGameWrapper itself, called only while `phase === 'game'`. Route through
    // a real component instead, so the effect gets its own, always-consistent
    // hook sequence.
    render(
      <BaseGameWrapper {...props}>
        {({ onGameComplete, setAutoAward }) => <AutoAwardChildren onGameComplete={onGameComplete} setAutoAward={setAutoAward} />}
      </BaseGameWrapper>,
    );
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    await user.click(screen.getByTestId('complete-game'));
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());

    type Ctrl = { id: string; type: string };
    await waitFor(() => {
      const calls = sendWsSpy.mock.calls.filter(([ch]) => ch === 'gamemaster-controls');
      const controls = (calls[calls.length - 1]?.[1] as { controls?: Ctrl[] })?.controls ?? [];
      const infoControls = controls.filter(c => c.type === 'info');
      expect(infoControls).toHaveLength(1);
      expect(infoControls[0]?.id).toBe('award-summary');
    });
    sendWsSpy.mockRestore();
  });
});
