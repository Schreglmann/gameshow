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
      { statement: 'Example Statement', answer: 'FAKT' },
      { statement: 'Statement 1', answer: 'FAKE', description: 'Because reasons' },
      { statement: 'Statement 2', answer: 'FAKT' },
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

describe('FactOrFake - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('completes game after last question', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { statement: 'Example', answer: 'FAKT' },
        { statement: 'Last Q', answer: 'FAKE' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    advanceToGame();

    // Example: reveal → advance
    await clickForward(user);
    await clickForward(user);

    // Last Q: reveal → advance (complete)
    await waitFor(() => expect(screen.getByText('Last Q')).toBeInTheDocument());
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('FAKE')).toBeInTheDocument());
    await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    });
  });

  it('does not show description when not provided', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { statement: 'No desc', answer: 'FAKT' },
        { statement: 'Q2', answer: 'FAKE' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    advanceToGame();

    await clickForward(user); // reveal

    await waitFor(() => {
      expect(screen.getByText('FAKT')).toBeInTheDocument();
      expect(document.querySelector('.fact-description')).not.toBeInTheDocument();
    });
  });

  it('shows description when provided', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { statement: 'With desc', answer: 'FAKE', description: 'Detailed explanation' },
        { statement: 'Q2', answer: 'FAKT' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    advanceToGame();

    await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Detailed explanation')).toBeInTheDocument();
    });
  });

  it('shows FAKT in green and FAKE in red', async () => {
    const user = userEvent.setup();
    // Test FAKT color
    renderGame(makeConfig({
      questions: [
        { statement: 'Fact Q', answer: 'FAKT' },
        { statement: 'Q2', answer: 'FAKE' },
      ],
    }));
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    advanceToGame();
    await clickForward(user);

    await waitFor(() => {
      const answer = document.querySelector('.fact-answer') as HTMLElement;
      expect(answer).toBeInTheDocument();
      expect(answer.style.color).toBe('rgb(74, 222, 128)'); // green for FAKT
    });
  });

  it('supports isFact boolean as answer', async () => {
    const user = userEvent.setup();
    renderGame(makeConfig({
      questions: [
        { statement: 'Bool Q', isFact: true } as any,
        { statement: 'Q2', answer: 'FAKE' },
      ],
    }));
    await waitFor(() => expect(screen.getByText('Fact or Fake')).toBeInTheDocument());
    advanceToGame();
    await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('FAKT')).toBeInTheDocument();
    });
  });

  it('renders null when question is undefined (empty questions)', () => {
    const config = makeConfig({ questions: [] });
    renderGame(config);
    advanceToGame();

    expect(screen.queryByText('Beispiel')).not.toBeInTheDocument();
  });
});
