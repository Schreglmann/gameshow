import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';
import type { GamemasterAnswerData, GamemasterControlsData } from '@/types/game';

const mockAnswer: { current: GamemasterAnswerData | null } = { current: null };
const mockControls: { current: GamemasterControlsData | null } = { current: null };

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => mockAnswer.current,
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => () => {},
  requestShowReemit: () => {},
}));

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
    enabledJokers: [],
  }),
  fetchTheme: vi.fn().mockResolvedValue({ frontend: 'galaxia', admin: 'galaxia' }),
  saveTheme: vi.fn().mockResolvedValue(undefined),
}));

function renderView(props?: { showAnswerImages?: boolean; showNextAnswer?: boolean }) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView showAnswerImages={props?.showAnswerImages} showNextAnswer={props?.showNextAnswer} />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('GamemasterView — random-frame previews', () => {
  beforeEach(() => {
    mockAnswer.current = {
      gameTitle: 'Zufallsbild',
      answer: 'The Matrix',
      questionNumber: 2,
      totalQuestions: 5,
      question: 'Aus welchem Film stammt dieses Bild?',
      questionImage: '/api/random-frame?path=matrix.mkv&seed=1',
      nextAnswer: { question: 'Aus welchem Film?', answer: 'Inception', image: '/api/random-frame?path=inception.mp4&seed=2' },
    };
    mockControls.current = { controls: [], answerRevealed: true };
  });

  it('hides the current + next frame previews when images are off (Bilder ausblenden)', () => {
    renderView({ showAnswerImages: false });
    expect(document.querySelector('.gamemaster-question-image')).toBeNull();
    expect(document.querySelector('.gamemaster-next-image')).toBeNull();
  });

  it('shows both frame previews when images are on (Bilder einblenden)', () => {
    renderView({ showAnswerImages: true });
    expect(document.querySelector('.gamemaster-question-image')).not.toBeNull();
    expect(document.querySelector('.gamemaster-next-image')).not.toBeNull();
  });

  it('shows a loading spinner over a frame preview until it loads', () => {
    renderView({ showAnswerImages: true });
    // Before the <img> fires onLoad, the GmPreviewImage overlay spinner is present.
    expect(document.querySelectorAll('.gamemaster-image-loading').length).toBeGreaterThan(0);
  });
});
