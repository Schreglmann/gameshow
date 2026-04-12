import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import ImageGuess from '@/components/games/ImageGuess';
import type { ImageGuessConfig } from '@/types/config';

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

function makeConfig(overrides: Partial<ImageGuessConfig> = {}): ImageGuessConfig {
  return {
    type: 'image-guess',
    title: 'Bilder Quiz',
    rules: ['Erratet das Bild!'],
    questions: [
      { image: '/images/example.jpg', answer: 'Beispiel Bild' },
      { image: '/images/bild1.jpg', answer: 'Eiffelturm' },
      { image: '/images/bild2.jpg', answer: 'Brandenburger Tor' },
    ],
    ...overrides,
  };
}

function renderGame(config?: ImageGuessConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <ImageGuess {...defaultProps} config={config || makeConfig()} />
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

describe('ImageGuess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Bilder Quiz')).toBeInTheDocument();
    });
  });

  it('shows example label for first question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bilder Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('shows percent indicator during game', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bilder Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText(/Bild auflösen/)).toBeInTheDocument();
    });
  });

  it('reveals answer text on advance', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bilder Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    expect(screen.queryByText('Beispiel Bild')).not.toBeInTheDocument();

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Beispiel Bild')).toBeInTheDocument();
    });
  });

  it('shows 100% when answer is revealed', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bilder Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText(/100%/)).toBeInTheDocument();
    });
  });

  it('shows question numbering for non-example questions', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Bilder Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal answer
    await user.click(div); // next question
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Bild 1 von 2')).toBeInTheDocument();
    });
  });

  it('renders image element with correct source', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { image: '/images/example.jpg', answer: 'Beispiel Bild', obfuscation: 'blur' },
        { image: '/images/bild1.jpg', answer: 'Eiffelturm', obfuscation: 'blur' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Bilder Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const img = document.querySelector('.image-guess-image') as HTMLImageElement;
      expect(img).toBeTruthy();
      expect(img.getAttribute('src')).toBe('/images/example.jpg');
    });
  });

  it('filters disabled questions', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { image: '/images/example.jpg', answer: 'Example' },
        { image: '/images/bild1.jpg', answer: 'Bild 1', disabled: true },
        { image: '/images/bild2.jpg', answer: 'Bild 2' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Bilder Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal example answer
    await user.click(div); // next question (should skip disabled)
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Bild 1 von 1')).toBeInTheDocument();
    });
  });
});
