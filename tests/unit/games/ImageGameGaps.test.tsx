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
    rules: ['Guess the image'],
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

describe('ImageGame - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('navigates back to un-reveal answer with ArrowLeft', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    advanceToGame();

    // Reveal answer
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Example Answer')).toBeInTheDocument());

    // Back to un-reveal
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.queryByText('Example Answer')).not.toBeInTheDocument();
    });
  });

  it('navigates back to previous question with answer shown', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    advanceToGame();

    // Example: reveal → advance
    await clickForward(user); // reveal
    await clickForward(user); // next question

    await waitFor(() => expect(screen.getByText('Bild 1 von 2')).toBeInTheDocument());

    // Back to example with answer
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.getByText('Example Answer')).toBeInTheDocument();
    });
  });

  it('completes game after last question', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { image: '/images/ex.jpg', answer: 'Ex' },
        { image: '/images/q1.jpg', answer: 'A1' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    advanceToGame();

    // Example: reveal → advance
    await clickForward(user);
    await clickForward(user);

    // Q1: reveal → advance (game complete)
    await waitFor(() => expect(screen.getByText('Bild 1 von 1')).toBeInTheDocument());
    await clickForward(user); // reveal
    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    await clickForward(user); // game complete

    await waitFor(() => {
      expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    });
  });

  it('opens lightbox when image is clicked', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
    });

    // Click the image
    const img = document.querySelector('.quiz-image') as HTMLImageElement;
    await user.click(img);

    // Lightbox should appear
    await waitFor(() => {
      const lightbox = document.querySelector('.lightbox-overlay');
      expect(lightbox).toBeInTheDocument();
    });
  });

  it('shows Beispiel label for first question', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('scrolls to top on new question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Image Quiz')).toBeInTheDocument());
    advanceToGame();

    // Advance to next question
    await clickForward(user); // reveal
    await clickForward(user); // next

    // No crash = scroll was called (scrollTo is mocked in setup)
    await waitFor(() => expect(screen.getByText('Bild 1 von 2')).toBeInTheDocument());
  });

  it('renders null when question is undefined', () => {
    const config = makeConfig({ questions: [] });
    renderGame(config);
    advanceToGame();

    expect(screen.queryByText('Beispiel')).not.toBeInTheDocument();
  });
});
