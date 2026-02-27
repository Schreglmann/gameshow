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

  it('renders both team buttons', () => {
    render(<AwardPoints onComplete={vi.fn()} />);
    expect(screen.getByText('Team 1')).toBeInTheDocument();
    expect(screen.getByText('Team 2')).toBeInTheDocument();
  });

  it('has disabled "Nächstes Spiel" button by default', () => {
    render(<AwardPoints onComplete={vi.fn()} />);
    const nextButton = screen.getByText('Nächstes Spiel');
    expect(nextButton).toBeDisabled();
  });

  it('shows warning when no team is selected', () => {
    render(<AwardPoints onComplete={vi.fn()} />);
    expect(
      screen.getByText('Bitte wähle mindestens ein Team aus')
    ).toBeInTheDocument();
  });

  it('enables button after selecting team 1', async () => {
    const user = userEvent.setup();
    render(<AwardPoints onComplete={vi.fn()} />);

    await user.click(screen.getByText('Team 1'));
    expect(screen.getByText('Nächstes Spiel')).not.toBeDisabled();
  });

  it('enables button after selecting team 2', async () => {
    const user = userEvent.setup();
    render(<AwardPoints onComplete={vi.fn()} />);

    await user.click(screen.getByText('Team 2'));
    expect(screen.getByText('Nächstes Spiel')).not.toBeDisabled();
  });

  it('allows selecting both teams', async () => {
    const user = userEvent.setup();
    render(<AwardPoints onComplete={vi.fn()} />);

    await user.click(screen.getByText('Team 1'));
    await user.click(screen.getByText('Team 2'));
    expect(screen.getByText('Nächstes Spiel')).not.toBeDisabled();
  });

  it('toggles team selection on second click', async () => {
    const user = userEvent.setup();
    render(<AwardPoints onComplete={vi.fn()} />);

    await user.click(screen.getByText('Team 1'));
    expect(screen.getByText('Nächstes Spiel')).not.toBeDisabled();

    await user.click(screen.getByText('Team 1')); // deselect
    expect(screen.getByText('Nächstes Spiel')).toBeDisabled();
  });

  it('calls onComplete with correct winners when team1 is selected', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<AwardPoints onComplete={onComplete} />);

    await user.click(screen.getByText('Team 1'));
    await user.click(screen.getByText('Nächstes Spiel'));

    expect(onComplete).toHaveBeenCalledWith({ team1: true, team2: false });
  });

  it('calls onComplete with correct winners when team2 is selected', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<AwardPoints onComplete={onComplete} />);

    await user.click(screen.getByText('Team 2'));
    await user.click(screen.getByText('Nächstes Spiel'));

    expect(onComplete).toHaveBeenCalledWith({ team1: false, team2: true });
  });

  it('calls onComplete with both teams when both are selected', async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<AwardPoints onComplete={onComplete} />);

    await user.click(screen.getByText('Team 1'));
    await user.click(screen.getByText('Team 2'));
    await user.click(screen.getByText('Nächstes Spiel'));

    expect(onComplete).toHaveBeenCalledWith({ team1: true, team2: true });
  });

  it('adds active class when team is selected', async () => {
    const user = userEvent.setup();
    render(<AwardPoints onComplete={vi.fn()} />);

    const team1Button = screen.getByText('Team 1');
    expect(team1Button.className).not.toContain('active');

    await user.click(team1Button);
    expect(team1Button.className).toContain('active');
  });
});
