// =============================================================================
// Map generator for the "Welches Land fehlt?" simple-quiz
// =============================================================================
// For every item two SVGs with identical geometry are written:
//   <slug>.svg          the continent with one country left out. Nothing is
//                       drawn in its place, so it reads as water; neighbours
//                       keep their own outlines.
//   <slug>-loesung.svg  the same map with the missing country highlighted and
//                       labelled.
// The game uses them as `questionImage` / `answerImage` with
// `replaceImage: true`, so the country appears in place on reveal.
//
// Run from the project root:
//   node --import=tsx scripts/generate-welches-land-fehlt-maps.ts
//
// The script writes images only. Add or remove a question by editing `items`
// and games/welches-land-fehlt.json together.
//
// Not suitable as missing countries:
//   - landlocked countries: the neighbours' borders draw the complete outline
//     of the hole, so the question becomes "which shape is this";
//   - microstates (a few pixels wide at this scale);
//   - Russia (Kaliningrad belongs to the same feature and would vanish too).
import fs from 'fs';
import path from 'path';
import {
  PADDING,
  SVG_HEIGHT,
  SVG_WIDTH,
  alignRingsToBbox,
  bboxOfRings,
  buildProjection,
  clampLabelToBbox,
  clipRingsToBbox,
  computeFontSize,
  expandBbox,
  findFeature,
  fitBboxToCanvas,
  getPolygons,
  getRings,
  labelInVisibleArea,
  loadCountries,
  renderLabelAt,
  ringsToPath,
  shiftLon,
  shiftLonPolygons,
} from './lib/country-map';
import type { Bbox, GeoFeature } from './lib/country-map';

const OUT_DIR = path.join('local-assets', 'images', 'Karten', 'Welches-Land-fehlt');

// Fixed view per region, so every map of a region has the same frame.
// The box is widened to the canvas aspect ratio at render time.
const VIEWS = {
  europa: [-11, 35, 35, 64],
  suedamerika: [-82, -56, -34, 13],
  mittelamerika: [-118, 6, -59, 34],
  afrika: [-18.5, -35.5, 52, 38],
  vorderasien: [24, 11, 64, 46],
  suedasien: [60, 4, 100, 38],
  ostasien: [72, 17, 147, 55],
  suedostasien: [91, -11, 142, 29],
  ozeanien: [110, -48, 179.5, 0],
} satisfies Record<string, Bbox>;

interface Item {
  answer: string;                 // German country name (label on the solution map)
  omitA3: string;                 // ADM0_A3 code in Natural Earth
  alsoOmit?: string[];            // features Natural Earth draws separately but that belong to the answer
  view: keyof typeof VIEWS;
  fileSlug: string;
}

// Every country here has a sea coast: where it is left out, the hole runs into
// the water and its outline stays open.
const items: Item[] = [
  { answer: 'Italien',          omitA3: 'ITA', view: 'europa',        fileSlug: 'italien' },
  { answer: 'Portugal',         omitA3: 'PRT', view: 'europa',        fileSlug: 'portugal' },
  { answer: 'Griechenland',     omitA3: 'GRC', view: 'europa',        fileSlug: 'griechenland' },
  { answer: 'Dänemark',         omitA3: 'DNK', view: 'europa',        fileSlug: 'daenemark' },
  { answer: 'Irland',           omitA3: 'IRL', view: 'europa',        fileSlug: 'irland' },
  { answer: 'Belgien',          omitA3: 'BEL', view: 'europa',        fileSlug: 'belgien' },
  { answer: 'Niederlande',      omitA3: 'NLD', view: 'europa',        fileSlug: 'niederlande' },
  { answer: 'Kroatien',         omitA3: 'HRV', view: 'europa',        fileSlug: 'kroatien' },
  { answer: 'Albanien',         omitA3: 'ALB', view: 'europa',        fileSlug: 'albanien' },
  { answer: 'Bulgarien',        omitA3: 'BGR', view: 'europa',        fileSlug: 'bulgarien' },
  { answer: 'Rumänien',         omitA3: 'ROU', view: 'europa',        fileSlug: 'rumaenien' },
  { answer: 'Litauen',          omitA3: 'LTU', view: 'europa',        fileSlug: 'litauen' },
  { answer: 'Chile',            omitA3: 'CHL', view: 'suedamerika',   fileSlug: 'chile' },
  { answer: 'Ecuador',          omitA3: 'ECU', view: 'suedamerika',   fileSlug: 'ecuador' },
  { answer: 'Uruguay',          omitA3: 'URY', view: 'suedamerika',   fileSlug: 'uruguay' },
  { answer: 'Peru',             omitA3: 'PER', view: 'suedamerika',   fileSlug: 'peru' },
  { answer: 'Kolumbien',        omitA3: 'COL', view: 'suedamerika',   fileSlug: 'kolumbien' },
  { answer: 'Venezuela',        omitA3: 'VEN', view: 'suedamerika',   fileSlug: 'venezuela' },
  { answer: 'Argentinien',      omitA3: 'ARG', view: 'suedamerika',   fileSlug: 'argentinien' },
  { answer: 'Mexiko',           omitA3: 'MEX', view: 'mittelamerika', fileSlug: 'mexiko' },
  { answer: 'Kuba',             omitA3: 'CUB', view: 'mittelamerika', fileSlug: 'kuba' },
  { answer: 'Panama',           omitA3: 'PAN', view: 'mittelamerika', fileSlug: 'panama' },
  { answer: 'Südafrika',        omitA3: 'ZAF', view: 'afrika',        fileSlug: 'suedafrika' },
  { answer: 'Madagaskar',       omitA3: 'MDG', view: 'afrika',        fileSlug: 'madagaskar' },
  // Natural Earth draws Somaliland as its own feature.
  { answer: 'Somalia',          omitA3: 'SOM', alsoOmit: ['SOL'], view: 'afrika', fileSlug: 'somalia' },
  { answer: 'Ägypten',          omitA3: 'EGY', view: 'afrika',        fileSlug: 'aegypten' },
  { answer: 'Namibia',          omitA3: 'NAM', view: 'afrika',        fileSlug: 'namibia' },
  { answer: 'Kenia',            omitA3: 'KEN', view: 'afrika',        fileSlug: 'kenia' },
  { answer: 'Tansania',         omitA3: 'TZA', view: 'afrika',        fileSlug: 'tansania' },
  { answer: 'Nigeria',          omitA3: 'NGA', view: 'afrika',        fileSlug: 'nigeria' },
  { answer: 'Türkei',           omitA3: 'TUR', view: 'vorderasien',   fileSlug: 'tuerkei' },
  { answer: 'Saudi-Arabien',    omitA3: 'SAU', view: 'vorderasien',   fileSlug: 'saudi-arabien' },
  { answer: 'Iran',             omitA3: 'IRN', view: 'vorderasien',   fileSlug: 'iran' },
  { answer: 'Indien',           omitA3: 'IND', view: 'suedasien',     fileSlug: 'indien' },
  { answer: 'Sri Lanka',        omitA3: 'LKA', view: 'suedasien',     fileSlug: 'sri-lanka' },
  { answer: 'Japan',            omitA3: 'JPN', view: 'ostasien',      fileSlug: 'japan' },
  { answer: 'Südkorea',         omitA3: 'KOR', view: 'ostasien',      fileSlug: 'suedkorea' },
  { answer: 'Vietnam',          omitA3: 'VNM', view: 'suedostasien',  fileSlug: 'vietnam' },
  { answer: 'Thailand',         omitA3: 'THA', view: 'suedostasien',  fileSlug: 'thailand' },
  { answer: 'Philippinen',      omitA3: 'PHL', view: 'suedostasien',  fileSlug: 'philippinen' },
  { answer: 'Neuseeland',       omitA3: 'NZL', view: 'ozeanien',      fileSlug: 'neuseeland' },
  { answer: 'Papua-Neuguinea',  omitA3: 'PNG', view: 'ozeanien',      fileSlug: 'papua-neuguinea' },
];

// Points closer than this (px) to the previous one are dropped.
const MIN_STEP = 1;

const WATER = '#16213b';
const LAND = '#3b5a8c';
const LAND_STROKE = '#9bb6e0';
const MISSING = '#f4a261';
const MISSING_STROKE = '#c97a2c';

function generateSVGs(item: Item, features: GeoFeature[]): { question: string; solution: string } {
  const bbox = fitBboxToCanvas(VIEWS[item.view]);
  const proj = buildProjection(bbox);
  // Geometry is clipped to a box 40 % larger than the view, so the clip edges
  // (and the artifact segments along them) fall outside the visible frame.
  const renderBbox = expandBbox(bbox, 0.4);
  const omitted = findFeature(features, item.omitA3);
  const hidden = new Set([omitted, ...(item.alsoOmit ?? []).map((a3) => findFeature(features, a3))]);

  // One path carries fill and outline. Its closing segments run along the clip
  // box, which lies outside the visible frame, so they never show.
  function renderCountry(rings: number[][][], fill: string, stroke: string, strokeW: number): string[] {
    const clipped = clipRingsToBbox(rings, renderBbox, { dropFullSpan: true });
    if (clipped.length === 0) return [];
    const d = ringsToPath(clipped, proj, MIN_STEP);
    if (!d) return [];
    return [`  <path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${stroke}" stroke-width="${strokeW}" stroke-linejoin="round"/>`];
  }

  const landPaths: string[] = [];
  for (const f of features) {
    if (hidden.has(f)) continue;
    const rings = alignRingsToBbox(shiftLon(getRings(f)), renderBbox);
    const fb = bboxOfRings(rings);
    if (fb[2] < renderBbox[0] || fb[0] > renderBbox[2] || fb[3] < renderBbox[1] || fb[1] > renderBbox[3]) continue;
    landPaths.push(...renderCountry(rings, LAND, LAND_STROKE, 1.1));
  }

  // The label is placed in the answer's own feature; `alsoOmit` parts are only filled.
  const omittedPolys = shiftLonPolygons(getPolygons(omitted)).map((p) => alignRingsToBbox(p, renderBbox));
  const missingPaths: string[] = [];
  for (const f of hidden) {
    const rings = alignRingsToBbox(shiftLon(getRings(f)), renderBbox);
    missingPaths.push(...renderCountry(rings, MISSING, MISSING_STROKE, 1.6));
  }
  if (missingPaths.length === 0) throw new Error(`${item.answer} is outside the "${item.view}" view`);

  const init = labelInVisibleArea(omittedPolys, bbox);
  const font = computeFontSize(item.answer, init.inscribedRadius, bbox);
  const pos = clampLabelToBbox(init.lon, init.lat, font, item.answer, bbox, proj);
  const label = renderLabelAt(item.answer, pos.lon, pos.lat, font, proj);

  const frameX = PADDING;
  const frameY = PADDING;
  const frameW = SVG_WIDTH - 2 * PADDING;
  const frameH = SVG_HEIGHT - 2 * PADDING;

  const build = (extra: string[]): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}" overflow="hidden">
  <defs><clipPath id="frame"><rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameH}" rx="8"/></clipPath></defs>
  <rect width="${SVG_WIDTH}" height="${SVG_HEIGHT}" fill="#1a1a2e" rx="12"/>
  <rect x="${frameX}" y="${frameY}" width="${frameW}" height="${frameH}" fill="${WATER}" rx="8"/>
  <g clip-path="url(#frame)">
${[...landPaths, ...extra].join('\n')}
  </g>
</svg>
`;

  return { question: build([]), solution: build([...missingPaths, label]) };
}

async function main() {
  const features = await loadCountries();
  console.log(`Got ${features.length} country features`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Maps of countries that are no longer in `items` would stay behind as unused assets.
  const wanted = new Set(items.flatMap((i) => [`${i.fileSlug}.svg`, `${i.fileSlug}-loesung.svg`]));
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (file.endsWith('.svg') && !wanted.has(file)) {
      fs.rmSync(path.join(OUT_DIR, file));
      console.log(`✗ removed ${file}`);
    }
  }

  for (const item of items) {
    const { question, solution } = generateSVGs(item, features);
    fs.writeFileSync(path.join(OUT_DIR, `${item.fileSlug}.svg`), question);
    fs.writeFileSync(path.join(OUT_DIR, `${item.fileSlug}-loesung.svg`), solution);
    console.log(`✓ ${item.fileSlug}.svg + ${item.fileSlug}-loesung.svg  (${item.answer})`);
  }
  console.log(`\nWrote ${items.length * 2} SVGs to ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
