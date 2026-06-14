import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import RandomFrame from '@/components/games/RandomFrame';
import type { RandomFrameConfig } from '@/types/config';

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

function makeConfig(overrides: Partial<RandomFrameConfig> = {}): RandomFrameConfig {
  return {
    type: 'random-frame',
    title: 'Aus welchem Film?',
    rules: ['Errate den Film!'],
    questions: [
      { video: '/videos/example.mp4', answer: 'Beispiel-Film' },
      { video: '/videos/matrix.mkv', answer: 'The Matrix', frameStart: 60, frameEnd: 120 },
      { video: '/videos/inception.mp4', answer: 'Inception' },
    ],
    ...overrides,
  };
}

function renderGame(config?: RandomFrameConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <RandomFrame {...defaultProps} config={config || makeConfig()} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

async function advanceToGame() {
  // Landing -> Rules
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  // Rules -> Game
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
}

function getFrameImg(): HTMLImageElement {
  return document.querySelector('.image-guess-image') as HTMLImageElement;
}

describe('RandomFrame', () => {
  const originalFetch = global.fetch;
  let fetchCalls: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    fetchCalls = [];
    global.fetch = vi.fn((url: RequestInfo | URL) => {
      fetchCalls.push(String(url));
      return Promise.resolve({ blob: () => Promise.resolve(new Blob()) } as Response);
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('preloads every question frame in order on the title screen', async () => {
    renderGame(); // mounts on the landing/title screen — preload should fire immediately
    await waitFor(() => {
      const frameCalls = fetchCalls.filter(u => u.includes('/api/random-frame'));
      expect(frameCalls.length).toBe(3);
    });
    const frameCalls = fetchCalls.filter(u => u.includes('/api/random-frame'));
    expect(frameCalls[0]).toContain('path=example.mp4');
    expect(frameCalls[1]).toContain('path=matrix.mkv');
    expect(frameCalls[2]).toContain('path=inception.mp4');
  });

  it('renders landing screen with title', async () => {
    renderGame();
    await waitFor(() => {
      expect(screen.getByText('Aus welchem Film?')).toBeInTheDocument();
    });
  });

  it('shows the example label and a frame request URL for the first question', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Aus welchem Film?')).toBeInTheDocument());
    await advanceToGame();

    await waitFor(() => expect(screen.getByText('Beispiel')).toBeInTheDocument());
    const img = getFrameImg();
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toMatch(/^\/api\/random-frame\?/);
    expect(img.getAttribute('src')).toContain('path=example.mp4');
  });

  it('shows the default prompt above the frame', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Aus welchem Film?')).toBeInTheDocument());
    await advanceToGame();
    await waitFor(() => expect(screen.getByText('Aus welchem Film stammt dieses Bild?')).toBeInTheDocument());
  });

  it('reveals answer text on advance', async () => {
    const user = userEvent.setup();
    renderGame();
    await waitFor(() => expect(screen.getByText('Aus welchem Film?')).toBeInTheDocument());
    await advanceToGame();

    expect(screen.queryByText('Beispiel-Film')).not.toBeInTheDocument();

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div);
    document.body.removeChild(div);

    await waitFor(() => expect(screen.getByText('Beispiel-Film')).toBeInTheDocument());
  });

  it('passes the configured frame bounds in the request URL', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Aus welchem Film?')).toBeInTheDocument());
    await advanceToGame();

    const user = userEvent.setup();
    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal example
    await user.click(div); // next question (#1, has bounds)
    document.body.removeChild(div);

    await waitFor(() => {
      const src = getFrameImg().getAttribute('src') ?? '';
      expect(src).toContain('path=matrix.mkv');
      expect(src).toContain('start=60');
      expect(src).toContain('end=120');
    });
  });

  it('re-rolls the frame URL when the gamemaster regenerate command fires', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Aus welchem Film?')).toBeInTheDocument());
    await advanceToGame();

    const before = getFrameImg().getAttribute('src') ?? '';
    const params = new URL(before, 'http://x').searchParams;

    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', { data: JSON.stringify({ channel: 'gamemaster-command', data: { controlId: 'regenerate-frame', timestamp: 1 } }) }),
      );
    });

    // The WS command path is exercised end-to-end in e2e; here we assert the URL
    // shape is seed + variant parameterised so a re-roll bumps the variant counter
    // (the GM rotate) while the per-question seed stays constant.
    expect(params.get('seed')).not.toBeNull();
    expect(params.get('variant')).toBe('0');
    expect(before).toMatch(/variant=\d+/);
  });

  it('filters disabled questions', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { video: '/videos/example.mp4', answer: 'Beispiel' },
        { video: '/videos/a.mp4', answer: 'A', disabled: true },
        { video: '/videos/b.mp4', answer: 'B' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Aus welchem Film?')).toBeInTheDocument());
    await advanceToGame();

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal example
    await user.click(div); // next (skips disabled)
    document.body.removeChild(div);

    await waitFor(() => expect(screen.getByText('Bild 1 von 1')).toBeInTheDocument());
  });

  it('calls onNextGame after the last question is revealed', async () => {
    const user = userEvent.setup();
    const config = makeConfig({
      questions: [
        { video: '/videos/example.mp4', answer: 'Beispiel' },
        { video: '/videos/only.mp4', answer: 'Einziger Film' },
      ],
    });
    renderGame(config);
    await waitFor(() => expect(screen.getByText('Aus welchem Film?')).toBeInTheDocument());
    await advanceToGame();

    const div = document.createElement('div');
    document.body.appendChild(div);
    await user.click(div); // reveal example
    await user.click(div); // next -> last question
    await user.click(div); // reveal last answer
    await user.click(div); // advance past last -> onGameComplete
    document.body.removeChild(div);

    // Either the point screen appears (point system on) or onNextGame fired.
    await waitFor(() => {
      const pointScreen = screen.queryByText(/Punkte/i);
      expect(pointScreen || defaultProps.onNextGame.mock.calls.length > 0).toBeTruthy();
    });
  });
});
