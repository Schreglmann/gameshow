import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import SimpleQuiz from '@/components/games/SimpleQuiz';
import BetQuiz from '@/components/games/BetQuiz';
import FourStatements from '@/components/games/FourStatements';
import * as backendSocket from '@/services/useBackendSocket';
import type { BetQuizConfig, FourStatementsConfig, SimpleQuizConfig } from '@/types/config';
import type { GameComponentProps } from '@/components/games/types';

// The gamemaster's play/pause + restart buttons must follow whichever clip is
// playing: the question audio before the reveal, the answer audio after it.
// See specs/gamemaster-controls.md.

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

/** Detached `new Audio()` stand-in that fires real play/pause events. */
class MockAudio extends EventTarget {
  src = '';
  volume = 1;
  paused = true;
  currentTime = 0;
  duration = NaN;
  readyState = 4;
  preload = '';
  constructor(src?: string) {
    super();
    if (src) this.src = src;
    audioInstances.push(this);
  }
  play = vi.fn(() => {
    this.paused = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  });
  pause = vi.fn(() => {
    if (this.paused) return;
    this.paused = true;
    this.dispatchEvent(new Event('pause'));
  });
  load = vi.fn();
}
const audioInstances: MockAudio[] = [];

function gameAudio(srcPart: string): MockAudio {
  const found = [...audioInstances].reverse().find(a => a.src.includes(srcPart) && a.preload !== 'auto');
  if (!found) throw new Error(`no audio element for ${srcPart}`);
  return found;
}

type Ctrl = { id: string; type: string; buttons?: Array<{ id: string; label: string }> };
let sendWsSpy: ReturnType<typeof vi.spyOn>;

function audioGroup(): Ctrl | undefined {
  const calls = sendWsSpy.mock.calls.filter(([ch]) => ch === 'gamemaster-controls');
  const controls = (calls[calls.length - 1]?.[1] as { controls?: Ctrl[] } | undefined)?.controls ?? [];
  return controls.find(c => c.id === 'audio-controls');
}

function playPauseLabel(): string | undefined {
  return audioGroup()?.buttons?.find(b => b.id === 'audio-playpause')?.label;
}

function pressRight() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });
}

async function sendGmCommand(controlId: string) {
  await act(async () => {
    backendSocket.__emitChannelForTests('gamemaster-command', { controlId, timestamp: Date.now() + Math.random() });
  });
}

const baseProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

function renderGame(Component: (p: GameComponentProps) => React.ReactNode, config: GameComponentProps['config'], pointSystemEnabled = true) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <Component {...baseProps} pointSystemEnabled={pointSystemEnabled} config={config} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  audioInstances.length = 0;
  (globalThis as unknown as { Audio: unknown }).Audio = MockAudio;
  sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
});

afterEach(() => {
  sendWsSpy.mockRestore();
});

describe('SimpleQuiz — GM audio controls', () => {
  function quiz(q: Partial<SimpleQuizConfig['questions'][number]>): SimpleQuizConfig {
    return {
      type: 'simple-quiz',
      title: 'Audio-Quiz',
      rules: ['Regel'],
      questions: [{ question: 'Frage A', answer: 'Antwort A', ...q }, { question: 'Frage B', answer: 'Antwort B' }],
    };
  }

  async function startGame(config: SimpleQuizConfig) {
    renderGame(SimpleQuiz, config);
    await waitFor(() => expect(screen.getByText('Audio-Quiz')).toBeInTheDocument());
    pressRight(); // landing → rules
    pressRight(); // rules → game
    await waitFor(() => expect(screen.getByText('Frage A')).toBeInTheDocument());
  }

  it('offers controls for answer-only audio once the answer is revealed, and routes them to that clip', async () => {
    await startGame(quiz({ answerAudio: '/audio/antwort.mp3', answerAudioStart: 5, answerAudioEnd: 20 }));
    expect(audioGroup()).toBeUndefined();

    pressRight(); // reveal → answer audio starts
    await waitFor(() => expect(playPauseLabel()).toBe('Pause'));
    const answer = gameAudio('antwort.mp3');

    await sendGmCommand('audio-playpause');
    expect(answer.pause).toHaveBeenCalled();
    await waitFor(() => expect(playPauseLabel()).toBe('Abspielen'));

    // Resuming a clip that already reached its trim end starts it over.
    answer.currentTime = 20;
    await sendGmCommand('audio-playpause');
    expect(answer.currentTime).toBe(5);
    await waitFor(() => expect(playPauseLabel()).toBe('Pause'));

    answer.currentTime = 12;
    await sendGmCommand('audio-restart');
    expect(answer.currentTime).toBe(5);
  });

  it('hands the controls from the question audio to the answer audio on reveal', async () => {
    await startGame(quiz({ questionAudio: '/audio/frage.mp3', answerAudio: '/audio/antwort.mp3' }));
    const question = gameAudio('frage.mp3');
    act(() => {
      question.duration = 30;
      question.dispatchEvent(new Event('loadedmetadata'));
    });
    await waitFor(() => expect(playPauseLabel()).toBe('Pause'));

    pressRight(); // reveal: question audio stops, answer audio starts
    const answer = gameAudio('antwort.mp3');
    expect(question.paused).toBe(true);

    await sendGmCommand('audio-playpause');
    expect(answer.pause).toHaveBeenCalled();
    expect(question.play).toHaveBeenCalledTimes(1); // the stopped question clip is not resumed
    await waitFor(() => expect(playPauseLabel()).toBe('Abspielen'));
  });

  it('keeps question-audio controls through the reveal when there is no answer audio', async () => {
    await startGame(quiz({ questionAudio: '/audio/frage.mp3' }));
    const question = gameAudio('frage.mp3');
    act(() => {
      question.duration = 30;
      question.dispatchEvent(new Event('loadedmetadata'));
    });
    await waitFor(() => expect(audioGroup()).toBeDefined());

    pressRight(); // reveal
    await waitFor(() => expect(screen.getByText('Antwort A')).toBeInTheDocument());
    expect(playPauseLabel()).toBe('Pause');
    await sendGmCommand('audio-playpause');
    expect(question.pause).toHaveBeenCalled();
  });
});

describe('BetQuiz — GM audio controls', () => {
  function betQuiz(q: Partial<BetQuizConfig['questions'][number]>): BetQuizConfig {
    return {
      type: 'bet-quiz',
      title: 'Einsatz-Audio',
      rules: ['Regel'],
      questions: [
        { category: 'Musik', question: 'Frage A', answer: 'Antwort A', ...q },
        { category: 'Sport', question: 'Frage B', answer: 'Antwort B' },
      ],
    };
  }

  async function startGame(config: BetQuizConfig) {
    renderGame(BetQuiz, config, false);
    await waitFor(() => expect(screen.getByText('Einsatz-Audio')).toBeInTheDocument());
    pressRight(); // landing → rules
    pressRight(); // rules → game (category)
    await waitFor(() => expect(screen.getByText('Musik')).toBeInTheDocument());
    pressRight(); // category → question (points off: no bet)
    await waitFor(() => expect(screen.getByText('Frage A')).toBeInTheDocument());
  }

  it('offers answer-audio controls in the answer phase', async () => {
    await startGame(betQuiz({ answerAudio: '/audio/antwort.mp3', answerAudioStart: 3 }));
    expect(audioGroup()).toBeUndefined();

    pressRight(); // question → answer
    await waitFor(() => expect(playPauseLabel()).toBe('Pause'));
    const answer = gameAudio('antwort.mp3');

    answer.currentTime = 9;
    await sendGmCommand('audio-restart');
    expect(answer.currentTime).toBe(3);
    await sendGmCommand('audio-playpause');
    expect(answer.pause).toHaveBeenCalled();
    await waitFor(() => expect(playPauseLabel()).toBe('Abspielen'));
  });

  it('drops the stopped question audio\'s controls in the answer phase', async () => {
    await startGame(betQuiz({ questionAudio: '/audio/frage.mp3' }));
    const question = gameAudio('frage.mp3');
    act(() => {
      question.duration = 30;
      question.dispatchEvent(new Event('loadedmetadata'));
    });
    await waitFor(() => expect(playPauseLabel()).toBe('Pause'));

    pressRight(); // question → answer: question audio stops
    await waitFor(() => expect(screen.getByText('Antwort A')).toBeInTheDocument());
    await waitFor(() => expect(audioGroup()).toBeUndefined());
  });
});

describe('FourStatements — GM audio controls', () => {
  function clues(answerAudio?: string): FourStatementsConfig {
    return {
      type: 'four-statements',
      title: 'Hinweise',
      rules: ['Regel'],
      questions: [
        { topic: 'Thema A', statements: ['H1', 'H2'], answer: 'Lösung A', answerAudio, answerAudioStart: answerAudio ? 4 : undefined },
        { topic: 'Thema B', statements: ['H1'], answer: 'Lösung B' },
      ],
    };
  }

  async function startGame(config: FourStatementsConfig) {
    renderGame(FourStatements, config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    pressRight(); // landing → rules
    pressRight(); // rules → game
    await waitFor(() => expect(screen.getByText('Thema A')).toBeInTheDocument());
  }

  it('offers answer-audio controls after the reveal', async () => {
    await startGame(clues('/audio/song.mp3'));
    expect(audioGroup()).toBeUndefined();

    await sendGmCommand('four-statements-reveal');
    await waitFor(() => expect(playPauseLabel()).toBe('Pause'));
    const answer = gameAudio('song.mp3');

    await sendGmCommand('audio-playpause');
    expect(answer.pause).toHaveBeenCalled();
    await waitFor(() => expect(playPauseLabel()).toBe('Abspielen'));
    answer.currentTime = 30;
    await sendGmCommand('audio-restart');
    expect(answer.currentTime).toBe(4);
  });

  it('offers no audio controls without answer audio', async () => {
    await startGame(clues());
    await sendGmCommand('four-statements-reveal');
    await waitFor(() => expect(screen.getByText('Lösung A')).toBeInTheDocument());
    expect(audioGroup()).toBeUndefined();
  });
});
