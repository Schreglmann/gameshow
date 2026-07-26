import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GameScreen from '@/components/screens/GameScreen';
import { __emitChannelForTests, __emitOpenForTests, __clearWsCacheForTests } from '@/services/useBackendSocket';

const mockFetchGameData = vi.fn();
const mockedNavigate = vi.fn();

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchGameData: (...args: unknown[]) => mockFetchGameData(...args),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockedNavigate };
});

function gameData(title: string, questions: { question: string; answer: string }[]) {
  return {
    gameId: 'game1',
    config: { type: 'simple-quiz', title, rules: ['Rule'], questions },
    currentIndex: 0,
    totalGames: 3,
    pointSystemEnabled: true,
  };
}

function renderGameScreen() {
  return render(
    <MemoryRouter initialEntries={['/game?index=0']}>
      <ThemeProvider>
        <GameProvider>
          <MusicProvider>
            <GameScreen />
          </MusicProvider>
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('GameScreen — live content reload', () => {
  beforeEach(() => {
    localStorage.clear();
    __clearWsCacheForTests();
    mockedNavigate.mockClear();
    mockFetchGameData.mockReset();
  });

  it('re-fetches the current game on content-changed { games } WITHOUT blanking, and shows the edit', async () => {
    const original = gameData('Original Quiz', [{ question: 'Example Q', answer: 'Example A' }, { question: 'Q1', answer: 'A1' }]);
    mockFetchGameData.mockResolvedValue(original);
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Original Quiz')).toBeInTheDocument());
    expect(mockFetchGameData).toHaveBeenCalledTimes(1);

    // Make the refresh fetch hang so we can observe the in-flight state.
    let resolveRefresh!: (v: unknown) => void;
    const refreshPromise = new Promise<unknown>(res => { resolveRefresh = res; });
    mockFetchGameData.mockReturnValueOnce(refreshPromise);

    act(() => {
      __emitChannelForTests('content-changed', { games: true });
    });

    // While the refresh is in flight: no "Loading…" blank, the previous game
    // stays mounted (proves we did NOT setGameData(null)).
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
    expect(screen.getByText('Original Quiz')).toBeInTheDocument();
    expect(mockFetchGameData).toHaveBeenCalledTimes(2);
    expect(mockFetchGameData).toHaveBeenLastCalledWith(0);

    // Now the edited game arrives and swaps in place.
    await act(async () => {
      resolveRefresh(gameData('Fixed Quiz', [{ question: 'Example Q', answer: 'Example A' }, { question: 'Q1', answer: 'A1' }]));
      await refreshPromise;
    });
    await waitFor(() => expect(screen.getByText('Fixed Quiz')).toBeInTheDocument());
  });

  it('re-fetches the current game on WS reconnect (recovers edits missed while disconnected)', async () => {
    const original = gameData('Original Quiz', [{ question: 'Example Q', answer: 'Example A' }, { question: 'Q1', answer: 'A1' }]);
    mockFetchGameData.mockResolvedValue(original);
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Original Quiz')).toBeInTheDocument());
    expect(mockFetchGameData).toHaveBeenCalledTimes(1);

    // Simulate: an edit landed while this client's socket was down (no
    // content-changed delivered). On reconnect the show must re-fetch and
    // pick up the missed edit without a manual reload.
    mockFetchGameData.mockResolvedValue(gameData('Edited While Offline', [{ question: 'Example Q', answer: 'Example A' }, { question: 'Q1', answer: 'A1' }]));
    await act(async () => { __emitOpenForTests(); });

    await waitFor(() => expect(mockFetchGameData).toHaveBeenCalledTimes(2));
    expect(mockFetchGameData).toHaveBeenLastCalledWith(0);
    await waitFor(() => expect(screen.getByText('Edited While Offline')).toBeInTheDocument());
    // No blanking on the reconnect refetch.
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();
  });

  it('re-fetches the current game on content-changed { config } too', async () => {
    mockFetchGameData.mockResolvedValue(gameData('Quiz', [{ question: 'Q', answer: 'A' }]));
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Quiz')).toBeInTheDocument());
    expect(mockFetchGameData).toHaveBeenCalledTimes(1);

    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });
    await waitFor(() => expect(mockFetchGameData).toHaveBeenCalledTimes(2));
  });

  it('does NOT re-fetch the game for a theme-only content-changed', async () => {
    mockFetchGameData.mockResolvedValue(gameData('Quiz', [{ question: 'Q', answer: 'A' }]));
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Quiz')).toBeInTheDocument());
    expect(mockFetchGameData).toHaveBeenCalledTimes(1);

    await act(async () => {
      __emitChannelForTests('content-changed', { theme: true });
    });
    expect(mockFetchGameData).toHaveBeenCalledTimes(1);
  });

  it('jumps to the title screen of the next game when the current game is deleted', async () => {
    // Game A is playing and advanced past its title screen.
    mockFetchGameData.mockResolvedValue({
      gameId: 'gameA',
      config: { type: 'simple-quiz', title: 'Game A', rules: ['R'], questions: [{ question: 'Ex', answer: 'A' }, { question: 'Q1', answer: 'A1' }] },
      currentIndex: 0,
      totalGames: 2,
      pointSystemEnabled: true,
    });
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Game A')).toBeInTheDocument());
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))); // landing → rules
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))); // rules → game
    await waitFor(() => expect(screen.queryByText('Game A')).not.toBeInTheDocument());

    // Admin deletes the current game: the next game (gameB) shifts into index 0.
    mockFetchGameData.mockResolvedValue({
      gameId: 'gameB',
      config: { type: 'simple-quiz', title: 'Game B', rules: ['R'], questions: [{ question: 'Ex', answer: 'A' }, { question: 'Q1', answer: 'A1' }] },
      currentIndex: 0,
      totalGames: 1,
      pointSystemEnabled: true,
    });
    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });

    // The next game appears AT ITS TITLE SCREEN (different gameId ⇒ remount,
    // resetting the wrapper to the landing phase).
    await waitFor(() => expect(screen.getByText('Game B')).toBeInTheDocument());
    expect(mockedNavigate).not.toHaveBeenCalledWith('/summary');
  });

  it('jumps to the summary when the deleted current game was the last (404 on live refresh)', async () => {
    mockFetchGameData.mockResolvedValue(gameData('Last Game', [{ question: 'Q', answer: 'A' }]));
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Last Game')).toBeInTheDocument());

    // Deleted last game → index 0 is now out of range → 404.
    mockFetchGameData.mockRejectedValue(Object.assign(new Error('Failed to fetch game 0'), { status: 404 }));
    await act(async () => {
      __emitChannelForTests('content-changed', { config: true });
    });
    await waitFor(() => expect(mockedNavigate).toHaveBeenCalledWith('/summary'));
  });

  /**
   * The host edits the questions of the game that is *currently being played*.
   * Nothing the audience can see may move. See specs/live-question-order.md.
   */
  describe('editing the playing game’s questions', () => {
    const OriginalAudio = globalThis.Audio;
    let audioCreated = 0;

    beforeEach(() => {
      audioCreated = 0;
      (globalThis as unknown as { Audio: unknown }).Audio = class extends OriginalAudio {
        constructor(src?: string) {
          super(src);
          audioCreated++;
        }
      };
    });
    afterEach(() => {
      (globalThis as unknown as { Audio: unknown }).Audio = OriginalAudio;
    });

    const quiz = (names: string[], randomize = true) => ({
      gameId: 'game1',
      config: {
        type: 'simple-quiz',
        title: 'Quiz',
        rules: ['Rule'],
        randomizeQuestions: randomize,
        questions: [
          { question: 'Beispiel', answer: 'B', questionAudio: 'ex.mp3' },
          ...names.map(n => ({ question: n, answer: `A-${n}`, questionAudio: `${n}.mp3` })),
        ],
      },
      currentIndex: 0,
      totalGames: 1,
      pointSystemEnabled: true,
    });

    const next = () => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
    /** Two presses per question: reveal the answer, then move on. */
    const nextQuestion = () => { next(); next(); };
    const label = () => document.querySelector('.quiz-question-number')?.textContent;
    const onScreen = () => document.querySelector('.quiz-question')?.textContent;

    /** Enters the game phase and advances to the given play index. */
    async function playTo(data: ReturnType<typeof quiz>, playIdx: number) {
      mockFetchGameData.mockResolvedValue(data);
      renderGameScreen();
      await waitFor(() => expect(screen.getByText('Quiz')).toBeInTheDocument());
      next(); // landing → rules
      next(); // rules → game
      await waitFor(() => expect(label()).toBe('Beispiel Frage'));
      for (let i = 0; i < playIdx; i++) nextQuestion();
    }

    async function pushEdit(data: ReturnType<typeof quiz>) {
      mockFetchGameData.mockResolvedValue(data);
      await act(async () => { __emitChannelForTests('content-changed', { games: true }); });
      await waitFor(() => expect(mockFetchGameData).toHaveBeenCalledTimes(2));
    }

    it('appending a question leaves the current one and everything before it untouched', async () => {
      await playTo(quiz(['A', 'B', 'C']), 2);
      const before = onScreen();
      expect(label()).toBe('Frage 2 von 3');
      const audioBefore = audioCreated;
      // Guards the assertions below from passing vacuously: playing to question
      // 2 must genuinely have built audio elements.
      expect(audioBefore).toBeGreaterThan(0);

      await pushEdit(quiz(['A', 'B', 'C', 'NEU']));

      expect(onScreen()).toBe(before);
      expect(label()).toBe('Frage 2 von 4'); // only the total grew
      expect(audioCreated).toBe(audioBefore); // playback was never restarted
    });

    it('deleting an already-asked question keeps the same question on screen, one number lower', async () => {
      const data = quiz(['A', 'B', 'C']);
      await playTo(data, 1);
      const asked = onScreen()!; // whatever the shuffle dealt into play index 1
      nextQuestion();
      const current = onScreen();
      expect(label()).toBe('Frage 2 von 3');
      const audioBefore = audioCreated;

      await pushEdit(quiz(['A', 'B', 'C'].filter(n => n !== asked)));

      expect(onScreen()).toBe(current);   // the host's question did not move
      expect(label()).toBe('Frage 1 von 2'); // ...it is just numbered one lower
      expect(audioCreated).toBe(audioBefore);
    });

    it('deleting a not-yet-asked question does not move the current one', async () => {
      await playTo(quiz(['A', 'B', 'C']), 1);
      const current = onScreen()!;
      const pending = ['A', 'B', 'C'].find(n => n !== current)!;
      const audioBefore = audioCreated;

      await pushEdit(quiz(['A', 'B', 'C'].filter(n => n !== pending)));

      expect(onScreen()).toBe(current);
      expect(label()).toBe('Frage 1 von 2');
      expect(audioCreated).toBe(audioBefore);
    });

    it('deleting the on-screen question slides the next one in', async () => {
      await playTo(quiz(['A', 'B', 'C']), 1);
      const current = onScreen()!;

      await pushEdit(quiz(['A', 'B', 'C'].filter(n => n !== current)));

      expect(onScreen()).not.toBe(current);
      expect(label()).toBe('Frage 1 von 2');
    });

    it('reshuffling the file in admin is a no-op on the running deck', async () => {
      await playTo(quiz(['A', 'B', 'C', 'D']), 2);
      const current = onScreen();
      const audioBefore = audioCreated;

      await pushEdit(quiz(['C', 'A', 'D', 'B'])); // "🔀 Fragen mischen"

      expect(onScreen()).toBe(current);
      expect(label()).toBe('Frage 2 von 4');
      expect(audioCreated).toBe(audioBefore);
    });

    it('fixing a typo on the current question updates it in place', async () => {
      const data = quiz(['A', 'B', 'C'], false);
      await playTo(data, 2); // ordered game → play index 2 is 'B'
      expect(onScreen()).toBe('B');

      await pushEdit(quiz(['A', 'B korrigiert', 'C'], false));

      expect(onScreen()).toBe('B korrigiert');
      expect(label()).toBe('Frage 2 von 3');
    });

    it('survives a keystroke-by-keystroke autosave of a newly typed question', async () => {
      await playTo(quiz(['A', 'B']), 1);
      const current = onScreen();

      for (const partial of ['N', 'NE', 'NEU']) {
        mockFetchGameData.mockResolvedValue(quiz(['A', 'B', partial]));
        await act(async () => { __emitChannelForTests('content-changed', { games: true }); });
        await waitFor(() => expect(onScreen()).toBe(current));
      }

      // One appended question, not three — each keystroke paired to the same slot.
      expect(label()).toBe('Frage 1 von 3');
    });
  });

  it('keeps the running game on a transient (non-404) live-refresh error', async () => {
    mockFetchGameData.mockResolvedValue(gameData('Stable Game', [{ question: 'Q', answer: 'A' }]));
    renderGameScreen();
    await waitFor(() => expect(screen.getByText('Stable Game')).toBeInTheDocument());

    mockFetchGameData.mockRejectedValue(Object.assign(new Error('network blip'), { status: 500 }));
    await act(async () => {
      __emitChannelForTests('content-changed', { games: true });
    });

    // No summary jump, no error screen — the running game stays put.
    expect(mockedNavigate).not.toHaveBeenCalledWith('/summary');
    expect(screen.getByText('Stable Game')).toBeInTheDocument();
  });
});
