import { describe, it, expect } from 'vitest';
import {
  catmull,
  sampleSpline,
  buildFlight,
  makeWarp,
  nextWispTarget,
  composeBgPos,
  createDriver,
  spriteUri,
  STYLES,
  FACE_RIGHT,
  FLAP,
  type RNG,
} from '@/utils/dndCreatures';

function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const parseXY = (s: string) => s.split(' ').map((v) => parseFloat(v));
// park strings from the driver (a bat at PARK is NOT airborne)
const PARK: Record<number, string> = { 1: '-24% 122%', 2: '124% 122%' };

describe('catmull / spline sampling', () => {
  it('passes through p1 at f=0 and p2 at f=1', () => {
    expect(catmull([0, 0], [10, 5], [20, 15], [30, 10], 0)).toEqual([10, 5]);
    expect(catmull([0, 0], [10, 5], [20, 15], [30, 10], 1)).toEqual([20, 15]);
  });
  it('sampleSpline hits the endpoints', () => {
    const pts = [[0, 40], [25, 38], [60, 45], [100, 40]];
    expect(sampleSpline(pts, 0)).toEqual([0, 40]);
    expect(sampleSpline(pts, 1)).toEqual([100, 40]);
  });
});

describe('makeWarp', () => {
  it('is a monotonic non-decreasing map from 0→0 to 1→1', () => {
    for (let s = 0; s < 30; s++) {
      const w = makeWarp(mulberry32(s + 1));
      expect(w(0)).toBeCloseTo(0, 5);
      expect(w(1)).toBeCloseTo(1, 5);
      let prev = -1;
      for (let u = 0; u <= 1.0001; u += 0.05) {
        const v = w(u);
        expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = v;
      }
    }
  });
});

describe('buildFlight', () => {
  it('crosses off-screen→off-screen, stays in the lair air band, random duration', () => {
    for (const layer of [1, 2]) {
      const rng = mulberry32(layer * 17 + 5);
      for (let n = 0; n < 60; n++) {
        const f = buildFlight(rng, STYLES[layer]);
        expect(f.dur).toBeGreaterThanOrEqual(STYLES[layer].durMin);
        expect(f.dur).toBeLessThanOrEqual(STYLES[layer].durMax);
        const xs = f.pts.map((p) => p[0]);
        expect(Math.min(xs[0], xs[xs.length - 1])).toBeLessThan(0);
        expect(Math.max(xs[0], xs[xs.length - 1])).toBeGreaterThan(100);
        for (const [, y] of f.pts) {
          expect(y).toBeGreaterThanOrEqual(8);
          expect(y).toBeLessThanOrEqual(54);
        }
        expect(typeof f.ltr).toBe('boolean');
      }
    }
  });
});

describe('spriteUri / mirroring', () => {
  it('produces distinct normal and mirrored bat data-URIs', () => {
    for (const layer of [1, 2]) {
      const normal = spriteUri(layer, false);
      const mirror = spriteUri(layer, true);
      expect(normal.startsWith('url("data:image/svg+xml,')).toBe(true);
      expect(normal).not.toEqual(mirror);
      expect(decodeURIComponent(mirror)).toContain('scale(-1,1)');
      expect(decodeURIComponent(normal)).not.toContain('scale(-1,1)');
    }
  });
  it('the wisp is a glowing orb (radial gradient), not a flapping sprite', () => {
    const wisp = spriteUri(0, false, 0);
    expect(wisp.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(wisp)).toContain('radialGradient');
    // flap/mirror have no effect on the wisp
    expect(spriteUri(0, false, 0)).toEqual(spriteUri(0, true, 30));
  });
  it('the wisp is a plain orb with NO upward lick/beam above it', () => {
    const svg = decodeURIComponent(spriteUri(0, false, 0));
    // two flame-lick attempts both read as "a beam on top" — halo + core only, no <path> at all
    expect(svg).not.toContain('<path');
  });
  it('bats face right by default', () => {
    expect(FACE_RIGHT[1]).toBe(true);
    expect(FACE_RIGHT[2]).toBe(true);
  });
});

describe('nextWispTarget', () => {
  it('stays in the lair air band', () => {
    const rng = mulberry32(11);
    let prev = { x: 50, y: 30 };
    for (let n = 0; n < 200; n++) {
      const t = nextWispTarget(rng, prev);
      expect(t.x).toBeGreaterThanOrEqual(10);
      expect(t.x).toBeLessThanOrEqual(90);
      expect(t.y).toBeGreaterThanOrEqual(14);
      expect(t.y).toBeLessThanOrEqual(50);
      prev = t;
    }
  });
});

describe('createDriver', () => {
  it('emits a 4-layer string with the scene layer fixed', () => {
    const parts = createDriver(mulberry32(1), undefined, 0).tick(1000).split(', ');
    expect(parts).toHaveLength(4);
    expect(parts[3]).toBe('center bottom');
  });

  it('keeps airborne bats inside the air band and the wisp in its band', () => {
    const driver = createDriver(mulberry32(42), undefined, 0);
    for (let ms = 0; ms < 900000; ms += 200) {
      const parts = driver.tick(ms).split(', ');
      for (const i of [1, 2]) {
        if (parts[i] !== PARK[i]) {
          const [x, y] = parseXY(parts[i]);
          if (x >= 0 && x <= 100) {
            expect(y).toBeGreaterThanOrEqual(7.9);
            expect(y).toBeLessThanOrEqual(54.1);
          }
        }
      }
      const [, wy] = parseXY(parts[0]);
      expect(wy).toBeGreaterThanOrEqual(13.9);
      expect(wy).toBeLessThanOrEqual(50.1);
    }
  });

  it('flies both bats over time (not stuck) and swaps the mirrored sprite', () => {
    const imgSet: Record<number, Set<boolean>> = { 1: new Set(), 2: new Set() };
    const flown = new Set<number>();
    const driver = createDriver(
      mulberry32(9),
      undefined,
      0,
      (layer, uri) => imgSet[layer]?.add(decodeURIComponent(uri).includes('scale(-1,1)')),
    );
    for (let ms = 0; ms < 900000; ms += 200) {
      const parts = driver.tick(ms).split(', ');
      for (const i of [1, 2]) if (parts[i] !== PARK[i]) flown.add(i);
    }
    expect([...flown].sort()).toEqual([1, 2]);
    for (const i of [1, 2]) expect(imgSet[i].size).toBeGreaterThanOrEqual(1);
  });
});

describe('wing flap', () => {
  it('moves the bat wings (poses differ at different flap angles)', () => {
    for (const layer of [1, 2]) {
      expect(spriteUri(layer, false, 0)).not.toEqual(spriteUri(layer, false, 18));
      expect(FLAP[layer].amp).toBeGreaterThan(0);
    }
  });
  it('rotates the wings with OPPOSITE signs so both beat up/down together (no see-saw)', () => {
    for (const layer of [1, 2]) {
      const svg = decodeURIComponent(spriteUri(layer, false, 18));
      expect(svg).toContain('rotate(18 20 13)');
      expect(svg).toContain('rotate(-18 24 13)');
    }
  });
});

describe('composeBgPos', () => {
  it('joins layer values with comma-space', () => {
    expect(composeBgPos(['10% 20%', '30% 40%', '50% 60%', 'center bottom'])).toBe(
      '10% 20%, 30% 40%, 50% 60%, center bottom',
    );
  });
});
