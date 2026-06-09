/* Compose the D&D theme's "dragon's lair" background and (optionally) bake it into the
 * `[data-theme="dnd"]::after` rule in src/styles/themes.css.
 *
 * SCENE: you look THROUGH a torchlit stone archway into a dragon's lair.
 *   - FRAME   = a heavy weathered stone archway: two block pillars + a round arch, hewn from
 *               irregular mortared blocks (per-block tone variation, recessed mortar, cracks,
 *               ambient-occlusion shadow around the opening), with an iron torch on each pillar.
 *   - OPENING = the dark depths beyond, where the DRAGON looms (a fierce dragon silhouette
 *               traced by scripts/trace-dragon-reference.cjs into scripts/dragon-traced.json),
 *               recoloured near-black with a faint torch-lit rim and narrow, menacing slit eyes.
 *   - FLOOR   = receding flagstones (per-tile tone, dark grout, a warm torch/treasure reflection);
 *               a TREASURE HOARD (coin mound + chest + goblet + crown + gems) glints in the opening.
 *   - CEILING = the top sinks into black (a dark fade) so the band blends into the theme's dark
 *               body gradient above it (sized `100% auto`, anchored bottom).
 *
 * QUALITY DISCIPLINE (from the Hogwarts scene): FLAT vector + SVG gradients only — NO SVG
 * filters (feTurbulence/feGaussianBlur don't render identically under `sharp`). Animated torch
 * flicker + embers are CSS overlays in themes.css, not baked here. Deterministic mulberry32
 * PRNG only (no clock/random) so the baked data-URI is reproducible.
 *
 * Usage (from repo root):
 *   node scripts/generate-dungeon-scene.cjs              # preview PNG to $TMPDIR
 *   node scripts/generate-dungeon-scene.cjs --png out.png
 *   node scripts/generate-dungeon-scene.cjs --write-css  # bake into themes.css
 */
'use strict';
const fs = require('fs');
const path = require('path');

const VW = 1600, VH = 760;
const FLOOR_Y = 660;          // top of the foreground flagstone floor
const OPEN_L = 300, OPEN_R = 1300;   // inner faces of the pillars (opening width)
const SPRING_Y = 300;         // arch springline
const CROWN_Y = 116;          // arch crown
const CROWN_X = 800;

// ── palette (dark, weathered, serious) ──
const DEPTH_TOP = '#050403', DEPTH_BOT = '#100b07';
const MORTAR = '#0b0906';
// stone block tones — desaturated cool-brown grey, mostly mid with darker weathered ones
const STONE_TONES = ['#2b2620', '#332d25', '#262019', '#3a342a', '#201b15', '#2e2922', '#241f18'];
const STONE_HI = '#4a4336';   // lit lower-lip / torch-side
const DRAGON = '#080604', DRAGON_RIM = '#2c2113';
const FLOOR_TONES = ['#1a160f', '#211b12', '#15110b', '#241d13', '#181309'];
const GROUT = '#080603';
const GOLD = '#ffcf3f', GOLD_HI = '#fff2ad', GOLD_DEEP = '#c79a2c', GOLD_DK = '#6e5113';
const WOOD = '#33240f', WOOD_DK = '#1a1106', IRON = '#211b13', IRON_HI = '#3a3328';
const GEM_TEAL = '#5fd0dd', GEM_RED = '#e0506a', GEM_PURPLE = '#9f6fd6';

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

// the stone frame = full rect MINUS the round-arch opening (even-odd → the opening is a hole)
const OPENING_D =
  `M${OPEN_L} ${FLOOR_Y} L${OPEN_L} ${SPRING_Y} ` +
  `Q${OPEN_L} ${CROWN_Y} ${CROWN_X} ${CROWN_Y} ` +
  `Q${OPEN_R} ${CROWN_Y} ${OPEN_R} ${SPRING_Y} L${OPEN_R} ${FLOOR_Y} Z`;
const FRAME_D = `M0 0 H${VW} V${VH} H0 Z ${OPENING_D}`;
// the spandrel band of stone above the arch (between the pillars, above the arch curve)
const ARCHBAND_D =
  `M${OPEN_L} 0 H${OPEN_R} V${SPRING_Y} ` +
  `Q${OPEN_R} ${CROWN_Y} ${CROWN_X} ${CROWN_Y} ` +
  `Q${OPEN_L} ${CROWN_Y} ${OPEN_L} ${SPRING_Y} Z`;

function archPoint(t) {
  if (t <= 0.5) {
    const u = t / 0.5, mt = 1 - u;
    return [mt * mt * OPEN_L + 2 * mt * u * OPEN_L + u * u * CROWN_X,
            mt * mt * SPRING_Y + 2 * mt * u * CROWN_Y + u * u * CROWN_Y];
  }
  const u = (t - 0.5) / 0.5, mt = 1 - u;
  return [mt * mt * CROWN_X + 2 * mt * u * OPEN_R + u * u * OPEN_R,
          mt * mt * CROWN_Y + 2 * mt * u * CROWN_Y + u * u * SPRING_Y];
}

// ── weathered masonry: irregular blocks (per-block tone + recessed mortar + lit lower lip +
//    occasional crack), drawn over the dark MORTAR frame fill so gaps read as recessed mortar ──
function stoneWall(x0, x1, y0, y1, rng, clipId) {
  const GAP = 5;
  let out = `<g clip-path='url(#${clipId})'>`;
  let row = 0;
  for (let y = y0; y < y1 + 60; row++) {
    const courseH = 52 + rng() * 18;             // varied course height
    const stagger = (row % 2) * (0.4 + rng() * 0.2);
    let x = x0 - (0.5 + stagger) * 120;
    while (x < x1 + 60) {
      const w = 92 + rng() * 64;                 // varied block width
      const bx = x + GAP / 2, by = y + GAP / 2, bw = w - GAP, bh = courseH - GAP;
      const tone = STONE_TONES[(rng() * STONE_TONES.length) | 0];
      out += `<rect x='${f2(bx)}' y='${f2(by)}' width='${f2(bw)}' height='${f2(bh)}' rx='2.5' fill='${tone}'/>`;
      // lit lower lip + chamfer highlight (light skims the bottom edge)
      out += `<line x1='${f2(bx + 1)}' y1='${f2(by + bh - 1.5)}' x2='${f2(bx + bw - 1)}' y2='${f2(by + bh - 1.5)}' stroke='${STONE_HI}' stroke-opacity='0.16' stroke-width='2'/>`;
      // top inner shadow (AO under the course above)
      out += `<line x1='${f2(bx + 1)}' y1='${f2(by + 1)}' x2='${f2(bx + bw - 1)}' y2='${f2(by + 1)}' stroke='#000' stroke-opacity='0.28' stroke-width='2'/>`;
      // occasional crack
      if (rng() < 0.12) {
        let cx = bx + bw * (0.2 + rng() * 0.6), cy = by + 2;
        let d = `M${f2(cx)} ${f2(cy)}`;
        const segs = 2 + ((rng() * 3) | 0);
        for (let s = 0; s < segs; s++) { cx += (rng() - 0.5) * 18; cy += bh / segs; d += ` L${f2(cx)} ${f2(Math.min(cy, by + bh - 1))}`; }
        out += `<path d='${d}' fill='none' stroke='#000' stroke-opacity='0.5' stroke-width='1.4'/>`;
      }
      // occasional chipped corner
      if (rng() < 0.08) {
        const c = rng() < 0.5 ? [bx, by] : [bx + bw, by];
        const sgn = c[0] === bx ? 1 : -1;
        out += `<path d='M${f2(c[0])} ${f2(c[1])} l${f2(sgn * 10)} 0 l${f2(-sgn * 10)} 10 Z' fill='${MORTAR}'/>`;
      }
      x += w;
    }
    y += courseH;
  }
  out += '</g>';
  return out;
}

// ── an iron wall-mounted torch (bracket + shaft + basket + organic flame), basket at (x,y) ──
function torch(x, y, flip) {
  const s = flip ? -1 : 1;
  return `<g transform='translate(${f2(x)} ${f2(y)})'>` +
    `<ellipse cx='2' cy='2' rx='168' ry='220' fill='url(#torchGlow)'/>` +       // big soft pool
    `<ellipse cx='0' cy='-30' rx='62' ry='86' fill='url(#torchCore)'/>` +        // tight bright core
    // wrought-iron wall bracket (back-plate + angled arm + rivets)
    `<rect x='${f2(s * 16 - 8)}' y='34' width='16' height='44' rx='3' fill='${IRON}'/>` +
    `<circle cx='${f2(s * 16)}' cy='42' r='2' fill='${IRON_HI}'/><circle cx='${f2(s * 16)}' cy='70' r='2' fill='${IRON_HI}'/>` +
    `<path d='M${f2(s * 16)} 56 L0 30' stroke='${IRON}' stroke-width='6' stroke-linecap='round'/>` +
    // shaft
    `<rect x='-5' y='-26' width='10' height='70' rx='4' fill='${IRON}'/>` +
    `<rect x='-5' y='-26' width='4' height='70' rx='2' fill='#15110b'/>` +
    // fire-basket (tapered iron cage)
    `<path d='M-22 -28 L22 -28 L15 2 L-15 2 Z' fill='${IRON}'/>` +
    `<path d='M-22 -28 L22 -28 L15 2 L-15 2 Z' fill='none' stroke='#15110b' stroke-width='2'/>` +
    `<path d='M-13 -28 L-9 2 M0 -28 L0 2 M13 -28 L9 2' stroke='#15110b' stroke-width='1.6'/>` +
    `<ellipse cx='0' cy='-28' rx='22' ry='6' fill='${IRON_HI}'/>` +
    // organic flame (asymmetric, layered hot → bright core)
    `<path d='M-15 -30 Q-20 -64 -3 -84 Q-10 -56 4 -64 Q-2 -44 12 -58 Q10 -36 16 -30 Q4 -22 -15 -30 Z' fill='#e9621a'/>` +
    `<path d='M-9 -32 Q-13 -58 0 -76 Q-5 -52 6 -58 Q1 -42 9 -50 Q8 -38 9 -32 Q1 -26 -9 -32 Z' fill='#ff9b2e'/>` +
    `<path d='M-4 -34 Q-7 -54 1 -68 Q-1 -50 4 -52 Q2 -40 4 -36 Z' fill='#ffd95e'/>` +
    `<path d='M-1 -36 Q-3 -50 1 -60 Q1 -46 2 -40 Z' fill='#fff6c8'/>` +
    `</g>`;
}

// ── a single fierce slit-eye: tight amber glow + narrow almond + vertical slit pupil + heavy
//    brow ridge. ang tilts the eye (negative = inner-up "angry"). ──
function fierceEye(cx, cy, s, ang) {
  const E = (n) => f2(n);
  return `<ellipse cx='${E(cx)}' cy='${E(cy)}' rx='${E(15 * s)}' ry='${E(10 * s)}' fill='url(#eyeGlow)'/>` +
    `<g transform='rotate(${f2(ang)} ${E(cx)} ${E(cy)})'>` +
    // almond
    `<path d='M${E(cx - 12 * s)} ${E(cy)} Q${E(cx)} ${E(cy - 6.5 * s)} ${E(cx + 12 * s)} ${E(cy)} Q${E(cx)} ${E(cy + 6.5 * s)} ${E(cx - 12 * s)} ${E(cy)} Z' fill='#ffb733'/>` +
    `<path d='M${E(cx - 8 * s)} ${E(cy)} Q${E(cx)} ${E(cy - 4 * s)} ${E(cx + 8 * s)} ${E(cy)} Q${E(cx)} ${E(cy + 4 * s)} ${E(cx - 8 * s)} ${E(cy)} Z' fill='#ffe79a'/>` +
    // vertical slit pupil
    `<path d='M${E(cx)} ${E(cy - 5.5 * s)} Q${E(cx + 1.8 * s)} ${E(cy)} ${E(cx)} ${E(cy + 5.5 * s)} Q${E(cx - 1.8 * s)} ${E(cy)} ${E(cx)} ${E(cy - 5.5 * s)} Z' fill='#160a00'/>` +
    // heavy brow ridge above
    `<path d='M${E(cx - 14 * s)} ${E(cy - 2 * s)} Q${E(cx - 2 * s)} ${E(cy - 11 * s)} ${E(cx + 14 * s)} ${E(cy - 5 * s)} L${E(cx + 14 * s)} ${E(cy - 1.5 * s)} Q${E(cx - 2 * s)} ${E(cy - 7 * s)} ${E(cx - 14 * s)} ${E(cy + 1.5 * s)} Z' fill='${DRAGON}'/>` +
    `</g>`;
}

function buildSvg() {
  // ── dragon: traced silhouette, recoloured + faint torch-lit rim ──
  const traced = JSON.parse(fs.readFileSync(path.join(__dirname, 'dragon-traced.json'), 'utf8'));
  const [dx0, dy0, dx1, dy1] = traced.bbox;
  const dw = dx1 - dx0, dh = dy1 - dy0;
  const targetH = 516;
  const scale = targetH / dh;
  const dragonW = dw * scale;
  const tx = CROWN_X - dragonW * 0.52 - dx0 * scale;
  const ty = (FLOOR_Y - 16) - dy1 * scale;
  const dragon =
    `<ellipse cx='${CROWN_X}' cy='430' rx='440' ry='280' fill='url(#depthHaze)'/>` +
    `<g transform='translate(${f2(tx)} ${f2(ty)}) scale(${f2(scale)})'>` +
    `<path fill-rule='evenodd' fill='${DRAGON_RIM}' d='${traced.path}'/>` +
    `<g transform='translate(2.5 3)'><path fill-rule='evenodd' fill='${DRAGON}' d='${traced.path}'/></g>` +
    `</g>`;
  // EYES — tune these to the chosen dragon's head. The head fractions below locate the eye(s)
  // within the traced bbox. EYE_MODE: 'pair' (front/3-quarter head) or 'single' (profile head).
  // single profile eye on the snarling head (upper-right of the silhouette)
  const EYE_MODE = 'single';
  const ex = tx + (dx0 + dw * 0.735) * scale;
  const ey = ty + (dy0 + dh * 0.205) * scale;
  const eyes = EYE_MODE === 'pair'
    ? fierceEye(ex, ey + 3, 1.05, -10) + fierceEye(ex + 30, ey, 1.0, 10)
    : fierceEye(ex, ey, 1.3, -14);

  // ── treasure hoard (coin mound + chest + goblet + crown + gems + sparkle) ──
  const hrng = mulberry32(0xd4a9203);
  const hr = (lo, hi) => lo + (hi - lo) * hrng();
  const HX = 905, HY = 598;
  const coin = (cx, cy, r) => {
    const base = hrng() < 0.5 ? GOLD : GOLD_DEEP;
    return `<ellipse cx='${f2(cx)}' cy='${f2(cy)}' rx='${f2(r)}' ry='${f2(r * 0.42)}' fill='${base}'/>` +
      `<path d='M${f2(cx - r * 0.8)} ${f2(cy - r * 0.06)} Q${f2(cx)} ${f2(cy - r * 0.42)} ${f2(cx + r * 0.8)} ${f2(cy - r * 0.06)}' fill='none' stroke='${GOLD_HI}' stroke-opacity='0.8' stroke-width='${f2(r * 0.18)}'/>`;
  };
  let coins = '';
  for (let i = 0; i < 46; i++) {
    const t = hrng();
    const cx = HX + hr(-150, 175), cy = HY + (1 - t) * hr(-26, 4) + hr(8, 52), r = hr(7, 14);
    coins += coin(cx, cy, r);
  }
  const hoard =
    `<ellipse cx='${HX + 8}' cy='${HY + 28}' rx='250' ry='108' fill='url(#hoardGlow)'/>` +
    `<path d='M${HX - 190} ${HY + 64} Q${HX + 8} ${HY - 14} ${HX + 206} ${HY + 64} Q${HX + 8} ${HY + 96} ${HX - 190} ${HY + 64} Z' fill='${GOLD_DK}'/>` +
    // crown (back of the mound)
    `<g transform='translate(${HX + 96} ${HY - 4})'><path d='M-26 14 L-26 -2 L-14 8 L0 -8 L14 8 L26 -2 L26 14 Z' fill='${GOLD_DEEP}'/><path d='M-26 14 L26 14' stroke='${GOLD_HI}' stroke-width='2'/><circle cx='-14' cy='9' r='2.4' fill='${GEM_RED}'/><circle cx='0' cy='-7' r='2.6' fill='${GEM_TEAL}'/><circle cx='14' cy='9' r='2.4' fill='${GEM_PURPLE}'/></g>` +
    coins +
    // open chest (left)
    `<g transform='translate(${HX - 200} ${HY + 8})'>` +
    `<path d='M-6 56 Q44 28 94 56 L94 42 Q44 16 -6 42 Z' fill='${WOOD_DK}'/>` +
    `<path d='M-2 50 Q44 28 90 50 L90 44 Q44 24 -2 44 Z' fill='${GOLD_DK}'/>` +
    `<rect x='-6' y='52' width='100' height='46' rx='5' fill='${WOOD}'/>` +
    `<rect x='-6' y='52' width='100' height='46' rx='5' fill='none' stroke='${WOOD_DK}' stroke-width='3'/>` +
    `<rect x='2' y='60' width='84' height='30' fill='${GOLD_DEEP}'/>` +
    `<path d='M2 74 Q44 64 86 74' fill='none' stroke='${GOLD_HI}' stroke-opacity='0.7' stroke-width='3'/>` +
    `<rect x='38' y='56' width='12' height='44' fill='${IRON}'/></g>` +
    // goblet (right)
    `<g transform='translate(${HX + 178} ${HY + 30})'><path d='M-9 -18 Q0 -6 9 -18 L7 -18 Q0 -10 -7 -18 Z' fill='${GOLD}'/><rect x='-1.6' y='-10' width='3.2' height='16' fill='${GOLD_DEEP}'/><path d='M-10 8 Q0 14 10 8 L8 6 L-8 6 Z' fill='${GOLD_DEEP}'/></g>` +
    // gems
    `<path d='M${HX + 150} ${HY + 24} l10 7 l-3 12 l-7 4 l-7 -4 l-3 -12 Z' fill='${GEM_TEAL}'/><path d='M${HX + 150} ${HY + 24} l10 7 l-10 5 l-10 -5 Z' fill='#bdf2f8'/>` +
    `<path d='M${HX - 96} ${HY + 40} l8 6 l-2 10 l-6 3 l-6 -3 l-2 -10 Z' fill='${GEM_RED}'/>` +
    // sparkles
    `<g fill='#fff7d6'><circle cx='${HX - 40}' cy='${HY + 4}' r='2.6'/><circle cx='${HX + 64}' cy='${HY - 6}' r='2.8'/><circle cx='${HX + 132}' cy='${HY + 16}' r='2.2'/><circle cx='${HX + 8}' cy='${HY + 18}' r='2'/></g>`;

  // ── stone frame + weathered masonry + arch voussoirs + opening AO ──
  const frame = `<path fill='${MORTAR}' fill-rule='evenodd' d='${FRAME_D}'/>`;
  const walls =
    stoneWall(-4, OPEN_L + 6, 96, FLOOR_Y, mulberry32(0x57a93b1), 'leftWall') +
    stoneWall(OPEN_R - 6, VW + 4, 96, FLOOR_Y, mulberry32(0x91c2f5), 'rightWall') +
    stoneWall(OPEN_L - 4, OPEN_R + 4, 0, SPRING_Y + 30, mulberry32(0x3ad17e), 'archBand');
  // voussoir ring around the arch (wedge stones)
  let vouss = '';
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const [ax, ay] = archPoint(t);
    const nx = ax - CROWN_X, ny = ay - (SPRING_Y + 70);
    const nl = Math.hypot(nx, ny) || 1;
    const ux = nx / nl, uy = ny / nl;
    vouss += `<line x1='${f2(ax - ux * 2)}' y1='${f2(ay - uy * 2)}' x2='${f2(ax + ux * 70)}' y2='${f2(ay + uy * 70)}' stroke='${MORTAR}' stroke-width='3.5'/>`;
  }
  // ambient occlusion: stone darkens into the opening (a soft dark reveal) + a lit inner edge
  const ao =
    `<path d='${OPENING_D}' fill='none' stroke='#000' stroke-opacity='0.42' stroke-width='26'/>` +
    `<path d='${OPENING_D}' fill='none' stroke='#000' stroke-opacity='0.4' stroke-width='12'/>` +
    `<path d='${OPENING_D}' fill='none' stroke='${STONE_HI}' stroke-opacity='0.4' stroke-width='2.5'/>`;
  // warm torch wash on the stone near each torch (low opacity, over the masonry)
  const warmWash =
    `<ellipse cx='${OPEN_L - 90}' cy='350' rx='170' ry='240' fill='url(#warmStone)'/>` +
    `<ellipse cx='${OPEN_R + 90}' cy='350' rx='170' ry='240' fill='url(#warmStone)'/>`;

  // ── receding flagstone floor (per-tile tone + dark grout + warm reflection) ──
  let floor = `<rect x='0' y='${FLOOR_Y}' width='${VW}' height='${VH - FLOOR_Y}' fill='url(#floorGrad)'/>`;
  const frng = mulberry32(0x1f7b3c);
  const rows = [FLOOR_Y, FLOOR_Y + 30, FLOOR_Y + 64, VH];
  for (let r = 0; r < rows.length - 1; r++) {
    const yT = rows[r], yB = rows[r + 1];
    const persp = 0.5 + r * 0.22;                 // nearer rows have wider tiles
    const tileW = 120 * persp;
    const off = (r % 2) * tileW * 0.5;
    for (let x = -tileW; x < VW + tileW; x += tileW) {
      const tone = FLOOR_TONES[(frng() * FLOOR_TONES.length) | 0];
      const x0t = x + off + 3, x1t = x + off + tileW - 3;
      floor += `<path d='M${f2(x0t)} ${f2(yT + 2)} H${f2(x1t)} V${f2(yB - 2)} H${f2(x0t)} Z' fill='${tone}'/>`;
      // lit front lip
      floor += `<line x1='${f2(x0t)}' y1='${f2(yB - 3)}' x2='${f2(x1t)}' y2='${f2(yB - 3)}' stroke='${STONE_HI}' stroke-opacity='0.12' stroke-width='2'/>`;
      if (frng() < 0.16) floor += `<path d='M${f2(x0t + (x1t - x0t) * 0.4)} ${f2(yT + 4)} L${f2(x0t + (x1t - x0t) * 0.55)} ${f2(yB - 6)}' stroke='${GROUT}' stroke-width='1.4'/>`;
    }
  }
  // grout lines + warm reflection pooling under the hoard/torches
  floor += `<line x1='0' y1='${FLOOR_Y + 1}' x2='${VW}' y2='${FLOOR_Y + 1}' stroke='${GROUT}' stroke-width='3'/>`;
  floor += `<ellipse cx='${HX}' cy='${FLOOR_Y + 30}' rx='300' ry='40' fill='url(#floorWarm)'/>`;

  // ── ceiling fade + corner vignette ──
  const ceiling = `<rect x='0' y='0' width='${VW}' height='250' fill='url(#topFade)'/>`;
  const vignette = `<rect x='0' y='0' width='${VW}' height='${VH}' fill='url(#vig)'/>`;

  return `<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}' viewBox='0 0 ${VW} ${VH}' preserveAspectRatio='xMidYMax meet'>` +
    `<defs>` +
    `<linearGradient id='depthGrad' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${DEPTH_TOP}'/><stop offset='1' stop-color='${DEPTH_BOT}'/></linearGradient>` +
    `<linearGradient id='floorGrad' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#0e0b07'/><stop offset='1' stop-color='#19140d'/></linearGradient>` +
    `<linearGradient id='topFade' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${DEPTH_TOP}'/><stop offset='1' stop-color='${DEPTH_TOP}' stop-opacity='0'/></linearGradient>` +
    `<radialGradient id='torchGlow' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(255,180,80,0.42)'/><stop offset='0.45' stop-color='rgba(255,135,40,0.13)'/><stop offset='1' stop-color='rgba(255,125,35,0)'/></radialGradient>` +
    `<radialGradient id='torchCore' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(255,225,150,0.6)'/><stop offset='0.5' stop-color='rgba(255,170,70,0.18)'/><stop offset='1' stop-color='rgba(255,150,50,0)'/></radialGradient>` +
    `<radialGradient id='warmStone' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(255,150,60,0.16)'/><stop offset='1' stop-color='rgba(255,140,50,0)'/></radialGradient>` +
    `<radialGradient id='eyeGlow' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='#fff0bf'/><stop offset='0.4' stop-color='#ffa322'/><stop offset='1' stop-color='rgba(255,130,15,0)'/></radialGradient>` +
    `<radialGradient id='depthHaze' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(158,84,26,0.42)'/><stop offset='0.55' stop-color='rgba(104,50,15,0.16)'/><stop offset='1' stop-color='rgba(60,30,10,0)'/></radialGradient>` +
    `<radialGradient id='hoardGlow' cx='0.5' cy='0.55' r='0.55'><stop offset='0' stop-color='rgba(255,196,76,0.42)'/><stop offset='1' stop-color='rgba(255,165,38,0)'/></radialGradient>` +
    `<radialGradient id='floorWarm' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(255,170,70,0.22)'/><stop offset='1' stop-color='rgba(255,150,50,0)'/></radialGradient>` +
    `<radialGradient id='vig' cx='0.5' cy='0.45' r='0.74'><stop offset='0.45' stop-color='rgba(0,0,0,0)'/><stop offset='1' stop-color='rgba(0,0,0,0.72)'/></radialGradient>` +
    `<clipPath id='leftWall'><rect x='0' y='0' width='${OPEN_L}' height='${FLOOR_Y}'/></clipPath>` +
    `<clipPath id='rightWall'><rect x='${OPEN_R}' y='0' width='${VW - OPEN_R}' height='${FLOOR_Y}'/></clipPath>` +
    `<clipPath id='archBand'><path d='${ARCHBAND_D}'/></clipPath>` +
    `</defs>` +
    `<rect width='${VW}' height='${VH}' fill='url(#depthGrad)'/>` +
    dragon +
    eyes +
    hoard +
    frame +
    walls +
    vouss +
    warmWash +
    ao +
    floor +
    torch(OPEN_L + 26, 322, false) +
    torch(OPEN_R - 26, 322, true) +
    ceiling +
    vignette +
    `</svg>`;
}

const toDataUri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);

function writeCss(dataUri) {
  const cssPath = path.join(__dirname, '..', 'src', 'styles', 'themes.css');
  let css = fs.readFileSync(cssPath, 'utf8');
  const re = /(\[data-theme="dnd"\]::after\s*\{[\s\S]*?url\(")data:image\/svg\+xml,[^"]*width%3D'1600'[^"]*("\))/;
  if (!re.test(css)) throw new Error('D&D ::after scene data-URI (width=1600) not found in themes.css');
  css = css.replace(re, `$1${dataUri}$2`);
  fs.writeFileSync(cssPath, css);
  console.log('Baked D&D dungeon scene into', path.relative(process.cwd(), cssPath), `(${dataUri.length} bytes)`);
}

async function writePreviewPng(svg, outPath) {
  const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));
  const grad = Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#070504'/><stop offset='1' stop-color='#15110a'/></linearGradient></defs><rect width='${VW}' height='${VH}' fill='url(#g)'/></svg>`);
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
  const pngPath = pngFlag !== -1 ? args[pngFlag + 1] : path.join(process.env.TMPDIR || '.', 'dungeon-scene.png');
  console.log(`SVG ${svg.length} bytes, data-URI ${dataUri.length} bytes`);
  try { await writePreviewPng(svg, pngPath); } catch (e) { console.error('preview skipped:', e.message); }
})();
