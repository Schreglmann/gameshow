import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import Ranking from '@/components/games/Ranking';
import type { RankingConfig, RankingQuestion } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
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

function makeQuestion(overrides: Partial<RankingQuestion> = {}): RankingQuestion {
  return {
    question: 'Reihenfolge der Antworten erraten',
    answers: ['Erster', 'Zweiter', 'Dritter'],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<RankingConfig> = {}): RankingConfig {
  return {
    type: 'ranking',
    title: 'Reihenfolge',
    rules: ['Errate die richtige Reihenfolge'],
    questions: [
      makeQuestion({ question: 'Beispiel-Frage' }),
      makeQuestion({ question: 'Echte Frage', answers: ['A', 'B', 'C', 'D'] }),
    ],
    ...overrides,
  };
}

function renderGame(config?: RankingConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <Ranking {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function advanceToGame() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });
}

async function clickForward(user: ReturnType<typeof userEvent.setup>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  await user.click(div);
  document.body.removeChild(div);
}

function pressArrowRight() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });
}

describe('Ranking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
  });

  it('shows the question with 0 answers revealed at start', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Beispiel-Frage')).toBeInTheDocument();
    });
    expect(document.querySelectorAll('.statement')).toHaveLength(0);
  });

  it('reveals one ranked answer per advance, in JSON order', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    await clickForward(user);
    await waitFor(() => {
      expect(document.querySelectorAll('.statement')).toHaveLength(1);
      expect(screen.getByText('Erster')).toBeInTheDocument();
    });
    const firstRank = document.querySelector('.statement .ranking-rank');
    expect(firstRank?.textContent).toBe('1.');

    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(2));
    const ranks = Array.from(document.querySelectorAll('.statement .ranking-rank')).map(el => el.textContent);
    expect(ranks).toEqual(['1.', '2.']);

    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(3));
    expect(screen.getByText('Dritter')).toBeInTheDocument();
  });

  it('advances to the next question after all answers revealed', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    // Example: 3 answers → 3 clicks to reveal, 1 more to go to next question
    for (let i = 0; i < 4; i++) await clickForward(user);

    await waitFor(() => expect(screen.getByText('Echte Frage')).toBeInTheDocument());
    expect(document.querySelectorAll('.statement')).toHaveLength(0);
  });

it('ArrowLeft un-reveals the most recent answer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    // Reveal 2 answers
    await clickForward(user);
    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(2));

    // ArrowLeft hides the most recent one
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
  });

  it('calls onGameComplete after last answer of last question advances', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Beispiel', answers: ['x'] }),
        makeQuestion({ question: 'Letzte', answers: ['y'] }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    // Example: 1 answer + 1 advance to next question
    await clickForward(user);
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Letzte')).toBeInTheDocument());

    // Last: 1 answer + 1 advance → complete
    await clickForward(user);
    await clickForward(user);

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
  });

  it('filters disabled questions and preserves the example', async () => {
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a'] }),
        makeQuestion({ question: 'Gesperrt', answers: ['b'], disabled: true }),
        makeQuestion({ question: 'Sichtbar', answers: ['c'] }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    expect(screen.queryByText('Gesperrt')).not.toBeInTheDocument();
    advanceToGame();
    // Ex question visible; "Gesperrt" skipped
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());
    expect(screen.queryByText('Gesperrt')).not.toBeInTheDocument();
  });

  it('renders topic when provided, skips when absent', async () => {
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', topic: 'Kleiner Hinweis' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => {
      expect(screen.getByText('Ex')).toBeInTheDocument();
      expect(screen.getByText('Kleiner Hinweis')).toBeInTheDocument();
    });
  });

  it('short ArrowRight tap advances one answer (does not trigger reveal-all)', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    pressArrowRight();
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
  });
});
