/**
 * Geometry of the `venn` game type ("Schnittmenge"): two overlapping circles side by
 * side, an optional third below them, each with its category name outside the circle,
 * and one focus point in the area all visible circles share.
 *
 * Everything is in SVG user units on a canvas 1000 wide. The category names stand
 * OUTSIDE the circles (above the upper two, below the third): a German compound like
 * "Programmiersprache" does not fit the crescent a circle keeps to itself, and a name
 * shrunk until it does is unreadable from the back of a room.
 *
 * Pure, so the show, the admin preview and the theme showcase draw the same picture
 * and the layout can be unit-tested without a DOM. See specs/games/venn.md.
 */

export const VENN_WIDTH = 1000;
export const VENN_MIN_SETS = 2;
export const VENN_MAX_SETS = 3;

const RADIUS = 250;
/** Distance between two circle centers; the overlap lens is `2 * RADIUS - SPACING` wide. */
const SPACING = 320;
/** Room above the upper circles for two lines of label. */
const TOP_BAND = 124;
/** Room below the third circle for two lines of label. */
const BOTTOM_BAND = 124;
const BOTTOM_PADDING = 24;

const LEFT_X = VENN_WIDTH / 2 - SPACING / 2;
const RIGHT_X = VENN_WIDTH / 2 + SPACING / 2;
const UPPER_Y = TOP_BAND + RADIUS;
/** The three centers form an equilateral triangle, so every pair overlaps alike. */
const TRIANGLE_HEIGHT = Math.sqrt(SPACING * SPACING - (SPACING / 2) * (SPACING / 2));
const LOWER_Y = UPPER_Y + TRIANGLE_HEIGHT;

/** Average glyph width of the bold UI font, as a share of the font size. */
const CHAR_WIDTH = 0.58;
const LABEL_MAX_FONT = 46;
const LABEL_MIN_FONT = 24;
const LABEL_LINE_HEIGHT = 1.14;
/** Each upper label has one half of the canvas, minus a gap in the middle. */
const UPPER_LABEL_WIDTH = 450;
const LOWER_LABEL_WIDTH = 880;

export const VENN_UNKNOWN_FONT_SIZE = 120;
const PILL_MAX_FONT = 62;
const PILL_MIN_FONT = 28;
const PILL_MAX_WIDTH = 760;

export interface VennLabel {
  lines: string[];
  /** Horizontal center of every line. */
  x: number;
  /** Baseline of each line, top to bottom. */
  ys: number[];
  fontSize: number;
}

export interface VennCircle {
  cx: number;
  cy: number;
  r: number;
  label: VennLabel;
}

export interface VennPill {
  width: number;
  height: number;
  fontSize: number;
}

export interface VennLayout {
  width: number;
  height: number;
  circles: VennCircle[];
  /** Center of the area shared by the first `n` circles, indexed by `n` (2 or 3). */
  focus: Record<number, { x: number; y: number }>;
  pill: VennPill | null;
}

/**
 * Break a category name into at most two lines at a space or after a hyphen, as
 * evenly as possible. A name without a break point stays on one line and shrinks.
 */
export function wrapVennLabel(text: string): string[] {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 14) return [trimmed];
  const breaks: number[] = [];
  for (let i = 1; i < trimmed.length - 1; i++) {
    if (trimmed[i] === ' ') breaks.push(i);
    else if (trimmed[i] === '-' && trimmed[i + 1] !== ' ') breaks.push(i + 1);
  }
  if (breaks.length === 0) return [trimmed];
  let best = breaks[0]!;
  for (const b of breaks) {
    if (Math.abs(b - trimmed.length / 2) < Math.abs(best - trimmed.length / 2)) best = b;
  }
  return [trimmed.slice(0, best).trim(), trimmed.slice(best).trim()];
}

function fitFont(lines: string[], maxWidth: number): number {
  const longest = Math.max(1, ...lines.map(l => l.length));
  return Math.max(LABEL_MIN_FONT, Math.min(LABEL_MAX_FONT, maxWidth / (longest * CHAR_WIDTH)));
}

/**
 * A label above one of the upper circles. It is centered on its circle where that
 * fits, and pushed outward only as far as it must be to stay clear of the middle
 * (where the other label would touch it) and of the canvas edge.
 */
function upperLabel(text: string, side: 'left' | 'right'): VennLabel {
  const lines = wrapVennLabel(text);
  const fontSize = fitFont(lines, UPPER_LABEL_WIDTH);
  const halfWidth = (Math.max(1, ...lines.map(l => l.length)) * fontSize * CHAR_WIDTH) / 2;
  const middleGap = 14;
  const x = side === 'left'
    ? Math.max(halfWidth + 8, Math.min(LEFT_X, VENN_WIDTH / 2 - middleGap - halfWidth))
    : Math.min(VENN_WIDTH - halfWidth - 8, Math.max(RIGHT_X, VENN_WIDTH / 2 + middleGap + halfWidth));
  // Bottom-aligned: the last line sits just above the circle, a second line stacks
  // upward, so a one-line and a two-line name both hug their circle.
  const lastBaseline = TOP_BAND - 22;
  const ys = lines.map((_, i) => lastBaseline - (lines.length - 1 - i) * fontSize * LABEL_LINE_HEIGHT);
  return { lines, x, ys, fontSize };
}

function lowerLabel(text: string): VennLabel {
  const lines = wrapVennLabel(text);
  const fontSize = fitFont(lines, LOWER_LABEL_WIDTH);
  const firstBaseline = LOWER_Y + RADIUS + 16 + fontSize;
  const ys = lines.map((_, i) => firstBaseline + i * fontSize * LABEL_LINE_HEIGHT);
  return { lines, x: VENN_WIDTH / 2, ys, fontSize };
}

export function layoutVenn(sets: readonly string[], options: { solutionLabel?: string } = {}): VennLayout {
  const names = sets.slice(0, VENN_MAX_SETS);
  const circles: VennCircle[] = [];
  if (names[0] !== undefined) {
    circles.push({ cx: LEFT_X, cy: UPPER_Y, r: RADIUS, label: upperLabel(names[0], 'left') });
  }
  if (names[1] !== undefined) {
    circles.push({ cx: RIGHT_X, cy: UPPER_Y, r: RADIUS, label: upperLabel(names[1], 'right') });
  }
  if (names[2] !== undefined) {
    circles.push({ cx: VENN_WIDTH / 2, cy: LOWER_Y, r: RADIUS, label: lowerLabel(names[2]) });
  }

  // The height follows the number of sets the QUESTION has, not how many are on
  // screen: a diagram that grew when the hint circle arrived would push the answer
  // (and everything below the card) down mid-question.
  const height = names.length >= 3
    ? LOWER_Y + RADIUS + BOTTOM_BAND
    : UPPER_Y + RADIUS + BOTTOM_PADDING;

  let pill: VennPill | null = null;
  const solution = options.solutionLabel?.trim();
  if (solution) {
    const fontSize = Math.max(
      PILL_MIN_FONT,
      Math.min(PILL_MAX_FONT, (PILL_MAX_WIDTH - 80) / (solution.length * CHAR_WIDTH)),
    );
    pill = {
      fontSize,
      width: Math.min(VENN_WIDTH - 40, solution.length * fontSize * CHAR_WIDTH + fontSize * 1.5),
      height: fontSize * 1.8,
    };
  }

  return {
    width: VENN_WIDTH,
    height,
    circles,
    focus: {
      2: { x: VENN_WIDTH / 2, y: UPPER_Y },
      // Centroid of the triangle of centers — the middle of the triple overlap.
      3: { x: VENN_WIDTH / 2, y: UPPER_Y + TRIANGLE_HEIGHT / 3 },
    },
    pill,
  };
}
