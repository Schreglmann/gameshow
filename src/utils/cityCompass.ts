/**
 * Geometry and neighbor selection for the `city-compass` game type
 * (see specs/games/city-compass.md).
 *
 * Everything here is a pure function of its arguments, which is what lets the show
 * and the admin preview draw the identical rose, and what makes an admin edit appear
 * on the running show as soon as the new config arrives.
 */

import type { CompassCity } from '@/types/config';
import { mulberry32 } from './questions';

/** Prominence tier of a city in the generated dataset, from most to least widely known. */
export type CityTier = 'capital' | 'metro' | 'major' | 'local';

/** One entry of the generated dataset — see src/data/cities.generated.ts. */
export interface City {
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  lat: number;
  lon: number;
  population: number;
  tier: CityTier;
}

export interface LatLon {
  lat: number;
  lon: number;
}

const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance in kilometres. */
export function haversineKm(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Compass bearing from `from` to `to` in degrees, 0 = north, clockwise.
 *
 * This is the initial bearing of the great circle, not the angle of the straight
 * line on a flat lat/lon grid. At the distances this game uses the two differ by
 * several degrees, which is enough to move a city into the wrong sector.
 */
export function initialBearingDeg(from: LatLon, to: LatLon): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLon = toRad(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest angle between two bearings, 0–180. */
export function angularGapDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Distance label for the compass. Rounded so it reads as an approximation — an exact
 * `183 km` would suggest a precision the game does not have, and would also hand out
 * more information than intended.
 */
export function formatDistanceKm(km: number): string {
  const step = km < 100 ? 5 : 10;
  return `${Math.max(step, Math.round(km / step) * step)} km`;
}

// ── Layout ────────────────────────────────────────────────────────────────────

/**
 * The rose is laid out in a fixed user space and then cropped: `layoutCompass` reports
 * the bounding box of everything it placed, and the SVG uses that as its viewBox. A
 * fixed box would have to be wide enough for the longest name a question could ever
 * carry, so every question without one drew a small ring inside wide empty margins.
 *
 * The box is kept symmetric around the center city horizontally, so the `?` lands in
 * the middle of the SVG and therefore in the middle of the screen — see `cropBox`.
 */
export const COMPASS_WIDTH = 1600;
export const COMPASS_HEIGHT = 1000;
const CENTER_X = COMPASS_WIDTH / 2;
const CENTER_Y = COMPASS_HEIGHT / 2;
const RING_RADIUS = 340;

/**
 * Type sizes, in user-space units, so the labels scale with the rose.
 *
 * They live here and not in the stylesheet because the crop box is computed from the
 * text extents: a size only the CSS knew about would either cut a name off or leave
 * the empty margins back in.
 */
export const LABEL_FONT_SIZE = 34;
export const DISTANCE_FONT_SIZE = 27;
export const UNKNOWN_FONT_SIZE = 58;
/** Size of the revealed city name, unless it has to shrink to fit its pill. */
const SOLUTION_FONT_SIZE = 38;
const MIN_SOLUTION_FONT_SIZE = 20;
/** Baseline distance between a neighbor's name and its distance line. */
export const LABEL_LINE_HEIGHT = 34;

/** Radius of the marker that stands in for the hidden center city. */
const CENTER_RADIUS = 44;
/** Clearance between the center marker (or the solution pill) and any line running
 *  into it — nothing is drawn across the answer. */
const CENTER_GAP = 20;
/** Labels beside the ring need less clearance than ones above or below it, where the
 *  text block would otherwise land on its own dot. */
const LABEL_GAP_SIDE = 26;
const LABEL_GAP_VERTICAL = 46;
/** Labels closer together than this in bearing are pushed onto different radii. */
const MIN_LABEL_GAP_DEG = 14;
const LABEL_LEVEL_OFFSET = 52;
const MAX_LABEL_LEVELS = 3;
/** Breathing room left around the cropped drawing. Less above and below, where the
 *  extents are a cap height and a descender rather than the generous estimate the
 *  label widths need, and where the show has the least room to spare. */
const BOX_PADDING_X = 28;
const BOX_PADDING_Y = 14;
/**
 * Average glyph advance as a fraction of the font size. Text cannot be measured
 * without a DOM, so the crop box estimates it — generously, because underestimating
 * crops a name while overestimating only leaves a little air.
 */
const CHAR_WIDTH_RATIO = 0.6;
const PILL_CHAR_WIDTH_RATIO = 0.62;
const PILL_PADDING_X = 28;
const PILL_HEIGHT = 68;
/**
 * The pill has to stay well inside the ring. `Klagenfurt am Wörthersee · AT` set at
 * the full solution size would be wider than the ring is across, and would cover the
 * dots it is supposed to sit between — so a long name shrinks instead.
 */
const MAX_PILL_WIDTH = 560;

export interface CompassNode {
  city: CompassCity;
  /** 0 = north, clockwise. */
  bearing: number;
  distanceKm: number;
  /** Dot on the ring, in SVG user units. */
  x: number;
  y: number;
  /** Inner end of the spoke — clear of the center marker or the solution pill. */
  spokeX: number;
  spokeY: number;
  /** Drawn length of the spoke; the draw-in animation dashes over exactly this. */
  spokeLength: number;
  /** Baseline of the first label line. A second line goes LABEL_LINE_HEIGHT below. */
  labelX: number;
  labelY: number;
  anchor: 'start' | 'middle' | 'end';
}

/** The crop the SVG renders, as a viewBox. */
export interface CompassViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompassLayout {
  cx: number;
  cy: number;
  ringRadius: number;
  centerRadius: number;
  nodes: CompassNode[];
  viewBox: CompassViewBox;
  /** The solution pill, or null while the center city is still hidden. */
  pill: { width: number; height: number; fontSize: number } | null;
  /** Radii at which the crosshair arms start, so they clear the center too. */
  grid: { horizontal: number; vertical: number };
}

export interface LayoutOptions {
  /** Whether a distance line is drawn, which decides how tall a label block is. */
  showDistances?: boolean;
  /**
   * The revealed center city, written into the middle instead of the `?`. Its width
   * decides how far the spokes have to stop short of the center.
   */
  solutionLabel?: string;
}

function polar(bearing: number, radius: number): { x: number; y: number } {
  const t = toRad(bearing);
  return { x: CENTER_X + radius * Math.sin(t), y: CENTER_Y - radius * Math.cos(t) };
}

/**
 * Assigns each node a label ring so that no two labels within MIN_LABEL_GAP_DEG of
 * each other share one. Levels are searched from the innermost outward, which keeps
 * the rose compact when the bearings happen to be well spread.
 */
function labelLevels(bearings: number[]): number[] {
  const order = bearings.map((bearing, index) => ({ bearing, index })).sort((a, b) => a.bearing - b.bearing);
  const levels = new Array<number>(bearings.length).fill(0);
  const placed: { bearing: number; level: number }[] = [];

  for (const { bearing, index } of order) {
    let level = 0;
    while (
      level < MAX_LABEL_LEVELS - 1 &&
      placed.some(p => p.level === level && angularGapDeg(p.bearing, bearing) < MIN_LABEL_GAP_DEG)
    ) {
      level += 1;
    }
    levels[index] = level;
    placed.push({ bearing, level });
  }
  return levels;
}

type Anchor = CompassNode['anchor'];

function anchorFor(bearing: number): Anchor {
  const sin = Math.sin(toRad(bearing));
  if (sin > 0.25) return 'start';
  if (sin < -0.25) return 'end';
  return 'middle';
}

/** Baseline of the first label line, given where the label's radial point landed. */
function firstBaseline(y: number, bearing: number, anchor: Anchor, lines: number): number {
  if (anchor !== 'middle') return y + 5 - ((lines - 1) * LABEL_LINE_HEIGHT) / 2;
  // Due north or due south: keep the whole block clear of the dot below or above it.
  return Math.cos(toRad(bearing)) > 0 ? y - 6 - (lines - 1) * LABEL_LINE_HEIGHT : y + 26;
}

/** The pill that holds the revealed center city, and the size its name is set at. */
function pillSize(label: string): { width: number; height: number; fontSize: number } {
  const perChar = Math.max(1, label.length) * PILL_CHAR_WIDTH_RATIO;
  const fontSize = Math.max(
    MIN_SOLUTION_FONT_SIZE,
    Math.min(SOLUTION_FONT_SIZE, (MAX_PILL_WIDTH - 2 * PILL_PADDING_X) / perChar),
  );
  const width = Math.min(MAX_PILL_WIDTH, Math.max(2 * CENTER_RADIUS, perChar * fontSize + 2 * PILL_PADDING_X));
  return { width, height: PILL_HEIGHT, fontSize };
}

/**
 * How far from the center a line pointing along `bearing` has to start to stay clear
 * of what sits in the middle — the round marker while the city is hidden, the wider
 * solution pill once it is revealed. Spokes converging on the answer used to run
 * straight through the text.
 *
 * The pill is a stadium shape, so its outline is the set of points at distance
 * `height / 2` from a horizontal spine. The ray either meets that spine's flank or
 * one of the two round caps.
 */
function centerInset(bearing: number, pill: { width: number; height: number } | null): number {
  if (!pill) return CENTER_RADIUS + CENTER_GAP;
  const radius = pill.height / 2 + CENTER_GAP;
  const spine = Math.max(0, pill.width / 2 - pill.height / 2);
  const dx = Math.abs(Math.sin(toRad(bearing)));
  const dy = Math.abs(Math.cos(toRad(bearing)));

  if (dy > 0) {
    const flank = radius / dy;
    if (flank * dx <= spine) return flank;
  }
  return spine * dx + Math.sqrt(Math.max(0, radius * radius - spine * spine * dy * dy));
}

/** Estimated width of a neighbor's label block. */
function labelWidth(node: { city: CompassCity; distanceKm: number }, showDistances: boolean): number {
  const name = node.city.name.length * LABEL_FONT_SIZE * CHAR_WIDTH_RATIO;
  if (!showDistances) return name;
  return Math.max(name, formatDistanceKm(node.distanceKm).length * DISTANCE_FONT_SIZE * CHAR_WIDTH_RATIO);
}

/**
 * The box around ring, dots and labels, padded — see COMPASS_WIDTH above.
 *
 * Horizontally it is then grown to sit symmetrically around the center city. The tight
 * box is what the drawing needs, but the labels around the ring are never symmetric,
 * so its middle is not the center city. The SVG is centered in the card, which put the
 * `?` beside the middle of the screen by however much the names on one side outran the
 * other. So each half-width is taken as the larger of the two, which centers the rose
 * at the cost of a little air on the shorter side.
 *
 * Vertically the box stays tight. Nothing is centered against the middle of the screen
 * on that axis — the card simply flows around the rose — and squaring up the taller
 * side there only adds empty space above or below the drawing, which is the dimension
 * the stage runs out of first.
 */
function cropBox(nodes: readonly CompassNode[], showDistances: boolean): CompassViewBox {
  let minX = CENTER_X - RING_RADIUS;
  let maxX = CENTER_X + RING_RADIUS;
  let minY = CENTER_Y - RING_RADIUS;
  let maxY = CENTER_Y + RING_RADIUS;

  const lines = showDistances ? 2 : 1;
  for (const node of nodes) {
    const width = labelWidth(node, showDistances);
    const left = node.anchor === 'start' ? node.labelX : node.anchor === 'end' ? node.labelX - width : node.labelX - width / 2;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, left + width);
    // Cap height above the first baseline, descender below the last one.
    minY = Math.min(minY, node.labelY - LABEL_FONT_SIZE * 0.8);
    maxY = Math.max(maxY, node.labelY + (lines - 1) * LABEL_LINE_HEIGHT + LABEL_FONT_SIZE * 0.3);
  }

  const halfWidth = Math.max(CENTER_X - minX, maxX - CENTER_X) + BOX_PADDING_X;

  return {
    x: CENTER_X - halfWidth,
    y: minY - BOX_PADDING_Y,
    width: 2 * halfWidth,
    height: maxY - minY + 2 * BOX_PADDING_Y,
  };
}

/**
 * Places every neighbor on the ring at its true bearing from the center city.
 *
 * `neighbors` is always the full list, even when the caller only draws the first few
 * of them: the crop box and the label rings are computed from all of them, so a
 * progressive reveal adds cities to a rose that stays exactly where it is instead of
 * resizing under the audience with every step.
 */
export function layoutCompass(
  center: LatLon,
  neighbors: readonly CompassCity[],
  options: LayoutOptions = {},
): CompassLayout {
  const showDistances = options.showDistances === true;
  const lines = showDistances ? 2 : 1;
  const pill = options.solutionLabel ? pillSize(options.solutionLabel) : null;
  const measured = neighbors.map(city => ({
    city,
    bearing: initialBearingDeg(center, city),
    distanceKm: haversineKm(center, city),
  }));
  const levels = labelLevels(measured.map(m => m.bearing));

  const nodes = measured.map((m, i) => {
    const dot = polar(m.bearing, RING_RADIUS);
    const inset = Math.min(centerInset(m.bearing, pill), RING_RADIUS);
    const spoke = polar(m.bearing, inset);
    const anchor = anchorFor(m.bearing);
    const gap = anchor === 'middle' ? LABEL_GAP_VERTICAL : LABEL_GAP_SIDE;
    const label = polar(m.bearing, RING_RADIUS + gap + (levels[i] ?? 0) * LABEL_LEVEL_OFFSET);
    return {
      ...m,
      x: dot.x,
      y: dot.y,
      spokeX: spoke.x,
      spokeY: spoke.y,
      spokeLength: RING_RADIUS - inset,
      labelX: label.x,
      labelY: firstBaseline(label.y, m.bearing, anchor, lines),
      anchor,
    };
  });

  return {
    cx: CENTER_X,
    cy: CENTER_Y,
    ringRadius: RING_RADIUS,
    centerRadius: CENTER_RADIUS,
    nodes,
    viewBox: cropBox(nodes, showDistances),
    pill,
    grid: { horizontal: centerInset(90, pill), vertical: centerInset(0, pill) },
  };
}

// ── Auto neighbor selection ───────────────────────────────────────────────────

export type CompassDifficulty = 'easy' | 'normal' | 'hard';

export const DEFAULT_NEIGHBOR_COUNT = 6;
export const MIN_NEIGHBOR_COUNT = 3;
export const MAX_NEIGHBOR_COUNT = 8;

/** The "Umgebung" of the game: nothing beyond this is offered. */
export const MAX_NEIGHBOR_DISTANCE_KM = 2000;
/** Below this a city is a suburb of the answer rather than a hint about it. */
const MIN_NEIGHBOR_DISTANCE_KM = 60;

/**
 * How far a city may be from the center to still be recognizable. A capital is a
 * useful hint from anywhere; a small Austrian town only says something to someone
 * who already has the region, so it is offered close to the center only.
 */
const MAX_DISTANCE_BY_TIER: Record<CityTier, number> = {
  capital: Infinity,
  metro: Infinity,
  major: 1200,
  local: 350,
};

const TIER_BONUS: Record<CityTier, number> = { capital: 3, metro: 2, major: 1, local: 0 };

/**
 * Distance bands the selection tries to cover before it fills the remaining slots.
 * A question made only of far cities is unsolvable; one made only of near cities
 * gives the region away at a glance.
 */
const BANDS: [number, number][] = [
  [MIN_NEIGHBOR_DISTANCE_KM, 300],
  [300, 800],
  [800, MAX_NEIGHBOR_DISTANCE_KM],
];

/** Minimum bearing gap between two picks, relaxed step by step if the slots cannot be filled. */
const SEPARATION_STEPS_DEG = [25, 18, 12, 0];

interface Weights {
  prominence: number;
  tier: number;
  /** Positive favors near cities, negative favors far ones. */
  near: number;
}

/**
 * Population is deliberately a weak term. It is meant as a coarse "would an audience
 * know this place" signal, and `log10` spans 3 to 7.3 — at full weight that alone
 * decides the ranking, so Moskau, Rom and Ankara won every slot they were eligible
 * for and every re-roll produced almost the same question. Prominence now mostly
 * comes from the tier, and the jitter below is large enough to shuffle cities that
 * are comparably well known.
 */
const WEIGHTS: Record<CompassDifficulty, Weights> = {
  easy: { prominence: 0.45, tier: 1.5, near: 2 },
  normal: { prominence: 0.45, tier: 1.2, near: 0.8 },
  hard: { prominence: 0.3, tier: 0.8, near: -1.2 },
};

/**
 * One slot is reserved for a `local` city — a regional town rather than a capital.
 *
 * Without it the tier is dead weight: a capital scores its population plus the
 * largest tier bonus, so a small town never wins a slot on score alone, and every
 * generated question ends up being six capitals. A single regional name is also the
 * strongest hint the game has, because it pins the region down at once. `hard` opts
 * out, which is what makes it hard.
 */
const DIFFICULTIES_WITH_LOCAL_ANCHOR: CompassDifficulty[] = ['easy', 'normal'];

/**
 * The regional slot uses its own scoring, because the main one settles it badly in
 * both directions. Weighed on population, a distant larger town always beats a near
 * one — and GeoNames counts only the core municipality, which understates Austrian
 * towns badly (Wels is listed at 16,857 against a real 62,000), so a German town of
 * the same real size wins the slot even in a question about an Austrian city.
 * Weighed on distance alone it picks the nearest name at any cost, which lands on
 * commuter suburbs nobody outside the city recognizes.
 *
 * So it trades one order of magnitude of population against this many kilometres.
 * Where one town clearly wins that trade it also wins every re-roll, which is the
 * intended outcome — the variety comes from the other slots, and swapping in a
 * weaker name for its own sake would only make the question worse.
 */
const LOCAL_ANCHOR_KM_PER_DEX = 150;

/** Wide enough to reorder equally well-known cities between seeds, so "neu würfeln"
 *  gives a genuinely different question rather than the same names in a new order. */
const JITTER = 1.8;

export interface PickNeighborsOptions {
  count?: number;
  /** Same seed, same selection. The re-roll button passes a new one. */
  seed?: number;
  difficulty?: CompassDifficulty;
}

function stableHash(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

interface Candidate {
  city: City;
  distanceKm: number;
  bearing: number;
  score: number;
  /** Kept separate from `score` so the regional slot can weigh it on its own terms. */
  jitter: number;
}

/**
 * Picks the cities that surround `center`, preferring ones an audience knows while
 * keeping the constellation readable: bearings spread apart, distances spread across
 * the bands. Returned sorted by descending distance, so a progressive reveal starts
 * with the vague far city and ends with the telling near one.
 */
export function pickNeighbors(
  center: LatLon & { name?: string },
  cities: readonly City[],
  options: PickNeighborsOptions = {},
): CompassCity[] {
  const count = Math.min(MAX_NEIGHBOR_COUNT, Math.max(MIN_NEIGHBOR_COUNT, options.count ?? DEFAULT_NEIGHBOR_COUNT));
  const seed = options.seed ?? 1;
  const weights = WEIGHTS[options.difficulty ?? 'normal'];

  const candidates: Candidate[] = [];
  for (const city of cities) {
    if (city.name === center.name) continue;
    const distanceKm = haversineKm(center, city);
    if (distanceKm < MIN_NEIGHBOR_DISTANCE_KM || distanceKm > MAX_NEIGHBOR_DISTANCE_KM) continue;
    if (distanceKm > MAX_DISTANCE_BY_TIER[city.tier]) continue;

    const prominence = Math.log10(Math.max(1000, city.population));
    const nearness = 1 - distanceKm / MAX_NEIGHBOR_DISTANCE_KM;
    const jitter = mulberry32(stableHash(`${city.name}|${city.country}`) ^ seed)() * JITTER;
    candidates.push({
      city,
      distanceKm,
      bearing: initialBearingDeg(center, city),
      score: weights.prominence * prominence + weights.tier * TIER_BONUS[city.tier] + weights.near * nearness + jitter,
      jitter,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const picked: Candidate[] = [];
  const fits = (candidate: Candidate, minGap: number): boolean =>
    !picked.includes(candidate) && picked.every(p => angularGapDeg(p.bearing, candidate.bearing) >= minGap);

  const wantsLocal = DIFFICULTIES_WITH_LOCAL_ANCHOR.includes(options.difficulty ?? 'normal');
  const localScore = (c: Candidate): number =>
    Math.log10(Math.max(1000, c.city.population)) - c.distanceKm / LOCAL_ANCHOR_KM_PER_DEX + c.jitter * 0.5;
  const localCandidates = candidates
    .filter(c => c.city.tier === 'local')
    .sort((a, b) => localScore(b) - localScore(a));

  for (const minGap of SEPARATION_STEPS_DEG) {
    if (wantsLocal && picked.length < count && !picked.some(p => p.city.tier === 'local')) {
      const anchor = localCandidates.find(c => fits(c, minGap));
      if (anchor) picked.push(anchor);
    }
    // Cover the bands, then fill up. Both passes take the best-scoring fit.
    for (const [from, to] of BANDS) {
      if (picked.length >= count) break;
      if (picked.some(p => p.distanceKm >= from && p.distanceKm < to)) continue;
      const fit = candidates.find(c => c.distanceKm >= from && c.distanceKm < to && fits(c, minGap));
      if (fit) picked.push(fit);
    }
    for (const candidate of candidates) {
      if (picked.length >= count) break;
      if (fits(candidate, minGap)) picked.push(candidate);
    }
    if (picked.length >= count) break;
  }

  return picked
    .sort((a, b) => b.distanceKm - a.distanceKm)
    .map(({ city }) => ({ name: city.name, lat: city.lat, lon: city.lon, country: city.country }));
}
