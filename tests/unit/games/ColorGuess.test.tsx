import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import ColorGuess, { ColorPie } from '@/components/games/ColorGuess';
import type { ColorGuessConfig } from '@/types/config';

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

function makeConfig(overrides: Partial<ColorGuessConfig> = {}): ColorGuessConfig {
  return {
    type: 'colorguess',
    title: 'Farb-Puzzle',
    rules: ['Erratet das Logo!'],
    questions: [
      {
        image: '/images/example.svg',
        answer: 'Beispiel',
        colors: [
          { hex: '#1E90FF', percent: 60 },
          { hex: '#34A853', percent: 40 },
        ],
      },
      {
        image: '/images/amazon.svg',
        answer: 'Amazon',
        colors: [
          { hex: '#000000', percent: 75 },
          { hex: '#FF9900', percent: 25 },
        ],
      },
    ],
    ...overrides,
  };
}

function renderGame(config?: ColorGuessConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <ColorGuess {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

async function advanceToGame() {
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
}

describe('ColorGuess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Farb-Puzzle')).toBeInTheDocument();
    });
  });

  it('shows example label for first question', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Farb-Puzzle')).toBeInTheDocument());
    await advanceToGame();

    await waitFor(() => {
      expect(screen.getByText('Beispiel')).toBeInTheDocument();
    });
  });

  it('renders a pie chart wedge per color slice', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Farb-Puzzle')).toBeInTheDocument());
    await advanceToGame();

    await waitFor(() => {
      const wedges = document.querySelectorAll('.color-pie__wedge');
      expect(wedges.length).toBe(2);
    });
  });

  it('hides the answer image before reveal', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Farb-Puzzle')).toBeInTheDocument());
    await advanceToGame();

    expect(document.querySelector('.quiz-answer .quiz-image')).toBeNull();
  });

  it('reveals answer image + text on advance', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Farb-Puzzle')).toBeInTheDocument());
    await advanceToGame();

    const target = document.createElement('div');
    document.body.appendChild(target);
    await user.click(target);
    document.body.removeChild(target);

    await waitFor(() => {
      expect(document.querySelector('.quiz-answer')).toBeTruthy();
      expect(document.querySelector('.quiz-answer .quiz-image')).toBeTruthy();
    });
  });

  it('advances to the next question after reveal', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Farb-Puzzle')).toBeInTheDocument());
    await advanceToGame();

    const target = document.createElement('div');
    document.body.appendChild(target);
    await user.click(target); // reveal example
    await user.click(target); // next question
    document.body.removeChild(target);

    await waitFor(() => {
      expect(screen.getByText('Bild 1 von 1')).toBeInTheDocument();
    });
  });

  it('filters disabled questions', async () => {
    const config = makeConfig({
      questions: [
        { image: '/images/ex.svg', answer: 'Example', colors: [{ hex: '#FFFFFF', percent: 100 }] },
        { image: '/images/d.svg', answer: 'Disabled', disabled: true, colors: [{ hex: '#FF0000', percent: 100 }] },
        { image: '/images/ok.svg', answer: 'OK', colors: [{ hex: '#00FF00', percent: 100 }] },
      ],
    });
    const user = userEvent.setup();
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Farb-Puzzle')).toBeInTheDocument());
    await advanceToGame();

    const target = document.createElement('div');
    document.body.appendChild(target);
    await user.click(target); // reveal example
    await user.click(target); // next (skips disabled)
    document.body.removeChild(target);

    await waitFor(() => {
      expect(screen.getByText('Bild 1 von 1')).toBeInTheDocument();
    });
  });

  it('renders fallback when a question has no colors', async () => {
    const config = makeConfig({
      questions: [
        { image: '/images/ex.svg', answer: 'Example' }, // no colors at all
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Farb-Puzzle')).toBeInTheDocument());
    await advanceToGame();

    await waitFor(() => {
      expect(document.querySelector('.color-pie--empty')).toBeTruthy();
    });
  });
});

describe('ColorPie component', () => {
  it('renders one wedge per slice', () => {
    render(
      <ColorPie
        colors={[
          { hex: '#FF0000', percent: 40 },
          { hex: '#00FF00', percent: 35 },
          { hex: '#0000FF', percent: 25 },
        ]}
        highlightIdx={null}
        onHighlight={() => {}}
      />
    );
    expect(document.querySelectorAll('.color-pie__wedge').length).toBe(3);
  });

  it('draws a full-circle path for a single 100% slice', () => {
    render(
      <ColorPie
        colors={[{ hex: '#FF0000', percent: 100 }]}
        highlightIdx={null}
        onHighlight={() => {}}
      />
    );
    const wedges = document.querySelectorAll('.color-pie__wedge');
    expect(wedges.length).toBe(1);
    // Full-circle path must contain two arcs (A … A … Z) — single-arc SVG can't draw 360°.
    const d = wedges[0].getAttribute('d') ?? '';
    const arcCount = (d.match(/A /g) ?? []).length;
    expect(arcCount).toBe(2);
  });

  it('suppresses labels for wedges smaller than the minimum angle', () => {
    render(
      <ColorPie
        colors={[
          { hex: '#FF0000', percent: 96 },
          { hex: '#00FF00', percent: 3 },
          { hex: '#0000FF', percent: 1 },
        ]}
        highlightIdx={null}
        onHighlight={() => {}}
      />
    );
    // Only the 96% slice exceeds the 18° (= 5%) threshold → exactly one label.
    expect(document.querySelectorAll('.color-pie__label').length).toBe(1);
  });

  it('shows an empty-state placeholder when no colors', () => {
    render(<ColorPie colors={[]} highlightIdx={null} onHighlight={() => {}} />);
    expect(document.querySelector('.color-pie--empty')).toBeTruthy();
  });
});
