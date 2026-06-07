import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import WerKenntMehr from '@/components/games/WerKenntMehr';
import type { WerKenntMehrConfig } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: false,
    globalRules: [],
  }),
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

function makeConfig(overrides: Partial<WerKenntMehrConfig> = {}): WerKenntMehrConfig {
  return {
    type: 'wer-kennt-mehr',
    title: 'Test WKM',
    rules: ['Rule 1'],
    questions: [
      // Index 0 is the non-scoring Beispiel (practice) round.
      { question: 'Beispiel Q', answerList: ['x', 'y'] },
      { question: 'Hauptstädte', answerList: ['Berlin', 'Paris', 'Madrid'] },
      { question: 'Planeten', answer: 'Merkur, Venus' },
    ],
    ...overrides,
  };
}

function renderGame(config?: WerKenntMehrConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <WerKenntMehr {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

/** Advance landing -> rules -> game via ArrowRight (mirrors SimpleQuiz tests). */
async function advanceToGame() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
}

/** Click an element outside the quiz card to trigger the global nav-forward. */
async function navForward(user: ReturnType<typeof userEvent.setup>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  await user.click(div);
  document.body.removeChild(div);
}

describe('WerKenntMehr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as any).Audio = class MockAudio {
      src = '';
      volume = 1;
      paused = true;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor(src?: string) { if (src) this.src = src; }
    };
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
  });

  it('shows the Beispiel label and reveals the examples grid', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();

    await waitFor(() => expect(screen.getByText('Beispiel Frage')).toBeInTheDocument());
    expect(screen.queryByText('x')).not.toBeInTheDocument();

    await navForward(user); // reveal examples
    await waitFor(() => {
      expect(document.querySelector('.wkm-examples')).toBeInTheDocument();
      expect(screen.getByText('x')).toBeInTheDocument();
      expect(screen.getByText('y')).toBeInTheDocument();
    });
  });

  it('does NOT award points on the Beispiel round', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel Frage')).toBeInTheDocument());

    await navForward(user); // reveal Beispiel examples
    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    await user.click(screen.getByRole('button', { name: 'Weiter' }));

    // Advancing past the example must not award any points.
    expect(defaultProps.onAwardPoints).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());
  });

  it('awards the entered count to the selected team on a real question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();

    // Skip the Beispiel: reveal then advance to question 1.
    await navForward(user);
    await navForward(user);
    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());

    await navForward(user); // reveal examples + scoring panel
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    await user.type(screen.getByPlaceholderText('Anzahl'), '12');
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 12);
    // Exactly one award — guards against double-counting.
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
  });

  it('splits the points when both teams are selected (tie)', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();
    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to question 1
    await navForward(user); // reveal question 1
    await waitFor(() => expect(screen.getByText('Berlin')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    await user.click(screen.getByRole('button', { name: 'Team 2' }));
    await user.type(screen.getByPlaceholderText('Anzahl'), '10');
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 5);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 5);
    // One award per team, no more.
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(2);
  });

  it('completes the game after the last question', async () => {
    const user = userEvent.setup();
    // One Beispiel + one real (the real one is the last).
    renderGame(makeConfig({
      questions: [
        { question: 'Beispiel Q', answerList: ['x'] },
        { question: 'Letzte Frage', answer: 'Eins, Zwei' },
      ],
    }));
    await waitFor(() => expect(screen.getByText('Test WKM')).toBeInTheDocument());
    await advanceToGame();

    await navForward(user); // reveal Beispiel
    await navForward(user); // advance to the last question
    await waitFor(() => expect(screen.getByText('Frage 1 von 1')).toBeInTheDocument());

    await navForward(user); // reveal
    await user.click(screen.getByRole('button', { name: 'Team 2' }));
    await user.type(screen.getByPlaceholderText('Anzahl'), '7');
    await user.click(screen.getByRole('button', { name: 'Punkte vergeben' }));

    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 7);
    await waitFor(() => expect(defaultProps.onNextGame).toHaveBeenCalled());
  });
});
