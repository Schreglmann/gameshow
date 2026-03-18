import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import AudioGuess from '@/components/games/AudioGuess';
import type { AudioGuessConfig, AudioGuessQuestion } from '@/types/config';

const mockFadeOut = vi.fn();
const mockFadeIn = vi.fn();

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/hooks/useBackgroundMusic', () => ({
  useBackgroundMusic: () => ({
    isPlaying: false,
    currentSong: '',
    currentTime: 0,
    duration: 0,
    volume: 1,
    start: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    skipToNext: vi.fn(),
    setVolume: vi.fn(),
    seekTo: vi.fn(),
    fadeOut: mockFadeOut,
    fadeIn: mockFadeIn,
  }),
}));

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

// Two questions: index 0 = example, index 1 = last real song
function makeConfig(overrides: Partial<AudioGuessConfig> = {}): AudioGuessConfig {
  return {
    type: 'audio-guess',
    title: 'Audio Quiz',
    rules: ['Listen carefully'],
    questions: [
      { folder: 'Example_Song', audioFile: 'short.example.opus', answer: 'Example Answer' },
      { folder: 'Song1', audioFile: 'short.song1.opus', answer: 'Answer 1' },
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

function pressRight() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
}

function advanceToGame() {
  pressRight(); // landing → rules
  pressRight(); // rules → game
}

/** Navigate to the last question's answer revealed so the next pressRight completes the game. */
async function navigateToLastAnswerRevealed() {
  advanceToGame();
  pressRight(); // show example answer (long audio plays)
  pressRight(); // advance to Song 1
  await waitFor(() => expect(screen.getByText('Song 1 von 1')).toBeInTheDocument());
  pressRight(); // reveal Song 1 answer (long audio plays → paused = false)
  await waitFor(() => expect(screen.getByText('Answer 1')).toBeInTheDocument());
}

describe('AudioGuess — audio fade transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── onRulesShow / music.fadeOut ──────────────────────────────────────────

  it('calls music.fadeOut(2000) when rules are shown', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    pressRight(); // landing → rules
    expect(mockFadeOut).toHaveBeenCalledWith(2000);
  });

  // ── long audio fade ──────────────────────────────────────────────────────

  it('long audio volume decreases gradually after game completes', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await navigateToLastAnswerRevealed();

    // Capture the long audio element before it is removed from the DOM on unmount
    const longAudio = document.querySelectorAll('audio')[1] as HTMLAudioElement;
    expect(longAudio).toBeTruthy();

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    pressRight(); // game complete → handleNextShow → fade setInterval starts

    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();

    // 10 steps × 50ms = 500ms → volume = 1 * (1 − 10/40) = 0.75
    act(() => { vi.advanceTimersByTime(500); });
    expect(longAudio.volume).toBeLessThan(1);
  });

  it('long audio is paused after full 2s fade completes', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await navigateToLastAnswerRevealed();

    const longAudio = document.querySelectorAll('audio')[1] as HTMLAudioElement;

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    pressRight(); // game complete

    // All 40 steps → clearInterval + audio.pause()
    act(() => { vi.advanceTimersByTime(2000); });
    expect(longAudio.paused).toBe(true);
  });

  // ── music.fadeIn ─────────────────────────────────────────────────────────

  it('calls music.fadeIn(3000) exactly 500ms after game completes', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await navigateToLastAnswerRevealed();

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    pressRight(); // game complete

    act(() => { vi.advanceTimersByTime(499); });
    expect(mockFadeIn).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(mockFadeIn).toHaveBeenCalledWith(3000);
  });

  it('calls music.fadeIn even when long audio was already paused at game complete', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Audio Quiz')).toBeInTheDocument());
    await navigateToLastAnswerRevealed();

    // Manually pause the long audio — simulates it having stopped on its own
    const longAudio = document.querySelectorAll('audio')[1] as HTMLAudioElement;
    longAudio.pause();

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    // handleNextShow: audio.paused = true → skips the volume loop, but still schedules fadeIn
    pressRight(); // game complete

    act(() => { vi.advanceTimersByTime(500); });
    expect(mockFadeIn).toHaveBeenCalledWith(3000);
  });
});
