/* Compose the "Halloween" theme's (id `maerchen`) enchanted-forest background and (optionally) bake it
 * into the `[data-theme="maerchen"]::after` rule in src/styles/themes.css.
 *
 * SCENE: you stand in a dark enchanted forest at night, looking out along a path to a cursed
 * castle. ONE place, ONE silhouette style; depth comes from layering, with atmospheric
 * perspective (farther = lighter and hazier plum, nearer = darker):
 *   - SKY        transparent (the theme's ::before star field shows through), except a big pale
 *                MOON with a soft halo (a faint blood-red ring in it) and a dark cloud wisp.
 *   - DISTANCE   moonlit far hills; on the highest one, at the far RIGHT, a crooked castle
 *                silhouetted against the moon (a tall keep, a slim tower on the right,
 *                a roofless turret, a torn flag, a few sickly-green windows — the CSS glow layers
 *                flicker over them, see WINDOWS), a green mist at its foot. A thin far tree line
 *                of firs + bare trees.
 *   - MIDDLE     a fog band; a mid tree line on both sides leaving the valley to the castle open;
 *                a moonlit PATH winding from the foreground up the castle hill, a crooked
 *                graveyard beside it.
 *   - FOREGROUND two big GNARLED TREES framing the left and right edges (roots, twisted trunk,
 *                claw branches reaching inward, dead moss hanging off them, complete crowns inside
 *                the band — the band is bottom-anchored, so anything cut at its top edge would
 *                float), a knot-hole in the left trunk, a gaunt face in the right one, ravens,
 *                undergrowth along the floor, toadstools at the left roots and a crooked signpost
 *                by the path. The JS driver (src/utils/maerchenCreatures.ts) opens red EYES in the
 *                knot-hole, the face's sockets and the undergrowth gaps (EYE_SPOTS).
 *
 * The middle of the band stays low and calm — content sits there.
 *
 * Every tree, root and twig comes from ONE primitive, `limb()`: a tapered, smoothly outlined
 * polygon along a gnarled spine, recursively branching. That keeps the whole forest in one
 * shape language.
 *
 * QUALITY DISCIPLINE (from the Hogwarts and dungeon scenes): FLAT vector + SVG gradients only —
 * NO SVG filters (they don't render identically under `sharp`). Deterministic mulberry32 PRNG
 * only (no clock/random) so the baked data-URI is reproducible.
 *
 * Usage (from repo root):
 *   node scripts/generate-maerchen-scene.cjs              # preview PNG to $TMPDIR
 *   node scripts/generate-maerchen-scene.cjs --png out.png
 *   node scripts/generate-maerchen-scene.cjs --write-css  # bake into themes.css
 */
'use strict';
const fs = require('fs');
const path = require('path');

const VW = 1600, VH = 640;

// ── palette: atmospheric perspective, far → near ──
const MOON = '#f0d49a', MOON_SHADE = '#d8b57a'; // a warm harvest moon
const FAR_HILL = '#2d1d44';
const FAR_TREES = '#26173a';
const CASTLE = '#1d1129', CASTLE_RIM = '#5a4878';
const MID_HILL = '#1c1029';
const MID_TREES = '#150c20';
const PATH_FAR = '#33224a', PATH_LIT = '#382750', PATH_DK = '#1d1229';
const NEAR = '#0b0712';     // foreground ground — MUST match the bottom stop of the body gradient (seam rule)
const TREE = '#09050e';     // foreground trees, a hair darker than the ground
const RIM = '#3b2c52';      // faint moonlit rim on the foreground silhouettes

// The castle is drawn in its own coordinates (foot at y=470) and placed by this transform.
// It sits at the far right (scene x ≈ 1307–1586): a question card covers the middle of the
// screen (at 1920px wide it ends at scene x ≈ 1383), so the keep, its spire and the moon behind
// it stay visible while a question is up.
const CASTLE_T = { dx: 461, dy: -3, s: 0.74 };
const MOON_C = { x: 1432, y: 162, r: 66 };
// Each big tree grows from its own seed — picked from rendered variants for a good silhouette.
const TREE_SEEDS = { left: 418916, right: 3 };

// lit windows in castle coordinates; WINDOWS (exported) is the on-scene position
const CASTLE_WINDOWS = [[1166, 352], [1296, 262], [1296, 300], [1236, 410], [1424, 330], [1352, 420]];
const toScene = ([x, y]) => [Math.round(x * CASTLE_T.s + CASTLE_T.dx), Math.round(y * CASTLE_T.s + CASTLE_T.dy)];
const WINDOWS = CASTLE_WINDOWS.map(toScene);
// eye spots — the left trunk's knot-hole, the eye sockets of the face in the right trunk and
// dark undergrowth gaps (must match EYE_SPOTS in src/utils/maerchenCreatures.ts)
// the knot-hole and the face sit on the trunks; their positions come from the trunk spines (set
// in buildSvg)
const KNOT = { x: 0, y: 0 };
const FACE = { x: 0, y: 0 };
// undergrowth tufts along the foreground floor — the other eye spots sit inside them
const TUFTS = [[300, 7], [470, 6], [612, 5], [1120, 6], [1250, 6], [1380, 7]];
const EYE_SPOTS = [[0, 0], [0, 0], ...TUFTS.map(([x]) => [x, 604])];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f2 = (v) => (Math.round(v * 10) / 10).toString();
const pt = (p) => `${f2(p[0])} ${f2(p[1])}`;

// Catmull-Rom → cubic Bézier segments through pts (continuing from pts[0]).
function curveThrough(pts) {
  let d = '';
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d;
}
const openCurve = (pts) => `M ${pt(pts[0])}${curveThrough(pts)}`;
// a filled mass: ridge curve, then down to the bottom edge and back
const massPath = (pts) => `${openCurve(pts)} L ${f2(pts[pts.length - 1][0])} ${VH + 2} L ${f2(pts[0][0])} ${VH + 2} Z`;

/* ── the ONE tree primitive ──
 * A limb grows from (x,y) at angle `ang` (radians, -π/2 = straight up) for `len` px, tapering
 * from width w0 to w1. Its spine wanders (`gnarl`) and curls (`curl` rad/step); children sprout
 * along it while `depth` > 0. Output: smooth filled outlines pushed onto `out`.
 * `bias(a)` optionally nudges the direction each step (e.g. toward the scene centre). */
function limb(out, rng, x, y, ang, len, w0, w1, depth, o) {
  o.top ??= depth; // the generation the tree started with (the trunk)
  const gen = o.top - depth; // 0 = trunk, 1 = main limbs, …
  const steps = Math.max(3, Math.round(len / 18));
  const step = len / steps;
  const spine = [[x, y]];
  const angs = [ang];
  let a = ang;
  // higher generations wander and curl more: a steady trunk, twisting arms, crooked fingers
  const gnarl = (o.gnarl ?? 0.3) * (1 + gen * 0.4);
  const curl = (rng() < 0.5 ? -1 : 1) * (0.5 + rng() * 0.5) * (o.curl ?? 0.04) * (1 + gen * 0.6);
  for (let i = 1; i <= steps; i++) {
    a += (rng() - 0.5) * gnarl + curl + (o.bias ? o.bias(a, x, y) : 0);
    // no limb may droop steeply toward the ground — level it off instead
    if (gen > 0 && Math.sin(a) > 0.3) a += Math.cos(a) > 0 ? -0.14 : 0.14;
    x += Math.cos(a) * step; y += Math.sin(a) * step;
    spine.push([x, y]); angs.push(a);
  }
  // the trunk tapers gently; arms and twigs stay thick for longer and then thin out to a point
  const taper = gen === 0 ? 1.2 : 0.85;
  const widthAt = (i) => w1 + (w0 - w1) * Math.pow(1 - i / steps, taper);
  const L = [], R = [];
  for (let i = 0; i <= steps; i++) {
    const w = widthAt(i);
    const [px, py] = spine[i];
    const na = angs[i] + Math.PI / 2;
    // knobbly bark: a little width noise
    const ww = (w / 2) * (1 + (rng() - 0.5) * (o.knob ?? 0.12));
    L.push([px + Math.cos(na) * ww, py + Math.sin(na) * ww]);
    R.push([px - Math.cos(na) * ww, py - Math.sin(na) * ww]);
  }
  const tip = spine[steps];
  // callers can collect every limb's spine (perches, hanging moss)
  o.spines?.push({ gen, spine, angs, w: spine.map((_, i) => widthAt(i)) });
  out.push(`M ${pt(L[0])}${curveThrough(L)} L ${pt(tip)} L ${pt(R[steps])}${curveThrough(R.slice().reverse())} Z`);
  if (depth <= 0) return spine;
  // children end at a third of their start width (a LEADER continues from their tip) unless
  // they are the last generation, which tapers to a point
  const childW1 = (w) => (depth - 1 > 0 ? w * 0.34 : 1);
  // the leader: continues this limb from its (blunt) tip, so no branch ever ends in a stump
  {
    const w = widthAt(steps) * 1.05;
    limb(out, rng, tip[0], tip[1], angs[steps] + (rng() - 0.5) * 0.5, len * (0.55 + rng() * 0.2), w, childW1(w), depth - 1, o);
  }
  const kids = o.kids ? o.kids(depth) : 1 + Math.floor(rng() * 2);
  for (let k = 0; k < kids; k++) {
    // the trunk forks in its upper half into long arms; side limbs sprout along the arms
    const t = gen === 0 ? 0.45 + rng() * 0.45 : 0.25 + rng() * 0.6;
    const i = Math.min(steps - 1, Math.max(1, Math.round(t * steps)));
    const side = k % 2 === 0 ? 1 : -1;
    const ca = angs[i] + side * (0.4 + rng() * 0.55);
    const lf = gen === 0 ? 0.75 + rng() * 0.25 : 0.45 + rng() * 0.25;
    const w = widthAt(i) * 0.62;
    limb(out, rng, spine[i][0], spine[i][1], ca, len * lf, w, childW1(w), depth - 1, o);
  }
  return spine;
}
const limbsPath = (parts, fill, extra = '') => `<path d='${parts.join(' ')}' fill='${fill}'${extra}/>`;

/* A big foreground tree. `side` = +1 grows from the LEFT edge leaning in, -1 from the right. */
function bigTree(rng, baseX, baseY, side, height, keepOut, lean = 0.18) {
  const parts = [];
  const spines = [];
  const inward = side; // +1 → branches favour the right (toward the centre)
  // trunk: leans in, gnarled; branches reach inward and up, the outer ones droop like claws
  const trunk = limb(parts, rng, baseX, baseY, -Math.PI / 2 + side * lean, height, 80, 30, 3, {
    gnarl: 0.16, curl: 0.05, knob: 0.18, spines,
    kids: (d) => (d === 3 ? 3 : d === 2 ? 2 : 2),
    // drift inward, and bend back down near the band's top edge so no crown gets cut off
    bias: (a, x, y) => (Math.cos(a) * inward < 0.2 ? inward * 0.014 : 0) + (y < 90 ? 0.12 * Math.sign(Math.cos(a) || inward) : 0) + (keepOut ? keepOut(a, x, y) : 0),
  });
  // roots: spread along the ground both ways, ends sinking into the soil
  for (const dir of [-1, 1, -1, 1]) {
    // pointing outward and slightly down (y grows downward), so the ends sink into the soil
    const a = dir < 0 ? Math.PI - (0.15 + rng() * 0.25) : 0.15 + rng() * 0.25;
    limb(parts, rng, baseX + dir * 10, baseY - 14, a, 60 + rng() * 60, 30, 9, 1, {
      gnarl: 0.22, curl: 0.02, kids: () => 0, bias: () => 0.012 * (dir < 0 ? -1 : 1),
    });
  }
  return { parts, trunk, spines };
}

/* Dead moss hanging from the near-level stretches of a tree's branches: thin strands that sway a
 * little on their way down. */
function hangingMoss(rng, spines, chance) {
  const parts = [];
  for (const { gen, spine, angs, w } of spines) {
    if (gen === 0) continue;
    for (let i = 1; i < spine.length - 1; i++) {
      if (Math.abs(Math.sin(angs[i])) > 0.45 || w[i] < 3 || rng() > chance) continue;
      const [x, y] = spine[i];
      limb(parts, rng, x, y + w[i] * 0.3, Math.PI / 2 + (rng() - 0.5) * 0.3, 14 + rng() * 34, Math.min(3.2, w[i] * 0.6), 0.5, 0, { gnarl: 0.3, curl: 0.03 });
    }
  }
  return parts;
}

/* A raven perched with its feet at (x,y), facing left (dir=-1) or right (1). */
function raven(x, y, dir, s = 1) {
  return `<g transform='translate(${f2(x)} ${f2(y)}) scale(${dir * s} ${s})'>` +
    // body with folded wings, tail sticking out behind and down, head + heavy beak, legs
    `<path d='M -1 -2 C -7 -3 -12 -7 -14 -11 L -22 -6 L -20 -9 L -24 -8 L -15 -14 C -13 -19 -6 -23 1 -23 ` +
    `C 3 -27 7 -29 10 -27 C 12 -26 13 -25 13.5 -24 L 20 -22.5 L 13 -21 C 12 -18 9 -13 6 -9 C 4 -6 2 -4 1 -2 Z' fill='${TREE}'/>` +
    `<path d='M -2 -2 L -3 1 M 1 -2 L 1.5 1' stroke='${TREE}' stroke-width='1.4'/>` +
    // a faint moonlit edge along the back, and a pale eye
    `<path d='M -15 -14 C -13 -19 -6 -23 1 -23 C 3 -27 7 -29 10 -27' stroke='${RIM}' stroke-width='1.2' fill='none' opacity='0.8'/>` +
    `<circle cx='9.5' cy='-24.5' r='0.9' fill='#b8a48a' opacity='0.8'/>` +
    `</g>`;
}

/* A crooked graveyard along the path: weathered stones, a cross and a broken slab. */
function graves(ridgeAt, xs) {
  const shapes = [
    (h) => `M -6 0 L -6 ${-h + 6} Q -6 ${-h} 0 ${-h} Q 6 ${-h} 6 ${-h + 6} L 6 0 Z`,
    (h) => `M -1.6 0 L -1.6 ${-h + 9} L -6.5 ${-h + 9} L -6.5 ${-h + 6} L -1.6 ${-h + 6} L -1.6 ${-h} L 1.6 ${-h} L 1.6 ${-h + 6} L 6.5 ${-h + 6} L 6.5 ${-h + 9} L 1.6 ${-h + 9} L 1.6 0 Z`,
    (h) => `M -5 0 L -5 ${-h} L 1 ${-h + 3} L 3 ${-h + 1} L 5 ${-h + 4} L 5 0 Z`,
  ];
  let s = `<g fill='${MID_TREES}' stroke='#2e1f42' stroke-width='1' stroke-linejoin='round'>`;
  for (const [x, kind, h, tilt] of xs) {
    s += `<path transform='translate(${x} ${f2(ridgeAt(x) + 3)}) rotate(${tilt}) scale(1.4)' d='${shapes[kind](h)}'/>`;
  }
  return s + `</g>`;
}

/* A gaunt face grown into a trunk: slanted eye sockets 18px apart (the eye sprite's pupil
 * spacing, so the red eyes light up inside them) and a long gaping mouth. */
function treeFace(x, y) {
  const socket = (cx, slant) =>
    `<path transform='rotate(${slant} ${cx} ${y})' d='M ${cx - 9.5} ${y} Q ${cx} ${y - 10} ${cx + 9.5} ${y} Q ${cx} ${y + 8} ${cx - 9.5} ${y} Z'/>`;
  const mouth = `M ${x - 7} ${y + 20} C ${x - 9} ${y + 30} ${x - 6} ${y + 44} ${x - 1} ${y + 50} C ${x + 4} ${y + 44} ${x + 8} ${y + 32} ${x + 6} ${y + 20} ` +
    `C ${x + 3} ${y + 17} ${x - 4} ${y + 17} ${x - 7} ${y + 20} Z`;
  // a faint moonlit lip along the upper edge of each hollow, then the hollows themselves, lit
  // from deep inside by a dull ember (black-on-black would not read as a hole)
  return `<g fill='#5a4878' opacity='0.75' transform='translate(0 -2)'>${socket(x - 9, 12)}${socket(x + 9, -12)}<path d='${mouth}'/></g>` +
    `<g fill='url(#ember)'>${socket(x - 9, 12)}${socket(x + 9, -12)}</g><path d='${mouth}' fill='url(#emberMouth)'/>` +
    // the brow: two furrows sloping down to the nose, bark knots for cheekbones
    `<path d='M ${x - 19} ${y - 10} Q ${x - 9} ${y - 12} ${x - 2} ${y - 6} M ${x + 19} ${y - 10} Q ${x + 9} ${y - 12} ${x + 2} ${y - 6}` +
    ` M ${x - 14} ${y + 14} Q ${x - 10} ${y + 22} ${x - 12} ${y + 30} M ${x + 14} ${y + 14} Q ${x + 10} ${y + 22} ${x + 12} ${y + 30}' ` +
    `stroke='#4a3a66' stroke-width='1.8' fill='none' opacity='0.8' stroke-linecap='round'/>`;
}

/* Small bare tree for the far / mid tree lines. */
function smallTree(rng, x, y, h) {
  const parts = [];
  limb(parts, rng, x, y + 2, -Math.PI / 2 + (rng() - 0.5) * 0.2, h * 0.55, Math.max(2.5, h * 0.09), Math.max(1, h * 0.03), 2, {
    gnarl: 0.35, curl: 0.05, kids: () => 1 + Math.floor(rng() * 2),
  });
  return parts;
}
/* Fir silhouette: a narrow, ragged spire of drooping, uneven spikes (not stacked cones). */
function fir(rng, x, y, h) {
  const w = h * (0.24 + rng() * 0.08);
  const n = Math.max(5, Math.round(h / 8));
  const side = (dir) => {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const yy = y - h * 0.12 - h * 0.86 * t;
      const ww = w * (1 - t) * (0.6 + rng() * 0.6);
      pts.push([x + dir * ww, yy + h * 0.035], [x + dir * ww * 0.25, yy - (h * 0.86) / n / 2]);
    }
    return pts;
  };
  const L = side(-1), R = side(1).reverse();
  return `M ${f2(x - 1.5)} ${f2(y)}` + [...L, [x, y - h], ...R].map((p) => ` L ${pt(p)}`).join('') + ` L ${f2(x + 1.5)} ${f2(y)} Z`;
}

/* A tree line along a ridge: mixes firs and bare trees, skipping the gap [gap0, gap1]. */
function treeLine(rng, ridgeAt, x0, x1, hMin, hMax, density, gap, firShare = 0.55) {
  const parts = [];
  let x = x0;
  while (x < x1) {
    if (!gap || x < gap[0] || x > gap[1]) {
      const h = hMin + rng() * (hMax - hMin);
      const y = ridgeAt(x);
      if (rng() < firShare) parts.push(fir(rng, x, y, h));
      else parts.push(...smallTree(rng, x, y, h * 0.9));
    }
    x += density * (0.5 + rng());
  }
  return parts;
}
// linear interpolation along a ridge polyline (for placing trees on it)
const ridgeFn = (pts) => (x) => {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    if (x >= ax && x <= bx) { const t = (x - ax) / (bx - ax); return ay + (by - ay) * (0.5 - Math.cos(Math.PI * t) / 2); }
  }
  return pts[x < pts[0][0] ? 0 : pts.length - 1][1];
};

function moon() {
  const { x, y, r } = MOON_C;
  // the halo must end INSIDE the band (radius < y): the scene's top edge would otherwise cut
  // it off as a hard horizontal line across the sky
  return `<circle cx='${x}' cy='${y}' r='${y - 4}' fill='url(#moonHalo)'/>` +
    `<circle cx='${x}' cy='${y}' r='${y - 4}' fill='url(#bloodRing)'/>` +
    `<circle cx='${x}' cy='${y}' r='${r}' fill='url(#moonDisc)'/>` +
    `<circle cx='${x - 20}' cy='${y - 13}' r='11' fill='${MOON_SHADE}' opacity='0.55'/>` +
    `<circle cx='${x + 18}' cy='${y + 20}' r='7' fill='${MOON_SHADE}' opacity='0.5'/>` +
    `<circle cx='${x + 26}' cy='${y - 24}' r='5' fill='${MOON_SHADE}' opacity='0.45'/>` +
    // a dark cloud wisp crossing the moon
    `<path d='M ${x - 140} ${y + 16} C ${x - 84} ${y - 4} ${x - 36} ${y + 22} ${x + 10} ${y + 9} C ${x + 56} ${y - 4} ${x + 104} ${y + 15} ${x + 160} ${y + 5} ` +
    `C ${x + 112} ${y + 25} ${x + 56} ${y + 21} ${x + 10} ${y + 28} C ${x - 38} ${y + 35} ${x - 94} ${y + 26} ${x - 140} ${y + 16} Z' fill='#1f122c' opacity='0.85'/>`;
}

// Cone roof with a crooked apex.
const roof = (x0, x1, base, apexX, apexY) =>
  `M ${f2(x0 - 7)} ${f2(base)} Q ${f2((x0 + apexX) / 2 - 2)} ${f2((base + apexY) / 2 + 6)} ${f2(apexX)} ${f2(apexY)} Q ${f2((x1 + apexX) / 2 + 4)} ${f2((base + apexY) / 2 + 10)} ${f2(x1 + 7)} ${f2(base)} Z`;

function castle() {
  const parts = [];
  parts.push(`M 1176 478 L 1176 372 L 1470 372 L 1470 478 Z`);
  for (let i = 0; i < 10; i++) parts.push(`M ${1176 + i * 30} 372 l 0 -15 l 17 0 l 0 15 Z`);
  parts.push(`M 1144 478 L 1144 332 L 1192 332 L 1192 478 Z`);
  parts.push(roof(1144, 1192, 334, 1160, 236));
  parts.push(`M 1266 478 L 1266 238 L 1328 238 L 1328 478 Z`);
  parts.push(roof(1266, 1328, 240, 1310, 118));
  parts.push(`M 1309 120 L 1312 82 L 1314 82 L 1312 120 Z`);
  parts.push(`M 1313 82 L 1342 88 L 1330 92 L 1340 98 L 1326 97 L 1313 96 Z`);
  parts.push(`M 1212 372 L 1212 316 L 1240 316 L 1240 372 Z`);
  parts.push(roof(1212, 1240, 318, 1229, 268));
  parts.push(`M 1400 478 L 1400 286 L 1448 286 L 1448 478 Z`);
  parts.push(roof(1400, 1448, 288, 1426, 186));
  const broken = `<path d='M 1484 478 L 1484 360 L 1492 350 L 1498 362 L 1505 344 L 1512 358 L 1520 352 L 1520 478 Z'/>`;
  const all = parts.map((d) => `<path d='${d}'/>`).join('') + broken;
  // backlit by the moon: a rim stroke under a second fill pass, so only the OUTER silhouette is rimmed
  let s = `<g fill='${CASTLE}' stroke='${CASTLE_RIM}' stroke-width='4' stroke-linejoin='round' stroke-opacity='0.5'>${all}</g>`;
  s += `<g fill='${CASTLE}'>${all}</g>`;
  const dark = [[1236, 340], [1196, 420], [1424, 404], [1500, 400]];
  for (const [wx, wy] of dark) s += `<path d='M ${wx - 5} ${wy + 9} L ${wx - 5} ${wy - 3} Q ${wx} ${wy - 10} ${wx + 5} ${wy - 3} L ${wx + 5} ${wy + 9} Z' fill='#0a0610'/>`;
  for (const [wx, wy] of CASTLE_WINDOWS) {
    s += `<circle cx='${wx}' cy='${wy}' r='24' fill='url(#winGlow)'/>`;
    s += `<path d='M ${wx - 6} ${wy + 10} L ${wx - 6} ${wy - 3} Q ${wx} ${wy - 11} ${wx + 6} ${wy - 3} L ${wx + 6} ${wy + 10} Z' fill='#b8f060'/>`;
  }
  return `<g transform='translate(${CASTLE_T.dx} ${CASTLE_T.dy}) scale(${CASTLE_T.s})'>${s}</g>`;
}

// an irregular, slightly torn hollow (the knot-hole), centred on (x,y)
function hollow(x, y, rx, ry) {
  const pts = [[0, -1], [0.55, -0.7], [0.95, -0.1], [0.8, 0.5], [0.35, 0.95], [-0.3, 0.9], [-0.85, 0.45], [-0.9, -0.2], [-0.45, -0.75]]
    .map(([u, v]) => [x + u * rx, y + v * ry]);
  return `${openCurve([...pts, pts[0]])} Z`;
}

function toadstools() {
  // three crooked toadstools between the left tree's roots
  const one = (x, y, s, lean) =>
    `<g transform='translate(${x} ${y}) rotate(${lean}) scale(${s})'>` +
    `<path d='M -3 0 C -4 -8 -2 -14 -2 -18 L 2 -18 C 2 -14 4 -8 3 0 Z' fill='#2a2030'/>` +
    `<path d='M -14 -16 C -12 -28 12 -28 14 -16 C 6 -19 -6 -19 -14 -16 Z' fill='#4a1a28'/>` +
    `<circle cx='-5' cy='-22' r='1.6' fill='#b8a48a' opacity='0.5'/><circle cx='4' cy='-24' r='1.3' fill='#b8a48a' opacity='0.5'/><circle cx='7' cy='-19' r='1' fill='#b8a48a' opacity='0.45'/>` +
    `</g>`;
  return one(236, 604, 1.1, -6) + one(262, 608, 0.8, 8) + one(214, 610, 0.65, -14);
}

// a crooked signpost beside the start of the path, two boards pointing different ways
const SIGN_DX = 112;
function signpost() {
  return `<g transform='translate(${SIGN_DX} 0)' fill='${TREE}' stroke='${RIM}' stroke-width='2' stroke-opacity='0.5' stroke-linejoin='round'>` +
    `<path d='M 1064 616 L 1067 506 L 1074 506 L 1073 616 Z'/>` +
    `<path d='M 1068 520 L 1124 512 L 1136 524 L 1124 534 L 1069 538 Z'/>` +
    `<path d='M 1071 548 L 1022 560 L 1010 548 L 1020 538 L 1070 532 Z'/>` +
    `</g>` +
    raven(1108 + SIGN_DX, 514.5, -1);
}

/* Halloween: carved JACK-O'-LANTERNS, lit from inside. [x, y (base), scale, lean°, flickers]. The
 * flickering ones get a CSS candle-glow layer over their face (PUMPKIN_GLOWS, exported — the
 * CSS glow centres must follow it). The last one sits small among the graves. */
const PUMPKINS = [[372, 618, 1.35, -4, true], [410, 621, 0.85, 8, false], [700, 621, 1.1, 5, true], [1316, 619, 1.2, -6, true]];
const GRAVE_PUMPKIN = [918, 0.6, 3];
// the face centre (pumpkin coordinates (0,-14)) on the scene
const pumpkinFace = ([x, y, s, lean]) => {
  const a = (lean * Math.PI) / 180;
  return [Math.round(x + 14 * s * Math.sin(a)), Math.round(y - 14 * s * Math.cos(a))];
};
const PUMPKIN_GLOWS = PUMPKINS.filter((p) => p[4]).map(pumpkinFace);
function jackOLantern(x, y, s, lean) {
  return `<g transform='translate(${f2(x)} ${f2(y)}) rotate(${lean}) scale(${s})'>` +
    // its light on the ground and the air around it
    `<ellipse cx='0' cy='-10' rx='42' ry='24' fill='url(#pumpkinGlow)'/>` +
    // body: three overlapping lobes, the middle one catching the most light
    `<ellipse cx='-9' cy='-13' rx='10' ry='12.5' fill='url(#pumpkinSide)'/><ellipse cx='9' cy='-13' rx='10' ry='12.5' fill='url(#pumpkinSide)'/>` +
    `<ellipse cx='0' cy='-13.5' rx='10.5' ry='13.5' fill='url(#pumpkinMid)'/>` +
    // crooked stem
    `<path d='M -1.6 -26 C -1.2 -30 1 -32.5 4.4 -33.5 L 5.4 -31.4 C 3.2 -30.4 2.2 -28.4 2 -26 Z' fill='#2c2414'/>` +
    // the carved face, glowing: slanted eyes, a nose, a jagged grin
    `<g fill='url(#pumpkinFire)'>` +
    `<path d='M -11 -15.5 L -3 -15.5 L -8 -22 Z'/><path d='M 3 -15.5 L 11 -15.5 L 8 -22 Z'/>` +
    `<path d='M -1.6 -11 L 1.6 -11 L 0 -14 Z'/>` +
    `<path d='M -11.5 -8 Q 0 -3.5 11.5 -8 Q 9.5 -1.6 4.5 -0.8 L 3.4 -3.6 L 1.2 -0.6 L -1.2 -0.6 L -3.4 -3.6 L -4.5 -0.8 Q -9.5 -1.6 -11.5 -8 Z'/>` +
    `</g></g>`;
}

/* Distance along the ray from (x,y) at angle a to the nearest branch SPINE (any limb of the
 * given tree), or Infinity if none is closer than maxR. */
function rayToBranch(spines, x, y, a, maxR) {
  const dx = Math.cos(a), dy = Math.sin(a);
  let best = Infinity;
  for (const { spine } of spines) {
    for (let i = 0; i < spine.length - 1; i++) {
      const [ax, ay] = spine[i], [bx, by] = spine[i + 1];
      const ex = bx - ax, ey = by - ay;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      // (x,y) + t·(dx,dy) = (ax,ay) + u·(ex,ey)
      const t = ((ax - x) * ey - (ay - y) * ex) / den;
      const u = ((ax - x) * dy - (ay - y) * dx) / den;
      if (t > 0 && t <= maxR && u >= 0 && u <= 1 && t < best) best = t;
    }
  }
  return best;
}

/* Where a web can hang: a hub inside the crown from which a ray in EVERY spoke direction hits a
 * branch — so every spoke is anchored. Picks the hub whose nearest branch is farthest away (the
 * largest web that still fits), avoiding the given keep-clear points. */
const WEB_SPOKES = 9;
// spoke i points at WEB_A0 + i·2π/WEB_SPOKES; the rings sit at these fractions of each spoke
const WEB_A0 = 0.2;
const WEB_RINGS = [0.14, 0.27, 0.4, 0.53, 0.66, 0.79];
function findWebSpot(spines, keepClear) {
  let best = null;
  for (let x = 30; x <= 520; x += 6) {
    for (let y = 90; y <= 440; y += 6) {
      if (keepClear.some(([kx, ky, kr]) => Math.hypot(x - kx, y - ky) < kr)) continue;
      const lens = [];
      for (let i = 0; i < WEB_SPOKES; i++) lens.push(rayToBranch(spines, x, y, WEB_A0 + (i * 2 * Math.PI) / WEB_SPOKES, 120));
      const min = Math.min(...lens);
      if (lens.every(Number.isFinite) && min >= 24 && (!best || min > best.min)) best = { x, y, lens, min };
    }
  }
  return best;
}

/* A spider web strung between branches: each radial thread runs from the hub to a branch spine
 * (the web is drawn BEHIND the trees, so the bark covers the thread ends — they meet the wood);
 * the sagging rings scale with each thread, so they stay inside the frame. */
function spiderWeb({ x: cx, y: cy, lens }) {
  const n = lens.length;
  const at = (i, f) => {
    const a = WEB_A0 + ((i % n) * 2 * Math.PI) / n, l = lens[i % n];
    return [cx + Math.cos(a) * l * f, cy + Math.sin(a) * l * f];
  };
  let d = lens.map((_, i) => `M ${f2(cx)} ${f2(cy)} L ${pt(at(i, 1))}`).join(' ');
  for (const f of WEB_RINGS) {
    for (let i = 0; i < n; i++) {
      const p = at(i, f), q = at(i + 1, f);
      // each ring segment sags toward the centre
      const m = [cx + ((p[0] + q[0]) / 2 - cx) * 0.86, cy + ((p[1] + q[1]) / 2 - cy) * 0.86];
      d += ` M ${pt(p)} Q ${pt(m)} ${pt(q)}`;
    }
  }
  return `<path d='${d}' stroke='#c9bedf' stroke-width='0.9' fill='none' opacity='0.32'/>`;
}

// The two SPIDERS are JS movers (src/utils/maerchenCreatures.ts), not part of the scene: one
// lives in the web, one dangles on a thread from a branch. Their geometry comes from the trees,
// so buildSvg fills these in and they are exported — the driver's copies must match (unit test).
const WEB_GEOM = { x: 0, y: 0, lens: [] };
const HANG = { x: 0, y: 0 };

/* A black cat sitting with its tail curled round, feet at (x,y), glowing yellow eyes. */
function blackCat(x, y, s) {
  return `<g transform='translate(${f2(x)} ${f2(y)}) scale(${s})'>` +
    `<path d='M -8 0 C -10.5 -8 -9 -15.5 -4.2 -19.5 C -5.4 -23 -5.2 -27 -3.4 -30 L -1.4 -26.6 C 0 -27 1.6 -27 3 -26.6 L 5 -30 C 6.4 -27 6.4 -23 5.2 -19.8 C 9.4 -16 10 -8 8 0 Z' fill='${TREE}'/>` +
    `<path d='M 7 -0.6 C 14.5 -0.6 18.5 -4 17.4 -9.4 C 16.8 -12.6 13.8 -12.4 14.4 -9.4 C 15 -6.4 12 -4 7 -4 Z' fill='${TREE}'/>` +
    `<path d='M -4.2 -19.5 C -5.4 -23 -5.2 -27 -3.4 -30 L -1.4 -26.6 C 0 -27 1.6 -27 3 -26.6 L 5 -30' stroke='${RIM}' stroke-width='0.9' fill='none' opacity='0.8'/>` +
    `<ellipse cx='-1.2' cy='-22.6' rx='1.5' ry='1' fill='#ffd040'/><ellipse cx='3' cy='-22.6' rx='1.5' ry='1' fill='#ffd040'/>` +
    `<ellipse cx='-1.2' cy='-22.6' rx='0.35' ry='0.9' fill='#2a1a00'/><ellipse cx='3' cy='-22.6' rx='0.35' ry='0.9' fill='#2a1a00'/>` +
    `</g>`;
}

function buildSvg() {
  const rng = mulberry32(0x6d61e7c);

  // far hills: the highest one, on the right, carries the castle
  const farHill = [[-10, 470], [160, 452], [360, 468], [560, 450], [720, 458], [860, 446], [1000, 432], [1120, 400], [1240, 360], [1380, 346], [1500, 348], [1610, 360]];
  const farR = ridgeFn(farHill);
  // the castle mound: the castle's foot (y≈351) sinks into it
  const mound = [[1220, 440], [1262, 384], [1296, 358], [1380, 346], [1480, 344], [1560, 348], [1610, 352]];
  const midHill = [[-10, 512], [180, 498], [420, 520], [640, 508], [820, 526], [1000, 512], [1180, 532], [1400, 516], [1610, 508]];
  const midR = ridgeFn(midHill);
  const ground = [[-10, 592], [180, 586], [420, 600], [620, 594], [800, 604], [1000, 596], [1220, 602], [1420, 590], [1610, 596]];

  // the path: from the foreground (wide, bottom centre) up and right toward the castle gate (narrow)
  const pathL = [[760, VH + 2], [850, 600], [950, 560], [1030, 526], [1120, 492], [1210, 452], [1290, 412], [1350, 376], [1392, 356]];
  const pathR = [[1100, VH + 2], [1062, 600], [1070, 564], [1110, 532], [1180, 500], [1260, 460], [1330, 418], [1380, 378], [1404, 356]];
  const pathD = `M ${pt(pathL[0])}${curveThrough(pathL)} L ${pt(pathR[pathR.length - 1])}${curveThrough(pathR.slice().reverse())} Z`;

  const farTrees = treeLine(rng, farR, 0, 1610, 22, 46, 18, [1200, 1610]);
  const midTrees = treeLine(rng, midR, 230, 1440, 60, 130, 30, [820, 1250], 0.92);

  const lt = bigTree(mulberry32(TREE_SEEDS.left), 112, 612, 1, 270, (a, x) => (x > 470 && Math.cos(a) > -0.1 ? -0.2 : 0));
  // the right tree must frame the castle, not cover it: a limb that reaches into the castle/moon
  // zone curls clockwise until it points out over the right edge (y-down coordinates: a growing
  // angle turns an upward limb rightward). Both trees also have a REACH limit: past it a limb
  // turns upward instead of crossing the valley.
  const castleZone = (a, x, y) => (x > 1270 && y < 376 && Math.cos(a) < 0.5 ? 0.26 : x < 1250 && Math.cos(a) < 0.1 ? 0.2 : 0);
  const rt = bigTree(mulberry32(TREE_SEEDS.right), 1530, 612, -1, 165, castleZone, 0);
  const leftTree = lt.parts, rightTree = rt.parts;
  const kp = lt.trunk[Math.round(lt.trunk.length * 0.42)];
  KNOT.x = Math.round(kp[0]); KNOT.y = Math.round(kp[1]);
  EYE_SPOTS[0] = [KNOT.x, KNOT.y];
  const fp = rt.trunk[Math.round(rt.trunk.length * 0.5)];
  FACE.x = Math.round(fp[0]); FACE.y = Math.round(fp[1]);
  EYE_SPOTS[1] = [FACE.x, FACE.y];
  const moss = [...hangingMoss(mulberry32(7), lt.spines, 0.3), ...hangingMoss(mulberry32(8), rt.spines, 0.3)];
  // a raven on the highest near-level branch inside the left tree's crown
  const perch = lt.spines.flatMap(({ gen, spine, angs, w }) => spine.map((p, i) => ({ p, a: angs[i], w: w[i], gen })))
    .filter(({ p, a, w, gen }) => gen >= 1 && w > 5 && Math.abs(Math.sin(a)) < 0.2 && p[0] > 300 && p[0] < 440 && p[1] > 170 && p[1] < 345)
    .sort((m, n) => m.p[1] - n.p[1])[0];
  // a spider web anchored on branches all round, clear of the raven and the knot-hole
  const web = findWebSpot(lt.spines, [
    ...(perch ? [[perch.p[0], perch.p[1] - 14, 60]] : []),
    [KNOT.x, KNOT.y, 70],
  ]);
  // a spider dangling from the lowest near-level branch at the crown's inner edge
  const hang = lt.spines.flatMap(({ gen, spine, angs, w }) => spine.map((p, i) => ({ p, a: angs[i], w: w[i], gen })))
    .filter(({ p, a, w, gen }) => gen >= 2 && w > 2.5 && Math.abs(Math.sin(a)) < 0.35 && p[0] > 430 && p[0] < 520 && p[1] > 240 && p[1] < 390)
    .sort((m, n) => n.p[1] - m.p[1])[0];
  if (web) Object.assign(WEB_GEOM, { x: web.x, y: web.y, lens: web.lens.map((l) => Math.round(l)) });
  // the thread hangs from the branch's underside
  if (hang) Object.assign(HANG, { x: Math.round(hang.p[0]), y: Math.round(hang.p[1] + hang.w * 0.3) });

  // undergrowth: ferny tufts along the foreground ground (the eyes' hiding places)
  const tufts = [];
  for (const [cx, n] of TUFTS) {
    for (let i = 0; i < n; i++) {
      const bx = cx + (i - n / 2) * 9 + (rng() - 0.5) * 6;
      limb(tufts, rng, bx, 618, -Math.PI / 2 + (i - n / 2) * 0.22 + (rng() - 0.5) * 0.2, 26 + rng() * 22, 5, 0.6, 0, { gnarl: 0.25, curl: 0.08 });
    }
  }

  return `<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}' viewBox='0 0 ${VW} ${VH}' preserveAspectRatio='xMidYMax meet'>` +
    `<defs>` +
    `<radialGradient id='moonHalo'><stop offset='0' stop-color='${MOON}' stop-opacity='0.30'/><stop offset='0.3' stop-color='${MOON}' stop-opacity='0.12'/><stop offset='0.65' stop-color='${MOON}' stop-opacity='0.035'/><stop offset='1' stop-color='${MOON}' stop-opacity='0'/></radialGradient>` +
    // a faint blood-red ring in the halo: something is wrong with this moon
    `<radialGradient id='bloodRing'><stop offset='0.42' stop-color='#8e1e33' stop-opacity='0'/><stop offset='0.56' stop-color='#8e1e33' stop-opacity='0.16'/><stop offset='0.8' stop-color='#8e1e33' stop-opacity='0'/></radialGradient>` +
    `<radialGradient id='ember'><stop offset='0' stop-color='#5a1418'/><stop offset='0.7' stop-color='#1c0508'/><stop offset='1' stop-color='#020104'/></radialGradient>` +
    `<radialGradient id='emberMouth' cy='0.35'><stop offset='0' stop-color='#42100f'/><stop offset='0.8' stop-color='#0a0204'/><stop offset='1' stop-color='#020104'/></radialGradient>` +
    `<radialGradient id='pumpkinMid' cx='0.5' cy='0.55'><stop offset='0' stop-color='#c8701f'/><stop offset='1' stop-color='#743010'/></radialGradient>` +
    `<radialGradient id='pumpkinSide' cx='0.5' cy='0.55'><stop offset='0' stop-color='#a85419'/><stop offset='1' stop-color='#4e1f09'/></radialGradient>` +
    `<radialGradient id='pumpkinFire'><stop offset='0' stop-color='#ffdc8a'/><stop offset='0.55' stop-color='#eea032'/><stop offset='1' stop-color='#cc6018'/></radialGradient>` +
    `<radialGradient id='pumpkinGlow'><stop offset='0' stop-color='#ff9a3a' stop-opacity='0.22'/><stop offset='0.5' stop-color='#ff8a2a' stop-opacity='0.06'/><stop offset='1' stop-color='#ff8a2a' stop-opacity='0'/></radialGradient>` +
    `<radialGradient id='witchMist'><stop offset='0' stop-color='#9be052' stop-opacity='0.13'/><stop offset='1' stop-color='#9be052' stop-opacity='0'/></radialGradient>` +
    `<radialGradient id='moonDisc' cx='0.42' cy='0.4'><stop offset='0' stop-color='#f8e8c0'/><stop offset='1' stop-color='${MOON}'/></radialGradient>` +
    `<radialGradient id='winGlow'><stop offset='0' stop-color='#b8f060' stop-opacity='0.35'/><stop offset='0.5' stop-color='#b8f060' stop-opacity='0.1'/><stop offset='1' stop-color='#b8f060' stop-opacity='0'/></radialGradient>` +
    `<linearGradient id='farHill' gradientUnits='userSpaceOnUse' x1='0' y1='336' x2='0' y2='520'><stop offset='0' stop-color='${FAR_HILL}'/><stop offset='1' stop-color='#1f1230'/></linearGradient>` +
    `<linearGradient id='fogBack' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#4a2c62' stop-opacity='0'/><stop offset='0.6' stop-color='#4a2c62' stop-opacity='0.5'/><stop offset='1' stop-color='#4a2c62' stop-opacity='0'/></linearGradient>` +
    `<linearGradient id='fogFront' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#3c2352' stop-opacity='0'/><stop offset='0.55' stop-color='#3c2352' stop-opacity='0.4'/><stop offset='1' stop-color='#3c2352' stop-opacity='0'/></linearGradient>` +
    `<linearGradient id='path' gradientUnits='userSpaceOnUse' x1='0' y1='386' x2='0' y2='${VH}'><stop offset='0' stop-color='${PATH_FAR}'/><stop offset='0.5' stop-color='${PATH_LIT}'/><stop offset='1' stop-color='${PATH_DK}'/></linearGradient>` +
    `<radialGradient id='knot'><stop offset='0' stop-color='#000' stop-opacity='0.9'/><stop offset='1' stop-color='#000' stop-opacity='0.4'/></radialGradient>` +
    `<clipPath id='nearLand'><path d='${massPath(midHill)}'/></clipPath>` +
    `<path id='bigTrees' d='${[...leftTree, ...rightTree].join(' ')}'/>` +
    `</defs>` +
    moon() +
    // distance
    `<path d='${massPath(farHill)}' fill='url(#farHill)'/>` +
    castle() +
    `<path d='${massPath(mound)}' fill='url(#farHill)'/>` +
    // a sickly witch-light mist pooling around the castle's foot
    `<ellipse cx='1440' cy='356' rx='230' ry='34' fill='url(#witchMist)'/>` +
    // the path, pass 1: its far stretch up the castle hill, BEHIND the mid hill and its trees
    `<path d='${pathD}' fill='url(#path)'/>` +
    limbsPath(farTrees, FAR_TREES) +
    `<rect x='0' y='400' width='${VW}' height='140' fill='url(#fogBack)'/>` +
    // middle
    `<path d='${massPath(midHill)}' fill='${MID_HILL}'/>` +
    limbsPath(midTrees, MID_TREES) +
    // the graveyard on both sides of the path where it crosses the mid hill
    graves(midR, [[830, 0, 20, -8], [864, 2, 14, 4], [900, 1, 24, 6], [936, 0, 16, -4], [966, 2, 12, 10], [996, 0, 19, 12]]) +
    jackOLantern(GRAVE_PUMPKIN[0], midR(GRAVE_PUMPKIN[0]) + 4, GRAVE_PUMPKIN[1], GRAVE_PUMPKIN[2]) +
    blackCat(806, midR(806) + 4, 1.15) +
    // foreground ground; the path, pass 2: its near stretch, clipped to the near land (mid hill +
    // ground) so it lies on top of them but never in front of the far hill; then ground fog over both
    `<path d='${massPath(ground)}' fill='${NEAR}'/>` +
    `<path d='${pathD}' fill='url(#path)' clip-path='url(#nearLand)'/>` +
    `<rect x='0' y='500' width='${VW}' height='110' fill='url(#fogFront)'/>` +
    signpost() +
    // the web hangs BEHIND the trees, so its thread ends disappear into the bark
    (web ? spiderWeb(WEB_GEOM) : '') +
    // the big trees, rimmed (a rim stroke under the fill, so only the outer silhouette shows it)
    // drawn twice from one unpainted <defs> path: a rim pass, then a plain fill pass on top that
    // hides the rim everywhere except the outer silhouette (the limbs overlap at every fork)
    `<use href='#bigTrees' fill='${TREE}' stroke='${RIM}' stroke-width='2.4' stroke-linejoin='round' stroke-opacity='0.55'/>` +
    `<use href='#bigTrees' fill='${TREE}'/>` +
    limbsPath(moss, TREE) +
    (perch ? raven(perch.p[0], perch.p[1] - perch.w * 0.4, 1, 1.1) : '') +
    // the face in the right trunk (the eyes light up in its sockets)
    treeFace(FACE.x, FACE.y) +
    // the knot-hole in the left trunk (the eyes peer out of it)
    // wide enough for a pair of eyes (the eye sprite is 36 scene px wide)
    `<path d='${hollow(KNOT.x, KNOT.y, 25, 24)}' fill='${RIM}' opacity='0.55'/>` +
    `<path d='${hollow(KNOT.x, KNOT.y + 1, 21, 20)}' fill='#020104'/>` +
    toadstools() +
    limbsPath(tufts, TREE) +
    PUMPKINS.map(([x, y, s, lean]) => jackOLantern(x, y, s, lean)).join('') +
    `</svg>`;
}

const toDataUri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);

function writeCss(dataUri) {
  const cssPath = path.join(__dirname, '..', 'src', 'styles', 'themes.css');
  let css = fs.readFileSync(cssPath, 'utf8');
  const re = /(\[data-theme="maerchen"\]::after\s*\{[\s\S]*?url\(")data:image\/svg\+xml,[^"]*width%3D'1600'[^"]*("\))/;
  if (!re.test(css)) throw new Error('Märchen ::after scene data-URI (width=1600) not found in themes.css');
  css = css.replace(re, `$1${dataUri}$2`);
  fs.writeFileSync(cssPath, css);
  console.log('Baked Märchen scene into', path.relative(process.cwd(), cssPath), `(${dataUri.length} bytes)`);
}

async function writePreviewPng(svg, outPath) {
  const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));
  // preview against the real body gradient (dark plum) so the transparent sky reads as in-app
  const grad = Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#24143a'/><stop offset='1' stop-color='${NEAR}'/></linearGradient></defs><rect width='${VW}' height='${VH}' fill='url(#g)'/></svg>`);
  const bg = await sharp(grad).png().toBuffer();
  await sharp(bg).composite([{ input: Buffer.from(svg) }]).png().toFile(outPath);
  console.log('Wrote preview PNG:', outPath);
}

module.exports = { buildSvg, WINDOWS, PUMPKIN_GLOWS, EYE_SPOTS, WEB_GEOM, WEB_A0, WEB_RINGS, HANG, VW, VH, findWebSpot };

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const svg = buildSvg();
    const dataUri = toDataUri(svg);
    if (args.includes('--write-css')) { writeCss(dataUri); return; }
    const pngFlag = args.indexOf('--png');
    const pngPath = pngFlag !== -1 ? args[pngFlag + 1] : path.join(process.env.TMPDIR || '.', 'maerchen-scene.png');
    console.log(`SVG ${svg.length} bytes, data-URI ${dataUri.length} bytes`);
    try { await writePreviewPng(svg, pngPath); } catch (e) { console.error('preview skipped:', e.message); }
  })();
}
