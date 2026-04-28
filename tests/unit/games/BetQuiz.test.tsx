import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import BetQuiz from '@/components/games/BetQuiz';
import { __emitChannelForTests } from '@/services/useBackendSocket';
import type { BetQuizConfig } from '@/types/config';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

const onAwardPoints = vi.fn();
const onNextGame = vi.fn();

const defaultProps = {
  gameId: 'game-1',
  currentIndex: 0,
  totalGames: 5,
  pointSystemEnabled: true,
  onNextGame,
  onAwardPoints,
};

function makeConfig(overrides: Partial<BetQuizConfig> = {}): BetQuizConfig {
  return {
    type: 'bet-quiz',
    title: 'Einsatzquiz',
    rules: ['Einsatz abgeben'],
    questions: [
      { category: 'Beispiel', question: 'Beispielfrage?', answer: 'Beispiel' },
      { category: 'Geografie', question: 'Hauptstadt Österreichs?', answer: 'Wien' },
      { category: 'Sport', question: 'Anzahl Spieler Fussball?', answer: 'Elf' },
    ],
    ...overrides,
  };
}

function renderGame(config?: BetQuizConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <BetQuiz {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function pressRight() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
}

async function advanceToGame() {
  pressRight(); // landing -> rules
  pressRight(); // rules -> game
}

async function sendGmCommand(controlId: string, value?: string | Record<string, string>) {
  const cmd = { controlId, value, timestamp: Date.now() + Math.random() };
  await act(async () => {
    __emitChannelForTests('gamemaster-command', cmd);
  });
  // Second flush so a newly-registered commandHandler (via setCommandHandler inside a useEffect)
  // is committed before the caller sends the next command.
  await waitFor(() => {
    // Trivial poll — waitFor exits after one stable render pass.
    expect(true).toBe(true);
  });
}

describe('BetQuiz', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Einsatzquiz')).toBeInTheDocument();
    });
  });

  it('shows category (not question) on the first question screen', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Einsatzquiz')).toBeInTheDocument());
    await advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
      expect(screen.queryByText('Beispielfrage?')).not.toBeInTheDocument();
    });
  });

  it('advances to question phase via gamemaster command and shows banner', async () => {
    const config = makeConfig();
    // Give team1 some points so bet of 5 is allowed
    localStorage.setItem('team1', JSON.stringify(['Alice', 'Bob']));
    localStorage.setItem('team2', JSON.stringify(['Clara']));
    localStorage.setItem('team1Points', '20');
    localStorage.setItem('team2Points', '0');
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Einsatzquiz')).toBeInTheDocument());
    await advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel')).toBeInTheDocument());

    await sendGmCommand('select-team1');
    await sendGmCommand('betting-submit', { bet: '5' });

    await waitFor(() => {
      expect(screen.getByText('Beispielfrage?')).toBeInTheDocument();
      expect(screen.getByText('Team 1')).toBeInTheDocument();
      expect(screen.getByText(/Alice, Bob/)).toBeInTheDocument();
      expect(screen.getByText(/Einsatz: 5 Punkte/)).toBeInTheDocument();
    });
  });

  it('does not advance when bet exceeds team points (hard cap)', async () => {
    localStorage.setItem('team1Points', '3');
    renderGame();
    await waitFor(() => expect(screen.getByText('Einsatzquiz')).toBeInTheDocument());
    await advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel')).toBeInTheDocument());

    await sendGmCommand('select-team1');
    await sendGmCommand('betting-submit', { bet: '10' });

    // Still on category phase — question should not appear
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Beispielfrage?')).not.toBeInTheDocument();
  });

  it('does not award points for the example question', async () => {
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    localStorage.setItem('team1Points', '20');
    renderGame();
    await waitFor(() => expect(screen.getByText('Einsatzquiz')).toBeInTheDocument());
    await advanceToGame();
    await waitFor(() => expect(screen.getByText('Beispiel')).toBeInTheDocument());

    await sendGmCommand('select-team1');
    await sendGmCommand('betting-submit', { bet: '5' });
    await waitFor(() => expect(screen.getByText('Beispielfrage?')).toBeInTheDocument());

    pressRight(); // question -> answer
    await waitFor(() => expect(screen.getByText('Beispiel', { selector: 'p' })).toBeInTheDocument());

    await sendGmCommand('judge-correct');
    expect(onAwardPoints).not.toHaveBeenCalled();
  });

  it('awards +bet for Richtig and -bet for Falsch on non-example questions', async () => {
    localStorage.setItem('team1', JSON.stringify(['Alice']));
    localStorage.setItem('team2', JSON.stringify(['Bob']));
    localStorage.setItem('team1Points', '20');
    localStorage.setItem('team2Points', '20');
    renderGame();
    await waitFor(() => expect(screen.getByText('Einsatzquiz')).toBeInTheDocument());
    await advanceToGame();

    // Q0 (example) — skip quickly
    await waitFor(() => expect(screen.getByText('Beispiel')).toBeInTheDocument());
    await sendGmCommand('select-team1');
    await sendGmCommand('betting-submit', { bet: '0' });
    await waitFor(() => expect(screen.getByText('Beispielfrage?')).toBeInTheDocument());
    pressRight(); // question -> answer
    await sendGmCommand('judge-correct'); // auto-advances to next question

    // Q1 (non-example) — Geografie
    await waitFor(() => expect(screen.getByText('Geografie')).toBeInTheDocument());
    await sendGmCommand('select-team1');
    await sendGmCommand('betting-submit', { bet: '7' });
    await waitFor(() => expect(screen.getByText('Hauptstadt Österreichs?')).toBeInTheDocument());
    pressRight(); // -> answer
    await sendGmCommand('judge-correct'); // awards +7 and auto-advances
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 7);

    // Q2 — Sport
    await waitFor(() => expect(screen.getByText('Sport')).toBeInTheDocument());
    await sendGmCommand('select-team2');
    await sendGmCommand('betting-submit', { bet: '4' });
    await waitFor(() => expect(screen.getByText('Anzahl Spieler Fussball?')).toBeInTheDocument());
    pressRight();
    await sendGmCommand('judge-incorrect'); // awards -4
    expect(onAwardPoints).toHaveBeenCalledWith('team2', -4);
  });

  it('calls onNextGame after the last question (skipPointsScreen)', async () => {
    localStorage.setItem('team1Points', '20');
    const config = makeConfig({
      questions: [
        { category: 'Cat0', question: 'Q0', answer: 'A0' },
        { category: 'Cat1', question: 'Q1', answer: 'A1' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Einsatzquiz')).toBeInTheDocument());
    await advanceToGame();

    // Q0 (example)
    await waitFor(() => expect(screen.getByText('Cat0')).toBeInTheDocument());
    await sendGmCommand('select-team1');
    await sendGmCommand('betting-submit', { bet: '0' });
    await waitFor(() => expect(screen.getByText('Q0')).toBeInTheDocument());
    pressRight();
    await sendGmCommand('judge-correct'); // auto-advances

    // Q1 (last)
    await waitFor(() => expect(screen.getByText('Cat1')).toBeInTheDocument());
    await sendGmCommand('select-team1');
    await sendGmCommand('betting-submit', { bet: '3' });
    await waitFor(() => expect(screen.getByText('Q1')).toBeInTheDocument());
    pressRight();
    await sendGmCommand('judge-correct'); // auto-advances past last question -> onGameComplete

    await waitFor(() => expect(onNextGame).toHaveBeenCalled());
  });
});
