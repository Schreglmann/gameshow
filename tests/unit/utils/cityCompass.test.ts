import { describe, it, expect } from 'vitest';
import {
  haversineKm,
  initialBearingDeg,
  angularGapDeg,
  formatDistanceKm,
  layoutCompass,
  pickNeighbors,
  COMPASS_WIDTH,
  COMPASS_HEIGHT,
  MAX_NEIGHBOR_DISTANCE_KM,
  type City,
} from '@/utils/cityCompass';
import { CITIES } from '@/data/cities.generated';

const ORIGIN = { lat: 0, lon: 0 };

const WIEN = { lat: 48.2085, lon: 16.3721 };
const PRAG = { lat: 50.088, lon: 14.4208 };
const LONDON = { lat: 51.5074, lon: -0.1278 };
const PARIS = { lat: 48.8566, lon: 2.3522 };

const cityByName = (name: string): City => {
  const found = CITIES.find(c => c.name === name);
  if (!found) throw new Error(`${name} missing from the generated dataset`);
  return found;
};

/**
 * Independent second formula: the spherical law of cosines. Agreement between the
 * two is evidence the implementation is right, where a hardcoded expected number
 * would only pin whatever the implementation currently returns.
 */
function lawOfCosinesKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const cos =
    Math.sin(rad(a.lat)) * Math.sin(rad(b.lat)) +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return 6371 * Math.acos(Math.min(1, cos));
}

describe('haversineKm', () => {
  it('measures one degree of latitude, and of longitude at the equator, as 111 km', () => {
    expect(haversineKm(ORIGIN, { lat: 1, lon: 0 })).toBeCloseTo(111.19, 1);
    expect(haversineKm(ORIGIN, { lat: 0, lon: 1 })).toBeCloseTo(111.19, 1);
  });

  it('is zero for identical points', () => {
    expect(haversineKm(WIEN, WIEN)).toBe(0);
  });

  it('is symmetric', () => {
    expect(haversineKm(WIEN, PRAG)).toBeCloseTo(haversineKm(PRAG, WIEN), 9);
  });

  it('agrees with the spherical law of cosines', () => {
    for (const [a, b] of [[WIEN, PRAG], [LONDON, PARIS], [WIEN, LONDON], [PARIS, PRAG]] as const) {
      expect(haversineKm(a, b)).toBeCloseTo(lawOfCosinesKm(a, b), 6);
    }
  });

  it('puts known city pairs in the right range', () => {
    expect(haversineKm(WIEN, PRAG)).toBeGreaterThan(240);
    expect(haversineKm(WIEN, PRAG)).toBeLessThan(265);
    expect(haversineKm(LONDON, PARIS)).toBeGreaterThan(330);
    expect(haversineKm(LONDON, PARIS)).toBeLessThan(355);
  });
});

describe('initialBearingDeg', () => {
  it('reads 0 due north and 90 due east', () => {
    expect(initialBearingDeg(ORIGIN, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(initialBearingDeg(ORIGIN, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
    expect(initialBearingDeg(ORIGIN, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
    expect(initialBearingDeg(ORIGIN, { lat: 0, lon: -1 })).toBeCloseTo(270, 6);
  });

  it('matches the flat approximation over a short distance, where that is valid', () => {
    // 1 km out from Vienna at a known angle: over that span the curvature is
    // negligible, so the flat construction is an independent expected value.
    const rad = (d: number) => (d * Math.PI) / 180;
    for (const expected of [0, 37, 90, 143, 180, 216, 270, 331]) {
      const to = {
        lat: WIEN.lat + (1 / 111.19) * Math.cos(rad(expected)),
        lon: WIEN.lon + (1 / (111.19 * Math.cos(rad(WIEN.lat)))) * Math.sin(rad(expected)),
      };
      expect(initialBearingDeg(WIEN, to)).toBeCloseTo(expected, 1);
    }
  });

  it('reverses when the endpoints are swapped along a meridian', () => {
    expect(initialBearingDeg({ lat: 40, lon: 10 }, { lat: 50, lon: 10 })).toBeCloseTo(0, 6);
    expect(initialBearingDeg({ lat: 50, lon: 10 }, { lat: 40, lon: 10 })).toBeCloseTo(180, 6);
  });

  it('places Prague north-north-west of Vienna', () => {
    const bearing = initialBearingDeg(WIEN, PRAG);
    expect(bearing).toBeGreaterThan(315);
    expect(bearing).toBeLessThan(340);
  });

  it('places Salzburg west-south-west of Vienna', () => {
    const bearing = initialBearingDeg(WIEN, { lat: 47.8095, lon: 13.055 });
    expect(bearing).toBeGreaterThan(250);
    expect(bearing).toBeLessThan(275);
  });

  it('differs from the flat lat/lon angle, which is why the great circle is used', () => {
    const flat = (Math.atan2(PRAG.lon - WIEN.lon, PRAG.lat - WIEN.lat) * 180) / Math.PI + 360;
    expect(Math.abs(flat - initialBearingDeg(WIEN, PRAG))).toBeGreaterThan(5);
  });
});

describe('angularGapDeg', () => {
  it('takes the short way around', () => {
    expect(angularGapDeg(350, 10)).toBe(20);
    expect(angularGapDeg(10, 350)).toBe(20);
    expect(angularGapDeg(0, 180)).toBe(180);
  });
});

describe('formatDistanceKm', () => {
  it('rounds to 5 km below 100 km and to 10 km above', () => {
    expect(formatDistanceKm(63)).toBe('65 km');
    expect(formatDistanceKm(183)).toBe('180 km');
    expect(formatDistanceKm(1997)).toBe('2000 km');
  });

  it('never rounds down to zero', () => {
    expect(formatDistanceKm(1)).toBe('5 km');
  });
});

describe('layoutCompass', () => {
  const city = (name: string, lat: number, lon: number) => ({ name, lat, lon });

  it('puts a due-north neighbor straight above the center', () => {
    const { cx, cy, ringRadius, nodes } = layoutCompass(ORIGIN, [city('Nord', 5, 0)]);
    expect(cx).toBe(COMPASS_WIDTH / 2);
    expect(cy).toBe(COMPASS_HEIGHT / 2);
    expect(nodes[0].x).toBeCloseTo(cx, 6);
    expect(nodes[0].y).toBeCloseTo(cy - ringRadius, 6);
    expect(nodes[0].anchor).toBe('middle');
  });

  it('puts a due-east neighbor to the right and anchors its label outward', () => {
    const { cx, cy, ringRadius, nodes } = layoutCompass(ORIGIN, [city('Ost', 0, 5)]);
    expect(nodes[0].x).toBeCloseTo(cx + ringRadius, 6);
    expect(nodes[0].y).toBeCloseTo(cy, 6);
    expect(nodes[0].anchor).toBe('start');
    expect(nodes[0].labelX).toBeGreaterThan(nodes[0].x);
  });

  it('keeps every dot on the ring and every label outside it', () => {
    const { cx, cy, ringRadius, nodes } = layoutCompass(WIEN, [
      city('Prag', PRAG.lat, PRAG.lon),
      city('Budapest', 47.4979, 19.0402),
      city('München', 48.1374, 11.5755),
    ]);
    for (const node of nodes) {
      expect(Math.hypot(node.x - cx, node.y - cy)).toBeCloseTo(ringRadius, 6);
      expect(Math.hypot(node.labelX - cx, node.labelY - cy)).toBeGreaterThan(ringRadius);
    }
  });

  it('staggers labels of neighbors that share almost the same bearing', () => {
    const { nodes } = layoutCompass(ORIGIN, [city('Ost', 0, 5), city('Fast Ost', 0.4, 5)]);
    expect(Math.abs(nodes[0].bearing - nodes[1].bearing)).toBeLessThan(14);
    expect(Math.abs(nodes[0].labelX - nodes[1].labelX)).toBeGreaterThan(40);
  });

  it('leaves labels of neighbors on opposite sides at the same distance out', () => {
    const { cx, nodes } = layoutCompass(ORIGIN, [city('Ost', 0, 5), city('West', 0, -5)]);
    expect(nodes[0].labelX - cx).toBeCloseTo(cx - nodes[1].labelX, 6);
  });

  it('drops a label line when distances are hidden, moving the block down', () => {
    const withDistance = layoutCompass(ORIGIN, [city('Ost', 0, 5)], { showDistances: true });
    const without = layoutCompass(ORIGIN, [city('Ost', 0, 5)], { showDistances: false });
    expect(without.nodes[0].labelY).toBeGreaterThan(withDistance.nodes[0].labelY);
  });

  it('reports the true bearing and distance per neighbor', () => {
    const [node] = layoutCompass(WIEN, [city('Prag', PRAG.lat, PRAG.lon)]).nodes;
    expect(node.bearing).toBeCloseTo(initialBearingDeg(WIEN, PRAG), 9);
    expect(node.distanceKm).toBeCloseTo(haversineKm(WIEN, PRAG), 9);
  });
});

describe('layoutCompass — the crop box', () => {
  const city = (name: string, lat: number, lon: number) => ({ name, lat, lon });
  const FOUR = [city('Nord', 5, 0), city('Ost', 0, 5), city('Süd', -5, 0), city('West', 0, -5)];

  /** Left and right edge of a label block, the way cropBox measures them. */
  function labelSpan(node: ReturnType<typeof layoutCompass>['nodes'][number]) {
    const width = node.city.name.length * 34 * 0.6;
    if (node.anchor === 'start') return [node.labelX, node.labelX + width];
    if (node.anchor === 'end') return [node.labelX - width, node.labelX];
    return [node.labelX - width / 2, node.labelX + width / 2];
  }

  it('crops to the drawing instead of the full canvas', () => {
    const { viewBox } = layoutCompass(ORIGIN, FOUR);
    expect(viewBox.width).toBeLessThan(COMPASS_WIDTH);
    expect(viewBox.height).toBeLessThan(COMPASS_HEIGHT);
  });

  it('keeps the whole ring and every label inside the box', () => {
    const { cx, cy, ringRadius, nodes, viewBox } = layoutCompass(
      ORIGIN,
      [...FOUR, city('Rothenburg ob der Tauber', 3, 4)],
      { showDistances: true },
    );
    expect(viewBox.x).toBeLessThanOrEqual(cx - ringRadius);
    expect(viewBox.y).toBeLessThanOrEqual(cy - ringRadius);
    expect(viewBox.x + viewBox.width).toBeGreaterThanOrEqual(cx + ringRadius);
    expect(viewBox.y + viewBox.height).toBeGreaterThanOrEqual(cy + ringRadius);

    for (const node of nodes) {
      const [left, right] = labelSpan(node);
      expect(left).toBeGreaterThanOrEqual(viewBox.x);
      expect(right).toBeLessThanOrEqual(viewBox.x + viewBox.width);
      expect(node.labelY).toBeGreaterThan(viewBox.y);
      expect(node.labelY).toBeLessThan(viewBox.y + viewBox.height);
    }
  });

  it('centers the box horizontally on the center city, whichever side the long names are on', () => {
    const { cx, viewBox } = layoutCompass(ORIGIN, [
      city('Rothenburg ob der Tauber', 0, 5),
      city('Ulm', 0, -5),
      city('Bad Windsheim an der Aisch', 3, 1),
      city('Au', -5, 0),
    ], { showDistances: true });
    expect(viewBox.x + viewBox.width / 2).toBeCloseTo(cx, 9);
  });

  it('stays tight above and below, where nothing is centered against the screen', () => {
    // Two long names in the north, nothing but the ring in the south: squaring the
    // box up would put the south\'s empty half-height above the drawing as well.
    const { cy, viewBox } = layoutCompass(ORIGIN, [
      city('Neustadt an der Weinstraße', 5, 1),
      city('Sankt Pölten', 4, -2),
    ], { showDistances: true });
    expect(cy - viewBox.y).toBeGreaterThan(viewBox.y + viewBox.height - cy);
  });

  it('grows the box for a long name and not for a short one', () => {
    const short = layoutCompass(ORIGIN, [city('Rom', 0, 5)]).viewBox;
    const long = layoutCompass(ORIGIN, [city('Rothenburg ob der Tauber', 0, 5)]).viewBox;
    expect(long.width).toBeGreaterThan(short.width + 300);
  });

  it('reserves room for the distance line only when it is drawn', () => {
    const withDistance = layoutCompass(ORIGIN, FOUR, { showDistances: true }).viewBox;
    const without = layoutCompass(ORIGIN, FOUR, { showDistances: false }).viewBox;
    expect(withDistance.height).toBeGreaterThan(without.height);
  });

  it('measures the box from every neighbor, so a progressive reveal cannot resize it', () => {
    const all = [city('Ost', 0, 5), city('Weit im Westen', 0, -5)];
    // What the caller draws is a prefix of `nodes`; the box is the same either way.
    const full = layoutCompass(ORIGIN, all).viewBox;
    const firstOnly = layoutCompass(ORIGIN, all.slice(0, 1)).viewBox;
    expect(full.width).toBeGreaterThan(firstOnly.width);
    expect(layoutCompass(ORIGIN, all).viewBox).toEqual(full);
  });
});

describe('layoutCompass — center clearance', () => {
  const city = (name: string, lat: number, lon: number) => ({ name, lat, lon });
  const AROUND = [
    city('Nord', 5, 0),
    city('Nordost', 4, 4),
    city('Ost', 0, 5),
    city('Süd', -5, 0),
    city('West', 0, -5),
  ];
  const radius = (n: { spokeX: number; spokeY: number }, cx: number, cy: number) =>
    Math.hypot(n.spokeX - cx, n.spokeY - cy);

  it('starts every spoke outside the marker of the hidden city', () => {
    const { cx, cy, centerRadius, nodes } = layoutCompass(ORIGIN, AROUND);
    for (const node of nodes) expect(radius(node, cx, cy)).toBeGreaterThan(centerRadius);
  });

  it('reports the drawn length of each spoke', () => {
    const { ringRadius, nodes } = layoutCompass(ORIGIN, AROUND);
    for (const node of nodes) {
      expect(node.spokeLength).toBeCloseTo(Math.hypot(node.x - node.spokeX, node.y - node.spokeY), 6);
      expect(node.spokeLength).toBeLessThan(ringRadius);
    }
  });

  it('clears the solution pill on every bearing once the city is revealed', () => {
    const { cx, cy, nodes, pill } = layoutCompass(ORIGIN, AROUND, { solutionLabel: 'Wien · AT' });
    expect(pill).not.toBeNull();
    for (const node of nodes) {
      const dx = Math.abs(node.spokeX - cx);
      const dy = Math.abs(node.spokeY - cy);
      // Outside the pill means clear of it either sideways or vertically.
      const clear = dx >= pill!.width / 2 || dy >= pill!.height / 2;
      expect(clear).toBe(true);
    }
  });

  it('pushes a due-east spoke past the whole width of the pill', () => {
    const label = 'Klagenfurt am Wörthersee · AT';
    const { cx, cy, nodes, pill } = layoutCompass(ORIGIN, [city('Ost', 0, 5)], { solutionLabel: label });
    expect(nodes[0].spokeX - cx).toBeGreaterThan(pill!.width / 2);
    expect(nodes[0].spokeY).toBeCloseTo(cy, 6);
  });

  it('leaves a short label a tighter middle than a long one', () => {
    const short = layoutCompass(ORIGIN, [city('Ost', 0, 5)], { solutionLabel: 'Rom · IT' });
    const long = layoutCompass(ORIGIN, [city('Ost', 0, 5)], { solutionLabel: 'Rothenburg ob der Tauber · DE' });
    expect(long.nodes[0].spokeLength).toBeLessThan(short.nodes[0].spokeLength);
  });

  it('shrinks a long name rather than letting the pill outgrow the ring', () => {
    const short = layoutCompass(ORIGIN, AROUND, { solutionLabel: 'Rom · IT' });
    const long = layoutCompass(ORIGIN, AROUND, { solutionLabel: 'Klagenfurt am Wörthersee · AT' });

    expect(short.pill!.fontSize).toBeGreaterThan(long.pill!.fontSize);
    for (const layout of [short, long]) {
      expect(layout.pill!.width).toBeLessThan(2 * layout.ringRadius);
      expect(layout.pill!.height).toBeLessThan(2 * layout.ringRadius);
    }
  });

  it('keeps the crosshair arms out of the middle too', () => {
    const hidden = layoutCompass(ORIGIN, AROUND);
    expect(hidden.grid.horizontal).toBeGreaterThan(hidden.centerRadius);
    expect(hidden.grid.vertical).toBeGreaterThan(hidden.centerRadius);

    const solved = layoutCompass(ORIGIN, AROUND, { solutionLabel: 'Wien · AT' });
    expect(solved.grid.horizontal).toBeGreaterThan(solved.pill!.width / 2);
    expect(solved.grid.vertical).toBeGreaterThan(solved.pill!.height / 2);
  });
});

describe('pickNeighbors', () => {
  const wien = cityByName('Wien');

  it('stays inside the 60 to 2000 km range', () => {
    for (const neighbor of pickNeighbors(wien, CITIES, { seed: 7 })) {
      const km = haversineKm(wien, neighbor);
      expect(km).toBeGreaterThanOrEqual(60);
      expect(km).toBeLessThanOrEqual(MAX_NEIGHBOR_DISTANCE_KM);
    }
  });

  it('returns the requested count', () => {
    expect(pickNeighbors(wien, CITIES, { count: 6, seed: 1 })).toHaveLength(6);
    expect(pickNeighbors(wien, CITIES, { count: 3, seed: 1 })).toHaveLength(3);
    expect(pickNeighbors(wien, CITIES, { count: 8, seed: 1 })).toHaveLength(8);
  });

  it('clamps the count to the range the rose stays readable in', () => {
    expect(pickNeighbors(wien, CITIES, { count: 1, seed: 1 })).toHaveLength(3);
    expect(pickNeighbors(wien, CITIES, { count: 40, seed: 1 })).toHaveLength(8);
  });

  it('never picks the center city itself', () => {
    expect(pickNeighbors(wien, CITIES, { seed: 3 }).map(c => c.name)).not.toContain('Wien');
  });

  it('keeps picks at least 25 degrees apart', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const picks = pickNeighbors(wien, CITIES, { seed });
      const bearings = picks.map(p => initialBearingDeg(wien, p));
      for (let i = 0; i < bearings.length; i += 1) {
        for (let j = i + 1; j < bearings.length; j += 1) {
          expect(angularGapDeg(bearings[i], bearings[j])).toBeGreaterThanOrEqual(25);
        }
      }
    }
  });

  it('covers a near and a far band, so the puzzle is neither trivial nor unsolvable', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const distances = pickNeighbors(wien, CITIES, { seed }).map(p => haversineKm(wien, p));
      expect(Math.min(...distances)).toBeLessThan(300);
      expect(Math.max(...distances)).toBeGreaterThan(800);
    }
  });

  it('sorts by descending distance, so a progressive reveal starts vague', () => {
    const distances = pickNeighbors(wien, CITIES, { seed: 9 }).map(p => haversineKm(wien, p));
    expect(distances).toEqual([...distances].sort((a, b) => b - a));
  });

  it('includes one regional town, which no capital would ever outscore on its own', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const tiers = pickNeighbors(wien, CITIES, { seed }).map(p => cityByName(p.name).tier);
      expect(tiers.filter(t => t === 'local')).toHaveLength(1);
    }
  });

  it('drops the regional town on hard, which is what makes it hard', () => {
    const tiers = pickNeighbors(wien, CITIES, { seed: 1, difficulty: 'hard' }).map(p => cityByName(p.name).tier);
    expect(tiers).not.toContain('local');
  });

  it('offers a small town only near the center and a capital at any distance', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const picked of pickNeighbors(wien, CITIES, { seed, difficulty: 'hard' })) {
        const tier = cityByName(picked.name).tier;
        if (tier === 'local') expect(haversineKm(wien, picked)).toBeLessThanOrEqual(350);
        if (tier === 'major') expect(haversineKm(wien, picked)).toBeLessThanOrEqual(1200);
      }
    }
  });

  it('is deterministic per seed and varies between seeds', () => {
    const a = pickNeighbors(wien, CITIES, { seed: 42 });
    expect(pickNeighbors(wien, CITIES, { seed: 42 })).toEqual(a);
    expect(pickNeighbors(wien, CITIES, { seed: 43 })).not.toEqual(a);
  });

  it('leans on nearer cities when easy and on farther ones when hard', () => {
    const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
    const spread = (difficulty: 'easy' | 'hard') =>
      mean([1, 2, 3, 4, 5, 6].map(seed =>
        mean(pickNeighbors(wien, CITIES, { seed, difficulty }).map(p => haversineKm(wien, p)))));
    expect(spread('easy')).toBeLessThan(spread('hard'));
  });

  it('carries the country through, so the reveal can name it', () => {
    expect(pickNeighbors(wien, CITIES, { seed: 5 }).every(c => typeof c.country === 'string')).toBe(true);
  });

  it('still fills the slots around a center with few neighbors', () => {
    const reykjavik = cityByName('Reykjavík');
    expect(pickNeighbors(reykjavik, CITIES, { seed: 1 }).length).toBeGreaterThan(0);
  });
});
