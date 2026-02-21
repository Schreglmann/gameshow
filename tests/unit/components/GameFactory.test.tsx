import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import GameFactory from '@/components/games/GameFactory';
import type { GameConfig } from '@/types/config';

// Mock all game components to isolate GameFactory routing
vi.mock('@/components/games/SimpleQuiz', () => ({
  default: () => <div data-testid="simple-quiz">SimpleQuiz</div>,
}));
vi.mock('@/components/games/GuessingGame', () => ({
  default: () => <div data-testid="guessing-game">GuessingGame</div>,
}));
vi.mock('@/components/games/FinalQuiz', () => ({
  default: () => <div data-testid="final-quiz">FinalQuiz</div>,
}));
vi.mock('@/components/games/AudioGuess', () => ({
  default: () => <div data-testid="audio-guess">AudioGuess</div>,
}));
vi.mock('@/components/games/ImageGame', () => ({
  default: () => <div data-testid="image-game">ImageGame</div>,
}));
vi.mock('@/components/games/FourStatements', () => ({
  default: () => <div data-testid="four-statements">FourStatements</div>,
}));
vi.mock('@/components/games/FactOrFake', () => ({
  default: () => <div data-testid="fact-or-fake">FactOrFake</div>,
}));
vi.mock('@/components/games/Quizjagd', () => ({
  default: () => <div data-testid="quizjagd">Quizjagd</div>,
}));

const baseProps = {
  gameId: 'test',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame: vi.fn(),
  onAwardPoints: vi.fn(),
};

describe('GameFactory', () => {
  it('renders SimpleQuiz for simple-quiz type', () => {
    const config = { type: 'simple-quiz', title: 'Test', questions: [] } as GameConfig;
    render(<GameFactory {...baseProps} config={config} />);
    expect(screen.getByTestId('simple-quiz')).toBeInTheDocument();
  });

  it('renders GuessingGame for guessing-game type', () => {
    const config = { type: 'guessing-game', title: 'Test', questions: [] } as GameConfig;
    render(<GameFactory {...baseProps} config={config} />);
    expect(screen.getByTestId('guessing-game')).toBeInTheDocument();
  });

  it('renders FinalQuiz for final-quiz type', () => {
    const config = { type: 'final-quiz', title: 'Test', questions: [] } as GameConfig;
    render(<GameFactory {...baseProps} config={config} />);
    expect(screen.getByTestId('final-quiz')).toBeInTheDocument();
  });

  it('renders AudioGuess for audio-guess type', () => {
    const config = { type: 'audio-guess', title: 'Test' } as GameConfig;
    render(<GameFactory {...baseProps} config={config} />);
    expect(screen.getByTestId('audio-guess')).toBeInTheDocument();
  });

  it('renders ImageGame for image-game type', () => {
    const config = { type: 'image-game', title: 'Test' } as GameConfig;
    render(<GameFactory {...baseProps} config={config} />);
    expect(screen.getByTestId('image-game')).toBeInTheDocument();
  });

  it('renders FourStatements for four-statements type', () => {
    const config = { type: 'four-statements', title: 'Test', questions: [] } as GameConfig;
    render(<GameFactory {...baseProps} config={config} />);
    expect(screen.getByTestId('four-statements')).toBeInTheDocument();
  });

  it('renders FactOrFake for fact-or-fake type', () => {
    const config = { type: 'fact-or-fake', title: 'Test', questions: [] } as GameConfig;
    render(<GameFactory {...baseProps} config={config} />);
    expect(screen.getByTestId('fact-or-fake')).toBeInTheDocument();
  });

  it('renders Quizjagd for quizjagd type', () => {
    const config = {
      type: 'quizjagd',
      title: 'Test',
      questions: { easy: [], medium: [], hard: [] },
    } as GameConfig;
    render(<GameFactory {...baseProps} config={config} />);
    expect(screen.getByTestId('quizjagd')).toBeInTheDocument();
  });

  it('renders unknown game type message for invalid type', () => {
    const config = { type: 'nonexistent-type', title: 'Test' } as unknown as GameConfig;
    render(<GameFactory {...baseProps} config={config} />);
    expect(screen.getByText(/Unknown game type: nonexistent-type/)).toBeInTheDocument();
  });
});
