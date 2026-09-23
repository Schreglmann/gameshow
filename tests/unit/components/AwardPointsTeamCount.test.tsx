import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AwardPoints, { selectedTeams, drawHint } from '@/components/common/AwardPoints';
import { GameProvider } from '@/context/GameContext';
import { teamKeys } from '@/utils/teams';
import type { ReactNode } from 'react';

const fetchSettings = vi.fn();
vi.mock('@/services/api', () => ({ fetchSettings: (...a: unknown[]) => fetchSettings(...a) }));

afterEach(() => localStorage.clear());

/**
 * The award screen renders one card per ACTIVE team; any subset may win.
 * See specs/team-count.md.
 */
function renderAward(teamCount: number, props: Record<string, unknown> = {}) {
  fetchSettings.mockResolvedValue({
    pointSystemEnabled: teamCount > 0,
    teamCount,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
    globalRules: [],
  });
  const handlers = { onToggle: vi.fn(), onConfirm: vi.fn() };
  const Wrapped = ({ children }: { children: ReactNode }) => <GameProvider>{children}</GameProvider>;
  render(
    <AwardPoints
      selected={{}}
      points={{ team1: 3, team2: 3, team3: 3, team4: 3 }}
      onToggle={handlers.onToggle}
      onConfirm={handlers.onConfirm}
      {...props}
    />,
    { wrapper: Wrapped },
  );
  return handlers;
}

const cards = () => screen.getAllByRole('button', { pressed: undefined })
  .filter(b => b.className.includes('award-team-card'));
const confirmButton = () => screen.getByRole('button', { name: 'Punkte vergeben & weiter' });

describe('one card per active team', () => {
  it.each([[1, []], [2, ['Team 1', 'Team 2']],
           [3, ['Team 1', 'Team 2', 'Team 3']],
           [4, ['Team 1', 'Team 2', 'Team 3', 'Team 4']]] as const)(
    'renders %i card(s)', async (count, names) => {
      renderAward(count);
      await waitFor(() => expect(cards()).toHaveLength(count));
      for (const name of names) expect(screen.getByText(name)).toBeInTheDocument();
      // Teams beyond the count must not leak in from a previous show.
      if (count < 4) expect(screen.queryByText('Team 4')).not.toBeInTheDocument();
    });

  it('names no team at all on the solo card — it shows its point value instead', async () => {
    // At 1 team the audience plays the show itself: there is no team, so
    // labelling the card "Team 1" would invent one and imply an opponent. The
    // card IS the round's points, so it states them from the start rather than
    // only once something is picked. See specs/team-count.md.
    renderAward(1);
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(screen.queryByText('Team 1')).not.toBeInTheDocument();
    expect(document.querySelector('.award-team-card-name')).toBeNull();
    expect(document.querySelector('.award-team-card-points')!.textContent).toBe('0 Punkte');
  });

  it('lets a solo team be awarded with one toggle plus confirm', async () => {
    const user = userEvent.setup();
    const h = renderAward(1);
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(confirmButton()).toBeDisabled();
    await user.click(cards()[0]!);
    expect(h.onToggle).toHaveBeenCalledWith('team1');
  });

  it('asks whether the round was won, without naming a team', async () => {
    // "Welches Team hat gewonnen?" is meaningless when there is only one, and
    // naming that one contradicts "no teams" — so the hint asks about the round.
    renderAward(1);
    await waitFor(() =>
      expect(screen.getByText('Wurde die Runde gewonnen?')).toBeInTheDocument());
    expect(screen.queryByText(/Team 1/)).not.toBeInTheDocument();
  });

  it('enables confirm as soon as any single team is selected at 4 teams', async () => {
    renderAward(4, { selected: { team3: true } });
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    expect(screen.getByText('Team 3 hat gewonnen')).toBeInTheDocument();
  });

  it('shows points only for the selected teams', async () => {
    renderAward(4, { selected: { team2: true, team4: true } });
    await waitFor(() => expect(cards()).toHaveLength(4));
    expect(screen.getAllByText('+3 Punkte')).toHaveLength(2);
    expect(screen.getAllByText('0 Punkte')).toHaveLength(2);
  });

  it('routes a toggle to the right team key at 4 teams', async () => {
    const user = userEvent.setup();
    const h = renderAward(4);
    await waitFor(() => expect(cards()).toHaveLength(4));
    await user.click(screen.getByText('Team 4'));
    expect(h.onToggle).toHaveBeenCalledWith('team4');
  });

  it('renders per-team count lines from a sparse record', async () => {
    renderAward(3, { selected: { team1: true }, counts: { team1: '2 Fragen', team3: '1 Frage' } });
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(screen.getByText('2 Fragen')).toBeInTheDocument();
    expect(screen.getByText('1 Frage')).toBeInTheDocument();
  });
});

describe('draw wording', () => {
  it('keeps the exact historic sentence at two teams', () => {
    // The regression bar: a two-team show must read identically to before.
    expect(drawHint({}, teamKeys(2), teamKeys(2)))
      .toBe('Unentschieden — beide Teams erhalten Punkte');
  });

  it('says "alle Teams" when every team of a 3-4 team show ties', () => {
    expect(drawHint({}, teamKeys(3), teamKeys(3)))
      .toBe('Unentschieden — alle Teams erhalten Punkte');
    expect(drawHint({}, teamKeys(4), teamKeys(4)))
      .toBe('Unentschieden — alle Teams erhalten Punkte');
  });

  it('names the tied teams on a PARTIAL draw, which only exists at 3+', () => {
    expect(drawHint({}, ['team1', 'team3'], teamKeys(4)))
      .toBe('Unentschieden — Team 1 und Team 3 erhalten Punkte');
    expect(drawHint({}, ['team1', 'team2', 'team3'], teamKeys(4)))
      .toBe('Unentschieden — Team 1, Team 2 und Team 3 erhalten Punkte');
  });

  it('uses the custom names the operator set', () => {
    expect(drawHint({ team1Name: 'Adler', team3Name: 'Füchse' }, ['team1', 'team3'], teamKeys(4)))
      .toBe('Unentschieden — Adler und Füchse erhalten Punkte');
  });

  it('renders the partial-draw hint on screen', async () => {
    renderAward(4, { selected: { team1: true, team3: true } });
    await waitFor(() =>
      expect(screen.getByText('Unentschieden — Team 1 und Team 3 erhalten Punkte')).toBeInTheDocument());
  });
});

describe('selectedTeams', () => {
  it('returns the picked teams in the given display order', () => {
    expect(selectedTeams({ team3: true, team1: true }, teamKeys(4))).toEqual(['team1', 'team3']);
    expect(selectedTeams({ team3: true, team1: true }, ['team4', 'team3', 'team2', 'team1']))
      .toEqual(['team3', 'team1']);
  });

  it('ignores teams that are not in play', () => {
    // A stale selection from a 4-team show must not award in a 2-team one.
    expect(selectedTeams({ team1: true, team4: true }, teamKeys(2))).toEqual(['team1']);
  });

  it('treats a false/absent flag as unselected', () => {
    expect(selectedTeams({ team1: false }, teamKeys(2))).toEqual([]);
    expect(selectedTeams({}, teamKeys(4))).toEqual([]);
  });
});
