import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import SimpleQuiz from '@/components/games/SimpleQuiz';
import type { SimpleQuizConfig } from '@/types/config';

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

const audioInstances: Array<{
  src: string;
  volume: number;
  paused: boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
}> = [];

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

function makeConfig(overrides: Partial<SimpleQuizConfig> = {}): SimpleQuizConfig {
  return {
    type: 'simple-quiz',
    title: 'Test Quiz',
    rules: ['Rule 1'],
    questions: [
      { question: 'Example Q', answer: 'Example A' },
      { question: 'Last Q', answer: 'Last A' },
    ],
    ...overrides,
  };
}

function renderQuiz(config?: SimpleQuizConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <SimpleQuiz {...defaultProps} config={config || makeConfig()} />
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

describe('SimpleQuiz — audio fade transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioInstances.length = 0;
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();

    (globalThis as any).Audio = class MockAudioInstance {
      src = '';
      volume = 1;
      paused = true;
      play = vi.fn().mockImplementation(function (this: any) {
        this.paused = false;
        return Promise.resolve();
      });
      pause = vi.fn().mockImplementation(function (this: any) {
        this.paused = true;
      });
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor(src?: string) {
        if (src) this.src = src;
        audioInstances.push(this as any);
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── onRulesShow / music.fadeOut ──────────────────────────────────────────

  it('calls music.fadeOut(2000) on rules show when quiz has questionAudio', async () => {
    const config = makeConfig({
      questions: [
        { question: 'Example Q', answer: 'Example A', questionAudio: '/audio/q.mp3' },
        { question: 'Last Q', answer: 'Last A' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    pressRight(); // landing → rules
    expect(mockFadeOut).toHaveBeenCalledWith(2000);
  });

  it('calls music.fadeOut(2000) on rules show when quiz has answerAudio', async () => {
    const config = makeConfig({
      questions: [
        { question: 'Example Q', answer: 'Example A', answerAudio: '/audio/a.mp3' },
        { question: 'Last Q', answer: 'Last A' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    pressRight(); // landing → rules
    expect(mockFadeOut).toHaveBeenCalledWith(2000);
  });

  it('does not call music.fadeOut when quiz has no audio', async () => {
    renderQuiz(); // default config has no audio
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    pressRight(); // landing → rules
    expect(mockFadeOut).not.toHaveBeenCalled();
  });

  // ── questionAudio fade ───────────────────────────────────────────────────

  it('questionAudio volume decreases gradually after game completes', async () => {
    const config = makeConfig({
      questions: [
        { question: 'Example Q', answer: 'Example A' },
        { question: 'Last Q', answer: 'Last A', questionAudio: '/audio/q.mp3' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    pressRight(); // show example answer
    pressRight(); // advance to Last Q
    await waitFor(() => expect(screen.getByText('Last Q')).toBeInTheDocument());

    pressRight(); // show last answer
    await waitFor(() => expect(screen.getByText('Last A')).toBeInTheDocument());

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    pressRight(); // game complete → handleNextShow → fade setInterval starts

    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();

    const questionAudio = audioInstances.find(a => a.src.includes('/audio/q.mp3'));
    expect(questionAudio).toBeTruthy();

    // 10 steps of 50ms each: volume = 1 * (1 − 10/40) = 0.75
    act(() => { vi.advanceTimersByTime(500); });
    expect(questionAudio!.volume).toBeLessThan(1);
  });

  it('questionAudio is paused after full 2s fade completes', async () => {
    const config = makeConfig({
      questions: [
        { question: 'Example Q', answer: 'Example A' },
        { question: 'Last Q', answer: 'Last A', questionAudio: '/audio/q.mp3' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    pressRight();
    pressRight();
    await waitFor(() => expect(screen.getByText('Last Q')).toBeInTheDocument());

    pressRight();
    await waitFor(() => expect(screen.getByText('Last A')).toBeInTheDocument());

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    pressRight(); // game complete

    const questionAudio = audioInstances.find(a => a.src.includes('/audio/q.mp3'))!;

    // All 40 steps: clearInterval + pause called
    act(() => { vi.advanceTimersByTime(2000); });
    expect(questionAudio.pause).toHaveBeenCalled();
  });

  it('answerAudio fades out after game completes', async () => {
    const config = makeConfig({
      questions: [
        { question: 'Example Q', answer: 'Example A' },
        { question: 'Last Q', answer: 'Last A', answerAudio: '/audio/a.mp3' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    pressRight();
    pressRight();
    await waitFor(() => expect(screen.getByText('Last Q')).toBeInTheDocument());

    pressRight(); // reveal answer → answerAudio plays
    await waitFor(() => expect(screen.getByText('Last A')).toBeInTheDocument());

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    pressRight(); // game complete

    const answerAudio = audioInstances.find(a => a.src.includes('/audio/a.mp3'))!;
    expect(answerAudio).toBeTruthy();

    act(() => { vi.advanceTimersByTime(2000); });
    expect(answerAudio.pause).toHaveBeenCalled();
  });

  // ── music.fadeIn ─────────────────────────────────────────────────────────

  it('calls music.fadeIn(3000) exactly 500ms after game completes', async () => {
    const config = makeConfig({
      questions: [
        { question: 'Example Q', answer: 'Example A' },
        { question: 'Last Q', answer: 'Last A', questionAudio: '/audio/q.mp3' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    pressRight();
    pressRight();
    await waitFor(() => expect(screen.getByText('Last Q')).toBeInTheDocument());

    pressRight();
    await waitFor(() => expect(screen.getByText('Last A')).toBeInTheDocument());

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    pressRight(); // game complete

    act(() => { vi.advanceTimersByTime(499); });
    expect(mockFadeIn).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    expect(mockFadeIn).toHaveBeenCalledWith(3000);
  });

  // ── no hard cut on phase transition ──────────────────────────────────────

  it('questionAudio is not hard-cut when QuizInner unmounts on phase transition', async () => {
    const config = makeConfig({
      questions: [
        { question: 'Example Q', answer: 'Example A' },
        { question: 'Last Q', answer: 'Last A', questionAudio: '/audio/q.mp3' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    pressRight();
    pressRight();
    await waitFor(() => expect(screen.getByText('Last Q')).toBeInTheDocument());

    pressRight();
    await waitFor(() => expect(screen.getByText('Last A')).toBeInTheDocument());

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    pressRight(); // game complete → QuizInner unmounts → award-points shown

    const questionAudio = audioInstances.find(a => a.src.includes('/audio/q.mp3'))!;

    // Award-points screen is rendered (QuizInner has unmounted)
    expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();

    // Audio must not have been hard-paused by the effect cleanup
    // (skipAudioCleanupRef prevents it; only the fade timer would pause it later)
    expect(questionAudio.pause).not.toHaveBeenCalled();
  });
});
