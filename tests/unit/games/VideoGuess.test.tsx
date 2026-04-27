import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import VideoGuess from '@/components/games/VideoGuess';
import type { VideoGuessConfig } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
  checkVideoHdr: vi.fn().mockResolvedValue(false),
}));

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

function makeConfig(overrides: Partial<VideoGuessConfig> = {}): VideoGuessConfig {
  return {
    type: 'video-guess',
    title: 'Film Quiz',
    rules: ['Erkennt den Film'],
    questions: [
      { answer: 'Example Film', video: '/videos/example.mp4', videoStart: 0, videoQuestionEnd: 10 },
      { answer: 'Film 1', video: '/videos/film1.mp4', videoStart: 5, videoQuestionEnd: 15, videoAnswerEnd: 25 },
      { answer: 'Film 2', video: '/videos/film2.mp4', videoStart: 0, videoQuestionEnd: 20 },
    ],
    ...overrides,
  };
}

function renderGame(config?: VideoGuessConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <VideoGuess {...defaultProps} config={config || makeConfig()} />
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

describe('VideoGuess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Film Quiz')).toBeInTheDocument();
    });
  });

  it('shows example label for first question', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('shows video element in game phase', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(document.querySelector('video')).toBeInTheDocument();
    });
  });

  it('reveals answer text when advancing', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Answer not visible initially
    expect(screen.queryByText('Example Film')).not.toBeInTheDocument();

    // Click to reveal
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Example Film')).toBeInTheDocument();
    });
  });

  it('renders video element with correct source', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const videoElements = document.querySelectorAll('video');
      expect(videoElements.length).toBe(1);

      const sources = videoElements[0].querySelectorAll('source');
      expect(sources.length).toBe(1);
      // ?strict=1 ensures the in-game player never triggers live ffmpeg encoding —
      // a missing cache returns 404 instead so the operator gets a pre-flight warning.
      expect(sources[0].getAttribute('src')).toBe('/videos-compressed/0/10/example.mp4?strict=1');
    });
  });

  it('shows question numbering for non-example questions', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Advance past example: reveal → next
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal answer
    await user.click(div); // next question
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Clip 1 von 2')).toBeInTheDocument();
    });
  });

  it('shows answer text after reveal', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Reveal answer
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Example Film')).toBeInTheDocument();
    });
  });

  it('uses /videos-compressed/ for SDR video with time ranges', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { answer: 'Example', video: '/videos/example.mp4' },
        { answer: 'Film', video: '/videos/film.mp4', videoStart: 30, videoQuestionEnd: 45 },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Advance past example
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal
    await user.click(div); // next question
    document.body.removeChild(div);

    await waitFor(() => {
      const source = document.querySelector('video source');
      expect(source?.getAttribute('src')).toBe('/videos-compressed/30/45/film.mp4?strict=1');
    });
  });

  it('uses original video path without time ranges (audioTrack ignored)', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { answer: 'Example', video: '/videos/example.mp4' },
        { answer: 'Film', video: '/videos/film.mp4', audioTrack: 1 },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Advance past example
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal
    await user.click(div); // next question
    document.body.removeChild(div);

    await waitFor(() => {
      const source = document.querySelector('video source');
      expect(source?.getAttribute('src')).toBe('/videos/film.mp4');
    });
  });

  it('uses /videos-compressed/ with ?track= for audio + time ranges', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { answer: 'Example', video: '/videos/example.mp4' },
        { answer: 'Film', video: '/videos/film.mp4', videoStart: 10, videoQuestionEnd: 20, audioTrack: 2 },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Advance past example
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal
    await user.click(div); // next question
    document.body.removeChild(div);

    await waitFor(() => {
      const source = document.querySelector('video source');
      expect(source?.getAttribute('src')).toBe('/videos-compressed/10/20/film.mp4?track=2&strict=1');
    });
  });

  it('uses original path for video without time ranges or track', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { answer: 'Example', video: '/videos/example.mp4' },
        { answer: 'Film', video: '/videos/film.mp4' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Advance past example
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal
    await user.click(div); // next question
    document.body.removeChild(div);

    await waitFor(() => {
      const source = document.querySelector('video source');
      expect(source?.getAttribute('src')).toBe('/videos/film.mp4');
    });
  });

  it('filters out disabled questions', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { answer: 'Example', video: '/videos/ex.mp4' },
        { answer: 'Active', video: '/videos/active.mp4' },
        { answer: 'Disabled', video: '/videos/disabled.mp4', disabled: true },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Film Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Advance past example
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal
    await user.click(div); // next
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Clip 1 von 1')).toBeInTheDocument();
    });
  });
});
