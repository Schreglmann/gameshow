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

function renderAward(onComplete: (w: { team1: boolean; team2: boolean }) => void): void {
  const Wrapped = ({ children }: { children: ReactNode }) => <GameProvider>{children}</GameProvider>;
  render(<AwardPoints onComplete={onComplete} />, { wrapper: Wrapped });
}

describe('AwardPoints', () => {
  it('renders the heading and hint', () => {
    renderAward(vi.fn());
    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    expect(screen.getByText('Welches Team hat gewonnen?')).toBeInTheDocument();
  });

  it('renders all three outcome buttons', () => {
    renderAward(vi.fn());
    expect(screen.getByText('Team 1')).toBeInTheDocument();
    expect(screen.getByText('Team 2')).toBeInTheDocument();
    expect(screen.getByText('Unentschieden')).toBeInTheDocument();
  });

  it('calls onComplete with team1 win when Team 1 is clicked', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderAward(onComplete);

    await user.click(screen.getByText('Team 1'));

    expect(onComplete).toHaveBeenCalledWith({ team1: true, team2: false });
  });

  it('calls onComplete with team2 win when Team 2 is clicked', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderAward(onComplete);

    await user.click(screen.getByText('Team 2'));

    expect(onComplete).toHaveBeenCalledWith({ team1: false, team2: true });
  });

  it('calls onComplete with both teams when Unentschieden is clicked', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderAward(onComplete);

    await user.click(screen.getByText('Unentschieden'));

    expect(onComplete).toHaveBeenCalledWith({ team1: true, team2: true });
  });

  it('calls onComplete immediately on first click with no prior interaction required', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderAward(onComplete);

    await user.click(screen.getByText('Team 1'));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('renders custom team names from team state', async () => {
    localStorage.setItem('team1Name', 'Die Adler');
    localStorage.setItem('team2Name', 'Quizfüchse');
    renderAward(vi.fn());
    expect(await screen.findByText('Die Adler')).toBeInTheDocument();
    expect(screen.getByText('Quizfüchse')).toBeInTheDocument();
  });

  it('orders the team buttons by the frontend order when swapped (callbacks unchanged)', async () => {
    localStorage.setItem('teamOrderSwapped', 'true');
    const user = userEvent.setup();
    const onComplete = vi.fn();
    renderAward(onComplete);

    // Order depends on teamMirrorEnabled, which loads async from /api/settings.
    await vi.waitFor(() => {
      const buttons = document.querySelectorAll('.award-team-button');
      expect(buttons[0]?.textContent).toContain('Team 2');
      expect(buttons[1]?.textContent).toContain('Team 1');
      expect(buttons[2]?.textContent).toContain('Unentschieden');
    });

    // Position changed, but each button still awards the right team.
    const buttons = document.querySelectorAll('.award-team-button');
    await user.click(buttons[0] as HTMLElement);
    expect(onComplete).toHaveBeenCalledWith({ team1: false, team2: true });
  });
});
