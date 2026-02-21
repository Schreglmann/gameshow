import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import FourStatements from '@/components/games/FourStatements';
import type { FourStatementsConfig } from '@/types/config';

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

function makeConfig(overrides: Partial<FourStatementsConfig> = {}): FourStatementsConfig {
  return {
    type: 'four-statements',
    title: '4 Statements',
    rules: ['Find the wrong one'],
    questions: [
      {
        Frage: 'Topic Example',
        trueStatements: ['True 1', 'True 2', 'True 3'],
        wrongStatement: 'Wrong One',
        answer: 'Example Answer',
      },
      {
        Frage: 'Topic 1',
        trueStatements: ['Fact A', 'Fact B', 'Fact C'],
        wrongStatement: 'Lie X',
        answer: 'Answer 1',
      },
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

async function advanceToGame(_user: ReturnType<typeof userEvent.setup>) {
  // Landing -> Rules
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  // Rules -> Game
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
}

describe('FourStatements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('4 Statements')).toBeInTheDocument();
    });
  });

  it('shows example label for first question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('shows the question/topic (Frage)', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Topic Example')).toBeInTheDocument();
    });
  });

  it('progressively reveals statements on each click', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);

    // No statements initially
    let statements = document.querySelectorAll('.statement');
    expect(statements).toHaveLength(0);

    // Click 1: 1 statement
    await user.click(div);
    await waitFor(() => {
      statements = document.querySelectorAll('.statement');
      expect(statements).toHaveLength(1);
    });

    // Click 2: 2 statements
    await user.click(div);
    await waitFor(() => {
      statements = document.querySelectorAll('.statement');
      expect(statements).toHaveLength(2);
    });

    // Click 3: 3 statements
    await user.click(div);
    await waitFor(() => {
      statements = document.querySelectorAll('.statement');
      expect(statements).toHaveLength(3);
    });

    // Click 4: 4 statements
    await user.click(div);
    await waitFor(() => {
      statements = document.querySelectorAll('.statement');
      expect(statements).toHaveLength(4);
    });

    document.body.removeChild(div);
  });

  it('shows answer with wrong statement highlighted after all revealed', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);

    // Reveal all 4 statements
    await user.click(div);
    await user.click(div);
    await user.click(div);
    await user.click(div);

    // Click once more to show answer
    await user.click(div);

    document.body.removeChild(div);

    await waitFor(() => {
      // "Gesuchter Begriff" label should appear
      expect(screen.getByText('Gesuchter Begriff')).toBeInTheDocument();
      // The answer text should appear
      expect(screen.getByText('Example Answer')).toBeInTheDocument();
    });

    // Check that statements have color-coded backgrounds
    const statements = document.querySelectorAll('.statements-container .statement');
    // At least one should have red background (wrong statement)
    const wrongStatements = Array.from(statements).filter(
      s => (s as HTMLElement).style.borderColor.includes('255, 59, 48')
    );
    expect(wrongStatements.length).toBeGreaterThanOrEqual(1);

    // True statements should have green background
    const trueStatements = Array.from(statements).filter(
      s => (s as HTMLElement).style.borderColor.includes('74, 222, 128')
    );
    expect(trueStatements.length).toBeGreaterThanOrEqual(1);
  });

  it('shows answer for the specific wrong statement text', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('4 Statements')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);

    // Reveal all + show answer
    for (let i = 0; i < 5; i++) await user.click(div);

    document.body.removeChild(div);

    await waitFor(() => {
      // All statement texts should be visible (shuffled order)
      expect(screen.getByText('True 1')).toBeInTheDocument();
      expect(screen.getByText('True 2')).toBeInTheDocument();
      expect(screen.getByText('True 3')).toBeInTheDocument();
      expect(screen.getByText('Wrong One')).toBeInTheDocument();
    });
  });
});
