import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import Ranking from '@/components/games/Ranking';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import type { RankingConfig, RankingQuestion } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const safePlayMock = vi.fn().mockResolvedValue(true);
vi.mock('@/utils/safePlay', () => ({
  safePlay: (...args: unknown[]) => safePlayMock(...args),
}));

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

function makeQuestion(overrides: Partial<RankingQuestion> = {}): RankingQuestion {
  return {
    question: 'Reihenfolge der Antworten erraten',
    answers: ['Erster', 'Zweiter', 'Dritter'],
    ...overrides,
  };
}

function makeConfig(overrides: Partial<RankingConfig> = {}): RankingConfig {
  return {
    type: 'ranking',
    title: 'Reihenfolge',
    rules: ['Errate die richtige Reihenfolge'],
    questions: [
      makeQuestion({ question: 'Beispiel-Frage' }),
      makeQuestion({ question: 'Echte Frage', answers: ['A', 'B', 'C', 'D'] }),
    ],
    ...overrides,
  };
}

function renderGame(config?: RankingConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <Ranking {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function advanceToGame() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });
}

async function clickForward(user: ReturnType<typeof userEvent.setup>) {
  const div = document.createElement('div');
  document.body.appendChild(div);
  await user.click(div);
  document.body.removeChild(div);
}

function pressArrowRight() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });
}

async function sendGmCommand(controlId: string) {
  await act(async () => {
    __emitChannelForTests('gamemaster-command', { controlId, timestamp: Date.now() + Math.random() });
  });
  await waitFor(() => expect(true).toBe(true));
}

describe('Ranking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
  });

  it('shows the question with 0 answers revealed at start', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Beispiel-Frage')).toBeInTheDocument();
    });
    expect(document.querySelectorAll('.statement')).toHaveLength(0);
  });

  // A question whose items (bare candidates) differ from its answers (full solution).
  function itemsConfig() {
    return makeConfig({
      questions: [
        makeQuestion({ question: 'Beispiel-Frage', items: ['Alpha', 'Beta', 'Gamma'], answers: ['Erster', 'Zweiter', 'Dritter'] }),
        makeQuestion({ question: 'Echte Frage', answers: ['A', 'B', 'C', 'D'] }),
      ],
    });
  }

  it('does not show the item pool when the question has no items (open recall)', async () => {
    renderGame(); // default config: questions have answers but no items
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel-Frage')).toBeInTheDocument());
    expect(document.querySelectorAll('.ranking-pool-row')).toHaveLength(0);
    expect(screen.queryByText('Diese Elemente in die richtige Reihenfolge bringen:')).not.toBeInTheDocument();
  });

  it('renders no question box when the question is empty (items provide the prompt)', async () => {
    const cfg = makeConfig({
      questions: [
        makeQuestion({ question: '', items: ['Alpha', 'Beta', 'Gamma'], answers: ['Erster', 'Zweiter', 'Dritter'] }),
        makeQuestion({ question: 'Echte Frage', answers: ['A', 'B'] }),
      ],
    });
    renderGame(cfg);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(document.querySelectorAll('.ranking-pool-row')).toHaveLength(3));
    // The empty question renders no `.quiz-question` box (so there's no leftover top gap)…
    expect(document.querySelector('.quiz-question')).toBeNull();
    // …while the pool label + items still show.
    expect(screen.getByText('Diese Elemente in die richtige Reihenfolge bringen:')).toBeInTheDocument();
  });

  it('shows the question items (not the answers) as a pool during guessing', async () => {
    renderGame(itemsConfig());
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel-Frage')).toBeInTheDocument());
    // Labelled pool shows the bare items…
    expect(screen.getByText('Diese Elemente in die richtige Reihenfolge bringen:')).toBeInTheDocument();
    expect(document.querySelectorAll('.ranking-pool-row')).toHaveLength(3);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
    // …and NOT the solution-bearing answers
    expect(screen.queryByText('Erster')).not.toBeInTheDocument();
    // Neutral bullets, not rank numbers
    const marks = Array.from(document.querySelectorAll('.ranking-pool-row .ranking-rank')).map(el => el.textContent);
    expect(marks).toEqual(['•', '•', '•']);
  });

  it('replaces the item pool with the ordered answer reveal once the host advances', async () => {
    const user = userEvent.setup();
    renderGame(itemsConfig());
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(document.querySelectorAll('.ranking-pool-row')).toHaveLength(3));
    await clickForward(user);
    await waitFor(() => {
      expect(document.querySelectorAll('.ranking-pool-row')).toHaveLength(0);
      expect(document.querySelectorAll('.statement')).toHaveLength(1);
    });
    // The revealed row is the answer (solution), not the pool item
    expect(screen.getByText('Erster')).toBeInTheDocument();
    const firstRank = document.querySelector('.statement .ranking-rank');
    expect(firstRank?.textContent).toBe('1.');
  });

  it('reveals one ranked answer per advance, in JSON order', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    await clickForward(user);
    await waitFor(() => {
      expect(document.querySelectorAll('.statement')).toHaveLength(1);
      expect(screen.getByText('Erster')).toBeInTheDocument();
    });
    const firstRank = document.querySelector('.statement .ranking-rank');
    expect(firstRank?.textContent).toBe('1.');

    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(2));
    const ranks = Array.from(document.querySelectorAll('.statement .ranking-rank')).map(el => el.textContent);
    expect(ranks).toEqual(['1.', '2.']);

    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(3));
    expect(screen.getByText('Dritter')).toBeInTheDocument();
  });

  it('advances to the next question after all answers revealed', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    // Example: 3 answers → 3 clicks to reveal, 1 more to go to next question
    for (let i = 0; i < 4; i++) await clickForward(user);

    await waitFor(() => expect(screen.getByText('Echte Frage')).toBeInTheDocument());
    expect(document.querySelectorAll('.statement')).toHaveLength(0);
  });

it('ArrowLeft un-reveals the most recent answer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    // Reveal 2 answers
    await clickForward(user);
    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(2));

    // ArrowLeft hides the most recent one
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
  });

  it('calls onGameComplete after last answer of last question advances', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Beispiel', answers: ['x'] }),
        makeQuestion({ question: 'Letzte', answers: ['y'] }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    // Example: 1 answer + 1 advance to next question
    await clickForward(user);
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Letzte')).toBeInTheDocument());

    // Last: 1 answer + 1 advance → complete
    await clickForward(user);
    await clickForward(user);

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
  });

  it('filters disabled questions and preserves the example', async () => {
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a'] }),
        makeQuestion({ question: 'Gesperrt', answers: ['b'], disabled: true }),
        makeQuestion({ question: 'Sichtbar', answers: ['c'] }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    expect(screen.queryByText('Gesperrt')).not.toBeInTheDocument();
    advanceToGame();
    // Ex question visible; "Gesperrt" skipped
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());
    expect(screen.queryByText('Gesperrt')).not.toBeInTheDocument();
  });

  it('renders topic when provided, skips when absent', async () => {
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', topic: 'Kleiner Hinweis' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => {
      expect(screen.getByText('Ex')).toBeInTheDocument();
      expect(screen.getByText('Kleiner Hinweis')).toBeInTheDocument();
    });
  });

  it('short ArrowRight tap advances one answer (does not trigger reveal-all)', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();

    pressArrowRight();
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
  });

  it('holding ArrowRight (≥500ms) reveals all answers at once', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel-Frage')).toBeInTheDocument());

    vi.useFakeTimers();
    try {
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
      act(() => { vi.advanceTimersByTime(600); }); // cross the 500ms long-press threshold
      act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });
    } finally {
      vi.useRealTimers();
    }

    // Example question has 3 answers → all revealed in one shot
    expect(document.querySelectorAll('.statement')).toHaveLength(3);
  });

  it('an OS key-repeat while holding ArrowRight reveals all answers (presenter clicker fix)', async () => {
    // The clicker may send an early keyup that would cancel the timer; OS
    // key-repeat proves the key is held and reveals everything at once.
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel-Frage')).toBeInTheDocument());

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat: true })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });

    expect(document.querySelectorAll('.statement')).toHaveLength(3);
  });

  it('holding Space (OS key-repeat) also reveals all answers', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel-Frage')).toBeInTheDocument());

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' })); });

    expect(document.querySelectorAll('.statement')).toHaveLength(3);
  });

  it('rapid consecutive short taps only advance one answer at a time (no accidental reveal-all)', async () => {
    // Double-tap was rejected as a skip trigger — too easy to fire by accident
    // during normal fast advancing. Two independent taps, however quick, must
    // each only reveal one answer.
    renderGame();
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel-Frage')).toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();

    expect(document.querySelectorAll('.statement')).toHaveLength(2);
  });

  it('first press only starts the audio (no reveal); ranks reveal from the second press (trigger "first" / default)', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a', 'b', 'c'], answerAudio: '/audio/x.mp3' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());
    expect(safePlayMock).not.toHaveBeenCalled();

    await clickForward(user); // "listen first": audio starts, NO rank revealed
    await waitFor(() => expect(safePlayMock).toHaveBeenCalledTimes(1));
    expect(document.querySelectorAll('.statement')).toHaveLength(0);

    await clickForward(user); // now the first rank appears — must not replay
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
    expect(safePlayMock).toHaveBeenCalledTimes(1);

    await clickForward(user); // second rank
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(2));
    expect(safePlayMock).toHaveBeenCalledTimes(1);
  });

  it('without answer audio the first press reveals the first rank immediately (no cue step)', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a', 'b', 'c'] }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());

    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
  });

  it('flags the final answer once it is revealed', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a', 'b'] }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());

    await clickForward(user); // reveal rank 1 — not the last, not flagged yet
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
    expect(document.querySelector('.ranking-row--last')).toBeNull();

    await clickForward(user); // reveal rank 2 — the last answer → flagged
    await waitFor(() => expect(document.querySelector('.ranking-row--last')).not.toBeNull());
  });

  it('plays answer audio only once all answers are revealed (trigger "all")', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a', 'b'], answerAudio: '/audio/x.mp3', answerAudioTrigger: 'all' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());

    await clickForward(user); // reveal first — not all yet, no audio
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
    expect(safePlayMock).not.toHaveBeenCalled();

    await clickForward(user); // reveal second → all revealed → audio
    await waitFor(() => expect(safePlayMock).toHaveBeenCalledTimes(1));
  });

  it('seeks to answerAudioStart before playing the trimmed answer audio', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a', 'b'], answerAudio: '/audio/x.mp3', answerAudioStart: 12, answerAudioEnd: 18 }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());

    await clickForward(user); // reveal first answer → play from trim start
    await waitFor(() => expect(safePlayMock).toHaveBeenCalledTimes(1));
    const audio = document.querySelector('audio') as HTMLAudioElement;
    expect(audio.currentTime).toBe(12);
  });

  it('stops the trimmed answer audio at answerAudioEnd (no loop)', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a', 'b'], answerAudio: '/audio/x.mp3', answerAudioStart: 5, answerAudioEnd: 9 }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());

    await clickForward(user);
    await waitFor(() => expect(safePlayMock).toHaveBeenCalledTimes(1));
    const audio = document.querySelector('audio') as HTMLAudioElement;
    const pauseSpy = vi.spyOn(audio, 'pause');
    audio.currentTime = 9.5;
    audio.dispatchEvent(new Event('timeupdate'));
    expect(pauseSpy).toHaveBeenCalled();
    expect(audio.currentTime).toBe(9);
  });

  it('GM "Von vorne" command restarts the reveal audio from its trim start', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a', 'b'], answerAudio: '/audio/x.mp3', answerAudioStart: 7 }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());

    await clickForward(user); // reveal → audio starts (safePlay #1)
    await waitFor(() => expect(safePlayMock).toHaveBeenCalledTimes(1));
    const audio = document.querySelector('audio') as HTMLAudioElement;
    audio.currentTime = 12;

    await sendGmCommand('audio-restart');
    expect(audio.currentTime).toBe(7);
    expect(safePlayMock).toHaveBeenCalledTimes(2);
  });

  it('GM "Pause/Abspielen" command resumes the paused reveal audio', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ question: 'Ex', answers: ['a', 'b'], answerAudio: '/audio/x.mp3' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Reihenfolge')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Ex')).toBeInTheDocument());

    await clickForward(user); // reveal → audio starts (safePlay #1)
    await waitFor(() => expect(safePlayMock).toHaveBeenCalledTimes(1));
    // safePlay is mocked so the element stays paused → play/pause command resumes it.
    await sendGmCommand('audio-playpause');
    expect(safePlayMock).toHaveBeenCalledTimes(2);
  });
});
