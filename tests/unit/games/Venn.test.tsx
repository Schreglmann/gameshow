import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import Venn from '@/components/games/Venn';
import type { VennConfig, VennQuestion } from '@/types/config';
import type { GamemasterAnswerData } from '@/types/game';
import * as backendSocket from '@/services/useBackendSocket';

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

const MARS: VennQuestion = { sets: ['Planet', 'Schokoriegel', 'Römischer Gott'], answer: 'Mars' };
const PUMA: VennQuestion = { sets: ['Raubkatze', 'Sportmarke'], answer: 'Puma' };

function makeConfig(overrides: Partial<VennConfig> = {}): VennConfig {
  return {
    type: 'venn',
    title: 'Schnittmenge',
    rules: ['Gesucht ist ein Begriff, der in alle Kategorien passt.'],
    questions: [MARS, PUMA],
    ...overrides,
  };
}

function renderGame(config?: VennConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <Venn {...defaultProps} config={config ?? makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>,
  );
}

function key(k: string) {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: k })); });
}

async function enterGame() {
  await waitFor(() => expect(screen.getByText('Schnittmenge')).toBeInTheDocument());
  key('ArrowRight'); // landing → rules
  key('ArrowRight'); // rules → game
  await waitFor(() => expect(document.querySelector('.venn-diagram')).toBeInTheDocument());
}

function emitCommand(controlId: string) {
  act(() => {
    backendSocket.__emitChannelForTests('gamemaster-command', { controlId, timestamp: Date.now() });
  });
}

/** Category names currently drawn, one entry per circle. A long name is split
 *  over two <tspan> lines, so the lines are joined back with a space. */
function drawnSets(): string[] {
  return Array.from(document.querySelectorAll('.venn-diagram__label')).map(el =>
    Array.from(el.querySelectorAll('tspan')).map(line => line.textContent ?? '').join(' '),
  );
}

function circleCount(): number {
  return document.querySelectorAll('.venn-diagram__circle').length;
}

/** The answer inside the diagram. Not getByText: the same word is also printed in
 *  the answer line below it. */
function solutionText(): string | null {
  return document.querySelector('.venn-diagram__solution')?.textContent ?? null;
}

function lastGmData(spy: { mock: { calls: unknown[][] } }): GamemasterAnswerData | undefined {
  const calls = spy.mock.calls.filter(([ch]) => ch === 'gamemaster-answer');
  return calls[calls.length - 1]?.[1] as GamemasterAnswerData | undefined;
}

describe('Venn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('renders the landing screen with the title', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Schnittmenge')).toBeInTheDocument());
  });

  it('starts with two circles, a question mark, and labels the first question as the example', async () => {
    renderGame();
    await enterGame();
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
    expect(screen.getByText('Welcher Begriff passt in alle Kategorien?')).toBeInTheDocument();
    expect(drawnSets()).toEqual(['Planet', 'Schokoriegel']);
    expect(circleCount()).toBe(2);
    expect(document.querySelector('.venn-diagram__unknown')?.textContent).toBe('?');
    expect(solutionText()).toBeNull();
  });

  it('adds the third category as a hint on the first advance, then reveals the answer', async () => {
    renderGame();
    await enterGame();

    key('ArrowRight');
    await waitFor(() => expect(circleCount()).toBe(3));
    expect(drawnSets()).toEqual(['Planet', 'Schokoriegel', 'Römischer Gott']);
    expect(document.querySelector('.venn-diagram__circle--hint')).toBeInTheDocument();
    expect(solutionText()).toBeNull();

    key('ArrowRight');
    await waitFor(() => expect(solutionText()).toBe('Mars'));
    expect(document.querySelector('.venn-diagram__unknown')).not.toBeInTheDocument();
    expect(document.querySelector('.quiz-answer p')?.textContent).toBe('Mars');
  });

  it('goes straight to the answer when a question has only two categories', async () => {
    renderGame(makeConfig({ questions: [PUMA, MARS] }));
    await enterGame();
    expect(circleCount()).toBe(2);
    key('ArrowRight');
    await waitFor(() => expect(solutionText()).toBe('Puma'));
    expect(circleCount()).toBe(2);
  });

  it('steps back through answer and hint, never below the two starting circles', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight'); // hint
    key('ArrowRight'); // answer
    await waitFor(() => expect(solutionText()).toBe('Mars'));

    key('ArrowLeft');
    await waitFor(() => expect(solutionText()).toBeNull());
    expect(circleCount()).toBe(3);

    key('ArrowLeft');
    await waitFor(() => expect(circleCount()).toBe(2));
  });

  it('opens the next question with two circles again', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight'); // hint
    key('ArrowRight'); // answer
    key('ArrowRight'); // next question
    await waitFor(() => expect(screen.getByText('Frage 1 von 1')).toBeInTheDocument());
    expect(drawnSets()).toEqual(['Raubkatze', 'Sportmarke']);
    expect(solutionText()).toBeNull();
  });

  it('shows the previous question solved, with every circle, when stepping back onto it', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowRight'); // question 1
    await waitFor(() => expect(drawnSets()).toEqual(['Raubkatze', 'Sportmarke']));

    key('ArrowLeft');
    await waitFor(() => expect(solutionText()).toBe('Mars'));
    expect(circleCount()).toBe(3);
  });

  it('reaches the award screen after the last answer', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight'); // hint
    key('ArrowRight'); // answer
    key('ArrowRight'); // question 1
    key('ArrowRight'); // answer
    await waitFor(() => expect(solutionText()).toBe('Puma'));
    key('ArrowRight');
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
  });

  it('skips disabled questions', async () => {
    renderGame(makeConfig({ questions: [MARS, { ...PUMA, disabled: true }, { sets: ['Gemüse', 'Deutscher Bundeskanzler'], answer: 'Kohl' }] }));
    await enterGame();
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowRight');
    await waitFor(() => expect(drawnSets()).toEqual(['Gemüse', 'Deutscher Bundeskanzler']));
  });

  it('renders the answer image once the answer is shown', async () => {
    renderGame(makeConfig({ questions: [{ ...PUMA, answerImage: '/images/Tiere/Puma.jpg' }] }));
    await enterGame();
    expect(document.querySelector('.quiz-image')).not.toBeInTheDocument();
    key('ArrowRight');
    await waitFor(() => expect(document.querySelector('.quiz-image')).toBeInTheDocument());
  });

  it('sends the answer and the categories as clickable hints to the gamemaster', async () => {
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    renderGame();
    await enterGame();

    await waitFor(() => {
      const data = lastGmData(sendWsSpy);
      expect(data?.answer).toBe('Mars');
      expect(data?.answerList).toBeUndefined();
      expect(data?.hintListClickable).toBe(true);
      expect(data?.hintList).toEqual([
        { rank: 1, text: 'Planet', revealed: true },
        { rank: 2, text: 'Schokoriegel', revealed: true },
        { rank: 3, text: 'Römischer Gott', revealed: false },
      ]);
      expect(data?.nextAnswer).toEqual({ question: 'Raubkatze ∩ Sportmarke', answer: 'Puma', image: undefined });
    });
    sendWsSpy.mockRestore();
  });

  it('jumps to the answer on the gamemaster "Auflösung" command', async () => {
    renderGame();
    await enterGame();
    emitCommand('venn-reveal');
    await waitFor(() => expect(solutionText()).toBe('Mars'));
    expect(circleCount()).toBe(3);
  });

  it('shows exactly the clicked number of categories on a hint command and hides the answer', async () => {
    renderGame();
    await enterGame();
    emitCommand('hint-3');
    await waitFor(() => expect(circleCount()).toBe(3));

    emitCommand('venn-reveal');
    await waitFor(() => expect(solutionText()).toBe('Mars'));

    emitCommand('hint-2');
    await waitFor(() => expect(circleCount()).toBe(2));
    expect(solutionText()).toBeNull();

    // Never fewer than the two circles the puzzle starts with, never more than exist.
    emitCommand('hint-1');
    await waitFor(() => expect(circleCount()).toBe(2));
    emitCommand('hint-9');
    await waitFor(() => expect(circleCount()).toBe(3));
  });
});
