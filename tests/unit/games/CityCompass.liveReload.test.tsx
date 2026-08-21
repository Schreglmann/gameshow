import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GameProvider } from '@/context/GameContext';
import { MusicProvider } from '@/context/MusicContext';
import CityCompass from '@/components/games/CityCompass';
import type { CityCompassConfig, CityCompassQuestion, CompassCity } from '@/types/config';

/**
 * Swapping a city in the admin has to reach the running show without a reload and
 * without moving the host to a different question — the point of storing
 * coordinates in the game JSON and drawing the rose as a pure function of them.
 * See specs/live-config-reload.md and specs/live-question-order.md.
 */

vi.mock('@/services/api', () => ({
  fetchSettings: vi.fn().mockResolvedValue({ pointSystemEnabled: true, teamRandomizationEnabled: true, globalRules: [] }),
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

const WIEN: CompassCity = { name: 'Wien', lat: 48.2085, lon: 16.3721, country: 'AT' };
const PRAG: CompassCity = { name: 'Prag', lat: 50.088, lon: 14.4208, country: 'CZ' };
const BUDAPEST: CompassCity = { name: 'Budapest', lat: 47.4984, lon: 19.0404, country: 'HU' };
const BERLIN: CompassCity = { name: 'Berlin', lat: 52.5244, lon: 13.4105, country: 'DE' };
const ROM: CompassCity = { name: 'Rom', lat: 41.8919, lon: 12.5113, country: 'IT' };
const MUENCHEN: CompassCity = { name: 'München', lat: 48.1374, lon: 11.5755, country: 'DE' };
const HAMBURG: CompassCity = { name: 'Hamburg', lat: 53.5507, lon: 9.993, country: 'DE' };

function makeConfig(questions: CityCompassQuestion[], overrides: Partial<CityCompassConfig> = {}): CityCompassConfig {
  return { type: 'city-compass', title: 'Städte-Kompass', rules: ['R'], questions, ...overrides };
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

function key(k: string) {
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: k })); });
  act(() => { document.dispatchEvent(new KeyboardEvent('keyup', { key: k })); });
}

async function enterGame() {
  await waitFor(() => expect(screen.getByText('Städte-Kompass')).toBeInTheDocument());
  key('ArrowRight');
  key('ArrowRight');
  await waitFor(() => expect(document.querySelector('.compass-rose')).toBeInTheDocument());
}

function drawnCities(): string[] {
  return Array.from(document.querySelectorAll('.compass-rose__label')).map(el => el.childNodes[0]?.textContent ?? '');
}

/** Angle of a neighbor's dot around the center of the rose, in degrees, 0 = north. */
function dotBearing(index: number): number {
  const dots = Array.from(document.querySelectorAll('.compass-rose__dot'));
  const dot = dots[index]!;
  const dx = Number(dot.getAttribute('cx')) - 800;
  const dy = 500 - Number(dot.getAttribute('cy'));
  return (((Math.atan2(dx, dy) * 180) / Math.PI) + 360) % 360;
}

function questionLabel(): string | null {
  return document.querySelector('.quiz-question-number')?.textContent ?? null;
}

describe('CityCompass — live city edits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('redraws the rose when a neighbor is swapped, staying on the same question', async () => {
    const before = [{ center: WIEN, neighbors: [PRAG, BUDAPEST, ROM] }];
    const { rerender } = render(tree(makeConfig(before)));
    await enterGame();
    expect(drawnCities()).toEqual(['Prag', 'Budapest', 'Rom']);

    rerender(tree(makeConfig([{ center: WIEN, neighbors: [PRAG, BUDAPEST, HAMBURG] }])));

    await waitFor(() => expect(drawnCities()).toEqual(['Prag', 'Budapest', 'Hamburg']));
    expect(questionLabel()).toBe('Beispiel');
    expect(document.querySelector('.compass-rose__unknown')?.textContent).toBe('?');
  });

  it('moves a swapped neighbor to its own bearing, not the old one', async () => {
    const { rerender } = render(tree(makeConfig([{ center: WIEN, neighbors: [PRAG, BUDAPEST, ROM] }])));
    await enterGame();
    const romBearing = dotBearing(2); // Rome is south-south-west of Vienna

    rerender(tree(makeConfig([{ center: WIEN, neighbors: [PRAG, BUDAPEST, HAMBURG] }])));
    await waitFor(() => expect(drawnCities()[2]).toBe('Hamburg'));

    // Hamburg is north-west, Rome south — the dot has to have moved.
    expect(Math.abs(dotBearing(2) - romBearing)).toBeGreaterThan(45);
    expect(dotBearing(2)).toBeGreaterThan(290);
    expect(dotBearing(2)).toBeLessThan(340);
  });

  it('rebases every bearing when the center city is swapped', async () => {
    const { rerender } = render(tree(makeConfig([{ center: WIEN, neighbors: [PRAG, BUDAPEST, ROM] }])));
    await enterGame();
    const fromWien = [0, 1, 2].map(dotBearing);

    rerender(tree(makeConfig([{ center: HAMBURG, neighbors: [PRAG, BUDAPEST, ROM] }])));
    // Prague is north-west of Vienna but south-east of Hamburg.
    await waitFor(() => expect(Math.abs(dotBearing(0) - fromWien[0]!)).toBeGreaterThan(90));
  });

  it('adds a neighbor to the rose without disturbing the ones already drawn', async () => {
    const { rerender } = render(tree(makeConfig([{ center: WIEN, neighbors: [PRAG, BUDAPEST, ROM] }])));
    await enterGame();
    const before = [0, 1, 2].map(dotBearing);

    rerender(tree(makeConfig([{ center: WIEN, neighbors: [PRAG, BUDAPEST, ROM, BERLIN] }])));
    await waitFor(() => expect(drawnCities()).toHaveLength(4));

    for (const i of [0, 1, 2]) expect(dotBearing(i)).toBeCloseTo(before[i]!, 6);
  });

  it('keeps the host on the played question when an earlier one is inserted', async () => {
    const first = { center: WIEN, neighbors: [PRAG, BUDAPEST, ROM] };
    const second = { center: BERLIN, neighbors: [PRAG, WIEN, ROM] };
    const { rerender } = render(tree(makeConfig([first, second])));
    await enterGame();

    key('ArrowRight'); // reveal the example
    key('ArrowRight'); // → the Berlin question
    await waitFor(() => expect(drawnCities()).toEqual(['Prag', 'Wien', 'Rom']));

    // A new question is inserted ahead of the one being played.
    const inserted = { center: MUENCHEN, neighbors: [PRAG, WIEN, ROM, BERLIN] };
    rerender(tree(makeConfig([first, inserted, second])));

    await waitFor(() => expect(screen.getByText('Stadt 2 von 2')).toBeInTheDocument());
    expect(drawnCities()).toEqual(['Prag', 'Wien', 'Rom']);
    key('ArrowRight');
    await waitFor(() => expect(document.querySelector('.compass-rose__solution')?.textContent).toBe('Berlin · DE'));
  });

  it('keeps the revealed count when an unrevealed neighbor is swapped', async () => {
    const config = (last: CompassCity) =>
      makeConfig([{ center: WIEN, neighbors: [PRAG, BUDAPEST, BERLIN, last] }], { reveal: 'progressive' });
    const { rerender } = render(tree(config(ROM)));
    await enterGame();
    key('ArrowRight');
    await waitFor(() => expect(drawnCities()).toEqual(['Prag', 'Budapest', 'Berlin']));

    rerender(tree(config(HAMBURG))); // swap the still-hidden fourth city
    await waitFor(() => expect(drawnCities()).toEqual(['Prag', 'Budapest', 'Berlin']));

    key('ArrowRight');
    await waitFor(() => expect(drawnCities()).toEqual(['Prag', 'Budapest', 'Berlin', 'Hamburg']));
  });

  it('turns the distance labels on live', async () => {
    const question = { center: WIEN, neighbors: [PRAG, BUDAPEST, ROM] };
    const { rerender } = render(tree(makeConfig([question])));
    await enterGame();
    expect(document.querySelectorAll('.compass-rose__distance')).toHaveLength(0);

    rerender(tree(makeConfig([question], { showDistances: true })));
    await waitFor(() => expect(document.querySelectorAll('.compass-rose__distance')).toHaveLength(3));
    expect(drawnCities()).toEqual(['Prag', 'Budapest', 'Rom']);
  });
});
