import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import AudioGuess from '@/components/games/AudioGuess';
import type { AudioGuessConfig, AudioGuessQuestion } from '@/types/config';

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

function makeConfig(overrides: Partial<AudioGuessConfig> = {}): AudioGuessConfig {
  return {
    type: 'audio-guess',
    title: 'Audio Quiz',
    rules: ['Listen carefully'],
    questions: [
      { folder: 'Example_Song', audioFile: 'short.test.opus', answer: 'Example Answer' },
      { folder: 'Song1', audioFile: 'short.song1.opus', answer: 'Answer 1' },
      { folder: 'Song2', audioFile: 'short.song2.opus', answer: 'Answer 2' },
    ] as AudioGuessQuestion[],
    ...overrides,
  };
}

function renderGame(config?: AudioGuessConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <AudioGuess {...defaultProps} config={config || makeConfig()} />
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

describe('AudioGuess - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('reveals answer and shows answer text on click', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => expect(screen.getByText('Beispiel')).toBeInTheDocument());

    // Before reveal: no answer shown
    expect(screen.queryByText('Example Answer')).not.toBeInTheDocument();

    // Click to reveal
    await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Example Answer')).toBeInTheDocument();
    });
  });

  it('navigates back to un-reveal answer with ArrowLeft', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => expect(screen.getByText('Beispiel')).toBeInTheDocument());

    // Reveal answer
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Example Answer')).toBeInTheDocument());

    // Back to un-reveal
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.queryByText('Example Answer')).not.toBeInTheDocument();
    });
  });

  it('navigates back to previous question with ArrowLeft', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    advanceToGame();

    // Example: reveal → advance
    await clickForward(user);
    await clickForward(user);

    await waitFor(() => expect(screen.getByText('Song 1 von 2')).toBeInTheDocument());

    // Back to example with answer shown
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.getByText('Example Answer')).toBeInTheDocument();
    });
  });

  it('completes game after last question', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { folder: 'Example', audioFile: 'short.test.opus', answer: 'Ex' },
        { folder: 'Song1', audioFile: 'short.s1.opus', answer: 'A1' },
      ] as AudioGuessQuestion[],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    advanceToGame();

    // Example: reveal → advance
    await clickForward(user);
    await clickForward(user);

    // Song 1: reveal → advance (game complete)
    await waitFor(() => expect(screen.queryByText('A1')).not.toBeInTheDocument());
    await clickForward(user); // reveal answer
    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    await clickForward(user); // game complete

    await waitFor(() => {
      expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    });
  });

  it('shows replay and full song buttons', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText(/Ausschnitt wiederholen/)).toBeInTheDocument();
      expect(screen.getByText(/Ganzer Song/)).toBeInTheDocument();
    });
  });

  it('shows full song and replay buttons in answer mode', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    advanceToGame();

    await clickForward(user); // reveal answer

    await waitFor(() => {
      expect(screen.getByText('Example Answer')).toBeInTheDocument();
      // Both buttons should still be present in answer mode
      expect(screen.getByText(/Ganzer Song/)).toBeInTheDocument();
      expect(screen.getByText(/Ausschnitt wiederholen/)).toBeInTheDocument();
    });
  });

  it('renders null when questions array is empty', () => {
    const config = makeConfig({ questions: [] });
    renderGame(config);
    advanceToGame();

    // No question content should be rendered (but no crash)
    expect(screen.queryByText('Beispiel')).not.toBeInTheDocument();
  });
});
