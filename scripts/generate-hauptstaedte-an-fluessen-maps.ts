// =============================================================================
// Capital-city + river map generator
// =============================================================================
// Built for the "Hauptstaedte an Flüssen" simple-quiz. Renders a regional map
// per city showing:
//   - the home country highlighted, neighbours dimmed for context
//   - every river in the bbox in light blue
//   - the answer river thick + bright + labelled
//   - the city as a red dot with its German name
//
// Run from the repo root:
//   node --import=tsx scripts/generate-hauptstaedte-an-fluessen-maps.ts
//
// Adapting for a new game: edit `cities` and `OUT_DIR`.
//
// Source data (cached in $TMPDIR after first download):
//   - Natural Earth 50m admin-0 countries
//   - Natural Earth 10m rivers + lake centerlines (worldwide)
//   - Natural Earth 10m rivers Europe (denser detail for European rivers like Spree, Aare)
import fs from 'fs';
import path from 'path';

const COUNTRIES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const RIVERS_WORLD_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_lake_centerlines.geojson';
const RIVERS_EUROPE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_rivers_europe.geojson';

const OUT_DIR = path.join('local-assets', 'images', 'Karten', 'Hauptstaedte-an-Fluessen');

interface City {
  city: string;          // German display name
  river: string;         // German display name
  cityCoords: [number, number]; // [lon, lat]
  riverNames: string[];  // names to match in Natural Earth river data
  // half-extent of the view box, in degrees of latitude (longitude is widened
  // by 1/cos(lat) so the bbox is roughly square in projected pixels).
  spanLat: number;
  fileSlug: string;
  // Optional: extra polylines for the answer river. Used when NE 10m data
  // doesn't reach the city (e.g. Tejo's NE data ends ~35 km east of Lisbon —
  // we patch in the estuary segment manually).
  manualRiverPolylines?: number[][][];
}

const cities: City[] = [
  { city: 'Berlin',           river: 'Spree',         cityCoords: [13.405,  52.520], riverNames: ['Spree'],          spanLat: 1.6, fileSlug: 'berlin' },
  { city: 'Wien',             river: 'Donau',         cityCoords: [16.373,  48.208], riverNames: ['Donau', 'Danube'], spanLat: 1.6, fileSlug: 'wien' },
  { city: 'Bratislava',       river: 'Donau',         cityCoords: [17.107,  48.149], riverNames: ['Donau', 'Danube'], spanLat: 1.6, fileSlug: 'bratislava' },
  { city: 'Budapest',         river: 'Donau',         cityCoords: [19.040,  47.498], riverNames: ['Donau', 'Danube'], spanLat: 1.6, fileSlug: 'budapest' },
  { city: 'Belgrad',          river: 'Donau',         cityCoords: [20.457,  44.787], riverNames: ['Donau', 'Danube'], spanLat: 1.8, fileSlug: 'belgrad' },
  { city: 'Zagreb',           river: 'Save',          cityCoords: [15.982,  45.815], riverNames: ['Sava'],            spanLat: 1.6, fileSlug: 'zagreb' },
  { city: 'Paris',            river: 'Seine',         cityCoords: [2.353,   48.857], riverNames: ['Seine'],           spanLat: 2.0, fileSlug: 'paris' },
  { city: 'London',           river: 'Themse',        cityCoords: [-0.128,  51.507], riverNames: ['Thames'],          spanLat: 1.4, fileSlug: 'london' },
  { city: 'Rom',              river: 'Tiber',         cityCoords: [12.496,  41.903], riverNames: ['Tevere'],          spanLat: 1.6, fileSlug: 'rom' },
  { city: 'Prag',             river: 'Moldau',        cityCoords: [14.437,  50.075], riverNames: ['Vltava'],          spanLat: 1.6, fileSlug: 'prag' },
  { city: 'Warschau',         river: 'Weichsel',      cityCoords: [21.012,  52.230], riverNames: ['Vistula'],         spanLat: 2.2, fileSlug: 'warschau' },
  {
    city: 'Lissabon',
    river: 'Tejo',
    cityCoords: [-9.140, 38.722],
    riverNames: ['Tejo'],
    spanLat: 1.6,
    fileSlug: 'lissabon',
    // NE 10m Tejo data ends near Vila Franca de Xira (~-8.8°E, 38.95°N). The
    // last ~40 km to the river mouth is the wide Tejo estuary at Lisbon —
    // patched in here so the river clearly reaches the city.
    manualRiverPolylines: [[
      [-8.83, 38.95],
      [-8.95, 38.86],
      [-9.05, 38.78],
      [-9.13, 38.72],
      [-9.20, 38.69],
      [-9.30, 38.65],
    ]],
  },
  { city: 'Bern',             river: 'Aare',          cityCoords: [7.447,   46.948], riverNames: ['Aare'],            spanLat: 1.4, fileSlug: 'bern' },
  { city: 'Vilnius',          river: 'Neris',         cityCoords: [25.280,  54.687], riverNames: ['Neris'],           spanLat: 1.8, fileSlug: 'vilnius' },
  { city: 'Riga',             river: 'Düna',          cityCoords: [24.105,  56.949], riverNames: ['Daugava'],         spanLat: 1.8, fileSlug: 'riga' },
  { city: 'Kiew',             river: 'Dnepr',         cityCoords: [30.524,  50.450], riverNames: ['Dnipro'],          spanLat: 2.4, fileSlug: 'kiew' },
  { city: 'Bagdad',           river: 'Tigris',        cityCoords: [44.366,  33.315], riverNames: ['Tigris'],          spanLat: 2.4, fileSlug: 'bagdad' },
  { city: 'Kairo',            river: 'Nil',           cityCoords: [31.236,  30.044], riverNames: ['Nile'],            spanLat: 2.6, fileSlug: 'kairo' },
  { city: 'Khartum',          river: 'Nil',           cityCoords: [32.560,  15.501], riverNames: ['Nile'],            spanLat: 2.6, fileSlug: 'khartum' },
  { city: 'Niamey',           river: 'Niger',         cityCoords: [2.112,   13.512], riverNames: ['Niger'],           spanLat: 3.0, fileSlug: 'niamey' },
  { city: 'Bamako',           river: 'Niger',         cityCoords: [-8.003,  12.638], riverNames: ['Niger'],           spanLat: 3.0, fileSlug: 'bamako' },
  { city: 'Kinshasa',         river: 'Kongo',         cityCoords: [15.266,  -4.441], riverNames: ['Congo'],           spanLat: 2.8, fileSlug: 'kinshasa' },
  { city: 'Brazzaville',      river: 'Kongo',         cityCoords: [15.291,  -4.265], riverNames: ['Congo'],           spanLat: 2.8, fileSlug: 'brazzaville' },
  { city: 'Neu-Delhi',        river: 'Yamuna',        cityCoords: [77.209,  28.614], riverNames: ['Yamuna'],          spanLat: 2.4, fileSlug: 'neu-delhi' },
  { city: 'Bangkok',          river: 'Chao Phraya',   cityCoords: [100.501, 13.756], riverNames: ['Chao Phraya'],     spanLat: 2.0, fileSlug: 'bangkok' },
  { city: 'Vientiane',        river: 'Mekong',        cityCoords: [102.633, 17.975], riverNames: ['Mekong'],          spanLat: 2.6, fileSlug: 'vientiane' },
  { city: 'Phnom Penh',       river: 'Mekong',        cityCoords: [104.916, 11.563], riverNames: ['Mekong'],          spanLat: 2.6, fileSlug: 'phnom-penh' },
  { city: 'Seoul',            river: 'Han',           cityCoords: [126.978, 37.566], riverNames: ['Han'],             spanLat: 1.4, fileSlug: 'seoul' },
  { city: 'Washington, D.C.', river: 'Potomac',       cityCoords: [-77.037, 38.907], riverNames: ['Potomac'],         spanLat: 1.6, fileSlug: 'washington' },
  { city: 'Ottawa',           river: 'Ottawa',        cityCoords: [-75.700, 45.421], riverNames: ['Ottawa'],          spanLat: 1.8, fileSlug: 'ottawa' },
];

// ── Geo plumbing (canvas, projection, geometry helpers) ──────────────────────

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 900;
const PADDING = 36;
const LABEL_HEIGHT = 60;

interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Polygon' | 'MultiPolygon' | 'LineString' | 'MultiLineString';
    coordinates: number[][] | number[][][] | number[][][][];
  };
}

interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

function getRings(feature: GeoFeature): number[][][] {
  const g = feature.geometry;
  if (g.type === 'Polygon') return g.coordinates as number[][][];
  if (g.type === 'MultiPolygon') {
    const out: number[][][] = [];
    for (const poly of g.coordinates as number[][][][]) {
      for (const ring of poly) out.push(ring);
    }
    return out;
  }
  return [];
}

function getLines(feature: GeoFeature): number[][][] {
  const g = feature.geometry;
  if (g.type === 'LineString') return [g.coordinates as number[][]];
  if (g.type === 'MultiLineString') return g.coordinates as number[][][];
  return [];
}

function bboxOfPoints(pts: number[][]): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function bboxIntersects(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function expandBbox([minLon, minLat, maxLon, maxLat]: [number, number, number, number], pct: number): [number, number, number, number] {
  const dLon = (maxLon - minLon) * pct;
  const dLat = (maxLat - minLat) * pct;
  return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat];
}

interface Projection {
  toX: (lon: number) => number;
  toY: (lat: number) => number;
}

function buildProjection(bbox: [number, number, number, number]): Projection {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const centerLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const wGeo = (maxLon - minLon) * cosLat;
  const hGeo = maxLat - minLat;
  const innerW = SVG_WIDTH - 2 * PADDING;
  const innerH = SVG_HEIGHT - 2 * PADDING - LABEL_HEIGHT;
  const scale = Math.min(innerW / wGeo, innerH / hGeo);
  const drawW = wGeo * scale;
  const drawH = hGeo * scale;
  const offsetX = PADDING + (innerW - drawW) / 2;
  const offsetY = PADDING + (innerH - drawH) / 2;
  return {
    toX: (lon) => offsetX + (lon - minLon) * cosLat * scale,
    toY: (lat) => offsetY + (maxLat - lat) * scale,
  };
}

function projectAndSimplify(line: number[][], proj: Projection, closed: boolean): string {
  const out: string[] = [];
  let lastX: number | null = null;
  let lastY: number | null = null;
  for (let i = 0; i < line.length; i++) {
    const x = Math.round(proj.toX(line[i][0]) * 10) / 10;
    const y = Math.round(proj.toY(line[i][1]) * 10) / 10;
    if (lastX === x && lastY === y) continue;
    out.push(`${out.length === 0 ? 'M' : 'L'}${x},${y}`);
    lastX = x;
    lastY = y;
  }
  if (out.length < 2) return '';
  return out.join(' ') + (closed ? ' Z' : '');
}

// Sutherland-Hodgman against a single edge.
function clipRingByEdge(ring: number[][], idx: 0 | 1, val: number, keepGreater: boolean): number[][] {
  if (ring.length < 2) return [];
  const inside = (p: number[]) => keepGreater ? p[idx] >= val : p[idx] <= val;
  const intersect = (a: number[], b: number[]): number[] => {
    const t = (val - a[idx]) / (b[idx] - a[idx]);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  const result: number[][] = [];
  let prev = ring[ring.length - 1];
  for (const cur of ring) {
    const curIn = inside(cur);
    const prevIn = inside(prev);
    if (curIn) {
      if (!prevIn) result.push(intersect(prev, cur));
      result.push(cur);
    } else if (prevIn) {
      result.push(intersect(prev, cur));
    }
    prev = cur;
  }
  return result;
}

function clipRingToBbox(ring: number[][], bbox: [number, number, number, number]): number[][] {
  let r: number[][] = ring;
  r = clipRingByEdge(r, 0, bbox[0], true);
  r = clipRingByEdge(r, 0, bbox[2], false);
  r = clipRingByEdge(r, 1, bbox[1], true);
  r = clipRingByEdge(r, 1, bbox[3], false);
  if (r.length < 3) return [];
  if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push(r[0]);
  return r;
}

function clipRingsToBbox(rings: number[][][], bbox: [number, number, number, number]): number[][][] {
  const eps = 1e-5;
  const onBoundary = (p: number[]) =>
    Math.abs(p[0] - bbox[0]) < eps || Math.abs(p[0] - bbox[2]) < eps ||
    Math.abs(p[1] - bbox[1]) < eps || Math.abs(p[1] - bbox[3]) < eps;
  const out: number[][][] = [];
  for (const ring of rings) {
    const c = clipRingToBbox(ring, bbox);
    if (c.length < 4) continue;
    if (c.every(onBoundary)) continue;
    out.push(c);
  }
  return out;
}

// Clip a polyline (open) to the bbox, returning multiple sub-polylines if it
// enters and exits the bbox more than once.
function clipPolylineToBbox(line: number[][], bbox: [number, number, number, number]): number[][][] {
  const inside = (p: number[]) =>
    p[0] >= bbox[0] && p[0] <= bbox[2] && p[1] >= bbox[1] && p[1] <= bbox[3];
  const intersectEdge = (a: number[], b: number[]): number[] => {
    // Find the smallest t in [0,1] where the segment a→b enters/exits bbox.
    let bestT = 1;
    let bestPt: number[] = b;
    const test = (t: number) => {
      if (t < 0 || t > 1) return;
      const x = a[0] + t * (b[0] - a[0]);
      const y = a[1] + t * (b[1] - a[1]);
      if (x < bbox[0] - 1e-9 || x > bbox[2] + 1e-9) return;
      if (y < bbox[1] - 1e-9 || y > bbox[3] + 1e-9) return;
      if (t < bestT) { bestT = t; bestPt = [x, y]; }
    };
    if (b[0] !== a[0]) {
      test((bbox[0] - a[0]) / (b[0] - a[0]));
      test((bbox[2] - a[0]) / (b[0] - a[0]));
    }
    if (b[1] !== a[1]) {
      test((bbox[1] - a[1]) / (b[1] - a[1]));
      test((bbox[3] - a[1]) / (b[1] - a[1]));
    }
    return bestPt;
  };
  const out: number[][][] = [];
  let cur: number[][] = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const inP = inside(p);
    if (i === 0) {
      if (inP) cur.push(p);
      continue;
    }
    const prev = line[i - 1];
    const inPrev = inside(prev);
    if (inP && inPrev) {
      cur.push(p);
    } else if (inP && !inPrev) {
      cur = [intersectEdge(prev, p), p];
    } else if (!inP && inPrev) {
      const exit = intersectEdge(prev, p);
      cur.push(exit);
      if (cur.length >= 2) out.push(cur);
      cur = [];
    } else {
      // Both outside — do nothing (segment may still cross the bbox; we'd need
      // a proper segment-bbox intersection here. For NE 10m river data the
      // segments are short enough that this is rarely a concern, but handle it
      // for completeness).
      const a = prev, b = p;
      // find both intersection points if any
      const ts: number[] = [];
      const test = (t: number) => {
        if (t < 0 || t > 1) return;
        const x = a[0] + t * (b[0] - a[0]);
        const y = a[1] + t * (b[1] - a[1]);
        if (x < bbox[0] - 1e-9 || x > bbox[2] + 1e-9) return;
        if (y < bbox[1] - 1e-9 || y > bbox[3] + 1e-9) return;
        ts.push(t);
      };
      if (b[0] !== a[0]) {
        test((bbox[0] - a[0]) / (b[0] - a[0]));
        test((bbox[2] - a[0]) / (b[0] - a[0]));
      }
      if (b[1] !== a[1]) {
        test((bbox[1] - a[1]) / (b[1] - a[1]));
        test((bbox[3] - a[1]) / (b[1] - a[1]));
      }
      ts.sort((x, y) => x - y);
      if (ts.length >= 2) {
        const enter: number[] = [a[0] + ts[0] * (b[0] - a[0]), a[1] + ts[0] * (b[1] - a[1])];
        const exit: number[]  = [a[0] + ts[1] * (b[0] - a[0]), a[1] + ts[1] * (b[1] - a[1])];
        out.push([enter, exit]);
      }
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

// Pick a midpoint along a polyline (in geographic units).
function midpointOfPolyline(line: number[][]): [number, number] {
  if (line.length === 0) return [0, 0];
  if (line.length === 1) return [line[0][0], line[0][1]];
  let total = 0;
  for (let i = 1; i < line.length; i++) {
    const dx = line[i][0] - line[i - 1][0];
    const dy = line[i][1] - line[i - 1][1];
    total += Math.hypot(dx, dy);
  }
  const target = total / 2;
  let acc = 0;
  for (let i = 1; i < line.length; i++) {
    const dx = line[i][0] - line[i - 1][0];
    const dy = line[i][1] - line[i - 1][1];
    const segLen = Math.hypot(dx, dy);
    if (acc + segLen >= target) {
      const t = (target - acc) / (segLen || 1);
      return [line[i - 1][0] + t * dx, line[i - 1][1] + t * dy];
    }
    acc += segLen;
  }
  const last = line[line.length - 1];
  return [last[0], last[1]];
}

// Pick the longest visible segment of the answer river inside the bbox; its
// midpoint is a good place for the river label.
function bestRiverLabelPoint(segments: number[][][]): [number, number] | null {
  let best: { len: number; line: number[][] } | null = null;
  for (const line of segments) {
    let len = 0;
    for (let i = 1; i < line.length; i++) {
      len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
    }
    if (!best || len > best.len) best = { len, line };
  }
  return best ? midpointOfPolyline(best.line) : null;
}

// ── Main rendering ────────────────────────────────────────────────────────────

function generateSVG(
  city: City,
  countries: GeoFeature[],
  rivers: GeoFeature[],
): string {
  const [cLon, cLat] = city.cityCoords;
  const cosLat = Math.cos((cLat * Math.PI) / 180) || 1;
  const halfLat = city.spanLat;
  const halfLon = halfLat / cosLat; // square in projected space
  const bbox: [number, number, number, number] = [cLon - halfLon, cLat - halfLat, cLon + halfLon, cLat + halfLat];
  const proj = buildProjection(bbox);
  const renderBbox = expandBbox(bbox, 0.4);

  // Identify the home country as the one whose polygons contain the city. NE
  // 50m polygons can be slightly inland of coastal cities — fall back to the
  // closest country (by edge distance) so the home highlight always lands
  // somewhere instead of leaving the whole map dim.
  let homeCountry = countries.find((f) => {
    const rings = getRings(f);
    return rings.some((ring) => pointInRing([cLon, cLat], ring));
  });
  if (!homeCountry) {
    let bestD = Infinity;
    for (const f of countries) {
      const rings = getRings(f);
      const fbb = bboxOfPoints(rings.flat());
      if (fbb[0] === Infinity) continue;
      // Cheap pre-filter: skip countries far from the bbox.
      if (!bboxIntersects(fbb, [cLon - 5, cLat - 5, cLon + 5, cLat + 5])) continue;
      for (const ring of rings) {
        for (let i = 1; i < ring.length; i++) {
          const dx = ring[i][0] - cLon;
          const dy = ring[i][1] - cLat;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD) { bestD = d2; homeCountry = f; }
        }
      }
    }
  }

  // Country fills (clipped, inside renderBbox only). Home country gets a
  // distinct fill; other countries are dim.
  const countryFills: string[] = [];
  const countryStrokes: string[] = [];
  for (const f of countries) {
    const fbb = bboxOfPoints(getRings(f).flat());
    if (fbb[0] === Infinity) continue;
    if (!bboxIntersects(fbb, renderBbox)) continue;
    const clipped = clipRingsToBbox(getRings(f), renderBbox);
    if (clipped.length === 0) continue;
    const fill = f === homeCountry ? '#3b5a8c' : '#2a2d44';
    const stroke = f === homeCountry ? '#9bb6e0' : '#5a6088';
    const strokeW = f === homeCountry ? 1.4 : 1.0;
    const fillD = clipped.map((r) => projectAndSimplify(r, proj, true)).filter(Boolean).join(' ');
    if (fillD) countryFills.push(`  <path d="${fillD}" fill="${fill}" stroke="none" fill-rule="evenodd"/>`);
    // Stroke from interior segments only (drop bbox-edge artifacts).
    const strokeSegs: string[] = [];
    for (const ring of clipped) {
      for (const sub of interiorPolylines(ring, renderBbox)) {
        const s = projectAndSimplify(sub, proj, false);
        if (s) strokeSegs.push(s);
      }
    }
    if (strokeSegs.length > 0) {
      countryStrokes.push(`  <path d="${strokeSegs.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
  }

  // Rivers: split into "answer" (matches city.riverNames) and "other".
  const answerNames = new Set(city.riverNames.map((n) => n.toLowerCase()));
  const answerSegments: number[][][] = [];
  const otherSegments: number[][][] = [];
  for (const f of rivers) {
    const name = String(f.properties.name ?? '').toLowerCase();
    const lines = getLines(f);
    if (lines.length === 0) continue;
    const fbb = bboxOfPoints(lines.flat());
    if (!bboxIntersects(fbb, renderBbox)) continue;
    const isAnswer = answerNames.has(name);
    for (const line of lines) {
      const clipped = clipPolylineToBbox(line, renderBbox);
      for (const sub of clipped) {
        if (sub.length < 2) continue;
        if (isAnswer) answerSegments.push(sub);
        else otherSegments.push(sub);
      }
    }
  }

  // Patch in any manual river polylines (used when NE data doesn't reach the
  // city — e.g. Tejo's tidal stretch into Lisbon).
  if (city.manualRiverPolylines) {
    for (const line of city.manualRiverPolylines) {
      const clipped = clipPolylineToBbox(line, renderBbox);
      for (const sub of clipped) {
        if (sub.length < 2) continue;
        answerSegments.push(sub);
      }
    }
  }

  const otherRiverPaths = otherSegments
    .map((s) => projectAndSimplify(s, proj, false))
    .filter(Boolean)
    .map((d) => `  <path d="${d}" fill="none" stroke="#6da3d1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.55"/>`)
    .join('\n');

  const answerRiverPaths = answerSegments
    .map((s) => projectAndSimplify(s, proj, false))
    .filter(Boolean)
    .map((d) => `  <path d="${d}" fill="none" stroke="#4dabf7" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('\n');

  // City marker: red dot with white halo.
  const cx = proj.toX(cLon).toFixed(1);
  const cy = proj.toY(cLat).toFixed(1);
  const cityMarker = `  <circle cx="${cx}" cy="${cy}" r="11" fill="#ffffff" opacity="0.9"/>
  <circle cx="${cx}" cy="${cy}" r="7"  fill="#e63946" stroke="#1a1a2e" stroke-width="1.5"/>`;

  // City label, positioned above the dot. Stroked outline for legibility.
  const cityLabelY = (parseFloat(cy) - 18).toFixed(1);
  const cityLabel = `  <text x="${cx}" y="${cityLabelY}" text-anchor="middle" dominant-baseline="auto" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="700" fill="#ffffff" stroke="#1a1a2e" stroke-width="4.5" paint-order="stroke">${escapeXml(city.city)}</text>`;

  // River label: midpoint of the longest visible answer-river segment, offset
  // a touch from the city if too close.
  let riverLabel = '';
  const labelPt = bestRiverLabelPoint(answerSegments);
  if (labelPt) {
    let lx = proj.toX(labelPt[0]);
    let ly = proj.toY(labelPt[1]);
    const dxPx = lx - parseFloat(cx);
    const dyPx = ly - parseFloat(cy);
    const distPx = Math.hypot(dxPx, dyPx);
    if (distPx < 90) {
      const ang = distPx === 0 ? Math.PI / 2 : Math.atan2(dyPx, dxPx);
      lx = parseFloat(cx) + Math.cos(ang) * 110;
      ly = parseFloat(cy) + Math.sin(ang) * 110;
    }
    // Clamp inside the visible (un-rendered) bbox.
    const clipX0 = Math.min(proj.toX(bbox[0]), proj.toX(bbox[2]));
    const clipY0 = Math.min(proj.toY(bbox[1]), proj.toY(bbox[3]));
    const clipX1 = Math.max(proj.toX(bbox[0]), proj.toX(bbox[2]));
    const clipY1 = Math.max(proj.toY(bbox[1]), proj.toY(bbox[3]));
    const halfW = (city.river.length * 28 * 0.55) / 2;
    const halfH = 28 * 0.65;
    lx = Math.max(clipX0 + halfW + 4, Math.min(clipX1 - halfW - 4, lx));
    ly = Math.max(clipY0 + halfH + 4, Math.min(clipY1 - halfH - 4, ly));
    riverLabel = `  <text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="28" font-weight="700" font-style="italic" fill="#a5d8ff" stroke="#0b3d62" stroke-width="3.5" paint-order="stroke">${escapeXml(city.river)}</text>`;
  }

  // Caption (footer)
  const captionY = SVG_HEIGHT - 22;
  const caption = `  <text x="${SVG_WIDTH / 2}" y="${captionY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="bold" fill="#ffffff">${escapeXml(city.city)} · ${escapeXml(city.river)}</text>`;

  // SVG clip-path for the visible bbox.
  const clipX0 = Math.min(proj.toX(bbox[0]), proj.toX(bbox[2]));
  const clipY0 = Math.min(proj.toY(bbox[1]), proj.toY(bbox[3]));
  const clipW = Math.abs(proj.toX(bbox[2]) - proj.toX(bbox[0]));
  const clipH = Math.abs(proj.toY(bbox[1]) - proj.toY(bbox[3]));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" overflow="hidden">
  <defs><clipPath id="frame"><rect x="${clipX0.toFixed(1)}" y="${clipY0.toFixed(1)}" width="${clipW.toFixed(1)}" height="${clipH.toFixed(1)}"/></clipPath></defs>
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#1a1a2e" rx="12"/>
  <rect x="${clipX0.toFixed(1)}" y="${clipY0.toFixed(1)}" width="${clipW.toFixed(1)}" height="${clipH.toFixed(1)}" fill="#1a2742"/>
  <g clip-path="url(#frame)">
${countryFills.join('\n')}
${countryStrokes.join('\n')}
${otherRiverPaths}
${answerRiverPaths}
${cityMarker}
${cityLabel}
${riverLabel}
  </g>
${caption}
</svg>
`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function pointInRing(p: [number, number], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > p[1]) !== (yj > p[1])) &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Borrowed from the laendergrenzen script: drop closed-ring segments that
// run along the bbox edge (Sutherland-Hodgman artifacts, not real coastline).
function interiorPolylines(
  ring: number[][],
  bbox: [number, number, number, number],
): number[][][] {
  const eps = 1e-5;
  const onAnyBoundary = (p: number[]) =>
    Math.abs(p[0] - bbox[0]) < eps || Math.abs(p[0] - bbox[2]) < eps ||
    Math.abs(p[1] - bbox[1]) < eps || Math.abs(p[1] - bbox[3]) < eps;
  const isArtifact = (a: number[], b: number[]) => onAnyBoundary(a) && onAnyBoundary(b);
  const out: number[][][] = [];
  let cur: number[][] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    if (isArtifact(ring[i], ring[i + 1])) {
      if (cur.length >= 2) out.push(cur);
      cur = [];
    } else {
      if (cur.length === 0) cur.push(ring[i]);
      cur.push(ring[i + 1]);
    }
  }
  if (cur.length >= 2) out.push(cur);
  return out;
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadCached(url: string, cacheName: string): Promise<GeoCollection> {
  const cachePath = path.join(process.env.TMPDIR ?? '/tmp', cacheName);
  if (fs.existsSync(cachePath)) {
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as GeoCollection;
  }
  console.log(`Fetching ${url}…`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} for ${url}`);
  const text = await resp.text();
  fs.writeFileSync(cachePath, text);
  return JSON.parse(text) as GeoCollection;
}

async function main() {
  const countries = await loadCached(COUNTRIES_URL, 'ne_50m_admin_0_countries.geojson');
  const riversWorld = await loadCached(RIVERS_WORLD_URL, 'ne_10m_rivers.geojson');
  const riversEurope = await loadCached(RIVERS_EUROPE_URL, 'ne_10m_rivers_europe.geojson');
  const rivers = [...riversWorld.features, ...riversEurope.features];

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const city of cities) {
    const svg = generateSVG(city, countries.features, rivers);
    const file = path.join(OUT_DIR, `${city.fileSlug}.svg`);
    fs.writeFileSync(file, svg);
    console.log(`✓ ${city.fileSlug}.svg  (${city.city} → ${city.river})`);
  }
  console.log(`\nWrote ${cities.length} SVGs to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
