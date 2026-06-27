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
  onRulesShow?: () => void;
  onNextShow?: () => void;
  onAwardPoints?: (team: 'team1' | 'team2', points: number) => void;
  onNextGame?: () => void;
}

function renderWrapper(opts: RenderOptions = {}) {
  const onAwardPoints = opts.onAwardPoints ?? vi.fn();
  const onNextGame = opts.onNextGame ?? vi.fn();
  render(
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <BaseGameWrapper
            title="Testspiel"
            rules={opts.rules ?? ['Regel eins', 'Regel zwei']}
            totalQuestions={opts.totalQuestions ?? 4}
            pointSystemEnabled={opts.pointSystemEnabled ?? true}
            currentIndex={2}
            pointValue={opts.pointValue ?? 3}
            skipPointsScreen={opts.skipPointsScreen}
            onRulesShow={opts.onRulesShow}
            onNextShow={opts.onNextShow}
            onAwardPoints={onAwardPoints}
            onNextGame={onNextGame}
          >
            {({ onGameComplete }) => (
              <div>
                <div>Spielinhalt</div>
                <button onClick={onGameComplete}>Spiel beenden</button>
              </div>
            )}
          </BaseGameWrapper>
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
  return { onAwardPoints, onNextGame };
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
