// =============================================================================
// Austria-with-marker map generator
// =============================================================================
// Built for the "Ortsname - Real oder Erfunden" fact-or-fake game. Renders one
// map per real Austrian place: Austria highlighted on a dimmed neighbour
// background, with a red dot and label at the place's coordinates.
//
// Run from the repo root:
//   node --import=tsx scripts/generate-ortsname-real-oder-erfunden-maps.ts
//
// Source data (cached in $TMPDIR after first download):
//   - Natural Earth 50m admin-0 countries
//
// Coordinates were captured from the German Wikipedia (`prop=coordinates` on
// each Gemeinde page) — see commit history for the queries.
import fs from 'fs';
import path from 'path';

const COUNTRIES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson';
const STATES_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';

const OUT_DIR = path.join('local-assets', 'images', 'Karten', 'Ortsname-Real-oder-Erfunden');

interface Place {
  name: string;
  slug: string;
  coords: [number, number]; // [lon, lat]
}

const places: Place[] = [
  { name: 'Hühnergeschrei', slug: 'huehnergeschrei', coords: [13.951, 48.518] },
  { name: 'Hundsheim',      slug: 'hundsheim',      coords: [16.939, 48.119] },
  { name: 'Hirnsdorf',      slug: 'hirnsdorf',      coords: [15.830, 47.194] },
  { name: 'Tweng',          slug: 'tweng',          coords: [13.600, 47.191] },
  { name: 'Goggendorf',     slug: 'goggendorf',     coords: [15.934, 48.619] },
  { name: 'Tobaj',          slug: 'tobaj',          coords: [16.304, 47.091] },
  { name: 'Stinatz',        slug: 'stinatz',        coords: [16.133, 47.204] },
  { name: 'Ölkam',          slug: 'oelkam',         coords: [14.358, 48.225] },
  { name: 'Schwoich',       slug: 'schwoich',       coords: [12.133, 47.550] },
  { name: 'Stoob',          slug: 'stoob',          coords: [16.476, 47.530] },
  { name: 'Übersaxen',      slug: 'uebersaxen',     coords: [9.671,  47.253] },
  { name: 'Schnifis',       slug: 'schnifis',       coords: [9.717,  47.217] },
  { name: 'Glanegg',        slug: 'glanegg',        coords: [14.206, 46.717] },
  { name: 'Trumau',         slug: 'trumau',         coords: [16.344, 47.995] },
  { name: 'Kollerschlag',   slug: 'kollerschlag',   coords: [13.843, 48.606] },
];

// All maps share the same view (Austria bbox + small padding for neighbours);
// only the marker position changes. Austria spans roughly 9.5–17.2°E and
// 46.3–49.0°N — pad slightly so the outline isn't flush with the canvas.
const VIEW_BBOX: [number, number, number, number] = [9.0, 46.2, 17.5, 49.2];

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

function getRings(feature: GeoFeature): number[][][] {
  const g = feature.geometry;
  if (g.type === 'Polygon') return g.coordinates as number[][][];
  const out: number[][][] = [];
  for (const poly of g.coordinates as number[][][][]) {
    for (const ring of poly) out.push(ring);
  }
  return out;
}

function bboxOfPoints(points: number[][]): [number, number, number, number] {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of points) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function bboxIntersects(
  a: [number, number, number, number],
  b: [number, number, number, number],
): boolean {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function expandBbox(
  [minLon, minLat, maxLon, maxLat]: [number, number, number, number],
  pct = 0.4,
): [number, number, number, number] {
  const dLon = (maxLon - minLon) * pct;
  const dLat = (maxLat - minLat) * pct;
  return [minLon - dLon, minLat - dLat, maxLon + dLon, maxLat + dLat];
}

const SVG_WIDTH = 1200;
const SVG_HEIGHT = 900;
const PADDING = 36;

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
  const innerH = SVG_HEIGHT - 2 * PADDING;
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

function clipRingByEdge(
  ring: number[][],
  idx: 0 | 1,
  val: number,
  keepGreater: boolean,
): number[][] {
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

function clipRingToBbox(
  ring: number[][],
  bbox: [number, number, number, number],
): number[][] {
  let r: number[][] = ring;
  r = clipRingByEdge(r, 0, bbox[0], true);
  r = clipRingByEdge(r, 0, bbox[2], false);
  r = clipRingByEdge(r, 1, bbox[1], true);
  r = clipRingByEdge(r, 1, bbox[3], false);
  if (r.length < 3) return [];
  if (r[0][0] !== r[r.length - 1][0] || r[0][1] !== r[r.length - 1][1]) r.push(r[0]);
  return r;
}

function clipRingsToBbox(
  rings: number[][][],
  bbox: [number, number, number, number],
): number[][][] {
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

// After Sutherland-Hodgman, segments running along the bbox edge are clipping
// artifacts (not real coastline / borders). Drop them from the stroked outline.
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

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateSVG(
  place: Place,
  austria: GeoFeature,
  neighbours: GeoFeature[],
  bundeslandRings: number[][][],
): string {
  const proj = buildProjection(VIEW_BBOX);
  const renderBbox = expandBbox(VIEW_BBOX, 0.2);

  function renderCountry(rings: number[][][], fill: string, stroke: string, strokeW: number): string[] {
    const clipped = clipRingsToBbox(rings, renderBbox);
    if (clipped.length === 0) return [];
    const fillD = clipped.map((r) => projectAndSimplify(r, proj, true)).filter(Boolean).join(' ');
    const strokeSegments: string[] = [];
    for (const r of clipped) {
      for (const line of interiorPolylines(r, renderBbox)) {
        const s = projectAndSimplify(line, proj, false);
        if (s) strokeSegments.push(s);
      }
    }
    const out: string[] = [];
    if (fillD) out.push(`  <path d="${fillD}" fill="${fill}" stroke="none" fill-rule="evenodd"/>`);
    if (strokeSegments.length > 0) {
      out.push(`  <path d="${strokeSegments.join(' ')}" fill="none" stroke="${stroke}" stroke-width="${strokeW}" stroke-linejoin="round" stroke-linecap="round"/>`);
    }
    return out;
  }

  const neighbourPaths: string[] = [];
  for (const f of neighbours) {
    const rings = getRings(f);
    const fb = bboxOfPoints(rings.flat());
    if (!bboxIntersects(fb, renderBbox)) continue;
    neighbourPaths.push(...renderCountry(rings, '#2a2d44', '#5a6088', 1.0));
  }

  const austriaPaths = renderCountry(getRings(austria), '#3b5a8c', '#9bb6e0', 1.6);

  // Bundesland borders: thin lines on top of Austria. Stroked from interior
  // segments only so artifacts along the renderBbox don't draw.
  const bundeslandPaths: string[] = [];
  {
    const clipped = clipRingsToBbox(bundeslandRings, renderBbox);
    const segs: string[] = [];
    for (const r of clipped) {
      for (const line of interiorPolylines(r, renderBbox)) {
        const s = projectAndSimplify(line, proj, false);
        if (s) segs.push(s);
      }
    }
    if (segs.length > 0) {
      bundeslandPaths.push(`  <path d="${segs.join(' ')}" fill="none" stroke="#9bb6e0" stroke-width="0.9" stroke-opacity="0.55" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="4 3"/>`);
    }
  }

  // Place marker: red dot + white halo for legibility against Austria's blue fill.
  const cx = proj.toX(place.coords[0]);
  const cy = proj.toY(place.coords[1]);
  const marker =
    `  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="13" fill="#ffffff" opacity="0.9"/>\n` +
    `  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="8"  fill="#e63946" stroke="#1a1a2e" stroke-width="1.5"/>`;

  // Place label above the dot. Clamp x so the full text stays within the
  // canvas (otherwise long names near the bbox edges — Hundsheim, Übersaxen
  // — get cut by the SVG's `overflow="hidden"`). Stroke + outline for
  // legibility against any background.
  const labelFontSize = 44;
  // Arial Bold averages ~0.6em per char; the stroke (width 6) adds another
  // 3 px on each side. Use 0.62 to be safe on wide caps like 'Ü', 'M', 'W'.
  const labelHalfW = (place.name.length * labelFontSize * 0.62) / 2 + 3;
  const labelMargin = 8;
  const labelX = Math.max(labelHalfW + labelMargin, Math.min(SVG_WIDTH - labelHalfW - labelMargin, cx));
  const labelY = cy - 22;
  const label = `  <text x="${labelX.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" dominant-baseline="auto" font-family="Arial, Helvetica, sans-serif" font-size="${labelFontSize}" font-weight="700" fill="#ffffff" stroke="#1a1a2e" stroke-width="6" paint-order="stroke">${escapeXml(place.name)}</text>`;

  // Caption (footer) — Bundesland is implicit from the dot, so just the name.
  const captionY = SVG_HEIGHT - 22;
  const caption = `  <text x="${SVG_WIDTH / 2}" y="${captionY}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="30" font-weight="bold" fill="#ffffff">${escapeXml(place.name)} · Österreich</text>`;

  // SVG clip-path at the projected view bbox.
  const clipX0 = Math.min(proj.toX(VIEW_BBOX[0]), proj.toX(VIEW_BBOX[2]));
  const clipY0 = Math.min(proj.toY(VIEW_BBOX[1]), proj.toY(VIEW_BBOX[3]));
  const clipW = Math.abs(proj.toX(VIEW_BBOX[2]) - proj.toX(VIEW_BBOX[0]));
  const clipH = Math.abs(proj.toY(VIEW_BBOX[1]) - proj.toY(VIEW_BBOX[3]));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" overflow="hidden">
  <defs><clipPath id="frame"><rect x="${clipX0.toFixed(1)}" y="${clipY0.toFixed(1)}" width="${clipW.toFixed(1)}" height="${clipH.toFixed(1)}"/></clipPath></defs>
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#1a1a2e" rx="12"/>
  <rect x="${clipX0.toFixed(1)}" y="${clipY0.toFixed(1)}" width="${clipW.toFixed(1)}" height="${clipH.toFixed(1)}" fill="#1a1a2e"/>
  <g clip-path="url(#frame)">
${neighbourPaths.join('\n')}
${austriaPaths.join('\n')}
${bundeslandPaths.join('\n')}
  </g>
${marker}
${label}
${caption}
</svg>
`;
}

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

async function main(): Promise<void> {
  const countries = await loadCached(COUNTRIES_URL, 'ne_50m_admin_0_countries.geojson');
  const states = await loadCached(STATES_URL, 'ne_10m_admin_1_states_provinces.geojson');

  const austria = countries.features.find(
    (f) =>
      f.properties.ADM0_A3 === 'AUT' ||
      f.properties.ADM0_A3_US === 'AUT' ||
      f.properties.SOV_A3 === 'AUT',
  );
  if (!austria) throw new Error('Could not find Austria feature');

  const neighbours = countries.features.filter((f) => f !== austria);

  // Austrian Bundesländer in the admin-1 dataset are tagged with `adm0_a3 = "AUT"`.
  const austriaStates = states.features.filter(
    (f) => (f.properties.adm0_a3 ?? f.properties.ADM0_A3) === 'AUT',
  );
  if (austriaStates.length === 0) {
    console.warn('Warning: no Austrian admin-1 features found — skipping Bundesland borders');
  } else {
    console.log(`Got ${austriaStates.length} Austrian Bundesland features`);
  }
  const bundeslandRings: number[][][] = [];
  for (const f of austriaStates) {
    for (const r of getRings(f)) bundeslandRings.push(r);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const place of places) {
    const svg = generateSVG(place, austria, neighbours, bundeslandRings);
    const file = path.join(OUT_DIR, `${place.slug}.svg`);
    fs.writeFileSync(file, svg);
    console.log(`✓ ${place.slug}.svg  (${place.name})`);
  }
  console.log(`\nWrote ${places.length} SVGs to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
