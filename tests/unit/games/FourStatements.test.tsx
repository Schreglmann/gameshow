import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import FourStatements from '@/components/games/FourStatements';
import type { FourStatementsConfig, FourStatementsQuestion } from '@/types/config';

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

function makeQuestion(overrides: Partial<FourStatementsQuestion> = {}): FourStatementsQuestion {
  return {
    topic: 'Gesucht ist ein Erfinder',
    statements: ['Hinweis A', 'Hinweis B', 'Hinweis C', 'Hinweis D'],
    answer: 'Edison',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<FourStatementsConfig> = {}): FourStatementsConfig {
  return {
    type: 'four-statements',
    title: 'Hinweise',
    rules: ['Errate die Lösung'],
    questions: [
      makeQuestion({ topic: 'Beispiel-Thema' }),
      makeQuestion({ topic: 'Echtes Thema' }),
    ],
    ...overrides,
  };
}

function renderGame(config?: FourStatementsConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <FourStatements {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function advanceToGame() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
}

async function clickForward(user: ReturnType<typeof userEvent.setup>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  await user.click(div);
  document.body.removeChild(div);
}

describe('FourStatements (clue-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
  });

  it('starts with 0 statements visible', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Beispiel-Thema')).toBeInTheDocument();
    });
    expect(document.querySelectorAll('.statement')).toHaveLength(0);
    // user available for future assertions
    expect(user).toBeDefined();
  });

  it('reveals one statement per advance, in JSON order', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Hinweis A/)).toBeInTheDocument());
    expect(document.querySelectorAll('.statement')).toHaveLength(1);

    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Hinweis B/)).toBeInTheDocument());
    expect(document.querySelectorAll('.statement')).toHaveLength(2);

    await clickForward(user);
    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(4));
    expect(screen.getByText(/Hinweis D/)).toBeInTheDocument();
  });

  it('shows answer (text) after all statements revealed', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // 4 statements + 1 advance for answer
    for (let i = 0; i < 5; i++) await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Lösung')).toBeInTheDocument();
      expect(screen.getByText('Edison')).toBeInTheDocument();
    });
  });

  it('shows answer image when answerImage is set', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ topic: 'Ex' }),
        makeQuestion({ answer: 'Tesla', answerImage: 'images/tesla.jpg' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // Example Q: 4 statements + answer + advance = 6 clicks. Then Q2: 4 statements + answer = 5 clicks.
    for (let i = 0; i < 11; i++) await clickForward(user);

    await waitFor(() => expect(screen.getByText('Tesla')).toBeInTheDocument());
    const img = document.querySelector('img.quiz-image') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.src).toContain('images/tesla.jpg');
  });

  it('renders image-only answer (no answer text)', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({
          topic: 'Nur Bild',
          statements: ['Clue 1', 'Clue 2'],
          answer: undefined,
          answerImage: 'images/only.jpg',
        }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // 2 statements + 1 answer
    for (let i = 0; i < 3; i++) await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Lösung')).toBeInTheDocument();
      expect(document.querySelector('img.quiz-image')).not.toBeNull();
    });
    // The answer-text card should not be present
    expect(screen.queryByText('Nur Bild')).toBeInTheDocument(); // topic still there
    expect(document.querySelectorAll('.statements-container .statement[style*="rgb(74, 222, 128)"], .statements-container .statement[style*="rgba(74"]')).toHaveLength(0);
  });

  it('skips empty statement slots (treats padded arrays as non-empty-only)', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ topic: 'Ex', statements: ['A', 'B', '', ''] }),
        makeQuestion({ topic: 'Short', statements: ['One clue only', '', '', ''], answer: 'Answer' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // Example has 2 non-empty statements: 2 reveals + 1 answer + 1 advance = 4 clicks
    for (let i = 0; i < 4; i++) await clickForward(user);

    await waitFor(() => expect(screen.getByText('Short')).toBeInTheDocument());
    // 1 statement reveal
    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
    // Next click → answer
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Answer')).toBeInTheDocument());
  });

  it('navigates back with ArrowLeft to un-reveal answer, then statements', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    for (let i = 0; i < 5; i++) await clickForward(user); // reveal 4 + show answer

    await waitFor(() => expect(screen.getByText('Lösung')).toBeInTheDocument());

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.queryByText('Lösung')).not.toBeInTheDocument();
      expect(document.querySelectorAll('.statement')).toHaveLength(4);
    });

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(3));
  });

  it('completes game after last question', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ topic: 'Ex', statements: ['x'] }),
        makeQuestion({ topic: 'Last', statements: ['y'] }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // Example: 1 statement + 1 answer + 1 advance
    for (let i = 0; i < 3; i++) await clickForward(user);
    await waitFor(() => expect(screen.getByText('Last')).toBeInTheDocument());
    // Last: 1 statement + 1 answer + 1 advance → complete
    for (let i = 0; i < 3; i++) await clickForward(user);

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
  });
});
