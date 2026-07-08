import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import BaseGameWrapper from '@/components/games/BaseGameWrapper';
import { useFullscreen, useRegisterFullscreenMedia, type FullscreenMedia } from '@/context/FullscreenContext';
import { __emitChannelForTests } from '@/services/useBackendSocket';

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({
    pointSystemEnabled: true,
    teamRandomizationEnabled: true,
    globalRules: [],
  }),
  fetchBackgroundMusic: vi.fn().mockResolvedValue([]),
}));

interface RenderOptions {
  pointSystemEnabled?: boolean;
  skipPointsScreen?: boolean;
  pointValue?: number;
  rules?: string[];
  totalQuestions?: number;
  currentIndex?: number;
  onRulesShow?: () => void;
  onNextShow?: () => void;
  onAwardPoints?: (team: 'team1' | 'team2', points: number) => void;
  onNextGame?: () => void;
  onPrevGame?: () => void;
  resumeAtEnd?: boolean;
}

function renderWrapper(opts: RenderOptions = {}) {
  const onAwardPoints = opts.onAwardPoints ?? vi.fn();
  const onNextGame = opts.onNextGame ?? vi.fn();
  const onPrevGame = opts.onPrevGame ?? vi.fn();
  const resumeArgs: boolean[] = [];
  render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <BaseGameWrapper
            title="Testspiel"
            rules={opts.rules ?? ['Regel eins', 'Regel zwei']}
            totalQuestions={opts.totalQuestions ?? 4}
            pointSystemEnabled={opts.pointSystemEnabled ?? true}
            currentIndex={opts.currentIndex ?? 2}
            pointValue={opts.pointValue ?? 3}
            skipPointsScreen={opts.skipPointsScreen}
            resumeAtEnd={opts.resumeAtEnd}
            onRulesShow={opts.onRulesShow}
            onNextShow={opts.onNextShow}
            onAwardPoints={onAwardPoints}
            onNextGame={onNextGame}
            onPrevGame={onPrevGame}
          >
            {({ onGameComplete, resumeAtEnd }) => {
              resumeArgs.push(resumeAtEnd);
              return (
                <div>
                  <div>Spielinhalt</div>
                  <button onClick={onGameComplete}>Spiel beenden</button>
                </div>
              );
            }}
          </BaseGameWrapper>
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
  return { onAwardPoints, onNextGame, onPrevGame, resumeArgs };
}

// Probe rendered inside the game phase: registers the given media (drives the
// GM toggle) and exposes a button that opens a specific clicked media.
function FullscreenProbe({ media, clickMedia }: { media: FullscreenMedia | null; clickMedia?: FullscreenMedia }) {
  const { open } = useFullscreen();
  useRegisterFullscreenMedia(media);
  return <button onClick={() => open(clickMedia)}>show-click</button>;
}

function renderFullscreenWrapper(media: FullscreenMedia | null, clickMedia?: FullscreenMedia) {
  render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <BaseGameWrapper
            title="Testspiel"
            rules={['Regel eins', 'Regel zwei']}
            totalQuestions={4}
            pointSystemEnabled
            currentIndex={2}
            pointValue={3}
            onAwardPoints={vi.fn()}
            onNextGame={vi.fn()}
          >
            {() => <FullscreenProbe media={media} clickMedia={clickMedia} />}
          </BaseGameWrapper>
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

async function gotoGamePhase() {
  await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());
  pressArrowRight();
  await waitFor(() => expect(screen.getByText('Regeln:')).toBeInTheDocument());
  pressArrowRight();
  await waitFor(() => expect(screen.getByText('show-click')).toBeInTheDocument());
}

async function sendGmCommand(controlId: string) {
  await act(async () => {
    __emitChannelForTests('gamemaster-command', { controlId, timestamp: Date.now() + Math.random() });
  });
}

function pressArrowRight() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); });
}

function pressArrowLeft() {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' })); });
}

describe('BaseGameWrapper (shared game shell)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('walks landing → rules → game with keyboard navigation', async () => {
    const onRulesShow = vi.fn();
    renderWrapper({ onRulesShow });

    // Landing: title visible, game content not yet rendered
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());
    expect(screen.queryByText('Spielinhalt')).not.toBeInTheDocument();

    // Rules: rule lines + question count, onRulesShow fired
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Regeln:')).toBeInTheDocument());
    expect(screen.getByText('Regel eins')).toBeInTheDocument();
    expect(screen.getByText('Regel zwei')).toBeInTheDocument();
    expect(screen.getByText('Es gibt insgesamt 4 Fragen.')).toBeInTheDocument();
    expect(onRulesShow).toHaveBeenCalledTimes(1);

    // Game: children rendered
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
  });

  it('navigates back from rules to landing and from game to rules', async () => {
    renderWrapper();
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Regeln:')).toBeInTheDocument());
    pressArrowLeft();
    await waitFor(() => expect(screen.queryByText('Regeln:')).not.toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    pressArrowLeft();
    await waitFor(() => expect(screen.getByText('Regeln:')).toBeInTheDocument());
  });

  it('navigates back to the previous game from the landing phase (keyboard)', async () => {
    const { onPrevGame } = renderWrapper({ currentIndex: 2 });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    // On the title screen the in-game phases are exhausted — back steps to the
    // previous game rather than being a no-op.
    pressArrowLeft();
    expect(onPrevGame).toHaveBeenCalledTimes(1);
  });

  it('navigates back to the previous game from the landing phase (gamemaster nav-back)', async () => {
    const { onPrevGame } = renderWrapper({ currentIndex: 2 });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    await sendGmCommand('nav-back');
    expect(onPrevGame).toHaveBeenCalledTimes(1);
  });

  it('invokes onPrevGame from the landing phase on the first game too (parent decides destination)', async () => {
    // The wrapper always delegates back-from-landing to onPrevGame; GameScreen
    // routes the first game out to the global rules / start page.
    const { onPrevGame } = renderWrapper({ currentIndex: 0 });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowLeft();
    expect(onPrevGame).toHaveBeenCalledTimes(1);
  });

  it('starts in the game phase and signals resume when resumeAtEnd is set', async () => {
    const { resumeArgs } = renderWrapper({ resumeAtEnd: true });
    // No landing/rules — game content is shown immediately.
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    expect(screen.queryByText('Regeln:')).not.toBeInTheDocument();
    // The initial game-phase render receives resumeAtEnd = true.
    expect(resumeArgs[0]).toBe(true);
  });

  it('stops signalling resume after the game phase is left (one-shot)', async () => {
    // Resume in game phase, step back to rules, then forward again: the second
    // game-phase entry must NOT resume (so forward replay starts at question 0).
    const { resumeArgs } = renderWrapper({ resumeAtEnd: true });
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    expect(resumeArgs[0]).toBe(true);

    pressArrowLeft(); // game → rules (no in-game back handler registered here)
    await waitFor(() => expect(screen.getByText('Regeln:')).toBeInTheDocument());
    pressArrowRight(); // rules → game (remount of children)
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    expect(resumeArgs[resumeArgs.length - 1]).toBe(false);
  });

  it('starts at the landing screen when resumeAtEnd is not set', async () => {
    const { resumeArgs } = renderWrapper();
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());
    expect(screen.queryByText('Spielinhalt')).not.toBeInTheDocument();
    expect(resumeArgs).toEqual([]); // children (game phase) not rendered yet
  });

  it('shows AwardPoints after completion and awards the winner the point value', async () => {
    const user = userEvent.setup();
    const { onAwardPoints, onNextGame } = renderWrapper({ pointValue: 3 });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());

    await user.click(screen.getByText('Spiel beenden'));
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Team 1' }));
    expect(onAwardPoints).toHaveBeenCalledTimes(1);
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 3);
    expect(onNextGame).toHaveBeenCalledTimes(1);
  });

  it('awards both teams on Unentschieden', async () => {
    const user = userEvent.setup();
    const { onAwardPoints, onNextGame } = renderWrapper({ pointValue: 2 });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    await user.click(screen.getByText('Spiel beenden'));
    await waitFor(() => expect(screen.getByText('Punkte vergeben')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Unentschieden' }));
    expect(onAwardPoints).toHaveBeenCalledWith('team1', 2);
    expect(onAwardPoints).toHaveBeenCalledWith('team2', 2);
    expect(onNextGame).toHaveBeenCalledTimes(1);
  });

  it('skips the points screen with skipPointsScreen and goes straight to the next game', async () => {
    const user = userEvent.setup();
    const onNextShow = vi.fn();
    const { onAwardPoints, onNextGame } = renderWrapper({ skipPointsScreen: true, onNextShow });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    await user.click(screen.getByText('Spiel beenden'));

    expect(screen.queryByText('Punkte vergeben')).not.toBeInTheDocument();
    expect(onNextShow).toHaveBeenCalledTimes(1);
    expect(onNextGame).toHaveBeenCalledTimes(1);
    expect(onAwardPoints).not.toHaveBeenCalled();
  });

  it('skips the points screen when the point system is disabled', async () => {
    const user = userEvent.setup();
    const { onAwardPoints, onNextGame } = renderWrapper({ pointSystemEnabled: false });
    await waitFor(() => expect(screen.getByText('Testspiel')).toBeInTheDocument());

    pressArrowRight();
    pressArrowRight();
    await waitFor(() => expect(screen.getByText('Spielinhalt')).toBeInTheDocument());
    await user.click(screen.getByText('Spiel beenden'));

    expect(screen.queryByText('Punkte vergeben')).not.toBeInTheDocument();
    expect(onNextGame).toHaveBeenCalledTimes(1);
    expect(onAwardPoints).not.toHaveBeenCalled();
  });

  describe('fullscreen toggle', () => {
    it('opens and closes the registered media on the toggle-fullscreen command', async () => {
      renderFullscreenWrapper({ type: 'image', src: '/images/answer.jpg' });
      await gotoGamePhase();

      // No overlay until the GM toggles it.
      expect(document.querySelector('.lightbox-image')).toBeNull();

      await sendGmCommand('toggle-fullscreen');
      await waitFor(() => {
        const img = document.querySelector('img.lightbox-image') as HTMLImageElement | null;
        expect(img).not.toBeNull();
        expect(img!.getAttribute('src')).toBe('/images/answer.jpg');
      });

      // Toggling again closes it.
      await sendGmCommand('toggle-fullscreen');
      await waitFor(() => expect(document.querySelector('.lightbox-image')).toBeNull());
    });

    it('shows the specific clicked media (override) rather than the registered one', async () => {
      const user = userEvent.setup();
      renderFullscreenWrapper(
        { type: 'image', src: '/images/registered.jpg' },
        { type: 'image', src: '/images/clicked.jpg' },
      );
      await gotoGamePhase();

      await user.click(screen.getByText('show-click'));
      await waitFor(() => {
        const img = document.querySelector('img.lightbox-image') as HTMLImageElement | null;
        expect(img?.getAttribute('src')).toBe('/images/clicked.jpg');
      });
    });

    it('closes automatically when the host proceeds (nav-forward)', async () => {
      renderFullscreenWrapper({ type: 'image', src: '/images/answer.jpg' });
      await gotoGamePhase();

      await sendGmCommand('toggle-fullscreen');
      await waitFor(() => expect(document.querySelector('.lightbox-image')).not.toBeNull());

      // Proceeding to the answer / next question must close the overlay.
      await sendGmCommand('nav-forward');
      await waitFor(() => expect(document.querySelector('.lightbox-image')).toBeNull());
    });

    it('closes automatically on nav-back', async () => {
      renderFullscreenWrapper({ type: 'image', src: '/images/answer.jpg' });
      await gotoGamePhase();

      await sendGmCommand('toggle-fullscreen');
      await waitFor(() => expect(document.querySelector('.lightbox-image')).not.toBeNull());

      await sendGmCommand('nav-back');
      await waitFor(() => expect(document.querySelector('.lightbox-image')).toBeNull());
    });

    it('does not open when no media is registered', async () => {
      renderFullscreenWrapper(null);
      await gotoGamePhase();
      await sendGmCommand('toggle-fullscreen');
      await waitFor(() => expect(true).toBe(true));
      expect(document.querySelector('.lightbox-image')).toBeNull();
    });
  });
});
