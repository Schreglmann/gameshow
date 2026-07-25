import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { ThemeProvider } from '@/context/ThemeContext';
import GamemasterView from '@/components/common/GamemasterView';
import type { GamemasterAnswerData, GamemasterControlsData } from '@/types/game';

const mockAnswer: { current: GamemasterAnswerData | null } = { current: null };
const mockControls: { current: GamemasterControlsData | null } = { current: null };
const sendCommandMock = vi.fn();

vi.mock('@/hooks/useGamemasterSync', () => ({
  useGamemasterAnswer: () => mockAnswer.current,
  useGamemasterControls: () => mockControls.current,
  useSendGamemasterCommand: () => sendCommandMock,
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

function renderView(props?: { showAnswerImages?: boolean; hideAnswers?: boolean }) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView showAnswerImages={props?.showAnswerImages} hideAnswers={props?.hideAnswers} />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

describe('GamemasterView — hidden answers', () => {
  beforeEach(() => {
    sendCommandMock.mockClear();
    mockAnswer.current = {
      gameTitle: 'Allgemeinwissen',
      questionNumber: 3,
      totalQuestions: 10,
      question: 'Welcher Fluss ist der längste der Welt?',
      answer: 'Nil',
      answerImage: '/images/nil.jpg',
      extraInfo: 'Kategorie: Geografie\n\nNil\nAmazonas',
      nextAnswer: { question: 'Wie viele Planeten?', answer: '8' },
    };
    mockControls.current = { controls: [], answerRevealed: true };
  });

  it('shows every answer element while hiding is off', () => {
    renderView({ showAnswerImages: true });

    expect(document.querySelector('.gamemaster-answer')?.textContent).toBe('Nil');
    expect(document.querySelector('.gamemaster-answer--hidden')).toBeNull();
    expect(document.querySelector('.gamemaster-image')).not.toBeNull();
    expect(document.querySelector('.gamemaster-extra')).not.toBeNull();
    expect(document.querySelector('.gamemaster-next')).not.toBeNull();
  });

  it('replaces the answer with a hint and drops image, extra info and next preview', () => {
    renderView({ showAnswerImages: true, hideAnswers: true });

    const answer = document.querySelector('.gamemaster-answer');
    expect(answer?.classList.contains('gamemaster-answer--hidden')).toBe(true);
    expect(answer?.textContent).toBe('Antworten versteckt');
    expect(document.body.textContent).not.toContain('Nil');

    expect(document.querySelector('.gamemaster-image')).toBeNull();
    expect(document.querySelector('.gamemaster-extra')).toBeNull();
    expect(document.querySelector('.gamemaster-next')).toBeNull();
  });

  it('keeps the question, meta and title visible while answers are hidden', () => {
    renderView({ hideAnswers: true });

    expect(document.querySelector('.gamemaster-question')?.textContent)
      .toBe('Welcher Fluss ist der längste der Welt?');
    expect(document.querySelector('.gamemaster-meta')?.textContent).toBe('Frage 3 / 10');
    expect(document.querySelector('.gamemaster-title')?.textContent).toBe('Allgemeinwissen');
  });

  it('keeps the current question image visible — it is what the players guess from', () => {
    mockAnswer.current = {
      gameTitle: 'Zufallsbild',
      questionNumber: 2,
      totalQuestions: 5,
      question: 'Aus welchem Film stammt dieses Bild?',
      answer: 'The Matrix',
      questionImage: '/api/random-frame?path=matrix.mkv&seed=1',
    };
    renderView({ showAnswerImages: true, hideAnswers: true });

    expect(document.querySelector('.gamemaster-question-image')).not.toBeNull();
    expect(document.querySelector('.gamemaster-answer--hidden')).not.toBeNull();
  });

  it('masks a ranking answer list but keeps the rows clickable', async () => {
    const user = userEvent.setup();
    mockAnswer.current = {
      gameTitle: 'Ranking',
      questionNumber: 1,
      totalQuestions: 4,
      question: 'Sortiere nach Einwohnerzahl',
      answer: 'Tokio',
      answerList: [
        { rank: 1, text: 'Tokio', revealed: true },
        { rank: 2, text: 'Delhi', revealed: false },
      ],
    };
    renderView({ hideAnswers: true });

    // No hint line for the list variant — the masked rows carry the message.
    expect(document.querySelector('.gamemaster-answer--hidden')).toBeNull();

    const rows = document.querySelectorAll('.gamemaster-answer-item');
    expect(rows).toHaveLength(2);
    expect(document.querySelectorAll('.gamemaster-answer-text--masked')).toHaveLength(2);
    expect(document.body.textContent).not.toContain('Tokio');
    expect(document.body.textContent).not.toContain('Delhi');
    // Rank chips and revealed/pending states stay readable.
    expect(rows[0].classList.contains('revealed')).toBe(true);
    expect(rows[1].classList.contains('pending')).toBe(true);
    expect(rows[0].textContent).toContain('1');

    await user.click(screen.getAllByTitle('In Frontend bis hierher aufdecken')[1]);
    expect(sendCommandMock).toHaveBeenCalledWith('rank-2');
  });
});
