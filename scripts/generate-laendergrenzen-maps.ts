// =============================================================================
// Country-map SVG generator (reusable for future games)
// =============================================================================
// Built for the "Ländergrenzen" simple-quiz. Kept as the project's go-to
// country-map renderer so future games that need country maps don't have to
// reinvent the projection / clipping / label-placement logic.
//
// Run from the project root:
//   node --import=tsx scripts/generate-laendergrenzen-maps.ts
// (no dedicated npm script — invoke via tsx as you would any one-off
// generator. OUT_DIR is relative to the cwd, so always run from the repo
// root.)
//
// Adapting for a new game:
//   - Edit the `pairs` array below (or copy the script and replace it).
//   - Change `OUT_DIR` to point at the right asset folder.
//   - For maps that aren't a country-pair-with-shared-border (e.g. a single
//     country highlight, a region map, a multi-country highlight), the helper
//     primitives — bbox math, Sutherland-Hodgman clip, pole-of-inaccessibility
//     label placement, antimeridian unwrap, projection — are all kept as
//     standalone functions in this file and can be reused or copied.
//
// What's handled automatically:
//   - Per-ring antimeridian unwrap (Russia, USA Aleutians) and ±360° alignment
//     to the bbox so seam-crossing context countries render correctly.
//   - Sutherland-Hodgman clip to a renderBbox 40 % larger than the viewBbox,
//     with stroke artifacts and "ghost" rings filtered out.
//   - Smart bbox: question country's largest landmass + shared-border bbox,
//     with `fullExtent: true` for archipelago pairs (Indonesia/Malaysia).
//   - Pole-of-inaccessibility / area-weighted centroid for label placement,
//     adaptive font sizing, conflict avoidance with the partner country, and
//     bbox clamping so labels never get cut at the visible edge.
//
// Source data: Natural Earth 50m admin-0 countries — topologically clean, with
// exact shared vertices between adjacent countries (so edge-matching across
// countries works). The dataset is cached in $TMPDIR after first download.
import fs from 'fs';
import path from 'path';

const COUNTRIES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';

const OUT_DIR = path.join('local-assets', 'images', 'Karten', 'Laendergrenzen');

interface Pair {
  question: string;        // German label of the question country (shown in question)
  answer: string;          // German label of the answer country (shown on map)
  questionA3: string;      // ADM0_A3 code in Natural Earth
  answerA3: string;
  borderKm: number;        // longest-border length, km
  fileSlug: string;        // output filename (without extension)
  bbox?: [number, number, number, number]; // optional override [minLon, minLat, maxLon, maxLat]
  shiftLon?: boolean;      // normalize lon to [0, 360] before projecting (antimeridian fix)
  fullExtent?: boolean;    // include all polygons of both countries in the view (archipelagos)
}

const pairs: Pair[] = [
  { question: 'Österreich',     answer: 'Deutschland',    questionA3: 'AUT', answerA3: 'DEU', borderKm: 817,  fileSlug: 'oesterreich' },
  { question: 'USA',            answer: 'Kanada',         questionA3: 'USA', answerA3: 'CAN', borderKm: 8891, fileSlug: 'usa', shiftLon: true },
  { question: 'Mexiko',         answer: 'USA',            questionA3: 'MEX', answerA3: 'USA', borderKm: 3145, fileSlug: 'mexiko' },
  { question: 'Russland',       answer: 'Kasachstan',     questionA3: 'RUS', answerA3: 'KAZ', borderKm: 7644, fileSlug: 'russland', shiftLon: true },
  { question: 'China',          answer: 'Mongolei',       questionA3: 'CHN', answerA3: 'MNG', borderKm: 4677, fileSlug: 'china' },
  { question: 'Indien',         answer: 'Bangladesch',    questionA3: 'IND', answerA3: 'BGD', borderKm: 4096, fileSlug: 'indien' },
  { question: 'Brasilien',      answer: 'Bolivien',       questionA3: 'BRA', answerA3: 'BOL', borderKm: 3403, fileSlug: 'brasilien' },
  { question: 'Argentinien',    answer: 'Chile',          questionA3: 'ARG', answerA3: 'CHL', borderKm: 5308, fileSlug: 'argentinien' },
  { question: 'Spanien',        answer: 'Portugal',       questionA3: 'ESP', answerA3: 'PRT', borderKm: 1214, fileSlug: 'spanien' },
  { question: 'Polen',          answer: 'Tschechien',     questionA3: 'POL', answerA3: 'CZE', borderKm: 796,  fileSlug: 'polen' },
  { question: 'Italien',        answer: 'Schweiz',        questionA3: 'ITA', answerA3: 'CHE', borderKm: 698,  fileSlug: 'italien' },
  { question: 'Norwegen',       answer: 'Schweden',       questionA3: 'NOR', answerA3: 'SWE', borderKm: 1666, fileSlug: 'norwegen' },
  { question: 'Finnland',       answer: 'Russland',       questionA3: 'FIN', answerA3: 'RUS', borderKm: 1340, fileSlug: 'finnland' },
  { question: 'Iran',           answer: 'Irak',           questionA3: 'IRN', answerA3: 'IRQ', borderKm: 1599, fileSlug: 'iran' },
  { question: 'Türkei',         answer: 'Syrien',         questionA3: 'TUR', answerA3: 'SYR', borderKm: 822,  fileSlug: 'tuerkei' },
  { question: 'Saudi-Arabien',  answer: 'Jemen',          questionA3: 'SAU', answerA3: 'YEM', borderKm: 1458, fileSlug: 'saudi-arabien' },
  { question: 'Vietnam',        answer: 'Laos',           questionA3: 'VNM', answerA3: 'LAO', borderKm: 2161, fileSlug: 'vietnam' },
  { question: 'Pakistan',       answer: 'Indien',         questionA3: 'PAK', answerA3: 'IND', borderKm: 3310, fileSlug: 'pakistan' },
  { question: 'Indonesien',     answer: 'Malaysia',       questionA3: 'IDN', answerA3: 'MYS', borderKm: 1881, fileSlug: 'indonesien', fullExtent: true },
  { question: 'Frankreich',     answer: 'Brasilien',      questionA3: 'FRA', answerA3: 'BRA', borderKm: 730,  fileSlug: 'frankreich' },
];

interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

// Return all rings (outer + holes) flattened into a single array
function getRings(feature: GeoFeature): number[][][] {
  const g = feature.geometry;
  if (g.type === 'Polygon') return g.coordinates as number[][][];
  // MultiPolygon: array of polygons, each polygon is array of rings
  const out: number[][][] = [];
  for (const poly of g.coordinates as number[][][][]) {
    for (const ring of poly) out.push(ring);
  }
  return out;
}

// Polygon-grouped rings (each polygon = [outer, ...holes]); needed for
// area-weighted centroid that uses only the largest *polygon* (so e.g.
// Indonesia's label doesn't get pulled into the ocean by averaging islands).
function getPolygons(feature: GeoFeature): number[][][][] {
  const g = feature.geometry;
  if (g.type === 'Polygon') return [g.coordinates as number[][][]];
  return g.coordinates as number[][][][];
}

// SVG canvas — 1200x900 gives the 50m source enough pixels to render fine
// detail (small islands, fjords, complex inland borders).
const SVG_WIDTH = 1200;
const SVG_HEIGHT = 900;
const PADDING = 36;
const LABEL_HEIGHT = 60; // extra space at the bottom for caption

function findFeature(features: GeoFeature[], a3: string): GeoFeature {
  const f = features.find(
    (ft) =>
      ft.properties.ADM0_A3 === a3 ||
      ft.properties.ADM0_A3_US === a3 ||
      ft.properties.SOV_A3 === a3
  );
  if (!f) throw new Error(`No feature for ${a3}`);
  return f;
}

// "Shift" used to mean "add 360 to every negative lon", which broke any ring
// that legitimately crossed the prime meridian (UK, Spain, France, …) — after
// shifting, those rings span the new 0/360 seam and clipping produces 250°-
// wide horizontal artifact segments. Instead we now do an *unwrap*: walk the
// ring and adjust each lon so consecutive vertices never differ by more than
// 180°. That keeps already-continuous rings unchanged and turns rings that
// cross the antimeridian (Russia mainland, USA Aleutians) into a single
// continuous range of lons (typically extending past ±180).
function unwrapRing(ring: number[][]): number[][] {
  if (ring.length === 0) return ring;
  const out: number[][] = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prev = out[i - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, ring[i][1]]);
  }
  return out;
}

function shiftLon(rings: number[][][]): number[][][] {
  return rings.map(unwrapRing);
}

function shiftLonPolygons(polys: number[][][][]): number[][][][] {
  return polys.map((p) => p.map(unwrapRing));
}

// After unwrap, a ring may sit at lons outside the bbox by a multiple of 360°
// (e.g. UK at 350–370 when the bbox spans -37 to 257). Rotate the whole ring
// by ±360° so it overlaps the bbox as much as possible — this lets us draw
// the same physical country either as -10..10 *or* 350..370, whichever falls
// inside the visible/render bbox.
function alignRingToBbox(ring: number[][], bbox: [number, number, number, number]): number[][] {
  if (ring.length === 0) return ring;
  let minLon = Infinity, maxLon = -Infinity;
  for (const [lon] of ring) { if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon; }
  let bestOffset = 0;
  let bestOverlap = -Infinity;
  for (let k = -2; k <= 2; k++) {
    const offset = k * 360;
    const lo = minLon + offset;
    const hi = maxLon + offset;
    const overlap = Math.min(hi, bbox[2]) - Math.max(lo, bbox[0]);
    if (overlap > bestOverlap) { bestOverlap = overlap; bestOffset = offset; }
  }
  if (bestOffset === 0) return ring;
  return ring.map(([lon, lat]) => [lon + bestOffset, lat]);
}

function alignRingsToBbox(rings: number[][][], bbox: [number, number, number, number]): number[][][] {
  return rings.map((r) => alignRingToBbox(r, bbox));
}

function bboxOfRings(rings: number[][][]): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}

function unionBbox(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

function expandBbox([minLon, minLat, maxLon, maxLat]: [number, number, number, number], pct = 0.08): [number, number, number, number] {
  const dLon = (maxLon - minLon) * pct;
  const dLat = (maxLat - minLat) * pct;
  return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat];
}

// Build a deterministic key for a segment, direction-independent.
function segKey(a: number[], b: number[]): string {
  const k1 = `${a[0].toFixed(6)},${a[1].toFixed(6)}`;
  const k2 = `${b[0].toFixed(6)},${b[1].toFixed(6)}`;
  return k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
}

// Find shared (border) segments between two ring-sets and chain them into polylines.
function findSharedBorderPolylines(ringsA: number[][][], ringsB: number[][][]): number[][][] {
  const setB = new Set<string>();
  for (const ring of ringsB) {
    for (let i = 0; i < ring.length - 1; i++) {
      setB.add(segKey(ring[i], ring[i + 1]));
    }
  }

  // Collect shared segments from A
  const segs: [number[], number[]][] = [];
  for (const ring of ringsA) {
    for (let i = 0; i < ring.length - 1; i++) {
      const p = ring[i], q = ring[i + 1];
      if (setB.has(segKey(p, q))) segs.push([p, q]);
    }
  }

  // Chain consecutive segments into polylines (point match by string key)
  const ptKey = (p: number[]) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const adjacency = new Map<string, number[][]>(); // pt -> list of points it is connected to
  for (const [a, b] of segs) {
    const ka = ptKey(a), kb = ptKey(b);
    if (!adjacency.has(ka)) adjacency.set(ka, []);
    if (!adjacency.has(kb)) adjacency.set(kb, []);
    adjacency.get(ka)!.push(b);
    adjacency.get(kb)!.push(a);
  }

  const visitedSegs = new Set<string>();
  const polylines: number[][][] = [];

  // Traverse chains starting from endpoints (degree=1) first, then any unvisited segs (loops)
  const ptToPoint = new Map<string, number[]>();
  for (const [a, b] of segs) {
    ptToPoint.set(ptKey(a), a);
    ptToPoint.set(ptKey(b), b);
  }

  function walkFrom(startKey: string): number[][] | null {
    const startPt = ptToPoint.get(startKey);
    if (!startPt) return null;
    const polyline: number[][] = [startPt];
    let curKey = startKey;
    while (true) {
      const neighbors = adjacency.get(curKey) ?? [];
      let next: number[] | null = null;
      for (const nb of neighbors) {
        const nbKey = ptKey(nb);
        const sk = segKey(ptToPoint.get(curKey)!, nb);
        if (!visitedSegs.has(sk)) {
          visitedSegs.add(sk);
          next = nb;
          curKey = nbKey;
          break;
        }
      }
      if (!next) break;
      polyline.push(next);
    }
    return polyline.length >= 2 ? polyline : null;
  }

  // Endpoint-first traversal
  for (const [k, neigh] of adjacency) {
    if (neigh.length === 1) {
      const pl = walkFrom(k);
      if (pl) polylines.push(pl);
    }
  }
  // Any remaining (closed loops)
  for (const [a, b] of segs) {
    const sk = segKey(a, b);
    if (!visitedSegs.has(sk)) {
      visitedSegs.add(sk);
      polylines.push([a, b]);
    }
  }

  return polylines;
}

interface Projection {
  toX: (lon: number) => number;
  toY: (lat: number) => number;
  fromX: (x: number) => number;
  fromY: (y: number) => number;
}

function buildProjection(bbox: [number, number, number, number]): Projection {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const centerLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  // Geographic span in "equal-area-ish" units: lon scaled by cos(centerLat).
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
    fromX: (x) => minLon + (x - offsetX) / (cosLat * scale),
    fromY: (y) => maxLat - (y - offsetY) / scale,
  };
}

// Project + round to 1 decimal, drop consecutive duplicates (after projection
// many close-by source vertices collapse to the same SVG pixel).
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

function ringToPath(ring: number[][], proj: Projection): string {
  return projectAndSimplify(ring, proj, true);
}

function ringsToPath(rings: number[][][], proj: Projection): string {
  return rings.map((r) => ringToPath(r, proj)).filter(Boolean).join(' ');
}

function polylineToPath(line: number[][], proj: Projection): string {
  return projectAndSimplify(line, proj, false);
}

// Shoelace area + area-weighted centroid for a single (closed) ring.
function shoelace(ring: number[][]): { area: number; cx: number; cy: number } {
  let twoA = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    const cross = x1 * y2 - x2 * y1;
    twoA += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  const area = twoA / 2;
  if (area === 0) return { area: 0, cx: ring[0][0], cy: ring[0][1] };
  return { area: Math.abs(area), cx: cx / (3 * twoA), cy: cy / (3 * twoA) };
}

// Ray-casting point-in-polygon (outer ring only; tolerant of small concavities).
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

// Distance from point to segment, squared (geographic units).
function distSqToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = px - x1, ey = py - y1;
    return ex * ex + ey * ey;
  }
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ex = px - (x1 + t * dx);
  const ey = py - (y1 + t * dy);
  return ex * ex + ey * ey;
}

// Distance from point to nearest edge of a ring (geographic units).
function distToRingEdge(px: number, py: number, ring: number[][]): number {
  let minD = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const d = distSqToSeg(px, py, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
    if (d < minD) minD = d;
  }
  return Math.sqrt(minD);
}

// Sutherland-Hodgman clip of a single ring against one edge of an axis-aligned
// rectangle. `idx` = 0 (lon/x) or 1 (lat/y); `keepGreater` = keep points on
// the high side of `val`.
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

// Clip a ring to a bbox; returns a closed ring (or [] if empty).
function clipRingToBbox(ring: number[][], bbox: [number, number, number, number]): number[][] {
  let r: number[][] = ring;
  r = clipRingByEdge(r, 0, bbox[0], true);
  r = clipRingByEdge(r, 0, bbox[2], false);
  r = clipRingByEdge(r, 1, bbox[1], true);
  r = clipRingByEdge(r, 1, bbox[3], false);
  if (r.length < 3) return [];
  // close
  if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push(r[0]);
  return r;
}

function clipRingsToBbox(
  rings: number[][][],
  bbox: [number, number, number, number],
  options: { dropFullSpan?: boolean } = {},
): number[][][] {
  const eps = 1e-5;
  const onBoundary = (p: number[]) =>
    Math.abs(p[0] - bbox[0]) < eps || Math.abs(p[0] - bbox[2]) < eps ||
    Math.abs(p[1] - bbox[1]) < eps || Math.abs(p[1] - bbox[3]) < eps;
  const bboxW = bbox[2] - bbox[0];
  const bboxH = bbox[3] - bbox[1];
  const out: number[][][] = [];
  for (const ring of rings) {
    const c = clipRingToBbox(ring, bbox);
    if (c.length < 4) continue;
    // Drop "ghost" rings where every vertex lies on the bbox boundary —
    // these are Sutherland-Hodgman artifacts produced when a polygon's
    // segments cross the bbox without actually entering its interior.
    if (c.every(onBoundary)) continue;
    if (options.dropFullSpan) {
      // For context countries: drop rings whose perimeter is *almost
      // entirely* on the bbox boundary. A Sutherland-Hodgman corner-cut
      // artifact wraps along the bbox edge from one crossing to another, so
      // its perimeter is dominated by edge segments. A real country, even
      // when its own polygon is much bigger than the bbox, contributes its
      // actual coastline / borders inside the visible area — most of the
      // perimeter is *not* on the bbox boundary.
      const eps = 1e-5;
      const onAny = (p: number[]) =>
        Math.abs(p[0] - bbox[0]) < eps || Math.abs(p[0] - bbox[2]) < eps ||
        Math.abs(p[1] - bbox[1]) < eps || Math.abs(p[1] - bbox[3]) < eps;
      let totalLen = 0;
      let boundaryLen = 0;
      for (let i = 0; i < c.length - 1; i++) {
        const a = c[i], b = c[i + 1];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        totalLen += len;
        if (onAny(a) && onAny(b)) boundaryLen += len;
      }
      if (totalLen > 0 && boundaryLen / totalLen > 0.85) continue;
    }
    out.push(c);
  }
  return out;
}

// After Sutherland-Hodgman, the closed ring may include segments running
// along the bbox boundary (or "corner cuts" connecting two different bbox
// edges). When stroked these show up as straight artifact lines crossing the
// map. Any segment whose BOTH endpoints sit on the bbox boundary is treated
// as such an artifact and excluded from the stroked outline.
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

// Pick the largest polygon (by outer-ring area) from a multipolygon set.
function largestPolygon(polygons: number[][][][]): number[][][] | null {
  let best: { area: number; poly: number[][][] } | null = null;
  for (const poly of polygons) {
    const a = shoelace(poly[0]).area;
    if (!best || a > best.area) best = { area: a, poly };
  }
  return best?.poly ?? null;
}

// Visual-center search: prefer the area-weighted centroid (visually balanced)
// when it sits inside the polygon, and fall back to a pole-of-inaccessibility
// grid scan only for highly concave outlines (e.g. Norway). Operates on the
// largest clipped polygon — i.e. the largest *visible* piece of the country.
function labelInVisibleArea(
  polygons: number[][][][],
  bbox: [number, number, number, number],
): { lon: number; lat: number; inscribedRadius: number } {
  let best: { area: number; ring: number[][] } | null = null;
  for (const poly of polygons) {
    const clipped = clipRingToBbox(poly[0], bbox);
    if (clipped.length < 4) continue;
    const a = shoelace(clipped).area;
    if (!best || a > best.area) best = { area: a, ring: clipped };
  }
  if (!best) {
    return { lon: (bbox[0] + bbox[2]) / 2, lat: (bbox[1] + bbox[3]) / 2, inscribedRadius: 0 };
  }
  const ring = best.ring;

  // Pole-of-inaccessibility grid scan to compute the inscribed radius (used
  // for font sizing). We always run this even if we end up using the
  // centroid for placement.
  const [minLon, minLat, maxLon, maxLat] = bboxOfRings([ring]);
  const aspect = (maxLon - minLon) / (maxLat - minLat || 1);
  const NY = 32;
  const NX = Math.max(8, Math.round(NY * aspect));
  let inscribedPt: [number, number] = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
  let inscribedD = -Infinity;
  for (let i = 1; i < NX; i++) {
    for (let j = 1; j < NY; j++) {
      const lon = minLon + ((maxLon - minLon) * i) / NX;
      const lat = minLat + ((maxLat - minLat) * j) / NY;
      if (!pointInRing([lon, lat], ring)) continue;
      const d = distToRingEdge(lon, lat, ring);
      if (d > inscribedD) { inscribedD = d; inscribedPt = [lon, lat]; }
    }
  }
  if (inscribedD > 0) {
    const wLon = (maxLon - minLon) / NX;
    const wLat = (maxLat - minLat) / NY;
    const REF = 12;
    const cx = inscribedPt[0], cy = inscribedPt[1];
    for (let i = -REF; i <= REF; i++) {
      for (let j = -REF; j <= REF; j++) {
        const lon = cx + (wLon * i) / REF;
        const lat = cy + (wLat * j) / REF;
        if (!pointInRing([lon, lat], ring)) continue;
        const d = distToRingEdge(lon, lat, ring);
        if (d > inscribedD) { inscribedD = d; inscribedPt = [lon, lat]; }
      }
    }
  }

  // Prefer the area-weighted centroid when it lies inside the polygon — it
  // gives a visually centered placement (e.g. middle of Austria, middle of
  // Chile) instead of biasing toward the country's widest spot. Falls back
  // to the inscribed point only when the centroid lands outside (Norway,
  // L-shaped countries).
  const c = shoelace(ring);
  if (pointInRing([c.cx, c.cy], ring)) {
    return { lon: c.cx, lat: c.cy, inscribedRadius: inscribedD < 0 ? 0 : inscribedD };
  }
  return { lon: inscribedPt[0], lat: inscribedPt[1], inscribedRadius: inscribedD < 0 ? 0 : inscribedD };
}

// Estimate the SVG-space half-width and half-height of a label.
function labelHalfSize(text: string, font: number): { halfW: number; halfH: number } {
  return { halfW: (text.length * font * 0.55) / 2, halfH: font * 0.65 };
}

// How much of the label rectangle (centered at lon/lat) is inside the OTHER
// country's polygons? Sampled on a 5×3 grid for cheap coverage.
function labelOverlapWithOther(
  lon: number,
  lat: number,
  font: number,
  text: string,
  otherPolys: number[][][][],
  proj: Projection,
): number {
  const { halfW, halfH } = labelHalfSize(text, font);
  const cx = proj.toX(lon), cy = proj.toY(lat);
  let inside = 0, total = 0;
  for (let i = -2; i <= 2; i++) {
    for (let j = -1; j <= 1; j++) {
      const x = cx + (i / 2) * halfW;
      const y = cy + (j / 1) * halfH;
      const tlon = proj.fromX(x), tlat = proj.fromY(y);
      total++;
      for (const poly of otherPolys) {
        if (pointInRing([tlon, tlat], poly[0])) { inside++; break; }
      }
    }
  }
  return inside / total;
}

// Constrain the label so its rectangle stays fully inside the visible bbox
// (otherwise the SVG <clipPath> at the viewBbox would chop part of the text).
function clampLabelToBbox(
  lon: number,
  lat: number,
  font: number,
  text: string,
  bbox: [number, number, number, number],
  proj: Projection,
): { lon: number; lat: number } {
  const { halfW, halfH } = labelHalfSize(text, font);
  const xMin = proj.toX(bbox[0]) + halfW;
  const xMax = proj.toX(bbox[2]) - halfW;
  const yMin = proj.toY(bbox[3]) + halfH;
  const yMax = proj.toY(bbox[1]) - halfH;
  const cx = Math.max(xMin, Math.min(xMax, proj.toX(lon)));
  const cy = Math.max(yMin, Math.min(yMax, proj.toY(lat)));
  return { lon: proj.fromX(cx), lat: proj.fromY(cy) };
}

// If the label rectangle overlaps the other country, search nearby positions
// (toward the empty / ocean side) for a placement that doesn't conflict.
// Falls back to the original position if nothing is clearly better.
function avoidOtherCountry(
  initLon: number,
  initLat: number,
  font: number,
  text: string,
  otherPolys: number[][][][],
  bbox: [number, number, number, number],
  proj: Projection,
): { lon: number; lat: number } {
  const initOverlap = labelOverlapWithOther(initLon, initLat, font, text, otherPolys, proj);
  if (initOverlap < 0.2) return { lon: initLon, lat: initLat };

  const stepLon = (bbox[2] - bbox[0]) * 0.05;
  const stepLat = (bbox[3] - bbox[1]) * 0.05;
  let best = { lon: initLon, lat: initLat, score: initOverlap };
  for (let r = 1; r <= 8; r++) {
    for (const [dx, dy] of [
      [-1, 0], [1, 0], [0, -1], [0, 1],
      [-1, -1], [-1, 1], [1, -1], [1, 1],
    ]) {
      const lon = initLon + dx * stepLon * r;
      const lat = initLat + dy * stepLat * r;
      if (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3]) continue;
      const score = labelOverlapWithOther(lon, lat, font, text, otherPolys, proj);
      if (score < best.score - 0.01) best = { lon, lat, score };
      if (best.score < 0.05) return { lon: best.lon, lat: best.lat };
    }
    if (best.score < 0.15) break;
  }
  return { lon: best.lon, lat: best.lat };
}

// Pull the two labels apart if their rectangles overlap (e.g. Chile +
// Argentinien when both centroids land at similar latitude).
function separateLabels(
  a: { lon: number; lat: number; font: number; text: string },
  b: { lon: number; lat: number; font: number; text: string },
  bbox: [number, number, number, number],
  proj: Projection,
): { a: { lon: number; lat: number }; b: { lon: number; lat: number } } {
  const ah = labelHalfSize(a.text, a.font);
  const bh = labelHalfSize(b.text, b.font);
  const ax = proj.toX(a.lon), ay = proj.toY(a.lat);
  const bx = proj.toX(b.lon), by = proj.toY(b.lat);
  const overlapX = ah.halfW + bh.halfW - Math.abs(ax - bx);
  const overlapY = ah.halfH + bh.halfH - Math.abs(ay - by);
  if (overlapX <= 0 || overlapY <= 0) {
    return { a: { lon: a.lon, lat: a.lat }, b: { lon: b.lon, lat: b.lat } };
  }
  // Resolve the overlap on the smaller axis (cheaper shift). Move each label
  // half the needed distance, away from the other label's center.
  const moveX = overlapX < overlapY;
  let aShift = 0, bShift = 0;
  if (moveX) {
    const need = overlapX / 2 + 2;
    if (ax < bx) { aShift = -need; bShift = need; }
    else         { aShift = need;  bShift = -need; }
  } else {
    const need = overlapY / 2 + 2;
    if (ay < by) { aShift = -need; bShift = need; }
    else         { aShift = need;  bShift = -need; }
  }
  const aOut = moveX
    ? clampLabelToBbox(proj.fromX(ax + aShift), a.lat, a.font, a.text, bbox, proj)
    : clampLabelToBbox(a.lon, proj.fromY(ay + aShift), a.font, a.text, bbox, proj);
  const bOut = moveX
    ? clampLabelToBbox(proj.fromX(bx + bShift), b.lat, b.font, b.text, bbox, proj)
    : clampLabelToBbox(b.lon, proj.fromY(by + bShift), b.font, b.text, bbox, proj);
  return { a: aOut, b: bOut };
}

// Compute font size from the inscribed-circle radius. Font shrinks to fit
// small/thin countries instead of overflowing them, with a min of 22 for
// legibility (the label may then overflow the country outline — acceptable
// per spec; legibility takes priority).
function computeFontSize(
  text: string,
  inscribedRadius: number,
  bbox: [number, number, number, number],
): number {
  const centerLat = (bbox[1] + bbox[3]) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const dx = ((inscribedRadius * cosLat) / ((bbox[2] - bbox[0]) * cosLat)) * (SVG_WIDTH - 2 * PADDING);
  const dy = (inscribedRadius / (bbox[3] - bbox[1])) * (SVG_HEIGHT - 2 * PADDING - LABEL_HEIGHT);
  const usable = Math.min(dx, dy);
  const charWidthFactor = 0.55;
  const fitByWidth = (usable * 1.7) / (text.length * charWidthFactor);
  const fitByHeight = usable * 1.6;
  return Math.max(22, Math.min(32, Math.min(fitByWidth, fitByHeight)));
}

function renderLabelAt(
  text: string,
  lon: number,
  lat: number,
  font: number,
  proj: Projection,
): string {
  return `  <text x="${proj.toX(lon).toFixed(1)}" y="${proj.toY(lat).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${font.toFixed(1)}" font-weight="700" fill="#ffffff" stroke="#1a1a2e" stroke-width="${(font / 8).toFixed(1)}" paint-order="stroke">${text}</text>`;
}

function generateSVG(pair: Pair, allFeatures: GeoFeature[]): string {
  const fA = findFeature(allFeatures, pair.questionA3);
  const fB = findFeature(allFeatures, pair.answerA3);

  // Per-country: full ring set (all polygons) + polygon-grouped (for label
  // placement, which needs to know polygon hierarchy).
  // Unwrap every ring so antimeridian crossings (Russia, USA Aleutians,
  // Indonesia) become continuous in lon space. Non-crossing rings are left
  // unchanged. The pair.shiftLon flag is no longer needed for clip safety,
  // but is still respected so the question/answer countries that cross the
  // antimeridian get drawn at lons > 180 (not split across the seam).
  let ringsA = shiftLon(getRings(fA));
  let ringsB = shiftLon(getRings(fB));
  let polysA = shiftLonPolygons(getPolygons(fA));
  let polysB = shiftLonPolygons(getPolygons(fB));

  // Smarter bbox: focus on the question country's largest landmass and the
  // shared border (so we don't zoom out to include far-flung territories
  // like Alaska when it's not relevant — and so the border with the answer
  // country is always centered in the view).
  const largestA = largestPolygon(polysA);
  const largestB = largestPolygon(polysB);
  const sharedLines = findSharedBorderPolylines(ringsA, ringsB);
  let bbox: [number, number, number, number];
  if (pair.bbox) {
    bbox = pair.bbox;
  } else if (pair.fullExtent) {
    // Archipelago pairs: show the entire extent of both countries (e.g.
    // Indonesien + Malaysia — peninsular Malaysia and the major Indonesian
    // islands belong in the view together with Borneo where the border is).
    // 15% padding leaves room for adjacent context countries (Thailand,
    // Philippines, Brunei, Singapore) so the regional setting is recognisable.
    bbox = unionBbox(bboxOfRings(ringsA), bboxOfRings(ringsB));
    bbox = expandBbox(bbox, 0.15);
  } else {
    const baseA = largestA ? bboxOfRings([largestA[0]]) : bboxOfRings(ringsA);
    let combined: [number, number, number, number] = baseA;
    if (sharedLines.length > 0) {
      const borderPts: number[][] = [];
      for (const l of sharedLines) for (const p of l) borderPts.push(p);
      const bboxBorder = bboxOfRings([borderPts]);
      // Pad the border bbox by ~20% of the question country's diameter so a
      // sliver of the answer country is always visible alongside the border.
      const qSize = Math.max(baseA[2] - baseA[0], baseA[3] - baseA[1]);
      const exp = qSize * 0.2;
      combined = unionBbox(combined, [
        bboxBorder[0] - exp,
        bboxBorder[1] - exp,
        bboxBorder[2] + exp,
        bboxBorder[3] + exp,
      ]);
    } else if (largestB) {
      // No shared-border data (rare): fall back to including the answer's
      // largest landmass too.
      combined = unionBbox(combined, bboxOfRings([largestB[0]]));
    }
    bbox = expandBbox(combined, 0.05);
  }
  const proj = buildProjection(bbox);
  // Render bbox: 40% larger than view bbox. Sutherland-Hodgman clips to
  // renderBbox (drops far-off geometry like Russia's mainland) but the closed
  // ring's edge segments along the renderBbox boundary land outside the
  // visible area, so they don't draw as horizontal/vertical artifact lines
  // when stroked. The SVG <clipPath> at the projected viewBbox does the final
  // visual clipping cleanly.
  const renderBbox = expandBbox(bbox, 0.4);

  // Helper: render fills + interior-only strokes. Closed clipped rings provide
  // the fill; the stroke is drawn from polylines that exclude segments lying
  // along the renderBbox boundary (those segments are clipping artifacts, not
  // real country outlines).
  function renderCountry(rings: number[][][], fill: string, stroke: string, strokeW: number, dropFullSpan = false): string[] {
    const clipped = clipRingsToBbox(rings, renderBbox, { dropFullSpan });
    if (clipped.length === 0) return [];
    const fillD = ringsToPath(clipped, proj);
    const strokeSegments: string[] = [];
    for (const r of clipped) {
      for (const line of interiorPolylines(r, renderBbox)) {
        const s = projectAndSimplify(line, proj, false);
        if (s) strokeSegments.push(s);
      }
    }
    const out: string[] = [];
    if (fillD) out.push(`  <path d="${fillD}" fill="${fill}" stroke="none" fill-rule="evenodd"/>`);
    if (strokeSegments.length > 0) out.push(`  <path d="${strokeSegments.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`);
    return out;
  }

  // Context countries: unwrap each ring, then rotate by ±360° so it aligns
  // with the renderBbox (e.g. UK at -10..10 displayed for a Europe map; or
  // shifted to 350..370 if the bbox is centered on the Pacific). Without the
  // alignment a context country at the wrong "branch" of the lon axis ends
  // up off-screen; without the unwrap a seam-crossing country produces fake
  // transversal segments after Sutherland-Hodgman clipping.
  const contextPaths: string[] = [];
  for (const f of allFeatures) {
    if (f === fA || f === fB) continue;
    const rings = alignRingsToBbox(shiftLon(getRings(f)), renderBbox);
    const fb = bboxOfRings(rings);
    if (fb[2] < renderBbox[0] || fb[0] > renderBbox[2] || fb[3] < renderBbox[1] || fb[1] > renderBbox[3]) continue;
    contextPaths.push(...renderCountry(rings, '#2a2d44', '#5a6088', 1.1, true));
  }

  // Question + answer countries.
  const aPaths = renderCountry(ringsA, '#3b5a8c', '#9bb6e0', 1.4);
  const bPaths = renderCountry(ringsB, '#f4a261', '#c97a2c', 1.4);

  // Shared border polylines (rendered on top of the country fills).
  const borderPaths = sharedLines
    .map(
      (line) =>
        `  <path d="${polylineToPath(line, proj)}" fill="none" stroke="#e63946" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join('\n');

  // Labels: visual-center placement, then post-process so the label
  //  - never extends outside the visible bbox (Russland in finnland.svg),
  //  - never sits mostly inside the OTHER country's polygon (Chile pushed
  //    out into Argentinien, Norwegen pushed into Schweden), and
  //  - doesn't overlap the partner label (Chile + Argentinien at the same
  //    latitude).
  const initA = labelInVisibleArea(polysA, bbox);
  const initB = labelInVisibleArea(polysB, bbox);
  const fontA = computeFontSize(pair.question, initA.inscribedRadius, bbox);
  const fontB = computeFontSize(pair.answer, initB.inscribedRadius, bbox);

  let posA = clampLabelToBbox(initA.lon, initA.lat, fontA, pair.question, bbox, proj);
  let posB = clampLabelToBbox(initB.lon, initB.lat, fontB, pair.answer, bbox, proj);
  posA = avoidOtherCountry(posA.lon, posA.lat, fontA, pair.question, polysB, bbox, proj);
  posB = avoidOtherCountry(posB.lon, posB.lat, fontB, pair.answer, polysA, bbox, proj);
  posA = clampLabelToBbox(posA.lon, posA.lat, fontA, pair.question, bbox, proj);
  posB = clampLabelToBbox(posB.lon, posB.lat, fontB, pair.answer, bbox, proj);
  const sep = separateLabels(
    { lon: posA.lon, lat: posA.lat, font: fontA, text: pair.question },
    { lon: posB.lon, lat: posB.lat, font: fontB, text: pair.answer },
    bbox,
    proj,
  );
  posA = sep.a;
  posB = sep.b;
  const labelA = renderLabelAt(pair.question, posA.lon, posA.lat, fontA, proj);
  const labelB = renderLabelAt(pair.answer, posB.lon, posB.lat, fontB, proj);

  // Caption (footer)
  const captionY = SVG_HEIGHT - 22;
  const caption = `  <text x="${SVG_WIDTH / 2}" y="${captionY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="bold" fill="#ffffff">${pair.question} ↔ ${pair.answer} · ${pair.borderKm.toLocaleString('de-DE')} km</text>`;

  // SVG clip-path at the projected view bbox — strokes from rings that touch
  // the renderBbox boundary fall in the 40% margin around the viewBbox and
  // are clipped here, leaving a clean edge on the visible map.
  const clipX0 = Math.min(proj.toX(bbox[0]), proj.toX(bbox[2]));
  const clipY0 = Math.min(proj.toY(bbox[1]), proj.toY(bbox[3]));
  const clipW = Math.abs(proj.toX(bbox[2]) - proj.toX(bbox[0]));
  const clipH = Math.abs(proj.toY(bbox[1]) - proj.toY(bbox[3]));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" overflow="hidden">
  <defs><clipPath id="frame"><rect x="${clipX0.toFixed(1)}" y="${clipY0.toFixed(1)}" width="${clipW.toFixed(1)}" height="${clipH.toFixed(1)}"/></clipPath></defs>
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#1a1a2e" rx="12"/>
  <rect x="${clipX0.toFixed(1)}" y="${clipY0.toFixed(1)}" width="${clipW.toFixed(1)}" height="${clipH.toFixed(1)}" fill="#1a1a2e"/>
  <g clip-path="url(#frame)">
${contextPaths.join('\n')}
${aPaths.join('\n')}
${bPaths.join('\n')}
${borderPaths}
${labelA}
${labelB}
  </g>
${caption}
</svg>
`;
}

async function loadGeoJSON(): Promise<GeoCollection> {
  // Allow caching to avoid repeated downloads when iterating on rendering.
  const cachePath = path.join(process.env.TMPDIR ?? '/tmp', 'ne_50m_admin_0_countries.geojson');
  if (fs.existsSync(cachePath)) {
    console.log(`Reading cached GeoJSON: ${cachePath}`);
    return JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as GeoCollection;
  }
  console.log('Fetching Natural Earth countries GeoJSON...');
  const resp = await fetch(COUNTRIES_URL);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
  const text = await resp.text();
  fs.writeFileSync(cachePath, text);
  return JSON.parse(text) as GeoCollection;
}

async function main() {
  const data = await loadGeoJSON();
  console.log(`Got ${data.features.length} country features`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const pair of pairs) {
    const svg = generateSVG(pair, data.features);
    const file = path.join(OUT_DIR, `${pair.fileSlug}.svg`);
    fs.writeFileSync(file, svg);
    console.log(`✓ ${pair.fileSlug}.svg  (${pair.question} → ${pair.answer}, ${pair.borderKm} km)`);
  }
  console.log(`\nWrote ${pairs.length} SVGs to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
