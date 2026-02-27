import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import FactOrFake from '@/components/games/FactOrFake';
import type { FactOrFakeConfig } from '@/types/config';

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

function makeConfig(overrides: Partial<FactOrFakeConfig> = {}): FactOrFakeConfig {
  return {
    type: 'fact-or-fake',
    title: 'Fact or Fake',
    rules: ['Is it fact or fake?'],
    questions: [
      { statement: 'Example Statement', answer: 'FAKT', description: 'Example explanation' },
      { statement: 'True Statement', answer: 'FAKT', description: 'It is real' },
      { statement: 'False Statement', answer: 'FAKE', description: 'It is made up' },
    ],
    ...overrides,
  };
}

function renderGame(config?: FactOrFakeConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <FactOrFake {...defaultProps} config={config || makeConfig()} />
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

describe('FactOrFake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Fact or Fake')).toBeInTheDocument();
    });
  });

  it('shows the statement text', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Example Statement')).toBeInTheDocument();
    });
  });

  it('shows example label for first question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('reveals FAKT answer with green color', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      const answerEl = document.querySelector('.fact-answer') as HTMLElement;
      expect(answerEl).toBeInTheDocument();
      expect(answerEl.textContent).toBe('FAKT');
      expect(answerEl.style.color).toBe('rgb(74, 222, 128)'); // #4ade80
    });
  });

  it('reveals FAKE answer with red color', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { statement: 'Fake Statement', answer: 'FAKE', description: 'Not real' },
        { statement: 'Q2', answer: 'FAKT' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      const answerEl = document.querySelector('.fact-answer') as HTMLElement;
      expect(answerEl).toBeInTheDocument();
      expect(answerEl.textContent).toBe('FAKE');
      expect(answerEl.style.color).toBe('rgb(248, 113, 113)'); // #f87171
    });
  });

  it('shows description when answer is revealed', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Example explanation')).toBeInTheDocument();
    });
  });

  it('supports isFact boolean fallback', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { statement: 'Bool Statement', answer: 'anything', isFact: true },
        { statement: 'Q2', answer: 'FAKT' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      const answerEl = document.querySelector('.fact-answer') as HTMLElement;
      expect(answerEl!.textContent).toBe('FAKT');
      expect(answerEl!.style.color).toBe('rgb(74, 222, 128)');
    });
  });

  it('advances through multiple questions', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);

    // Example: reveal → next
    await user.click(div); // reveal example
    await user.click(div); // next question

    await waitFor(() => {
      expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument();
      expect(screen.getByText('True Statement')).toBeInTheDocument();
    });

    // Reveal → next
    await user.click(div);
    await user.click(div);

    await waitFor(() => {
      expect(screen.getByText('Frage 2 von 2')).toBeInTheDocument();
      expect(screen.getByText('False Statement')).toBeInTheDocument();
    });

    document.body.removeChild(div);
  });
});
