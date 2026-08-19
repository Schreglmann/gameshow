import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, act, waitFor, type RenderOptions } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameProvider } from '@/context/GameContext';
import BaseGameWrapper from '@/components/games/BaseGameWrapper';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import * as backendSocket from '@/services/useBackendSocket';
import type { ReactElement } from 'react';

/**
 * The award screen's selection: what it opens with, who may change it, and what
 * one confirm actually books. See specs/point-system.md.
 */

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
}));

function render(ui: ReactElement, options?: RenderOptions) {
  return rtlRender(ui, {
    wrapper: ({ children }) => <GameProvider>{children}</GameProvider>,
    ...options,
  });
}

/** Seed the gamemaster's per-question tally for game index 0. */
function seedTally(team1: number, team2: number) {
  localStorage.setItem('correctAnswersByQuestion', JSON.stringify({ 0: { 1: { team1, team2 } } }));
}

const onAwardPoints = vi.fn();
const onNextGame = vi.fn();

const props = {
  title: 'Test Game',
  rules: [],
  totalQuestions: 2,
  pointSystemEnabled: true,
  pointValue: 3,
  currentIndex: 0,
  onAwardPoints,
  onNextGame,
  children: ({ onGameComplete }: { onGameComplete: () => void }) => (
    <button data-testid="complete-game" onClick={onGameComplete}>Complete</button>
  ),
};

async function toAwardScreen(user: ReturnType<typeof userEvent.setup>) {
  render(<BaseGameWrapper {...props} />);
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  await user.click(screen.getByTestId('complete-game'));
  await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
}

const confirmButton = () => screen.getByRole('button', { name: 'Punkte vergeben & weiter' });
const card = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe('Award screen selection', () => {
  it('opens with nothing selected when nobody kept score', async () => {
    const user = userEvent.setup();
    await toAwardScreen(user);

    expect(document.querySelector('.award-team-card.is-selected')).not.toBeInTheDocument();
    // Neither the points nor the count line say anything before a team is picked.
    expect(document.querySelector('.award-team-card-points')).not.toBeInTheDocument();
    expect(document.querySelector('.award-team-card-count')).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('preselects the team leading the gamemaster tally, with its count', async () => {
    seedTally(3, 1);
    const user = userEvent.setup();
    await toAwardScreen(user);

    expect(card(/Team 1/)).toHaveClass('is-selected');
    expect(card(/Team 2/)).not.toHaveClass('is-selected');
    expect(screen.getByText('3 richtige Antworten')).toBeInTheDocument();
    expect(screen.getByText('1 richtige Antwort')).toBeInTheDocument();
    expect(screen.getByText('+3 Punkte')).toBeInTheDocument();
    expect(screen.getByText('0 Punkte')).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  it('preselects both teams on an equal tally', async () => {
    seedTally(2, 2);
    const user = userEvent.setup();
    await toAwardScreen(user);

    expect(screen.getByText('Unentschieden — beide Teams erhalten Punkte')).toBeInTheDocument();
    expect(document.querySelectorAll('.award-team-card.is-selected')).toHaveLength(2);
  });

  it('lets the host override a preselection, and books only what is selected', async () => {
    seedTally(3, 1);
    const user = userEvent.setup();
    await toAwardScreen(user);

    await user.click(card(/Team 1/));   // drop the preselected leader
    await user.click(card(/Team 2/));   // hand it to the other team
    expect(screen.getByText('Team 2 hat gewonnen')).toBeInTheDocument();

    await user.click(confirmButton());

    expect(onAwardPoints).toHaveBeenCalledWith('team2', 3);
    expect(onAwardPoints).toHaveBeenCalledTimes(1);
    expect(onNextGame).toHaveBeenCalled();
  });

  it('books nothing while the selection is empty', async () => {
    seedTally(3, 1);
    const user = userEvent.setup();
    await toAwardScreen(user);

    await user.click(card(/Team 1/)); // deselect the only selected team
    expect(confirmButton()).toBeDisabled();

    await user.click(confirmButton());
    expect(onAwardPoints).not.toHaveBeenCalled();
    expect(onNextGame).not.toHaveBeenCalled();
  });

  it('mirrors the show selection to the gamemaster and takes its commands', async () => {
    const user = userEvent.setup();
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    await toAwardScreen(user);

    type Ctrl = { id: string; buttons?: { id: string; active?: boolean }[]; disabled?: boolean };
    const lastControls = () => {
      const calls = sendWsSpy.mock.calls.filter(([ch]) => ch === 'gamemaster-controls');
      return (calls[calls.length - 1]?.[1] as { controls?: Ctrl[] })?.controls ?? [];
    };

    // GM toggles team 1 → the show's card follows and the GM mirror marks it active.
    act(() => { __emitChannelForTests('gamemaster-command', { controlId: 'award-toggle-team1', timestamp: 1 }); });
    await waitFor(() => expect(card(/Team 1/)).toHaveClass('is-selected'));
    await waitFor(() => {
      const group = lastControls().find(c => c.id === 'award-selection');
      expect(group?.buttons?.find(b => b.id === 'award-toggle-team1')?.active).toBe(true);
      expect(lastControls().find(c => c.id === 'award-confirm')?.disabled).toBe(false);
    });

    // ...and the GM's confirm books it.
    act(() => { __emitChannelForTests('gamemaster-command', { controlId: 'award-confirm', timestamp: 2 }); });
    await waitFor(() => expect(onAwardPoints).toHaveBeenCalledWith('team1', 3));
    expect(onNextGame).toHaveBeenCalled();
    sendWsSpy.mockRestore();
  });

  it('still honours the pre-toggle award ids from an older gamemaster bundle', async () => {
    const user = userEvent.setup();
    await toAwardScreen(user);

    act(() => { __emitChannelForTests('gamemaster-command', { controlId: 'award-draw', timestamp: 3 }); });

    await waitFor(() => expect(onAwardPoints).toHaveBeenCalledWith('team1', 3));
    expect(onAwardPoints).toHaveBeenCalledWith('team2', 3);
  });
});
