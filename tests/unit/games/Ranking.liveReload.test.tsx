import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import Ranking from '@/components/games/Ranking';
import type { RankingConfig } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({ pointSystemEnabled: true, teamRandomizationEnabled: true, globalRules: [] }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

function makeConfig(answers: string[]): RankingConfig {
  return { type: 'ranking', title: 'Reihenfolge', rules: ['R'], questions: [{ question: 'Frage', answers }] };
}

function tree(config: RankingConfig) {
  return (
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <Ranking {...defaultProps} config={config} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function key(k: string) {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: k })); });
}

function revealedTexts(): string[] {
  return Array.from(document.querySelectorAll('.statement .ranking-text')).map(el => el.textContent || '');
}

async function enterGameAndReveal(count: number) {
  await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
  key('ArrowRight'); // landing → rules
  key('ArrowRight'); // rules → game
  await waitFor(() => expect(screen.getByText('Frage')).toBeInTheDocument());
  for (let i = 0; i < count; i++) key('ArrowRight');
}

describe('Ranking — live answer edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('deleting a revealed answer removes it without sliding the next one into view', async () => {
    const { rerender } = render(tree(makeConfig(['A', 'B', 'C', 'D'])));
    await enterGameAndReveal(3);
    await waitFor(() => expect(revealedTexts()).toEqual(['A', 'B', 'C']));

    // Delete the revealed answer 'C'.
    rerender(tree(makeConfig(['A', 'B', 'D'])));
    await waitFor(() => expect(revealedTexts()).toEqual(['A', 'B']));

    // The next reveal shows 'D' — the deletion left the reveal ready for it.
    key('ArrowRight');
    await waitFor(() => expect(revealedTexts()).toEqual(['A', 'B', 'D']));
  });

  it('deleting an unrevealed answer leaves the revealed prefix unchanged', async () => {
    const { rerender } = render(tree(makeConfig(['A', 'B', 'C', 'D'])));
    await enterGameAndReveal(2);
    await waitFor(() => expect(revealedTexts()).toEqual(['A', 'B']));

    rerender(tree(makeConfig(['A', 'B', 'C']))); // 'D' (unrevealed) deleted
    expect(revealedTexts()).toEqual(['A', 'B']);
  });

  it('editing a revealed answer\'s text keeps it revealed (no collapse on typo fix)', async () => {
    const { rerender } = render(tree(makeConfig(['A', 'B', 'C', 'D'])));
    await enterGameAndReveal(2);
    await waitFor(() => expect(revealedTexts()).toEqual(['A', 'B']));

    rerender(tree(makeConfig(['A', 'Bee', 'C', 'D']))); // typo fix on the revealed 'B'
    await waitFor(() => expect(revealedTexts()).toEqual(['A', 'Bee']));
  });
});
