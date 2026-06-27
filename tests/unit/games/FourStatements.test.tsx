import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import FourStatements from '@/components/games/FourStatements';
import type { FourStatementsConfig, FourStatementsQuestion } from '@/types/config';

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

function makeQuestion(overrides: Partial<FourStatementsQuestion> = {}): FourStatementsQuestion {
  return {
    topic: 'Gesucht ist ein Erfinder',
    statements: ['Hinweis A', 'Hinweis B', 'Hinweis C', 'Hinweis D'],
    answer: 'Edison',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<FourStatementsConfig> = {}): FourStatementsConfig {
  return {
    type: 'four-statements',
    title: 'Hinweise',
    rules: ['Errate die Lösung'],
    questions: [
      makeQuestion({ topic: 'Beispiel-Thema' }),
      makeQuestion({ topic: 'Echtes Thema' }),
    ],
    ...overrides,
  };
}

function renderGame(config?: FourStatementsConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <FourStatements {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

interface MockAudio { src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; }
const audioInstances: MockAudio[] = [];

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

describe('FourStatements (clue-based)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
    audioInstances.length = 0;
    (globalThis as any).Audio = class MockAudioInstance {
      src = '';
      volume = 1;
      paused = true;
      currentTime = 0;
      play = vi.fn().mockImplementation(function (this: MockAudio) { (this as any).paused = false; return Promise.resolve(); });
      pause = vi.fn().mockImplementation(function (this: MockAudio) { (this as any).paused = true; });
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor(src?: string) {
        if (src) this.src = src;
        audioInstances.push(this as any);
      }
    };
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
  });

  it('starts with 0 statements visible', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Beispiel-Thema')).toBeInTheDocument();
    });
    expect(document.querySelectorAll('.statement')).toHaveLength(0);
    // user available for future assertions
    expect(user).toBeDefined();
  });

  it('reveals one statement per advance, in JSON order', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Hinweis A/)).toBeInTheDocument());
    expect(document.querySelectorAll('.statement')).toHaveLength(1);

    await clickForward(user);
    await waitFor(() => expect(screen.getByText(/Hinweis B/)).toBeInTheDocument());
    expect(document.querySelectorAll('.statement')).toHaveLength(2);

    await clickForward(user);
    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(4));
    expect(screen.getByText(/Hinweis D/)).toBeInTheDocument();
  });

  it('shows answer (text) after all statements revealed', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // 4 statements + 1 advance for answer
    for (let i = 0; i < 5; i++) await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Lösung')).toBeInTheDocument();
      expect(screen.getByText('Edison')).toBeInTheDocument();
    });
  });

  it('shows answer image when answerImage is set', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ topic: 'Ex' }),
        makeQuestion({ answer: 'Tesla', answerImage: 'images/tesla.jpg' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // Example Q: 4 statements + answer + advance = 6 clicks. Then Q2: 4 statements + answer = 5 clicks.
    for (let i = 0; i < 11; i++) await clickForward(user);

    await waitFor(() => expect(screen.getByText('Tesla')).toBeInTheDocument());
    const img = document.querySelector('img.quiz-image') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.src).toContain('images/tesla.jpg');
  });

  it('renders image-only answer (no answer text)', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({
          topic: 'Nur Bild',
          statements: ['Clue 1', 'Clue 2'],
          answer: undefined,
          answerImage: 'images/only.jpg',
        }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // 2 statements + 1 answer
    for (let i = 0; i < 3; i++) await clickForward(user);

    await waitFor(() => {
      expect(screen.getByText('Lösung')).toBeInTheDocument();
      expect(document.querySelector('img.quiz-image')).not.toBeNull();
    });
    // The answer-text card should not be present
    expect(screen.queryByText('Nur Bild')).toBeInTheDocument(); // topic still there
    expect(document.querySelectorAll('.statements-container .statement[style*="rgb(74, 222, 128)"], .statements-container .statement[style*="rgba(74"]')).toHaveLength(0);
  });

  it('skips empty statement slots (treats padded arrays as non-empty-only)', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ topic: 'Ex', statements: ['A', 'B', '', ''] }),
        makeQuestion({ topic: 'Short', statements: ['One clue only', '', '', ''], answer: 'Answer' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // Example has 2 non-empty statements: 2 reveals + 1 answer + 1 advance = 4 clicks
    for (let i = 0; i < 4; i++) await clickForward(user);

    await waitFor(() => expect(screen.getByText('Short')).toBeInTheDocument());
    // 1 statement reveal
    await clickForward(user);
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
    // Next click → answer
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Answer')).toBeInTheDocument());
  });

  it('navigates back with ArrowLeft to un-reveal answer, then statements', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    for (let i = 0; i < 5; i++) await clickForward(user); // reveal 4 + show answer

    await waitFor(() => expect(screen.getByText('Lösung')).toBeInTheDocument());

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.queryByText('Lösung')).not.toBeInTheDocument();
      expect(document.querySelectorAll('.statement')).toHaveLength(4);
    });

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(3));
  });

  it('completes game after last question', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ topic: 'Ex', statements: ['x'] }),
        makeQuestion({ topic: 'Last', statements: ['y'] }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // Example: 1 statement + 1 answer + 1 advance
    for (let i = 0; i < 3; i++) await clickForward(user);
    await waitFor(() => expect(screen.getByText('Last')).toBeInTheDocument());
    // Last: 1 statement + 1 answer + 1 advance → complete
    for (let i = 0; i < 3; i++) await clickForward(user);

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
  });

  it('short ArrowRight tap reveals one clue (does not trigger reveal-all)', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel-Thema')).toBeInTheDocument());

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });

    await waitFor(() => expect(document.querySelectorAll('.statement')).toHaveLength(1));
    expect(screen.queryByText('Lösung')).not.toBeInTheDocument();
  });

  it('holding ArrowRight (≥500ms) reveals all clues and the answer at once', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel-Thema')).toBeInTheDocument());

    vi.useFakeTimers();
    try {
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
      act(() => { vi.advanceTimersByTime(600); }); // cross the 500ms long-press threshold
      act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' })); });
    } finally {
      vi.useRealTimers();
    }

    // All 4 clues + the answer revealed in one shot
    expect(screen.getByText('Hinweis A')).toBeInTheDocument();
    expect(screen.getByText('Hinweis B')).toBeInTheDocument();
    expect(screen.getByText('Hinweis C')).toBeInTheDocument();
    expect(screen.getByText('Hinweis D')).toBeInTheDocument();
    expect(screen.getByText('Lösung')).toBeInTheDocument();
    expect(screen.getByText('Edison')).toBeInTheDocument();
  });

  it('plays answer audio when the answer is revealed', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ topic: 'Ex', statements: ['only'], answer: 'Song', answerAudio: '/audio/song.mp3' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    // No audio until the answer is shown
    await clickForward(user); // reveal the single clue
    expect(audioInstances.find(a => a.src.includes('/audio/song.mp3'))).toBeUndefined();

    await clickForward(user); // reveal the answer
    await waitFor(() => {
      const played = audioInstances.find(a => a.src.includes('/audio/song.mp3'));
      expect(played).toBeTruthy();
      expect(played!.play).toHaveBeenCalled();
    });
  });

  it('stops answer audio when navigating back off the answer', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        makeQuestion({ topic: 'Ex', statements: ['only'], answer: 'Song', answerAudio: '/audio/song.mp3' }),
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Hinweise')).toBeInTheDocument());
    advanceToGame();

    await clickForward(user); // reveal clue
    await clickForward(user); // reveal answer
    const played = await waitFor(() => {
      const a = audioInstances.find(x => x.src.includes('/audio/song.mp3'));
      expect(a).toBeTruthy();
      return a!;
    });

    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.queryByText('Lösung')).not.toBeInTheDocument();
      expect(played.pause).toHaveBeenCalled();
    });
  });
});
