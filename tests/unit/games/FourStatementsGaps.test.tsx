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
    Frage: 'Topic 1',
    trueStatements: ['True 1', 'True 2', 'True 3'],
    wrongStatement: 'Wrong 1',
    answer: 'The Answer',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<FourStatementsConfig> = {}): FourStatementsConfig {
  return {
    type: 'four-statements',
    title: '4 Statements',
    rules: ['Find the false statement'],
    questions: [
      makeQuestion({ Frage: 'Example Topic' }),
      makeQuestion({ Frage: 'Real Topic 1' }),
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

describe('FourStatements - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('navigates back to hide last revealed statement with ArrowLeft', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    advanceToGame();

    // Reveal first 2 statements
    await clickForward(user);
    await clickForward(user);

    let statements = document.querySelectorAll('.statement');
    expect(statements).toHaveLength(2);

    // ArrowLeft to un-reveal one
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });

    await waitFor(() => {
      statements = document.querySelectorAll('.statement');
      expect(statements).toHaveLength(1);
    });
  });

  it('navigates back to previous question from 0 revealed', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    advanceToGame();

    // Reveal all 4 statements + show answer + advance to next question
    await clickForward(user); // 1
    await clickForward(user); // 2
    await clickForward(user); // 3
    await clickForward(user); // 4
    await clickForward(user); // show answer
    await clickForward(user); // next question

    await waitFor(() => expect(screen.getByText('Frage 1 von 1')).toBeInTheDocument());

    // ArrowLeft: back to example with all revealed + answer shown
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
      expect(screen.getByText('Gesuchter Begriff')).toBeInTheDocument();
    });
  });

  it('un-reveals answer with ArrowLeft when answer is shown', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    advanceToGame();

    // Reveal all 4 statements + show answer
    await clickForward(user); // 1
    await clickForward(user); // 2
    await clickForward(user); // 3
    await clickForward(user); // 4
    await clickForward(user); // show answer

    await waitFor(() => expect(screen.getByText('Gesuchter Begriff')).toBeInTheDocument());

    // ArrowLeft to un-reveal answer
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.queryByText('Gesuchter Begriff')).not.toBeInTheDocument();
      // Statements should still be visible
      expect(document.querySelectorAll('.statement')).toHaveLength(4);
    });
  });

  it('completes game after last question', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ Frage: 'Example' }),
        makeQuestion({ Frage: 'Last Q' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    advanceToGame();

    // Example: reveal 4 + answer + advance
    for (let i = 0; i < 6; i++) await clickForward(user);

    // Last Q: reveal 4 + answer + advance (game complete)
    await waitFor(() => expect(screen.getByText('Last Q')).toBeInTheDocument());
    for (let i = 0; i < 6; i++) await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    });
  });

  it('shows "Gesuchter Begriff" and the answer text when revealed', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ answer: 'Special Answer' }),
        makeQuestion(),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    advanceToGame();

    // Reveal all 4 + answer
    for (let i = 0; i < 5; i++) await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Gesuchter Begriff')).toBeInTheDocument();
      expect(screen.getByText('Special Answer')).toBeInTheDocument();
    });
  });

  it('highlights wrong statement in red and correct in green', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    advanceToGame();

    // Reveal all 4 + show answer
    for (let i = 0; i < 5; i++) await clickForward(user);

    await waitFor(() => {
      const statements = document.querySelectorAll('.statement');
      // At least one should have red background and others green
      const styles = Array.from(statements).map(s => (s as HTMLElement).style.background);
      expect(styles.some(s => s.includes('255, 59, 48'))).toBe(true); // red
      expect(styles.some(s => s.includes('74, 222, 128'))).toBe(true); // green
    });
  });

  it('renders with single question (example only)', async () => {
    const config = makeConfig({
      questions: [makeQuestion({ Frage: 'Only Example' })],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
      expect(screen.getByText('Only Example')).toBeInTheDocument();
    });
  });
});
