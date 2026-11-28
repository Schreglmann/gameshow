// =============================================================================
// Country-map helpers (shared library for map generator scripts)
// =============================================================================
// Projection, clipping, path building and label placement for SVG country
// maps drawn from Natural Earth 50m admin-0 data. The functions are the ones
// from scripts/generate-laendergrenzen-maps.ts; that script still carries its
// own copy.
//
// Layout: a 1200x900 canvas with PADDING on every side. `captionHeight`
// reserves space under the map for a caption line (0 = the map uses the full
// height).
import fs from 'fs';
import path from 'path';

export const COUNTRIES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';

export type Bbox = [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]

export interface GeoFeature {
  type: 'Feature';
  properties: Record<string, unknown>;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: number[][][] | number[][][][];
  };
}

export interface GeoCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
}

// Return all rings (outer + holes) flattened into a single array
export function getRings(feature: GeoFeature): number[][][] {
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
export function getPolygons(feature: GeoFeature): number[][][][] {
  const g = feature.geometry;
  if (g.type === 'Polygon') return [g.coordinates as number[][][]];
  return g.coordinates as number[][][][];
}

// SVG canvas — 1200x900 gives the 50m source enough pixels to render fine
// detail (small islands, fjords, complex inland borders).
export const SVG_WIDTH = 1200;
export const SVG_HEIGHT = 900;
export const PADDING = 36;

export function findFeature(features: GeoFeature[], a3: string): GeoFeature {
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
export function unwrapRing(ring: number[][]): number[][] {
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

export function shiftLon(rings: number[][][]): number[][][] {
  return rings.map(unwrapRing);
}

export function shiftLonPolygons(polys: number[][][][]): number[][][][] {
  return polys.map((p) => p.map(unwrapRing));
}

// After unwrap, a ring may sit at lons outside the bbox by a multiple of 360°
// (e.g. UK at 350–370 when the bbox spans -37 to 257). Rotate the whole ring
// by ±360° so it overlaps the bbox as much as possible — this lets us draw
// the same physical country either as -10..10 *or* 350..370, whichever falls
// inside the visible/render bbox.
export function alignRingToBbox(ring: number[][], bbox: [number, number, number, number]): number[][] {
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

export function alignRingsToBbox(rings: number[][][], bbox: [number, number, number, number]): number[][][] {
  return rings.map((r) => alignRingToBbox(r, bbox));
}

export function bboxOfRings(rings: number[][][]): [number, number, number, number] {
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

export function unionBbox(a: [number, number, number, number], b: [number, number, number, number]): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function expandBbox([minLon, minLat, maxLon, maxLat]: [number, number, number, number], pct = 0.08): [number, number, number, number] {
  const dLon = (maxLon - minLon) * pct;
  const dLat = (maxLat - minLat) * pct;
  return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat];
}

export interface Projection {
  toX: (lon: number) => number;
  toY: (lat: number) => number;
  fromX: (x: number) => number;
  fromY: (y: number) => number;
}

export function buildProjection(bbox: Bbox, captionHeight = 0): Projection {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const centerLat = (minLat + maxLat) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  // Geographic span in "equal-area-ish" units: lon scaled by cos(centerLat).
  const wGeo = (maxLon - minLon) * cosLat;
  const hGeo = maxLat - minLat;
  const innerW = SVG_WIDTH - 2 * PADDING;
  const innerH = SVG_HEIGHT - 2 * PADDING - captionHeight;
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
// `minStep` (in px) drops points closer than that to the last one kept. The
// 50m data is far denser than a pixel at continent scale, so 0.6 shrinks a map
// to about a fifth without a visible change. First and last point always stay.
export function projectAndSimplify(line: number[][], proj: Projection, closed: boolean, minStep = 0): string {
  const out: string[] = [];
  let lastX: number | null = null;
  let lastY: number | null = null;
  for (let i = 0; i < line.length; i++) {
    const x = Math.round(proj.toX(line[i][0]) * 10) / 10;
    const y = Math.round(proj.toY(line[i][1]) * 10) / 10;
    if (lastX === x && lastY === y) continue;
    const isEnd = i === line.length - 1;
    if (minStep > 0 && lastX !== null && lastY !== null && !isEnd && Math.hypot(x - lastX, y - lastY) < minStep) continue;
    out.push(`${out.length === 0 ? 'M' : 'L'}${x},${y}`);
    lastX = x;
    lastY = y;
  }
  if (out.length < 2) return '';
  return out.join(' ') + (closed ? ' Z' : '');
}

export function ringToPath(ring: number[][], proj: Projection, minStep = 0): string {
  return projectAndSimplify(ring, proj, true, minStep);
}

export function ringsToPath(rings: number[][][], proj: Projection, minStep = 0): string {
  return rings.map((r) => ringToPath(r, proj, minStep)).filter(Boolean).join(' ');
}

export function polylineToPath(line: number[][], proj: Projection): string {
  return projectAndSimplify(line, proj, false);
}

// Shoelace area + area-weighted centroid for a single (closed) ring.
export function shoelace(ring: number[][]): { area: number; cx: number; cy: number } {
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
export function pointInRing(p: [number, number], ring: number[][]): boolean {
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
export function distSqToSeg(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
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
export function distToRingEdge(px: number, py: number, ring: number[][]): number {
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
export function clipRingByEdge(ring: number[][], idx: 0 | 1, val: number, keepGreater: boolean): number[][] {
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
export function clipRingToBbox(ring: number[][], bbox: [number, number, number, number]): number[][] {
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

export function clipRingsToBbox(
  rings: number[][][],
  bbox: [number, number, number, number],
  options: { dropFullSpan?: boolean } = {},
): number[][][] {
  const eps = 1e-5;
  const onBoundary = (p: number[]) =>
    Math.abs(p[0] - bbox[0]) < eps || Math.abs(p[0] - bbox[2]) < eps ||
    Math.abs(p[1] - bbox[1]) < eps || Math.abs(p[1] - bbox[3]) < eps;
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
export function interiorPolylines(
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
export function largestPolygon(polygons: number[][][][]): number[][][] | null {
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
export function labelInVisibleArea(
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
export function labelHalfSize(text: string, font: number): { halfW: number; halfH: number } {
  return { halfW: (text.length * font * 0.55) / 2, halfH: font * 0.65 };
}

// Constrain the label so its rectangle stays fully inside the visible bbox
// (otherwise the SVG <clipPath> at the viewBbox would chop part of the text).
export function clampLabelToBbox(
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

// Compute font size from the inscribed-circle radius. Font shrinks to fit
// small/thin countries instead of overflowing them, with a min of 22 for
// legibility (the label may then overflow the country outline — acceptable
// per spec; legibility takes priority).
export function computeFontSize(
  text: string,
  inscribedRadius: number,
  bbox: [number, number, number, number],
  captionHeight = 0,
): number {
  const centerLat = (bbox[1] + bbox[3]) / 2;
  const cosLat = Math.cos((centerLat * Math.PI) / 180);
  const dx = ((inscribedRadius * cosLat) / ((bbox[2] - bbox[0]) * cosLat)) * (SVG_WIDTH - 2 * PADDING);
  const dy = (inscribedRadius / (bbox[3] - bbox[1])) * (SVG_HEIGHT - 2 * PADDING - captionHeight);
  const usable = Math.min(dx, dy);
  const charWidthFactor = 0.55;
  const fitByWidth = (usable * 1.7) / (text.length * charWidthFactor);
  const fitByHeight = usable * 1.6;
  return Math.max(22, Math.min(32, Math.min(fitByWidth, fitByHeight)));
}

export function renderLabelAt(
  text: string,
  lon: number,
  lat: number,
  font: number,
  proj: Projection,
): string {
  return `  <text x="${proj.toX(lon).toFixed(1)}" y="${proj.toY(lat).toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${font.toFixed(1)}" font-weight="700" fill="#ffffff" stroke="#1a1a2e" stroke-width="${(font / 8).toFixed(1)}" paint-order="stroke">${text}</text>`;
}

// Widen or heighten a bbox (symmetrically) so that, projected, it has exactly
// the aspect ratio of the drawable area — the map then fills the whole canvas
// instead of being letterboxed.
export function fitBboxToCanvas(bbox: Bbox, captionHeight = 0): Bbox {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const innerW = SVG_WIDTH - 2 * PADDING;
  const innerH = SVG_HEIGHT - 2 * PADDING - captionHeight;
  const target = innerW / innerH;
  const cosLat = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const wGeo = (maxLon - minLon) * cosLat;
  const hGeo = maxLat - minLat;
  if (wGeo / hGeo < target) {
    const extra = (hGeo * target - wGeo) / cosLat / 2;
    return [minLon - extra, minLat, maxLon + extra, maxLat];
  }
  const extra = (wGeo / target - hGeo) / 2;
  return [minLon, minLat - extra, maxLon, maxLat + extra];
}

// Natural Earth 50m admin-0 countries, cached in $TMPDIR after the first
// download.
export async function loadCountries(): Promise<GeoFeature[]> {
  const cachePath = path.join(process.env.TMPDIR ?? '/tmp', 'ne_50m_admin_0_countries.geojson');
  if (fs.existsSync(cachePath)) {
    console.log(`Reading cached GeoJSON: ${cachePath}`);
    return (JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as GeoCollection).features;
  }
  console.log('Fetching Natural Earth countries GeoJSON...');
  const resp = await fetch(COUNTRIES_URL);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
  const text = await resp.text();
  fs.writeFileSync(cachePath, text);
  return (JSON.parse(text) as GeoCollection).features;
}
