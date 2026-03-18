import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AwardPoints from '@/components/common/AwardPoints';

describe('AwardPoints', () => {
  it('renders the heading and hint', () => {
    render(<AwardPoints onComplete={vi.fn()} />);
    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    expect(screen.getByText('Welches Team hat gewonnen?')).toBeInTheDocument();
  });

  it('renders all three outcome buttons', () => {
    render(<AwardPoints onComplete={vi.fn()} />);
    expect(screen.getByText('Team 1')).toBeInTheDocument();
    expect(screen.getByText('Team 2')).toBeInTheDocument();
    expect(screen.getByText('Unentschieden')).toBeInTheDocument();
  });

  it('calls onComplete with team1 win when Team 1 is clicked', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<AwardPoints onComplete={onComplete} />);

    await user.click(screen.getByText('Team 1'));

    expect(onComplete).toHaveBeenCalledWith({ team1: true, team2: false });
  });

  it('calls onComplete with team2 win when Team 2 is clicked', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<AwardPoints onComplete={onComplete} />);

    await user.click(screen.getByText('Team 2'));

    expect(onComplete).toHaveBeenCalledWith({ team1: false, team2: true });
  });

  it('calls onComplete with both teams when Unentschieden is clicked', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<AwardPoints onComplete={onComplete} />);

    await user.click(screen.getByText('Unentschieden'));

    expect(onComplete).toHaveBeenCalledWith({ team1: true, team2: true });
  });

  it('calls onComplete immediately on first click with no prior interaction required', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<AwardPoints onComplete={onComplete} />);

    await user.click(screen.getByText('Team 1'));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
