import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import GuessingGame from '@/components/games/GuessingGame';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import type { GuessingGameConfig } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    teamMirrorEnabled: true,
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

function makeConfig(overrides: Partial<GuessingGameConfig> = {}): GuessingGameConfig {
  return {
    type: 'guessing-game',
    title: 'Test Guessing',
    rules: ['Guess the number'],
    questions: [
      { question: 'Example Guess', answer: 50, unit: 'kg' },
      { question: 'How many?', answer: 100, unit: 'pcs' },
      { question: 'How much?', answer: 200, unit: 'km' },
    ],
    ...overrides,
  };
}

function renderGame(config?: GuessingGameConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <GuessingGame {...defaultProps} config={config || makeConfig()} />
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

describe('GuessingGame', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Test Guessing')).toBeInTheDocument();
    });
  });

  it('shows the question and guess form', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Example Guess')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument();
    expect(screen.getByLabelText('Tipp Team 2:')).toBeInTheDocument();
    expect(screen.getByText('Tipp Abgeben')).toBeInTheDocument();
    // Default (not swapped): team 1's input is first on the show.
    const labels = Array.from(document.querySelectorAll('.guess-field label')).map(l => l.textContent);
    expect(labels).toEqual(['Tipp Team 1:', 'Tipp Team 2:']);
  });

  it('renders the guess inputs in swapped frontend order when orderSwapped is set', async () => {
    localStorage.setItem('teamOrderSwapped', 'true');
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 2:')).toBeInTheDocument());
    const labels = Array.from(document.querySelectorAll('.guess-field label')).map(l => l.textContent);
    expect(labels).toEqual(['Tipp Team 2:', 'Tipp Team 1:']);
  });

  it('shows results after submitting guesses', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Tipp Team 1:'), '40');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '70');
    await user.click(screen.getByText('Tipp Abgeben'));

    // Should show the answer
    await waitFor(() => {
      expect(screen.getByText('50')).toBeInTheDocument();
    });
  });

  it('determines Team 1 as winner when closer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    // Answer is 50, Team 1 guesses 48 (diff=2), Team 2 guesses 60 (diff=10)
    await user.type(screen.getByLabelText('Tipp Team 1:'), '48');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '60');
    await user.click(screen.getByText('Tipp Abgeben'));

    // The verdict is a badge on the winning team's result card
    await waitFor(() => {
      expect(screen.getByText('Näher dran!').closest('.guess-result-team'))
        .toHaveTextContent('Team 1');
    });
  });

  it('determines Team 2 as winner when closer', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    // Answer is 50, Team 1 guesses 10 (diff=40), Team 2 guesses 49 (diff=1)
    await user.type(screen.getByLabelText('Tipp Team 1:'), '10');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '49');
    await user.click(screen.getByText('Tipp Abgeben'));

    await waitFor(() => {
      expect(screen.getByText('Näher dran!').closest('.guess-result-team'))
        .toHaveTextContent('Team 2');
    });
  });

  it('shows tie when equal distance', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    // Answer is 50, both guess 5 away
    await user.type(screen.getByLabelText('Tipp Team 1:'), '45');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '55');
    await user.click(screen.getByText('Tipp Abgeben'));

    // A tie badges both team cards
    await waitFor(() => {
      expect(screen.getAllByText('Gleichstand!')).toHaveLength(2);
    });
  });

  it('shows Nächste Frage button in result phase', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Tipp Team 1:'), '40');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '60');
    await user.click(screen.getByText('Tipp Abgeben'));

    await waitFor(() => {
      expect(screen.getByText('Nächste Frage')).toBeInTheDocument();
    });
  });

  it('shows answer image in result phase when provided', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 50, unit: '', answerImage: '/images/result.jpg' },
        { question: 'Q2', answer: 100, unit: '' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Tipp Team 1:'), '40');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '60');
    await user.click(screen.getByText('Tipp Abgeben'));

    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain('/images/result.jpg');
    });
  });

  it('displays formatted numbers with dot separator', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Big number', answer: 1000000, unit: '' },
        { question: 'Q2', answer: 100, unit: '' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Tipp Team 1:'), '999999');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '1000001');
    await user.click(screen.getByText('Tipp Abgeben'));

    // The answer (1000000) should be formatted as "1.000.000"
    await waitFor(() => {
      expect(screen.getByText('1.000.000')).toBeInTheDocument();
    });
  });

  it('renders year answers without a thousands separator', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Which year?', answer: 1492, unit: '' },
        { question: 'Q2', answer: 100, unit: '' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    await user.type(screen.getByLabelText('Tipp Team 1:'), '1500');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '1400');
    await user.click(screen.getByText('Tipp Abgeben'));

    // The answer (1492) should render as "1492", not "1.492"
    await waitFor(() => {
      expect(screen.getByText('1492')).toBeInTheDocument();
    });
    expect(screen.queryByText('1.492')).not.toBeInTheDocument();
  });
});

describe('GuessingGame automatic scoring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // Automatic scoring is the default — no `scoringMode` needed.
  const autoConfig = (questions: GuessingGameConfig['questions']) =>
    makeConfig({ questions });

  /** The shared per-question tally as persisted by the reducer. */
  const readTally = () => JSON.parse(localStorage.getItem('correctAnswersByQuestion') || '{}');

  /** Enter both guesses, reveal, then advance (to the next question or the award screen). */
  async function playQuestion(user: ReturnType<typeof userEvent.setup>, t1: string, t2: string) {
    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Tipp Team 1:'), t1);
    await user.type(screen.getByLabelText('Tipp Team 2:'), t2);
    await user.click(screen.getByText('Tipp Abgeben'));
    await waitFor(() => expect(screen.getByText('Nächste Frage')).toBeInTheDocument());
    await user.click(screen.getByText('Nächste Frage'));
  }

  it('states the verdict on the award screen and awards the positional points to the winner', async () => {
    const user = userEvent.setup();
    renderGame(autoConfig([
      { question: 'Example', answer: 50 },
      { question: 'Q1', answer: 100 },
      { question: 'Q2', answer: 200 },
    ]));
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    // Example question: never counted, whoever is closer.
    await playQuestion(user, '10', '50');
    // Team 1 closer on both real questions.
    await playQuestion(user, '99', '150');
    await playQuestion(user, '205', '300');

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
    expect(screen.getByText('Team 1 hat mehr Fragen gewonnen')).toBeInTheDocument();
    // Points for BOTH teams plus a plain won-question count — never "x von y", which a
    // drawn question (counting for both teams) would break.
    expect(screen.getByText('+1 Punkt')).toBeInTheDocument();
    expect(screen.getByText('0 Punkte')).toBeInTheDocument();
    expect(screen.getByText('2 gewonnene Fragen')).toBeInTheDocument();
    expect(screen.getByText('0 gewonnene Fragen')).toBeInTheDocument();
    expect(screen.queryByText(/von 2 Fragen/)).not.toBeInTheDocument();

    // The verdicts are filed in the shared per-question tally (game 0, questions 1 + 2),
    // which is what the gamemaster's score boxes and "Wertung pro Frage" read.
    expect(readTally()).toEqual({
      '0': { '1': { team1: 1, team2: 0 }, '2': { team1: 1, team2: 0 } },
    });

    // No winner selection — a single confirm books the points and advances.
    expect(screen.queryByText('Unentschieden')).not.toBeInTheDocument();
    await user.click(screen.getByText('Punkte vergeben & weiter'));
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 1);
    expect(defaultProps.onNextGame).toHaveBeenCalled();
  });

  it('counts an equidistant question for both teams', async () => {
    const user = userEvent.setup();
    renderGame(autoConfig([
      { question: 'Example', answer: 50 },
      { question: 'Q1', answer: 100 },
      { question: 'Q2', answer: 200 },
    ]));
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await playQuestion(user, '50', '50');
    // Q1: team 1 closer. Q2: both 10 away — counts for both.
    await playQuestion(user, '99', '150');
    await playQuestion(user, '190', '210');

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
    expect(screen.getByText('Team 1 hat mehr Fragen gewonnen')).toBeInTheDocument();
    // The drawn question is recorded for both teams — 2 wins vs 1 out of 2 questions.
    expect(readTally()['0']['2']).toEqual({ team1: 1, team2: 1 });
    expect(screen.getByText('2 gewonnene Fragen')).toBeInTheDocument();
    expect(screen.getByText('1 gewonnene Frage')).toBeInTheDocument();

    await user.click(screen.getByText('Punkte vergeben & weiter'));
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 1);
  });

  it('awards both teams when they won the same number of questions', async () => {
    const user = userEvent.setup();
    renderGame(autoConfig([
      { question: 'Example', answer: 50 },
      { question: 'Q1', answer: 100 },
      { question: 'Q2', answer: 200 },
    ]));
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await playQuestion(user, '50', '50');
    await playQuestion(user, '99', '150');   // team 1
    await playQuestion(user, '300', '205');  // team 2

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
    expect(screen.getByText('Unentschieden — beide Teams erhalten Punkte')).toBeInTheDocument();
    expect(screen.getAllByText('+1 Punkt')).toHaveLength(2);
    expect(screen.getAllByText('1 gewonnene Frage')).toHaveLength(2);

    await user.click(screen.getByText('Punkte vergeben & weiter'));
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(2);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 1);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 1);
  });

  it('overwrites a question\'s record when it is judged again', async () => {
    const user = userEvent.setup();
    renderGame(autoConfig([
      { question: 'Example', answer: 50 },
      { question: 'Q1', answer: 100 },
    ]));
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await playQuestion(user, '50', '50');
    // Judge Q1 for team 1 (without advancing), then submit it again with team 2 closer.
    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Tipp Team 1:'), '99');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '150');
    await user.click(screen.getByText('Tipp Abgeben'));
    await waitFor(() => expect(screen.getByText('Nächste Frage')).toBeInTheDocument());
    expect(readTally()['0']['1']).toEqual({ team1: 1, team2: 0 });
  });

  it('clears this game\'s tally when the host starts it from the title screen', async () => {
    const user = userEvent.setup();
    // A full standing from an earlier run of this game position.
    localStorage.setItem('correctAnswersByQuestion', JSON.stringify({
      '0': { '1': { team1: 1, team2: 0 }, '2': { team1: 0, team2: 1 } },
      '4': { '1': { team1: 1, team2: 0 } },
    }));
    renderGame(autoConfig([
      { question: 'Example', answer: 50 },
      { question: 'Q1', answer: 100 },
    ]));
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);
    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());

    // Game 0 starts from a clean slate; another game's record is left alone.
    expect(readTally()['0']).toBeUndefined();
    expect(readTally()['4']).toEqual({ '1': { team1: 1, team2: 0 } });
  });

  it('ignores tally entries for questions this playthrough never reached', async () => {
    const user = userEvent.setup();
    renderGame(autoConfig([
      { question: 'Example', answer: 50 },
      { question: 'Q1', answer: 100 },
    ]));
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);
    await playQuestion(user, '50', '50');
    await playQuestion(user, '99', '150');   // team 1 closer on the only question played

    // A record for question 2 arrives from another device AFTER the game started, so the
    // start-of-game reset can't have removed it. Without the reached-question ceiling it
    // would turn this into a 1:1 draw.
    act(() => {
      __emitChannelForTests('gamemaster-question-tally', {
        '0': { '1': { team1: 1, team2: 0 }, '2': { team1: 0, team2: 1 } },
      });
    });

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
    expect(screen.getByText('Team 1 hat mehr Fragen gewonnen')).toBeInTheDocument();
    await user.click(screen.getByText('Punkte vergeben & weiter'));
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team1', 1);
  });

  it('counts a single judged question in the singular', async () => {
    const user = userEvent.setup();
    // Explicit `scoringMode: 'auto'` behaves exactly like the default.
    renderGame(makeConfig({
      scoringMode: 'auto',
      questions: [
        { question: 'Example', answer: 50 },
        { question: 'Q1', answer: 100 },
      ],
    }));
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await playQuestion(user, '50', '50');
    await playQuestion(user, '150', '99');  // team 2 closer

    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
    expect(screen.getByText('Team 2 hat mehr Fragen gewonnen')).toBeInTheDocument();
    expect(screen.getByText('+1 Punkt')).toBeInTheDocument();

    await user.click(screen.getByText('Punkte vergeben & weiter'));
    expect(defaultProps.onAwardPoints).toHaveBeenCalledTimes(1);
    expect(defaultProps.onAwardPoints).toHaveBeenCalledWith('team2', 1);
  });
});

describe('GuessingGame question audio', () => {
  // Track all created Audio instances
  const audioInstances: Array<{
    src: string;
    paused: boolean;
    currentTime: number;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
  }> = [];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    audioInstances.length = 0;
    (globalThis as any).Audio = class MockAudioInstance {
      src = '';
      volume = 1;
      paused = true;
      currentTime = 0;
      duration = 0;
      play = vi.fn().mockImplementation(() => {
        this.paused = false;
        return Promise.resolve();
      });
      pause = vi.fn().mockImplementation(() => {
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

  it('auto-plays question audio when the question has questionAudio', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Which year?', answer: 1976, questionAudio: '/audio/song.mp3' },
        { question: 'Q2', answer: 100 },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const playedAudio = audioInstances.find(a => a.src.includes('/audio/song.mp3'));
      expect(playedAudio).toBeTruthy();
      expect(playedAudio!.play).toHaveBeenCalled();
    });
  });

  it('keeps the question audio playing through the result phase and stops it on the next question', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Which year?', answer: 1976, questionAudio: '/audio/song.mp3' },
        { question: 'Q2', answer: 100 },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());
    const playedAudio = audioInstances.find(a => a.src.includes('/audio/song.mp3'))!;

    await user.type(screen.getByLabelText('Tipp Team 1:'), '1970');
    await user.type(screen.getByLabelText('Tipp Team 2:'), '1980');
    await user.click(screen.getByText('Tipp Abgeben'));

    // Result phase: audio not paused by the reveal
    await waitFor(() => expect(screen.getByText('Nächste Frage')).toBeInTheDocument());
    expect(playedAudio.pause).not.toHaveBeenCalled();

    // Advancing to the next question stops the song
    await user.click(screen.getByText('Nächste Frage'));
    await waitFor(() => {
      expect(playedAudio.pause).toHaveBeenCalled();
    });
  });

  it('starts trimmed question audio at questionAudioStart', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Which year?', answer: 1976, questionAudio: '/audio/song.mp3', questionAudioStart: 42 },
        { question: 'Q2', answer: 100 },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const playedAudio = audioInstances.find(a => a.src.includes('/audio/song.mp3'));
      expect(playedAudio).toBeTruthy();
      expect(playedAudio!.currentTime).toBe(42);
    });
  });

  it('creates no audio element for questions without questionAudio', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Test Guessing')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => expect(screen.getByLabelText('Tipp Team 1:')).toBeInTheDocument());
    // The background-music player creates two src-less A/B elements; the game
    // itself must not have created any sourced audio element.
    expect(audioInstances.filter(a => a.src !== '').length).toBe(0);
  });
});
