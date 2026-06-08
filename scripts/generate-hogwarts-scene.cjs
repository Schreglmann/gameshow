/* Compose the Harry Potter theme's Hogwarts-night background and (optionally) bake
 * it into the `[data-theme="harry-potter"]::after` rule in src/styles/themes.css.
 *
 * The castle is the REAL Hogwarts, vectorised from the classic blue reference
 * (pa-Hogwarts.png) by scripts/trace-hogwarts-reference.cjs into
 * scripts/hogwarts-traced.json (two shading tones — shadow #2c2658 / highlight
 * #473f6f — + gold windows).
 *
 * SCENE COMPOSITION (per the user): the Black Lake nestled BETWEEN two mountains, seen
 * across from its near shore.
 *   - LEFT  = a forested mountain (the approved craggy peak + a recessed haze ridge behind
 *     it, with a conifer TREELINE on its lower slope) rising out of the lake.
 *   - RIGHT = the traced Hogwarts castle on its cliff, the other framing mountain.
 *   - CENTRE/BACK = the lake recedes to a low, hazy FAR SHORE (the opposite bank) — so the
 *     water reads as a body you look ACROSS, not a vertical cross-section.
 *   - FOREGROUND = the lake surface itself (full width to the frame bottom = the near water
 *     at our feet), carrying the moonlit sheen, the moon's reflection and a faint mirror of
 *     the far shore.
 * The far waterline is FLAT (the mountains + castle rise straight out of it — no uphill
 * ramp). The forest is a TREELINE (jagged band on the slope), never a solid wall.
 *
 * ROCK VOCABULARY — the left mountain is drawn in the CASTLE CLIFF'S OWN flat two-tone style
 * (dark #2c2658 body + #473f6f lit edge-slivers / broad faces), gated to crests ABOVE the
 * waterline. The recessed back-ridge + far shore use cooler haze tones for depth.
 *
 * Z-ORDER (back → front): back-ridge → far shore → lake water (+ reflections) → left
 * mountain rock + faceting → forest treeline → castle.
 *
 * FLAT — no gradients on the rock, no SVG filters (only the lake uses a vertical gradient +
 * low-opacity moonlight). Renders identically in sharp/resvg and the browser. Deterministic
 * mulberry32 PRNG only (no global random, no clock). Moon/stars/candles live in ::before.
 *
 * Usage (from repo root):
 *   node scripts/generate-hogwarts-scene.cjs              # preview PNG to $TMPDIR
 *   node scripts/generate-hogwarts-scene.cjs --write-css  # bake into themes.css
 *   node scripts/generate-hogwarts-scene.cjs --png out.png
 */
'use strict';
const fs = require('fs');
const path = require('path');

const VW = 1600, VH = 430, BASE = 430;
const C_SHADOW = '#2c2658', C_HIGH = '#473f6f', GOLD = '#f2c75c';
// Depth tones: recessed back-ridge behind the left peak, and the distant far shore.
const RANGE_BACK = '#352e63';   // recessed ridge behind the left peak (haze)
const FAR_SHORE = '#3a3463';    // the opposite bank of the lake (distant, hazier)
// Black Lake + Forbidden Forest — flat night palette.
const WATER_TOP = '#26204a', WATER_BOT = '#171132'; // far waterline (reflects sky) → near water
const WATER_SHEEN = '#9aa0cf';                       // moonlit glimmer (low opacity)
const FOREST_BACK = '#241d40', FOREST_FRONT = '#15102a', FOREST_LIT = '#332b54';

const FAR_WL = 314; // far waterline — the lake meets the far shore / mountain bases here

// deterministic PRNG (mulberry32) so the baked SVG is reproducible.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const poly = (pts) => pts.map((p) => f2(p[0]) + ',' + f2(p[1])).join(' ');

// Organic ridge: Catmull-Rom control points → cubic Beziers.
function smoothPath(pts) {
  let d = `M ${f2(pts[0][0])} ${f2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const k = 1 / 6;
    const c1x = p1[0] + (p2[0] - p0[0]) * k, c1y = p1[1] + (p2[1] - p0[1]) * k;
    const c2x = p2[0] - (p3[0] - p1[0]) * k, c2y = p2[1] - (p3[1] - p1[1]) * k;
    d += ` C ${f2(c1x)} ${f2(c1y)} ${f2(c2x)} ${f2(c2y)} ${f2(p2[0])} ${f2(p2[1])}`;
  }
  return d;
}

function buildSvg() {
  // ── LEFT MOUNTAIN silhouette — the approved craggy peak, descending into the lake on its
  //    right around x≈480. The right framing mountain is the castle cliff; the centre is lake. ──
  const rng = mulberry32(987654321);
  const r = (lo, hi) => lo + (hi - lo) * rng();
  const ridge = [
    [-90, 430], [-90, 250], [-40, 205], [10, 150], [40, 96], [70, 132], [96, 110],
    [120, 158], [150, 196], [185, 175], [220, 228], [262, 256], [305, 286],
    [345, 300], [392, 320], [440, 366], [482, 430], // descend into the lake on the right
  ];
  const fixed = new Set([0, 1, ridge.length - 1, ridge.length - 2]);
  const anchorXs = new Set([40]);
  const jittered = ridge.map((p, i) => {
    if (fixed.has(i) || anchorXs.has(p[0])) return [p[0], p[1]];
    const amp = p[0] < 300 ? r(-7, 7) : r(-4, 4);
    return [p[0] + r(-4, 4), p[1] + amp];
  });
  const massifPath = smoothPath(jittered) + ' L -90 430 Z';

  // ── recessed back-ridge behind the left peak (layered range: "mountains after the forest") ──
  const brng = mulberry32(0x2c1a77b3);
  const br = (lo, hi) => lo + (hi - lo) * brng();
  const backRidge = [
    [-90, 430], [-90, 272], [-30, 238], [40, 200], [95, 178], [150, 152],
    [205, 170], [255, 192], [300, 188], [345, 220], [392, 280], [430, FAR_WL - 2], [452, BASE],
  ].map((p, i, arr) => {
    if (i === 0 || i === 1 || i >= arr.length - 2) return [p[0], p[1]];
    return [p[0] + br(-3, 3), p[1] + br(-4, 4)];
  });
  const backRangePath = smoothPath(backRidge) + ` L 452 ${BASE} L -90 ${BASE} Z`;
  const backRange = `<path fill='${RANGE_BACK}' d='${backRangePath}'/>`;

  // ── far shore — the OPPOSITE bank of the lake: a low, distant, hazy ridge across the
  //    centre gap (between the left mountain and the castle). Encloses the lake at the back
  //    so the water reads as a body you look across. Drawn behind the water. ──
  const fsr = mulberry32(0x77c1a2b3);
  const fr = (lo, hi) => lo + (hi - lo) * fsr();
  const fsRidge = [[400, FAR_WL + 10]];
  for (let sx = 440; sx <= 1080; sx += 40) {
    const t = (sx - 440) / 640;
    fsRidge.push([sx, FAR_WL - 4 - Math.sin(t * Math.PI) * 7 - fr(0, 5)]);
  }
  fsRidge.push([1110, FAR_WL + 10]);
  const farShorePath = smoothPath(fsRidge) + ` L 1110 ${FAR_WL + 10} L 400 ${FAR_WL + 10} Z`;
  const farShore = `<path fill='${FAR_SHORE}' d='${farShorePath}'/>`;

  // ── cliff-vocabulary faceting on the LEFT mountain (separate seeded stream) ──
  const drng = mulberry32(0x5f3a91c7);
  const dr = (lo, hi) => lo + (hi - lo) * drng();
  const crest = jittered.filter((p) => p[1] < BASE - 4);
  const crestYat = (x) => {
    if (x <= crest[0][0]) return crest[0][1];
    if (x >= crest[crest.length - 1][0]) return crest[crest.length - 1][1];
    for (let i = 0; i < crest.length - 1; i++) {
      const a = crest[i], b = crest[i + 1];
      if (x >= a[0] && x <= b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
    return BASE;
  };
  const aboveWater = (x) => crestYat(x) < FAR_WL - 6;
  const lit = [];
  const sliver = (xTop) => {
    const yTop = crestYat(xTop) + dr(2, 14);
    const crag = FAR_WL - yTop;
    if (crag < 14) return;
    const len = Math.min(crag * dr(0.45, 0.9), dr(42, 150));
    const dir = drng() < 0.88 ? -1 : 1;
    const lean = dr(0.32, 0.72) * dir;
    const wid = drng() < 0.22 ? dr(9, 15) : dr(3.5, 9);
    const nseg = 3, ax = [];
    for (let s = 0; s <= nseg; s++) { const t = s / nseg; ax.push([xTop + lean * len * t + dr(-3, 3), yTop + len * t]); }
    const dx = lean, dy = 1, n = Math.hypot(dx, dy), nx = -dy / n, ny = dx / n;
    const left = [], right = [];
    for (let s = 0; s < ax.length; s++) {
      const t = s / (ax.length - 1), w = wid * (1 - t) * 0.5 + 0.4;
      left.push([ax[s][0] + nx * w, ax[s][1] + ny * w]);
      right.push([ax[s][0] - nx * w, ax[s][1] - ny * w]);
    }
    lit.push([...left, ...right.reverse()]);
  };
  const broadFace = (xTop) => {
    const yTop = crestYat(xTop) + dr(2, 10), crag = FAR_WL - yTop;
    if (crag < 24) return;
    const len = Math.min(crag * dr(0.5, 0.85), dr(50, 120));
    const wTop = dr(26, 55), lean = dr(0.3, 0.6), tipx = xTop - lean * len;
    lit.push([
      [xTop - dr(2, 6), yTop],
      [xTop + wTop * dr(0.5, 0.8), yTop + dr(4, 14)],
      [tipx + wTop * dr(0.3, 0.6), yTop + len * dr(0.55, 0.7)],
      [tipx + dr(-6, 6), yTop + len],
      [tipx - dr(6, 16), yTop + len * dr(0.5, 0.7)],
      [xTop - dr(8, 20), yTop + dr(10, 26)],
    ]);
  };
  const spacing = (x) => (x < 300 ? dr(18, 30) : dr(24, 40));
  let x = crest[0][0] + 8;
  const xEnd = 470;
  while (x < xEnd) {
    if (!aboveWater(x)) { x += spacing(x); continue; }
    if (x < 300 && drng() < 0.42) broadFace(x);
    else if (drng() < 0.92) sliver(x);
    x += spacing(x);
  }
  let inner = '';
  for (const p of lit) inner += `<polygon fill='${C_HIGH}' points='${poly(p)}'/>`;

  // ── Black Lake — full-width foreground water from the FLAT far waterline to the frame
  //    bottom (the near water at our feet). The left mountain + castle (drawn on top) frame
  //    it; the far shore (behind) closes the back. Carries a faint mirror of the far shore,
  //    a moonlit horizon sheen, ripples and the moon's reflection column. ──
  const wrng = mulberry32(0x1a2b3c4d);
  const wr = (lo, hi) => lo + (hi - lo) * wrng();
  const far = [];
  for (let sx = -90; sx <= 1660; sx += 80) far.push([sx, FAR_WL + wr(-2, 2)]);
  const farD = far.map((p) => `${f2(p[0])} ${f2(p[1])}`).join(' L ');
  const waterPath = `M ${farD} L 1660 ${BASE} L -90 ${BASE} Z`;
  // faint mirror of the far shore, just below the waterline (a calm reflection)
  const reflPts = fsRidge.map((p) => [p[0], FAR_WL + (FAR_WL - p[1]) * 0.6]);
  const reflPath = `M ${f2(reflPts[0][0])} ${f2(FAR_WL)} L ${reflPts.map((p) => `${f2(p[0])} ${f2(p[1])}`).join(' L ')} L ${f2(reflPts[reflPts.length - 1][0])} ${f2(FAR_WL)} Z`;
  // thin moonlit sheen hugging the far waterline
  const sheenBot = [...far].reverse().map((p) => `${f2(p[0])} ${f2(p[1] + wr(4, 8))}`).join(' L ');
  const sheenPath = `M ${farD} L ${sheenBot} Z`;
  // subtle moonlit glow on the open horizon (centre gap)
  const glowCx = 720, glowW = 460, glowY = FAR_WL + 1;
  const horizonGlow = `<polygon fill='${WATER_SHEEN}' fill-opacity='0.09' points='${poly([
    [glowCx - glowW / 2, glowY], [glowCx, glowY - 4], [glowCx + glowW / 2, glowY],
    [glowCx + glowW * 0.34, glowY + 8], [glowCx - glowW * 0.34, glowY + 8],
  ])}'/>`;
  // ripple lozenges across the open water
  let ripples = '';
  for (let k = 0; k < 9; k++) {
    const cy = FAR_WL + wr(16, 100), cx = wr(470, 1020), w = wr(50, 150), h = wr(0.6, 1.6);
    ripples += `<polygon fill='${WATER_SHEEN}' fill-opacity='${f2(wr(0.04, 0.1))}' points='${poly([[cx - w / 2, cy], [cx - w * 0.15, cy], [cx + w / 2, cy], [cx + w * 0.15, cy + h]])}'/>`;
  }
  // moon reflection — a vertical column of stacked lozenges fading down from the waterline
  let glimmer = '';
  for (let g = 0; g < 11; g++) {
    const gy = FAR_WL + 6 + g * wr(8, 13);
    const gw = (34 - g * 2.6) * wr(0.7, 1.1);
    if (gw < 4 || gy > BASE - 6) continue;
    const cx = 560 + wr(-8, 8);
    glimmer += `<polygon fill='${WATER_SHEEN}' fill-opacity='${f2(Math.max(0.05, 0.22 - g * 0.018))}' points='${poly([[cx - gw / 2, gy], [cx - gw * 0.12, gy - 1.1], [cx + gw / 2, gy], [cx + gw * 0.12, gy + 1.1]])}'/>`;
  }
  const lake = `<path fill='url(#lakeGrad)' d='${waterPath}'/>` +
    `<path fill='${FAR_SHORE}' fill-opacity='0.45' d='${reflPath}'/>` +
    `<path fill='${WATER_SHEEN}' fill-opacity='0.14' d='${sheenPath}'/>` +
    horizonGlow + ripples + glimmer;

  // ── Forbidden Forest — a conifer TREELINE (a jagged band of individual trees, NOT a solid
  //    wall) on the left mountain's lower slope, below the rock peak and above the shore. Two
  //    depth rows + subtle moonlit treetop nicks. ──
  // a single tiered conifer (spruce) silhouette centred at cx, sitting on baseY — a pointed
  // crown over THREE widening branch tiers (the notches give the layered-bough read).
  const conifer = (cx, baseY, h, w) => {
    const top = baseY - h;
    return [
      [cx, top],
      [cx + w * 0.26, top + h * 0.32], [cx + w * 0.13, top + h * 0.37],
      [cx + w * 0.43, top + h * 0.63], [cx + w * 0.23, top + h * 0.69],
      [cx + w * 0.58, baseY], [cx - w * 0.58, baseY],
      [cx - w * 0.23, top + h * 0.69], [cx - w * 0.43, top + h * 0.63],
      [cx - w * 0.13, top + h * 0.37], [cx - w * 0.26, top + h * 0.32],
    ];
  };
  // a dense treeline = many overlapping conifers of varied height / width
  const treeline = (x0, x1, baseY, hLo, hHi, tone) => {
    let out = '';
    let cx = x0;
    while (cx < x1) {
      const w = wr(11, 22), h = wr(hLo, hHi);
      out += `<polygon fill='${tone}' points='${poly(conifer(cx, baseY + wr(-2, 3), h, w))}'/>`;
      cx += w * wr(0.68, 1.04); // more spacing → a looser, less crowded treeline
    }
    return out;
  };
  // moonlit nicks catching the upper-left of some front treetops (subtle)
  let foliage = '';
  for (let fx = -80; fx < 330; fx += wr(34, 64)) {
    const ty = wr(262, 284);
    foliage += `<polygon fill='${FOREST_LIT}' fill-opacity='0.55' points='${poly([[fx - wr(2, 5), ty + wr(7, 12)], [fx + wr(2, 6), ty], [fx + wr(7, 12), ty + wr(8, 13)]])}'/>`;
  }
  // three depth rows (far haze → back → front) reaching the left screen edge, plus nicks
  const forest =
    treeline(-94, 360, 300, 20, 34, RANGE_BACK) +
    treeline(-94, 356, 305, 24, 42, FOREST_BACK) +
    treeline(-94, 350, 311, 30, 54, FOREST_FRONT) +
    foliage;

  // ── right foreshore — a gentle rocky shore at the FOOT of the castle cliff, sweeping LEFT
  //    into the water so the right shore eases into the lake like the left mountain's slope
  //    (the castle's own cliff edge alone met the water too abruptly). ──
  const rightShore = `<path fill='${C_SHADOW}' d='${smoothPath([
    [922, BASE], [958, FAR_WL + 48], [1006, FAR_WL + 20], [1058, FAR_WL + 4], [1110, FAR_WL - 12],
  ])} L 1660 ${f2(FAR_WL - 12)} L 1660 ${BASE} Z'/>`;

  // full castle (traced) — the right framing mountain, rising out of the lake.
  const traced = JSON.parse(fs.readFileSync(path.join(__dirname, 'hogwarts-traced.json'), 'utf8'));
  const castle = `<g transform='translate(1026.9 23.7) scale(0.8969)'>` +
    `<path fill='${C_SHADOW}' d='${traced.shadow}'/>` +
    `<path fill='${C_HIGH}' d='${traced.high}'/>` +
    `<path fill='${GOLD}' d='${traced.gold}'/></g>`;

  // z-order: back-ridge → far shore → lake water (covers far-shore base + frames) → left
  // mountain rock + faceting (clipped to the massif) → forest treeline → castle.
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}' viewBox='0 0 ${VW} ${VH}' preserveAspectRatio='xMidYMax meet'>` +
    `<defs><clipPath id='massifClip'><path d='${massifPath}'/></clipPath>` +
    `<linearGradient id='lakeGrad' x1='0' y1='0' x2='0' y2='1'>` +
    `<stop offset='0' stop-color='${WATER_TOP}'/><stop offset='1' stop-color='${WATER_BOT}'/></linearGradient></defs>` +
    backRange +
    farShore +
    lake +
    `<path fill='${C_SHADOW}' d='${massifPath}'/>` +
    `<g clip-path='url(#massifClip)'>${inner}</g>` +
    forest +
    rightShore +
    castle +
    `</svg>`;
}

const toDataUri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);

function writeCss(dataUri) {
  const cssPath = path.join(__dirname, '..', 'src', 'styles', 'themes.css');
  let css = fs.readFileSync(cssPath, 'utf8');
  const re = /(\[data-theme="harry-potter"\]::after\s*\{[\s\S]*?url\(")data:image\/svg\+xml,[^"]*("\))/;
  if (!re.test(css)) throw new Error('HP ::after data-URI not found in themes.css');
  css = css.replace(re, `$1${dataUri}$2`);
  fs.writeFileSync(cssPath, css);
  console.log('Baked HP scene into', path.relative(process.cwd(), cssPath), `(${dataUri.length} bytes)`);
}

async function writePreviewPng(svg, outPath) {
  const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));
  const grad = Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#1f0c31'/><stop offset='0.5' stop-color='#2a0e3a'/><stop offset='1' stop-color='#190720'/></linearGradient></defs><rect width='${VW}' height='${VH}' fill='url(#g)'/></svg>`);
  const bg = await sharp(grad).png().toBuffer();
  await sharp(bg).composite([{ input: Buffer.from(svg) }]).png().toFile(outPath);
  console.log('Wrote preview PNG:', outPath);
}

(async () => {
  const args = process.argv.slice(2);
  const svg = buildSvg();
  const dataUri = toDataUri(svg);
  if (args.includes('--write-css')) { writeCss(dataUri); return; }
  const pngFlag = args.indexOf('--png');
  const pngPath = pngFlag !== -1 ? args[pngFlag + 1] : path.join(process.env.TMPDIR || '.', 'hogwarts-scene.png');
  console.log(`SVG ${svg.length} bytes, data-URI ${dataUri.length} bytes`);
  try { await writePreviewPng(svg, pngPath); } catch (e) { console.error('preview skipped:', e.message); }
})();
