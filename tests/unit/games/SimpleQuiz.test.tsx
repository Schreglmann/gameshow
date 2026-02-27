import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import SimpleQuiz from '@/components/games/SimpleQuiz';
import type { SimpleQuizConfig } from '@/types/config';

// Track all created Audio instances
const audioInstances: Array<{
  src: string;
  volume: number;
  paused: boolean;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
}> = [];

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

describe('SimpleQuiz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioInstances.length = 0;
    // Restore Audio constructor mock
    (globalThis as any).Audio = class MockAudioInstance {
      src = '';
      volume = 1;
      paused = true;
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

  it('renders landing screen with title', async () => {
    renderQuiz();
    await waitFor(() => {
      expect(screen.getByText('Test Quiz')).toBeInTheDocument();
    });
  });

  it('displays example question label for first question', async () => {
    const user = userEvent.setup();
    renderQuiz();
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      expect(screen.getByText('Beispiel Frage')).toBeInTheDocument();
    });
  });

  it('displays question numbering for non-example questions', async () => {
    const user = userEvent.setup();
    renderQuiz();
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Show answer for example
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // show answer
    await user.click(div); // next question
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Frage 1 von 2')).toBeInTheDocument();
    });
  });

  it('reveals answer when clicking', async () => {
    const user = userEvent.setup();
    renderQuiz();
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Verify question is shown
    await waitFor(() => {
      expect(screen.getByText('Example Q')).toBeInTheDocument();
    });
    expect(screen.queryByText('Example A')).not.toBeInTheDocument();

    // Click to reveal
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      expect(screen.getByText('Example A')).toBeInTheDocument();
    });
  });

  it('renders question image when provided', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Img Q', answer: 'Img A', questionImage: '/images/test.jpg' },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain('/images/test.jpg');
    });
  });

  it('renders answer image when answer is revealed', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 'A', answerImage: '/images/answer.jpg' },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Before reveal: no answer image
    expect(document.querySelectorAll('.quiz-image')).toHaveLength(0);

    // Reveal answer
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      const imgs = document.querySelectorAll('.quiz-image');
      expect(imgs.length).toBeGreaterThanOrEqual(1);
      const answerImg = imgs[imgs.length - 1] as HTMLImageElement;
      expect(answerImg.src).toContain('/images/answer.jpg');
    });
  });

  it('renders answer list with correct answer highlighted', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        {
          question: 'Pick one',
          answer: 'Option B',
          answerList: ['Option A', 'Option B', 'Option C'],
        },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Reveal answer
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      const correctItem = document.querySelector('.answer-list .correct');
      expect(correctItem).toBeInTheDocument();
      expect(correctItem!.textContent).toBe('Option B');
    });

    // Wrong items should not have .correct class
    const allItems = document.querySelectorAll('.answer-list li');
    const wrongItems = Array.from(allItems).filter(li => !li.classList.contains('correct'));
    expect(wrongItems).toHaveLength(2);
  });

  it('applies large font style for emoji-only questions', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: '🎉🎊', answer: 'Party!' },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const questionDiv = document.querySelector('.quiz-question') as HTMLElement;
      expect(questionDiv).toBeInTheDocument();
      expect(questionDiv.style.fontSize).toBe('6em');
    });
  });

  it('plays answer audio when answer is revealed', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 'A', answerAudio: '/audio/answer.mp3' },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Reveal answer
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => {
      const playedAudio = audioInstances.find(a => a.src.includes('/audio/answer.mp3'));
      expect(playedAudio).toBeTruthy();
      expect(playedAudio!.play).toHaveBeenCalled();
    });
  });

  it('plays question audio when question has questionAudio', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 'A', questionAudio: '/audio/question.mp3' },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    await waitFor(() => {
      const playedAudio = audioInstances.find(a => a.src.includes('/audio/question.mp3'));
      expect(playedAudio).toBeTruthy();
      expect(playedAudio!.play).toHaveBeenCalled();
    });
  });

  it('replaces question image with answer image when replaceImage is true', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: 'A', questionImage: '/images/question.jpg', answerImage: '/images/answer.jpg', replaceImage: true },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Before reveal: question image shown
    await waitFor(() => {
      const img = document.querySelector('.quiz-image') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      expect(img.src).toContain('/images/question.jpg');
    });

    // Reveal answer
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    // After reveal: image should be swapped to answer image
    await waitFor(() => {
      const imgs = document.querySelectorAll('.quiz-image');
      const questionImg = imgs[0] as HTMLImageElement;
      expect(questionImg.src).toContain('/images/answer.jpg');
    });

    // Answer image should NOT appear separately in the answer box
    const answerBox = document.querySelector('.quiz-answer');
    const answerBoxImgs = answerBox?.querySelectorAll('.quiz-image');
    expect(answerBoxImgs?.length || 0).toBe(0);
  });

  it('hides answer box when replaceImage is true and no answer text', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Q', answer: '', questionImage: '/images/question.jpg', answerImage: '/images/answer.jpg', replaceImage: true },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Reveal answer
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    // Answer box should not be rendered
    await waitFor(() => {
      expect(document.querySelector('.quiz-answer')).not.toBeInTheDocument();
    });
  });

  it('renders Timer when question has timer property', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { question: 'Timed Q', answer: 'A', timer: 30 },
        { question: 'Q2', answer: 'A2' },
      ],
    });
    renderQuiz(config);
    await waitFor(() => expect(screen.getByText('Test Quiz')).toBeInTheDocument());
    await advanceToGame(user);

    // Timer should show "30s" initially
    await waitFor(() => {
      expect(screen.getByText('30s')).toBeInTheDocument();
    });
  });
});
