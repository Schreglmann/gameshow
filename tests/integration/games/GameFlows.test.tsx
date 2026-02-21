import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import GameScreen from '@/components/screens/GameScreen';

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
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockedNavigate,
  };
});

function renderGameScreen(initialEntries = ['/game?index=0']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <GameProvider>
        <MusicProvider>
          <GameScreen />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

describe('SimpleQuiz game flow', () => {
  beforeEach(() => {
    mockedNavigate.mockClear();
    mockFetchGameData.mockClear();
  });

  it('shows questions and answers through full game flow', async () => {
    mockFetchGameData.mockResolvedValue({
      gameId: 'game1',
      config: {
        type: 'simple-quiz',
        title: 'Test Quiz',
        rules: ['Answer questions'],
        questions: [
          { question: 'Example Question', answer: 'Example Answer' },
          { question: 'Real Question 1', answer: 'Real Answer 1' },
        ],
      },
      currentIndex: 0,
      totalGames: 2,
      pointSystemEnabled: true,
    });

    renderGameScreen();

    // Wait for game to load - landing screen
    await waitFor(() => {
      expect(screen.getByText('Test Quiz')).toBeInTheDocument();
    });

    // Landing -> Rules
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(screen.getByText('Regeln:')).toBeInTheDocument();
    expect(screen.getByText('Answer questions')).toBeInTheDocument();

    // Rules -> Game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    // Should show first (example) question
    await waitFor(() => {
      expect(screen.getByText('Example Question')).toBeInTheDocument();
      expect(screen.getByText('Beispiel Frage')).toBeInTheDocument();
    });

    // Reveal answer
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(screen.getByText('Example Answer')).toBeInTheDocument();

    // Next question
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(screen.getByText('Real Question 1')).toBeInTheDocument();
    expect(screen.getByText('Frage 1 von 1')).toBeInTheDocument();

    // Reveal answer
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    expect(screen.getByText('Real Answer 1')).toBeInTheDocument();

    // Complete game -> Should show award points
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    await waitFor(() => {
      expect(screen.getByText('Punkte vergeben')).toBeInTheDocument();
    });
  });
});

describe('GuessingGame game flow', () => {
  beforeEach(() => {
    mockedNavigate.mockClear();
    mockFetchGameData.mockClear();
  });

  it('allows guessing and shows result', async () => {
    const user = userEvent.setup();

    mockFetchGameData.mockResolvedValue({
      gameId: 'game2',
      config: {
        type: 'guessing-game',
        title: 'Guessing',
        rules: ['Guess close!'],
        questions: [
          { question: 'Example', answer: 100 },
          { question: 'How many stars?', answer: 1000 },
        ],
      },
      currentIndex: 0,
      totalGames: 2,
      pointSystemEnabled: true,
    });

    renderGameScreen();

    await waitFor(() => {
      expect(screen.getByText('Guessing')).toBeInTheDocument();
    });

    // Landing -> Rules -> Game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    // Should show example question with the guess form
    await waitFor(() => {
      expect(screen.getByText('Example')).toBeInTheDocument();
    });

    // Fill in guesses
    const team1Input = screen.getByLabelText('Tipp Team 1:');
    const team2Input = screen.getByLabelText('Tipp Team 2:');
    await user.type(team1Input, '90');
    await user.type(team2Input, '110');

    // Submit
    await user.click(screen.getByText('Tipp Abgeben'));

    // Should show result: correct answer is 100
    await waitFor(() => {
      expect(screen.getByText('100')).toBeInTheDocument();
    });
  });
});

describe('FactOrFake game flow', () => {
  beforeEach(() => {
    mockedNavigate.mockClear();
    mockFetchGameData.mockClear();
  });

  it('shows statement and reveals answer', async () => {
    mockFetchGameData.mockResolvedValue({
      gameId: 'game3',
      config: {
        type: 'fact-or-fake',
        title: 'Fakt oder Fake',
        rules: ['Decide!'],
        questions: [
          { statement: 'Example statement', answer: 'FAKT', description: 'It is true' },
          { statement: 'Water is dry', answer: 'FAKE', description: 'No it is not' },
        ],
      },
      currentIndex: 0,
      totalGames: 2,
      pointSystemEnabled: true,
    });

    renderGameScreen();

    await waitFor(() => {
      expect(screen.getByText('Fakt oder Fake')).toBeInTheDocument();
    });

    // Landing -> Rules -> Game
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    // Should show example statement
    await waitFor(() => {
      expect(screen.getByText('Example statement')).toBeInTheDocument();
    });

    // Reveal answer
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    });

    expect(screen.getByText('FAKT')).toBeInTheDocument();
    expect(screen.getByText('It is true')).toBeInTheDocument();
  });
});
