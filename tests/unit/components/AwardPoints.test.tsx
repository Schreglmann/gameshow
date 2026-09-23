import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AwardPoints from '@/components/common/AwardPoints';
import { GameProvider } from '@/context/GameContext';
import type { ReactNode } from 'react';

afterEach(() => localStorage.clear());

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
    globalRules: [],
  }),
}));

function renderAward(props: Partial<Parameters<typeof AwardPoints>[0]> = {}) {
  const handlers = { onToggle: vi.fn(), onConfirm: vi.fn() };
  const Wrapped = ({ children }: { children: ReactNode }) => <GameProvider>{children}</GameProvider>;
  render(
    <AwardPoints
      selected={{ team1: false, team2: false }}
      points={{ team1: 3, team2: 3 }}
      onToggle={handlers.onToggle}
      onConfirm={handlers.onConfirm}
      {...props}
    />,
    { wrapper: Wrapped },
  );
  return handlers;
}

const confirmButton = () => screen.getByRole('button', { name: 'Punkte vergeben & weiter' });

describe('AwardPoints', () => {
  // Both card branches (button and read-only div) must carry it — the read-only
  // one is easy to forget. See specs/team-colors.md.
  it('marks each card with data-team and a colour dot, selectable and read-only', () => {
    renderAward();
    expect(document.querySelectorAll('.award-team-card[data-team]')).toHaveLength(2);
    expect(document.querySelectorAll('.award-team-card .team-dot[data-team]')).toHaveLength(2);
  });

  it('opens with nothing selected: no points, confirm disabled', () => {
    renderAward();
    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    expect(screen.getByText('Welches Team hat gewonnen?')).toBeInTheDocument();
    expect(screen.queryByText(/Punkte$/)).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it('renders one card per team', () => {
    renderAward();
    expect(screen.getByText('Team 1')).toBeInTheDocument();
    expect(screen.getByText('Team 2')).toBeInTheDocument();
    expect(document.querySelectorAll('.award-team-card')).toHaveLength(2);
  });

  it('reports a card press as a toggle, without awarding anything', async () => {
    const user = userEvent.setup();
    const { onToggle, onConfirm } = renderAward();

    await user.click(screen.getByText('Team 1'));

    expect(onToggle).toHaveBeenCalledWith('team1');
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('states the winner and the points once a team is selected', () => {
    renderAward({ selected: { team1: true, team2: false } });
    expect(screen.getByText('Team 1 hat gewonnen')).toBeInTheDocument();
    expect(screen.getByText('+3 Punkte')).toBeInTheDocument();
    expect(screen.getByText('0 Punkte')).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  it('treats both teams selected as a draw', () => {
    renderAward({ selected: { team1: true, team2: true } });
    expect(screen.getByText('Unentschieden — beide Teams erhalten Punkte')).toBeInTheDocument();
    expect(screen.getAllByText('+3 Punkte')).toHaveLength(2);
  });

  it('uses the singular for a one-point game', () => {
    renderAward({ selected: { team1: true, team2: false }, points: { team1: 1, team2: 1 } });
    expect(screen.getByText('+1 Punkt')).toBeInTheDocument();
  });

  it('marks the selected card and exposes it as pressed', () => {
    renderAward({ selected: { team1: false, team2: true } });
    const cards = document.querySelectorAll('.award-team-card');
    expect(cards[0]).not.toHaveClass('is-selected');
    expect(cards[1]).toHaveClass('is-selected');
    expect(cards[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('confirms the current selection', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderAward({ selected: { team1: true, team2: false } });

    await user.click(confirmButton());

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('renders the count line only when counts are supplied', () => {
    renderAward({ counts: { team1: '3 richtige Antworten', team2: '1 richtige Antwort' } });
    expect(screen.getByText('3 richtige Antworten')).toBeInTheDocument();
    expect(screen.getByText('1 richtige Antwort')).toBeInTheDocument();

    document.body.innerHTML = '';
    renderAward();
    expect(document.querySelector('.award-team-card-count')).not.toBeInTheDocument();
  });

  it('shows a supplied hint instead of the derived one', () => {
    renderAward({ selected: { team1: true, team2: false }, hint: 'Team 1 hat mehr Fragen gewonnen' });
    expect(screen.getByText('Team 1 hat mehr Fragen gewonnen')).toBeInTheDocument();
    expect(screen.queryByText('Team 1 hat gewonnen')).not.toBeInTheDocument();
  });

  it('renders a note under the hint', () => {
    renderAward({ note: 'Rundenstand: Team 1 2 – 1 Team 2' });
    expect(screen.getByText('Rundenstand: Team 1 2 – 1 Team 2')).toBeInTheDocument();
  });

  it('renders custom team names from team state', async () => {
    localStorage.setItem('team1Name', 'Die Adler');
    localStorage.setItem('team2Name', 'Quizfüchse');
    renderAward();
    expect(await screen.findByText('Die Adler')).toBeInTheDocument();
    expect(screen.getByText('Quizfüchse')).toBeInTheDocument();
  });

  it('orders the team cards by the frontend order when swapped (callbacks unchanged)', async () => {
    localStorage.setItem('teamOrderSwapped', 'true');
    const user = userEvent.setup();
    const { onToggle } = renderAward();

    // Order depends on teamMirrorEnabled, which loads async from /api/settings.
    await vi.waitFor(() => {
      const cards = document.querySelectorAll('.award-team-card');
      expect(cards[0]?.textContent).toContain('Team 2');
      expect(cards[1]?.textContent).toContain('Team 1');
    });

    // Position changed, but each card still toggles its own team.
    const cards = document.querySelectorAll('.award-team-card');
    await user.click(cards[0] as HTMLElement);
    expect(onToggle).toHaveBeenCalledWith('team2');
  });

  it('renders without its own card surface when inline', () => {
    renderAward({ inline: true });
    expect(document.querySelector('#awardPointsContainer')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.award-team-card')).toHaveLength(2);
  });
});
