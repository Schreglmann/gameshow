// Spec: specs/player-stats.md
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlayerStats from '@/components/backend/PlayerStats';
import type { GameFileSummary, GameshowConfig } from '@/types/config';

const games = [
  { fileName: 'quiz', title: 'Allgemeinwissen', type: 'simple-quiz', isSingleInstance: true, instances: [] },
  { fileName: 'bandle', title: 'Bandle', type: 'bandle', isSingleInstance: true, instances: [] },
] as unknown as GameFileSummary[];

// Config order is the timeline: "past" happened, "next" is the active (upcoming) one.
const gameshows: Record<string, GameshowConfig> = {
  past: { name: 'Pub Quiz Mai', gameOrder: ['quiz'], players: ['anna'] },
  next: { name: 'Pub Quiz Juni', gameOrder: ['bandle'], players: ['anna'] },
};

function renderStats() {
  return render(
    <PlayerStats
      playerId="anna"
      playerName="Anna Müller"
      games={games}
      gameshows={gameshows}
      referenceIndex={1}
      onNavigateToGameshow={vi.fn()}
    />,
  );
}

describe('PlayerStats', () => {
  it('starts played gameshows collapsed and upcoming ones expanded', () => {
    renderStats();
    const toggles = screen.getAllByRole('button', { name: /Ausklappen|Einklappen/ });
    // Played (Mai): collapsed — its game is hidden.
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: /Allgemeinwissen/ })).not.toBeInTheDocument();
    // Upcoming (Juni): expanded — its game is listed.
    expect(toggles[1]).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Bandle/ })).toBeInTheDocument();
  });

  it('expands a played gameshow on click and collapses an upcoming one', async () => {
    const user = userEvent.setup();
    renderStats();
    const [played, upcoming] = screen.getAllByRole('button', { name: /Ausklappen|Einklappen/ });
    await user.click(played!);
    expect(screen.getByRole('button', { name: /Allgemeinwissen/ })).toBeInTheDocument();
    await user.click(upcoming!);
    expect(screen.queryByRole('button', { name: /Bandle/ })).not.toBeInTheDocument();
  });
});
