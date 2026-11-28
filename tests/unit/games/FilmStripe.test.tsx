import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import FilmStripe, { filmStripeFrameUrl } from '@/components/games/FilmStripe';
import type { FilmStripeConfig, FilmStripeQuestion } from '@/types/config';
import type { GamemasterAnswerData, GamemasterControl } from '@/types/game';
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

const STRIPE = {
  colors: ['#101010', '#202020', '#303030', '#404040', '#505050', '#606060'],
  frames: 3,
  framePositions: [0, 2, 4],
};

const NEMO: FilmStripeQuestion = { video: '/videos/Findet Nemo.m4v', answer: 'Findet Nemo', stripe: STRIPE };
const DUNE: FilmStripeQuestion = { video: '/videos/Dune.m4v', answer: 'Dune', answerImage: '/images/Movie Posters/dune.jpg', stripe: STRIPE };

function makeConfig(overrides: Partial<FilmStripeConfig> = {}): FilmStripeConfig {
  return {
    type: 'film-stripe',
    title: 'Filmstreifen',
    rules: ['Errate den Film.'],
    questions: [NEMO, DUNE],
    ...overrides,
  };
}

function renderGame(config?: FilmStripeConfig) {
  return render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <FilmStripe {...defaultProps} config={config ?? makeConfig()} />
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
  await waitFor(() => expect(screen.getByText('Filmstreifen')).toBeInTheDocument());
  key('ArrowRight'); // landing → rules
  key('ArrowRight'); // rules → game
  await waitFor(() => expect(document.querySelector('.film-stripe-stage')).toBeInTheDocument());
}

function emitCommand(controlId: string) {
  act(() => {
    backendSocket.__emitChannelForTests('gamemaster-command', { controlId, timestamp: Date.now() });
  });
}

function stripeColors(): string[] {
  return Array.from(document.querySelectorAll('.film-stripe-bar__colors rect')).map(r => r.getAttribute('fill') ?? '');
}

function timelapseFrame(): HTMLImageElement | null {
  return document.querySelector('.film-stripe-timelapse__frame');
}

function answerText(): string | null {
  return document.querySelector('.quiz-answer p')?.textContent ?? null;
}

describe('filmStripeFrameUrl', () => {
  it('strips the /videos/ prefix and encodes the path as a query value', () => {
    expect(filmStripeFrameUrl('/videos/Harry Potter/Film #1 & mehr.m4v', 7))
      .toBe('/api/film-stripe/frame?path=Harry%20Potter%2FFilm%20%231%20%26%20mehr.m4v&i=7');
  });
});

describe('FilmStripe', () => {
  let fetchedUrls: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
    fetchedUrls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetchedUrls.push(String(url));
      return { ok: true, blob: async () => new Blob(['x']) } as unknown as Response;
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the landing screen with the title', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Filmstreifen')).toBeInTheDocument());
  });

  it('opens a film with its stripe only, labelled as the example', async () => {
    renderGame();
    await enterGame();
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
    expect(screen.getByText('Welcher Film ist das?')).toBeInTheDocument();
    expect(stripeColors()).toEqual(STRIPE.colors);
    expect(timelapseFrame()).toBeNull();
    expect(document.querySelector('.film-stripe-bar__marker')).toBeNull();
    expect(answerText()).toBeNull();
  });

  it('uses a per-question prompt when one is authored', async () => {
    renderGame(makeConfig({ questions: [{ ...NEMO, question: 'Welcher Pixar-Film ist das?' }] }));
    await enterGame();
    expect(screen.getByText('Welcher Pixar-Film ist das?')).toBeInTheDocument();
  });

  it('prefetches the time-lapse stills of the current film with fetch()', async () => {
    renderGame();
    await enterGame();
    await waitFor(() => expect(fetchedUrls).toHaveLength(3));
    expect(fetchedUrls.sort()).toEqual([0, 1, 2].map(i => filmStripeFrameUrl(NEMO.video, i)));
  });

  it('plays the time-lapse on the first advance, with a marker on the stripe', async () => {
    renderGame();
    await enterGame();
    await waitFor(() => expect(fetchedUrls).toHaveLength(3));

    key('ArrowRight');
    await waitFor(() => expect(timelapseFrame()).not.toBeNull());
    expect(document.querySelector('.film-stripe-stage--timelapse')).toBeInTheDocument();
    expect(document.querySelector('.film-stripe-bar__marker')).toBeInTheDocument();
    expect(answerText()).toBeNull();

    // The stills advance on their own and loop.
    const first = timelapseFrame()!.getAttribute('src');
    await waitFor(() => expect(timelapseFrame()!.getAttribute('src')).not.toBe(first));
  });

  it('reveals the answer on the next advance and stops the time-lapse', async () => {
    renderGame(makeConfig({ questions: [DUNE, NEMO] }));
    await enterGame();
    key('ArrowRight'); // time-lapse
    key('ArrowRight'); // answer
    await waitFor(() => expect(answerText()).toBe('Dune'));
    expect(timelapseFrame()).toBeNull();
    expect(document.querySelector('.film-stripe-bar__marker')).toBeNull();
    expect(stripeColors()).toEqual(STRIPE.colors);
    expect(document.querySelector('.quiz-image')).toBeInTheDocument();
  });

  it('steps back from the answer to the time-lapse to the bare stripe', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight');
    key('ArrowRight');
    await waitFor(() => expect(answerText()).toBe('Findet Nemo'));

    key('ArrowLeft');
    await waitFor(() => expect(answerText()).toBeNull());
    expect(document.querySelector('.film-stripe-stage--timelapse')).toBeInTheDocument();

    key('ArrowLeft');
    await waitFor(() => expect(document.querySelector('.film-stripe-stage--timelapse')).not.toBeInTheDocument());
  });

  it('opens the next film with the bare stripe again', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowRight');
    await waitFor(() => expect(screen.getByText('Film 1 von 1')).toBeInTheDocument());
    expect(timelapseFrame()).toBeNull();
    expect(answerText()).toBeNull();
  });

  it('reaches the award screen after the last answer', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight'); key('ArrowRight'); // film 0: time-lapse, answer
    key('ArrowRight');                    // film 1
    key('ArrowRight'); key('ArrowRight'); // time-lapse, answer
    await waitFor(() => expect(answerText()).toBe('Dune'));
    key('ArrowRight');
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());
  });

  it('says so when a stripe was never computed, and still reveals the answer', async () => {
    renderGame(makeConfig({ questions: [{ video: '/videos/Neu.mkv', answer: 'Neuer Film' }] }));
    await enterGame();
    expect(screen.getByText('Für diesen Film wurde noch kein Farbstreifen berechnet.')).toBeInTheDocument();
    expect(document.querySelector('.film-stripe-bar')).toBeNull();
    expect(fetchedUrls).toHaveLength(0);

    // No time-lapse stage to stop at: the first advance is the answer.
    key('ArrowRight');
    await waitFor(() => expect(answerText()).toBe('Neuer Film'));
  });

  it('sends prompt, answer and next film to the gamemaster', async () => {
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    renderGame();
    await enterGame();
    await waitFor(() => {
      const calls = sendWsSpy.mock.calls.filter(([ch]) => ch === 'gamemaster-answer');
      const data = calls[calls.length - 1]?.[1] as GamemasterAnswerData | undefined;
      expect(data?.question).toBe('Welcher Film ist das?');
      expect(data?.answer).toBe('Findet Nemo');
      expect(data?.nextAnswer).toEqual({ question: 'Welcher Film ist das?', answer: 'Dune', image: '/images/Movie Posters/dune.jpg' });
    });
    sendWsSpy.mockRestore();
  });

  it('offers the gamemaster a time-lapse and a reveal button', async () => {
    const sendWsSpy = vi.spyOn(backendSocket, 'sendWs');
    renderGame();
    await enterGame();
    await waitFor(() => {
      const calls = sendWsSpy.mock.calls.filter(([ch]) => ch === 'gamemaster-controls');
      const payload = calls[calls.length - 1]?.[1] as { controls?: GamemasterControl[] } | undefined;
      const group = payload?.controls?.find(c => c.type === 'button-group' && c.id === 'actions');
      const ids = group && group.type === 'button-group' ? group.buttons.map(b => b.id) : [];
      expect(ids).toEqual(['film-stripe-timelapse', 'film-stripe-reveal']);
    });
    sendWsSpy.mockRestore();
  });

  it('obeys the gamemaster commands', async () => {
    renderGame();
    await enterGame();
    await waitFor(() => expect(fetchedUrls).toHaveLength(3));

    emitCommand('film-stripe-timelapse');
    await waitFor(() => expect(document.querySelector('.film-stripe-stage--timelapse')).toBeInTheDocument());

    emitCommand('film-stripe-timelapse');
    await waitFor(() => expect(document.querySelector('.film-stripe-stage--timelapse')).not.toBeInTheDocument());

    emitCommand('film-stripe-reveal');
    await waitFor(() => expect(answerText()).toBe('Findet Nemo'));

    // From the answer, the time-lapse button goes back to the hint.
    emitCommand('film-stripe-timelapse');
    await waitFor(() => expect(answerText()).toBeNull());
    expect(document.querySelector('.film-stripe-stage--timelapse')).toBeInTheDocument();
  });
});
