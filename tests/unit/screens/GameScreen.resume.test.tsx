import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GameScreen from '@/components/screens/GameScreen';
import {
  getShowPosition, hydratePlaythroughStore, noteShowPhase, peekBootResume, setShowPosition,
} from '@/utils/gamePlaythroughStore';
import type { GameComponentProps } from '@/components/games/types';

// GameScreen decides whether a reload resumes the game it lands on: only when the
// URL index AND the loaded game match the saved position. See specs/crash-recovery.md.

const gameIdsByIndex: Record<number, string> = { 3: 'quiz/v1', 4: 'other/v1' };

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({ pointSystemEnabled: true, teamRandomizationEnabled: true, globalRules: [] }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
  fetchGameData: vi.fn((index: number) => Promise.resolve({
    gameId: gameIdsByIndex[index] ?? `game-${index}`,
    currentIndex: index,
    totalGames: 10,
    pointSystemEnabled: true,
    config: { type: 'simple-quiz', title: 'Quiz', rules: [], questions: [] },
  })),
}));

// Records what the token looked like at the moment the game first rendered.
const seenAtRender: Array<{ gameId: string; resume: ReturnType<typeof peekBootResume> }> = [];
vi.mock('@/components/games/GameFactory', () => ({
  default: (props: GameComponentProps) => {
    seenAtRender.push({ gameId: props.gameId, resume: peekBootResume() });
    return <div>Spiel {props.gameId}</div>;
  },
}));

function NavButton({ to }: { to: string }) {
  const navigate = useNavigate();
  return <button onClick={() => navigate(to)}>weiter</button>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <ThemeProvider>
        <GameProvider>
          <Routes>
            <Route path="/game" element={<><GameScreen /><NavButton to="/game?index=4" /></>} />
          </Routes>
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

function reloadedOn(gameIndex: number, gameId: string) {
  setShowPosition(gameIndex, gameId);
  noteShowPhase(gameIndex, 'game');
  hydratePlaythroughStore();
}

describe('GameScreen reload resume', () => {
  beforeEach(() => {
    seenAtRender.length = 0;
  });

  it('keeps the token when the URL index and the loaded game match', async () => {
    reloadedOn(3, 'quiz/v1');
    renderAt('/game?index=3');
    await waitFor(() => expect(screen.getByText('Spiel quiz/v1')).toBeInTheDocument());
    expect(seenAtRender[0]!.resume).toMatchObject({ gameIndex: 3, gameId: 'quiz/v1', phase: 'game' });
  });

  it('drops the token when the slot now holds a different game', async () => {
    reloadedOn(3, 'renamed/v1');
    renderAt('/game?index=3');
    await waitFor(() => expect(screen.getByText('Spiel quiz/v1')).toBeInTheDocument());
    expect(seenAtRender[0]!.resume).toBeNull();
  });

  it('drops the token when the tab opens on another index', async () => {
    reloadedOn(5, 'quiz/v1');
    renderAt('/game?index=3');
    await waitFor(() => expect(screen.getByText('Spiel quiz/v1')).toBeInTheDocument());
    expect(seenAtRender[0]!.resume).toBeNull();
  });

  it('records the loaded game as the position and drops the token on navigation', async () => {
    reloadedOn(3, 'quiz/v1');
    renderAt('/game?index=3');
    await waitFor(() => expect(screen.getByText('Spiel quiz/v1')).toBeInTheDocument());
    expect(getShowPosition()).toMatchObject({ gameIndex: 3, gameId: 'quiz/v1' });

    screen.getByText('weiter').click();
    await waitFor(() => expect(screen.getByText('Spiel other/v1')).toBeInTheDocument());
    expect(peekBootResume()).toBeNull();
    expect(getShowPosition()).toEqual({ gameIndex: 4, gameId: 'other/v1', phase: 'landing' });
  });
});
