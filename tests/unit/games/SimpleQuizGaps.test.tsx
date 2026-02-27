import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import SimpleQuiz from '@/components/games/SimpleQuiz';
import type { SimpleQuizConfig } from '@/types/config';

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

function makeConfig(overrides: Partial<SimpleQuizConfig> = {}): SimpleQuizConfig {
  return {
    type: 'simple-quiz',
    title: 'Test Quiz',
    rules: ['Rule 1'],
    questions: [
      { question: 'Example Q', answer: 'Example A' },
      { question: 'Question 1', answer: 'Answer 1' },
      { question: 'Question 2', answer: 'Answer 2' },
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

describe('SimpleQuiz - Gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('navigates back to un-reveal answer with ArrowLeft', async () => {
    const user = userEvent.setup();
    renderQuiz();
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    // Show answer
    await clickForward(user);
    await waitFor(() => expect(screen.getByText('Example A')).toBeInTheDocument());

    // ArrowLeft to un-reveal
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.queryByText('Example A')).not.toBeInTheDocument();
      expect(screen.getByText('Example Q')).toBeInTheDocument();
    });
  });

  it('navigates back to previous question with ArrowLeft', async () => {
    const user = userEvent.setup();
    renderQuiz();
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    // Advance: show answer → next question
    await clickForward(user); // show example answer
    await clickForward(user); // go to question 1

    await waitFor(() => expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument());

    // ArrowLeft should go back to example with answer shown
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
    await waitFor(() => {
      expect(screen.getByText('Example A')).toBeInTheDocument();
    });
  });

  it('completes game after last question', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Example Q', answer: 'Example A' },
        { question: 'Q1', answer: 'A1' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    // Example: show answer → advance
    await clickForward(user);
    await clickForward(user);

    // Q1: show answer → advance (should complete)
    await waitFor(() => expect(screen.getByText('Q1')).toBeInTheDocument());
    await clickForward(user); // show answer A1
    await waitFor(() => expect(screen.getByText('A1')).toBeInTheDocument());
    await clickForward(user); // game complete

    // Should show points screen (pointSystemEnabled=true)
    await waitFor(() => {
      expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    });
  });

  it('scrolls to top on new question', async () => {
    const scrollSpy = vi.fn();
    Object.defineProperty(document.documentElement, 'scrollTop', { set: scrollSpy, configurable: true });

    const user = userEvent.setup();
    renderQuiz();
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    // scrollTop should have been set to 0 for the first question
    expect(scrollSpy).toHaveBeenCalledWith(0);

    // Clean up
    Object.defineProperty(document.documentElement, 'scrollTop', { value: 0, writable: true, configurable: true });
  });

  it('does not play answer audio when question has no answerAudio', async () => {
    const audioInstances: any[] = [];
    const OrigAudio = (globalThis as any).Audio;
    (globalThis as any).Audio = class MockAudio {
      src = '';
      play = vi.fn().mockReturnValue(Promise.resolve());
      pause = vi.fn();
      load = vi.fn();
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
      constructor(src?: string) {
        if (src) this.src = src;
        audioInstances.push(this);
      }
    };

    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 'A' },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    await clickForward(user); // reveal answer

    // No audio should have been created for answer
    const answerAudios = audioInstances.filter(a => a.src && !a.src.includes('timer'));
    expect(answerAudios).toHaveLength(0);
  });

  it('does not render Timer when question has no timer property', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'No Timer', answer: 'A' },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    expect(document.querySelector('.timer-display')).not.toBeInTheDocument();
  });

  it('displays normal font for text questions (no emoji-only)', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Normal text question?', answer: 'A' },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    advanceToGame();

    await waitFor(() => {
      const questionDiv = document.querySelector('.quiz-question') as HTMLElement;
      expect(questionDiv).toBeInTheDocument();
      expect(questionDiv.style.fontSize).not.toBe('6em');
    });
  });
});
