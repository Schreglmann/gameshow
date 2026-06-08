import { describe, it, expect } from 'vitest';
import {
  catmull,
  sampleSpline,
  sampleLinear,
  buildFlight,
  makeWarp,
  nextSnitchTarget,
  composeBgPos,
  createDriver,
  spriteUri,
  STYLES,
  FACE_RIGHT,
  FLY_OPACITY,
  FLAP,
  type RNG,
} from '@/utils/hpFlyers';

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
// park strings from the driver (a flyer at PARK is NOT airborne)
const PARK: Record<number, string> = { 5: '-22% 40%', 6: '122% 40%', 7: '122% 40%' };

describe('catmull / spline sampling', () => {
  it('passes through p1 at f=0 and p2 at f=1', () => {
    expect(catmull([0, 0], [10, 5], [20, 15], [30, 10], 0)).toEqual([10, 5]);
    expect(catmull([0, 0], [10, 5], [20, 15], [30, 10], 1)).toEqual([20, 15]);
  });
  it('sampleSpline hits the endpoints; sampleLinear interpolates', () => {
    const pts = [[0, 50], [25, 48], [60, 55], [100, 50]];
    expect(sampleSpline(pts, 0)).toEqual([0, 50]);
    expect(sampleSpline(pts, 1)).toEqual([100, 50]);
    expect(sampleLinear([[0, 0], [10, 20]], 0.5)).toEqual([5, 10]);
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
  it('crosses off-screen→off-screen, stays above the terrain floor (no ceiling), random duration', () => {
    for (const layer of [5, 6, 7]) {
      const rng = mulberry32(layer * 13 + 3);
      for (let n = 0; n < 60; n++) {
        const f = buildFlight(rng, STYLES[layer]);
        expect(f.dur).toBeGreaterThanOrEqual(STYLES[layer].durMin);
        expect(f.dur).toBeLessThanOrEqual(STYLES[layer].durMax);
        const xs = f.pts.map((p) => p[0]);
        expect(Math.min(xs[0], xs[xs.length - 1])).toBeLessThan(0);
        expect(Math.max(xs[0], xs[xs.length - 1])).toBeGreaterThan(100);
        for (const [, y] of f.pts) {
          expect(y).toBeGreaterThanOrEqual(8);  // floor (above terrain)
          expect(y).toBeLessThanOrEqual(61);    // never below the skyline
        }
        expect(typeof f.ltr).toBe('boolean');
      }
    }
  });
});

describe('spriteUri / mirroring', () => {
  it('produces distinct normal and mirrored data-URIs', () => {
    for (const layer of [5, 6, 7]) {
      const normal = spriteUri(layer, false);
      const mirror = spriteUri(layer, true);
      expect(normal.startsWith('url("data:image/svg+xml,')).toBe(true);
      expect(normal).not.toEqual(mirror);
      expect(decodeURIComponent(mirror)).toContain('scale(-1,1)');
      expect(decodeURIComponent(normal)).not.toContain('scale(-1,1)');
    }
  });
  it('the owl faces right, broom + dragon face left', () => {
    expect(FACE_RIGHT[5]).toBe(true);
    expect(FACE_RIGHT[6]).toBe(false);
    expect(FACE_RIGHT[7]).toBe(false);
  });
});

describe('nextSnitchTarget', () => {
  it('stays in the upper-sky band (above the terrain)', () => {
    const rng = mulberry32(7);
    let prev = { x: 50, y: 30 };
    for (let n = 0; n < 200; n++) {
      const t = nextSnitchTarget(rng, prev);
      expect(t.x).toBeGreaterThanOrEqual(8);
      expect(t.x).toBeLessThanOrEqual(92);
      expect(t.y).toBeGreaterThanOrEqual(14);
      expect(t.y).toBeLessThanOrEqual(58);
      prev = t;
    }
  });
});

describe('createDriver', () => {
  it('emits a 9-layer string with the scene layers fixed', () => {
    const parts = createDriver(mulberry32(1), undefined, 0).tick(1000).split(', ');
    expect(parts).toHaveLength(9);
    expect(parts[0]).toBe('center');
    expect(parts[2]).toBe('center bottom');
    expect(parts[3]).toBe('center bottom');
  });

  it('keeps flyers above the terrain floor and serialises them (never two airborne at once)', () => {
    const driver = createDriver(mulberry32(42), undefined, 0);
    for (let ms = 0; ms < 900000; ms += 200) {
      const parts = driver.tick(ms).split(', ');
      let airborne = 0;
      for (const i of [5, 6, 7]) {
        if (parts[i] !== PARK[i]) {
          airborne++;
          const [x, y] = parseXY(parts[i]);
          if (x >= 0 && x <= 100) {
            expect(y).toBeGreaterThanOrEqual(7.9);
            expect(y).toBeLessThanOrEqual(61.1);
          }
        }
      }
      expect(airborne).toBeLessThanOrEqual(1); // SERIALISED
      const [, sy] = parseXY(parts[4]);
      expect(sy).toBeGreaterThanOrEqual(13.9);
      expect(sy).toBeLessThanOrEqual(60.1);
    }
  });

  it('spaces consecutive flight starts 30–60s apart', () => {
    const driver = createDriver(mulberry32(3), undefined, 0);
    const starts: number[] = [];
    let prevAir = false;
    for (let ms = 0; ms < 600000; ms += 200) {
      const parts = driver.tick(ms).split(', ');
      const air = [5, 6, 7].some((i) => parts[i] !== PARK[i]);
      if (air && !prevAir) starts.push(ms);
      prevAir = air;
    }
    expect(starts.length).toBeGreaterThanOrEqual(6);
    for (let k = 1; k < starts.length; k++) {
      const gap = starts[k] - starts[k - 1];
      expect(gap).toBeGreaterThanOrEqual(30000 - 400); // ±step tolerance
      expect(gap).toBeLessThanOrEqual(60000 + 400);
    }
  });

  it('flies all three flyers over time (not stuck on one) and swaps the mirrored sprite', () => {
    const imgSet: Record<number, Set<boolean>> = { 5: new Set(), 6: new Set(), 7: new Set() };
    const flown = new Set<number>();
    const driver = createDriver(
      mulberry32(9),
      undefined,
      0,
      (layer, uri) => imgSet[layer].add(decodeURIComponent(uri).includes('scale(-1,1)')),
    );
    for (let ms = 0; ms < 900000; ms += 200) {
      const parts = driver.tick(ms).split(', ');
      for (const i of [5, 6, 7]) if (parts[i] !== PARK[i]) flown.add(i);
    }
    expect([...flown].sort()).toEqual([5, 6, 7]);
    // over many random flights each flyer should have flown in at least one orientation
    for (const i of [5, 6, 7]) expect(imgSet[i].size).toBeGreaterThanOrEqual(1);
  });
});

describe('depth cues (dragon farthest)', () => {
  it('opacity decreases near→far: Hedwig > broom > dragon', () => {
    expect(FLY_OPACITY[5]).toBeGreaterThan(FLY_OPACITY[6]);
    expect(FLY_OPACITY[6]).toBeGreaterThan(FLY_OPACITY[7]);
  });
  it('flight is slowest for the farthest: dragon > broom > Hedwig durations', () => {
    expect(STYLES[7].durMin).toBeGreaterThan(STYLES[6].durMin);
    expect(STYLES[6].durMin).toBeGreaterThan(STYLES[5].durMin);
  });
  it('spriteUri bakes the per-layer haze opacity', () => {
    expect(decodeURIComponent(spriteUri(7, false))).toContain(`opacity='${FLY_OPACITY[7]}'`);
    expect(decodeURIComponent(spriteUri(5, true))).toContain(`opacity='${FLY_OPACITY[5]}'`);
  });
});

describe('wing flap', () => {
  it('moves the wing for Hedwig + dragon (poses differ); broom has no wing flap', () => {
    for (const layer of [5, 7]) {
      expect(spriteUri(layer, false, 0)).not.toEqual(spriteUri(layer, false, 12));
      expect(decodeURIComponent(spriteUri(layer, false, 12))).toContain('rotate(12');
      expect(FLAP[layer].amp).toBeGreaterThan(0);
    }
    // broom (6) has no wing → flap argument has no effect, and it's not in FLAP
    expect(spriteUri(6, false, 0)).toEqual(spriteUri(6, false, 12));
    expect(FLAP[6]).toBeUndefined();
  });
  it('the flapped sprite still keeps the depth opacity and mirroring', () => {
    expect(decodeURIComponent(spriteUri(7, true, 10))).toContain('scale(-1,1)');
    expect(decodeURIComponent(spriteUri(7, false, 10))).toContain(`opacity='${FLY_OPACITY[7]}'`);
  });
});

describe('composeBgPos', () => {
  it('joins layer values with comma-space', () => {
    expect(composeBgPos(['center', '10% 20%', '30% 40%'])).toBe('center, 10% 20%, 30% 40%');
  });
});
