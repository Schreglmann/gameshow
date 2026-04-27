import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import AudioGuess from '@/components/games/AudioGuess';
import type { AudioGuessConfig } from '@/types/config';

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
    rules: ['Listen and guess'],
    questions: [
      { answer: 'Example Song', audio: '/audio/example.m4a', isExample: true },
      { answer: 'Song 1', audio: '/audio/song1.m4a' },
      { answer: 'Song 2', audio: '/audio/song2.m4a' },
    ],
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

describe('AudioGuess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Audio Quiz')).toBeInTheDocument();
    });
  });

  it('shows example label for first question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('shows replay and full song buttons before answer reveal', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText(/Ausschnitt wiederholen/)).toBeInTheDocument();
      expect(screen.getByText(/Ganzer Song/)).toBeInTheDocument();
    });
  });

  it('reveals answer text when clicking', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Answer not visible initially
    expect(screen.queryByText('Example Song')).not.toBeInTheDocument();

    // Click to reveal
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Example Song')).toBeInTheDocument();
    });
  });

  it('renders audio elements with correct sources', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const audioElements = document.querySelectorAll('audio');
      expect(audioElements.length).toBe(2); // short + long (same file)

      // Both audio elements use the same source file
      const shortSources = audioElements[0].querySelectorAll('source');
      expect(shortSources.length).toBe(1);
      expect(shortSources[0].getAttribute('src')).toBe('/audio/example.m4a');

      const longSources = audioElements[1].querySelectorAll('source');
      expect(longSources.length).toBe(1);
      expect(longSources[0].getAttribute('src')).toBe('/audio/example.m4a');
    });
  });

  it('shows question numbering for non-example questions', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Advance past example: reveal → next
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal answer
    await user.click(div); // next question
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Song 1 von 2')).toBeInTheDocument();
    });
  });

  it('hides control buttons in answer reveal mode', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Reveal answer
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      // Control buttons should not be present in answer mode
      expect(screen.queryByText(/Ganzer Song/)).not.toBeInTheDocument();
      expect(screen.queryByText(/Ausschnitt wiederholen/)).not.toBeInTheDocument();
    });
  });
});
