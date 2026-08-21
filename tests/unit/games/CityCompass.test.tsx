import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import CityCompass from '@/components/games/CityCompass';
import type { CityCompassConfig, CityCompassQuestion } from '@/types/config';

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

const WIEN = { name: 'Wien', lat: 48.2085, lon: 16.3721, country: 'AT' };
const PRAG = { name: 'Prag', lat: 50.088, lon: 14.4208, country: 'CZ' };
const BUDAPEST = { name: 'Budapest', lat: 47.4984, lon: 19.0404, country: 'HU' };
const BERLIN = { name: 'Berlin', lat: 52.5244, lon: 13.4105, country: 'DE' };
const ROM = { name: 'Rom', lat: 41.8919, lon: 12.5113, country: 'IT' };

function makeQuestion(overrides: Partial<CityCompassQuestion> = {}): CityCompassQuestion {
  return { center: WIEN, neighbors: [PRAG, BUDAPEST, BERLIN, ROM], ...overrides };
}

function makeConfig(overrides: Partial<CityCompassConfig> = {}): CityCompassConfig {
  return {
    type: 'city-compass',
    title: 'Städte-Kompass',
    rules: ['Errate die Stadt im Zentrum.'],
    questions: [
      makeQuestion(),
      makeQuestion({ center: BERLIN, neighbors: [PRAG, WIEN, ROM, BUDAPEST] }),
    ],
    ...overrides,
  };
}

function tree(config: CityCompassConfig) {
  return (
    <MemoryRouter>
      <GameProvider>
        <MusicProvider>
          <CityCompass {...defaultProps} config={config} />
        </MusicProvider>
      </GameProvider>
    </MemoryRouter>
  );
}

function renderGame(config?: CityCompassConfig) {
  return render(tree(config ?? makeConfig()));
}

function key(k: string) {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: k })); });
}

async function enterGame() {
  await waitFor(() => expect(screen.getByText('Städte-Kompass')).toBeInTheDocument());
  key('ArrowRight'); // landing → rules
  key('ArrowRight'); // rules → game
  await waitFor(() => expect(document.querySelector('.compass-rose')).toBeInTheDocument());
}

/** Neighbor names currently drawn on the rose. */
function drawnCities(): string[] {
  return Array.from(document.querySelectorAll('.compass-rose__label')).map(
    el => el.childNodes[0]?.textContent ?? '',
  );
}

function distanceLabels(): string[] {
  return Array.from(document.querySelectorAll('.compass-rose__distance')).map(el => el.textContent ?? '');
}

/** The solved center city. Deliberately not getByText: the same name is also
 *  printed in the answer line below the rose. */
function solutionText(): string | null {
  return document.querySelector('.compass-rose__solution')?.textContent ?? null;
}

function answerText(): string | null {
  return document.querySelector('.quiz-answer p')?.textContent ?? null;
}

describe('CityCompass', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    defaultProps.onNextGame = vi.fn();
    defaultProps.onAwardPoints = vi.fn();
  });

  it('renders the landing screen with the title', async () => {
    renderGame();
    await waitFor(() => expect(screen.getByText('Städte-Kompass')).toBeInTheDocument());
  });

  it('shows the default prompt and labels the first question as the example', async () => {
    renderGame();
    await enterGame();
    expect(screen.getByText('Welche Stadt liegt im Zentrum?')).toBeInTheDocument();
    expect(screen.getByText('Beispiel')).toBeInTheDocument();
  });

  it('uses a per-question prompt when one is authored', async () => {
    renderGame(makeConfig({ questions: [makeQuestion({ question: 'Welche Hauptstadt ist gesucht?' })] }));
    await enterGame();
    expect(screen.getByText('Welche Hauptstadt ist gesucht?')).toBeInTheDocument();
  });

  it('renders the info subtitle above the question', async () => {
    renderGame(makeConfig({ questions: [makeQuestion({ info: 'Mitteleuropa' })] }));
    await enterGame();
    expect(screen.getByText('Mitteleuropa')).toBeInTheDocument();
  });

  it('draws every neighbor and keeps the center hidden', async () => {
    renderGame();
    await enterGame();
    expect(drawnCities()).toEqual(['Prag', 'Budapest', 'Berlin', 'Rom']);
    expect(document.querySelector('.compass-rose__unknown')?.textContent).toBe('?');
    expect(screen.queryByText('Wien · AT')).not.toBeInTheDocument();
  });

  it('shows no distances by default, leaving the bearing as the only clue', async () => {
    renderGame();
    await enterGame();
    expect(drawnCities()).toHaveLength(4);
    expect(distanceLabels()).toHaveLength(0);
  });

  it('appends the distance to each label when showDistances is on', async () => {
    renderGame(makeConfig({ showDistances: true }));
    await enterGame();
    expect(distanceLabels()).toHaveLength(4);
    // Vienna to Budapest is a little over 200 km.
    expect(distanceLabels()).toContain('210 km');
  });

  it('reveals the center city on the host advance', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight');
    await waitFor(() => expect(solutionText()).toBe('Wien · AT'));
    expect(document.querySelector('.compass-rose__unknown')).not.toBeInTheDocument();
    expect(answerText()).toBe('Wien · AT');
  });

  it('moves to the next question after the answer, then completes the game', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight'); // reveal question 0
    await waitFor(() => expect(solutionText()).toBe('Wien · AT'));

    key('ArrowRight'); // → question 1
    await waitFor(() => expect(screen.getByText('Stadt 1 von 1')).toBeInTheDocument());
    expect(solutionText()).toBeNull();

    key('ArrowRight'); // reveal question 1
    await waitFor(() => expect(solutionText()).toBe('Berlin · DE'));

    key('ArrowRight'); // past the last answer → award points
    await waitFor(() => expect(document.querySelector('.compass-rose')).not.toBeInTheDocument());
  });

  it('un-reveals the answer on back navigation', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight');
    await waitFor(() => expect(solutionText()).toBe('Wien · AT'));

    key('ArrowLeft');
    await waitFor(() => expect(solutionText()).toBeNull());
    expect(document.querySelector('.compass-rose__unknown')?.textContent).toBe('?');
  });

  it('shows the previous question with its answer when stepping back past it', async () => {
    renderGame();
    await enterGame();
    key('ArrowRight'); // reveal question 0
    key('ArrowRight'); // → question 1
    await waitFor(() => expect(screen.getByText('Stadt 1 von 1')).toBeInTheDocument());

    key('ArrowLeft');
    await waitFor(() => expect(screen.getByText('Beispiel')).toBeInTheDocument());
    expect(solutionText()).toBe('Wien · AT');
  });

  describe('drawing the constellation', () => {
    /** Every animated element, in the order CompassRose lays them out. */
    function animated(): { cls: string; delay: number }[] {
      return Array.from(document.querySelectorAll<SVGElement>('.compass-rose [style*="animation-delay"]')).map(el => ({
        cls: el.getAttribute('class') ?? '',
        delay: parseFloat(el.style.animationDelay),
      }));
    }

    it('crops the drawing instead of padding it out to a fixed canvas', async () => {
      renderGame();
      await enterGame();
      const svg = document.querySelector('.compass-rose')!;
      const [, , width, height] = svg.getAttribute('viewBox')!.split(' ').map(Number);
      expect(width).toBeLessThan(1600);
      expect(height).toBeLessThan(1000);
      // The box the SVG scales into has to follow the crop, or the crop is undone.
      const aspect = (svg as SVGElement).style.getPropertyValue('--compass-aspect');
      expect(parseFloat(aspect)).toBeCloseTo(width! / height!, 4);
    });

    it('staggers each city, spoke before dot before name', async () => {
      renderGame();
      await enterGame();
      const spokes = animated().filter(e => e.cls.includes('__spoke')).map(e => e.delay);
      const dots = animated().filter(e => e.cls.includes('__dot')).map(e => e.delay);
      const labels = animated().filter(e => e.cls.includes('__label')).map(e => e.delay);

      expect(spokes).toHaveLength(4);
      expect(spokes).toEqual([...spokes].sort((a, b) => a - b));
      expect(spokes[0]).toBe(0);
      for (let i = 0; i < 4; i += 1) {
        expect(dots[i]).toBeGreaterThan(spokes[i]!);
        expect(labels[i]).toBeGreaterThan(dots[i]!);
      }
    });

    it('gives each spoke its own dash length, so it can draw itself outward', async () => {
      renderGame();
      await enterGame();
      for (const spoke of document.querySelectorAll<SVGElement>('.compass-rose__spoke')) {
        expect(parseFloat(spoke.style.getPropertyValue('--compass-spoke-len'))).toBeGreaterThan(0);
      }
    });

    /** Animation durations from game.css, per element kind. */
    const DURATION_MS: Record<string, number> = { __spoke: 380, __dot: 260, __label: 260 };

    it('is finished within a second at the largest question the game allows', async () => {
      const eight = [PRAG, BUDAPEST, BERLIN, ROM,
        { name: 'Paris', lat: 48.8566, lon: 2.3522, country: 'FR' },
        { name: 'Warschau', lat: 52.2298, lon: 21.0118, country: 'PL' },
        { name: 'Zagreb', lat: 45.8144, lon: 15.978, country: 'HR' },
        { name: 'Kopenhagen', lat: 55.6761, lon: 12.5683, country: 'DK' },
      ];
      renderGame(makeConfig({ questions: [makeQuestion({ neighbors: eight })] }));
      await enterGame();

      const done = animated().map(e => {
        const kind = Object.keys(DURATION_MS).find(k => e.cls.includes(k))!;
        return e.delay + DURATION_MS[kind]!;
      });
      expect(done).toHaveLength(24); // spoke, dot and name for each of the eight
      expect(Math.max(...done)).toBeLessThanOrEqual(1000);
    });
  });

  describe('progressive reveal', () => {
    const progressive = () => makeConfig({ reveal: 'progressive', questions: [makeQuestion()] });

    it('starts with two neighbors, because one alone only gives a direction', async () => {
      renderGame(progressive());
      await enterGame();
      expect(drawnCities()).toEqual(['Prag', 'Budapest']);
      expect(screen.getByText('2 von 4 Städten')).toBeInTheDocument();
    });

    it('adds one neighbor per advance, then reveals the answer', async () => {
      renderGame(progressive());
      await enterGame();

      key('ArrowRight');
      await waitFor(() => expect(drawnCities()).toEqual(['Prag', 'Budapest', 'Berlin']));
      key('ArrowRight');
      await waitFor(() => expect(drawnCities()).toEqual(['Prag', 'Budapest', 'Berlin', 'Rom']));
      expect(screen.queryByText(/von 4 Städten/)).not.toBeInTheDocument();

      key('ArrowRight');
      await waitFor(() => expect(solutionText()).toBe('Wien · AT'));
    });

    it('leaves the cities already drawn untouched when the next one arrives', async () => {
      renderGame(progressive());
      await enterGame();
      const before = Array.from(document.querySelectorAll('.compass-rose__dot'));

      key('ArrowRight');
      await waitFor(() => expect(drawnCities()).toHaveLength(3));

      // Same DOM nodes, so only the new city's elements mount — and only they run
      // the draw-in animation. Remounting the rose would replay all of them.
      const after = Array.from(document.querySelectorAll('.compass-rose__dot'));
      expect(after[0]).toBe(before[0]);
      expect(after[1]).toBe(before[1]);
      expect(before).toHaveLength(2);
    });

    it('takes a neighbor back off the rose on back navigation', async () => {
      renderGame(progressive());
      await enterGame();
      key('ArrowRight');
      await waitFor(() => expect(drawnCities()).toHaveLength(3));

      key('ArrowLeft');
      await waitFor(() => expect(drawnCities()).toEqual(['Prag', 'Budapest']));
    });

    it('leaves the game rather than dropping below the two it starts with', async () => {
      renderGame(progressive());
      await enterGame();
      key('ArrowRight');
      await waitFor(() => expect(drawnCities()).toHaveLength(3));

      key('ArrowLeft');
      await waitFor(() => expect(drawnCities()).toEqual(['Prag', 'Budapest']));

      // Nothing left to un-reveal on the first question, so the wrapper backs out
      // of the game instead of showing a single, useless city.
      key('ArrowLeft');
      await waitFor(() => expect(document.querySelector('.compass-rose')).not.toBeInTheDocument());
    });
  });

  it('skips a disabled question', async () => {
    renderGame(makeConfig({
      questions: [
        makeQuestion(),
        makeQuestion({ center: ROM, neighbors: [PRAG, WIEN, BERLIN], disabled: true }),
        makeQuestion({ center: BERLIN, neighbors: [PRAG, WIEN, ROM, BUDAPEST] }),
      ],
    }));
    await enterGame();
    key('ArrowRight'); // reveal example
    key('ArrowRight'); // → next enabled question
    await waitFor(() => expect(screen.getByText('Stadt 1 von 1')).toBeInTheDocument());
    key('ArrowRight');
    await waitFor(() => expect(solutionText()).toBe('Berlin · DE'));
  });

  it('renders a question whose center has no country', async () => {
    renderGame(makeConfig({
      questions: [makeQuestion({ center: { name: 'Wien', lat: 48.2085, lon: 16.3721 } })],
    }));
    await enterGame();
    key('ArrowRight');
    await waitFor(() => expect(solutionText()).toBe('Wien'));
  });
});
