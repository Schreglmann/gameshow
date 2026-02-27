import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import ImageGame from '@/components/games/ImageGame';
import type { ImageGameConfig } from '@/types/config';

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

function makeConfig(overrides: Partial<ImageGameConfig> = {}): ImageGameConfig {
  return {
    type: 'image-game',
    title: 'Image Quiz',
    rules: ['Identify the image'],
    questions: [
      { image: '/images/example.jpg', answer: 'Example Answer' },
      { image: '/images/q1.jpg', answer: 'Answer 1' },
      { image: '/images/q2.jpg', answer: 'Answer 2' },
    ],
    ...overrides,
  };
}

function renderGame(config?: ImageGameConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <ImageGame {...defaultProps} config={config || makeConfig()} />
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

describe('ImageGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Image Quiz')).toBeInTheDocument();
    });
  });

  it('displays the image for the current question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain('/images/example.jpg');
    });
  });

  it('shows example label for first question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('reveals answer text when clicking', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Answer not visible yet
    expect(screen.queryByText('Example Answer')).not.toBeInTheDocument();

    // Click to reveal
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Example Answer')).toBeInTheDocument();
    });
  });

  it('advances to next image after revealing answer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    const div = document.createElement('div');
    document.body.appendChild(div);

    // Reveal answer
    await user.click(div);
    await waitFor(() => expect(screen.getByText('Example Answer')).toBeInTheDocument());

    // Next question
    await user.click(div);

    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Bild 1 von 2')).toBeInTheDocument();
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img.src).toContain('/images/q1.jpg');
    });
  });

  it('opens lightbox when image is clicked', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
    });

    // Click the image to open lightbox
    const img = document.querySelector('.quiz-image') as HTMLImageElement;
    await user.click(img);

    await waitFor(() => {
      const lightbox = document.querySelector('.lightbox-overlay');
      expect(lightbox).toBeInTheDocument();
    });
  });
});
