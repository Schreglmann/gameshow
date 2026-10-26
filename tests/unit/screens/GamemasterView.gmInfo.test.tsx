import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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

function renderView(hideAnswers?: boolean) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <GameProvider>
          <GamemasterView hideAnswers={hideAnswers} />
        </GameProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

// `gmInfo` is the host's private note under the answer. See specs/gamemaster-info.md.
describe('GamemasterView — gmInfo', () => {
  beforeEach(() => {
    sendCommandMock.mockClear();
    mockAnswer.current = {
      gameTitle: 'Allgemeinwissen',
      questionNumber: 3,
      totalQuestions: 10,
      question: 'Welcher Fluss ist der längste der Welt?',
      answer: 'Nil',
      gmInfo: 'Knapp länger als der Amazonas.',
    };
    mockControls.current = { controls: [], answerRevealed: false };
  });

  it('renders the label and the note', () => {
    renderView();

    expect(document.querySelector('.gamemaster-gm-info-label')?.textContent).toBe('Info für Gamemaster');
    expect(document.querySelector('.gamemaster-gm-info-text')?.textContent).toBe('Knapp länger als der Amazonas.');
  });

  it('is hidden while answers are hidden', () => {
    renderView(true);

    expect(document.querySelector('.gamemaster-gm-info')).toBeNull();
    expect(document.body.textContent).not.toContain('Knapp länger als der Amazonas.');
  });

  it('is absent when the question has no gmInfo', () => {
    mockAnswer.current = { ...mockAnswer.current!, gmInfo: undefined };
    renderView();

    expect(document.querySelector('.gamemaster-gm-info')).toBeNull();
  });

  it('keeps a multi-line note in one element', () => {
    mockAnswer.current = { ...mockAnswer.current!, gmInfo: 'Zeile eins\nZeile zwei' };
    renderView();

    const text = document.querySelectorAll('.gamemaster-gm-info-text');
    expect(text).toHaveLength(1);
    expect(text[0].textContent).toBe('Zeile eins\nZeile zwei');
  });

  it('sits after the answer and before the next-question preview', () => {
    mockAnswer.current = { ...mockAnswer.current!, nextAnswer: { answer: 'Nächste Antwort' } };
    mockControls.current = { controls: [], answerRevealed: true };
    renderView();

    const answer = document.querySelector('.gamemaster-answer')!;
    const note = document.querySelector('.gamemaster-gm-info')!;
    const next = document.querySelector('.gamemaster-next')!;
    expect(answer.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
