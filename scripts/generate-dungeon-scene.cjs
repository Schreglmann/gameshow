/* Compose the D&D theme's "dragon's lair" background and (optionally) bake it into the
 * `[data-theme="dnd"]::after` rule in src/styles/themes.css.
 *
 * SCENE (per the user): you look THROUGH a torchlit stone archway into a dragon's lair.
 *   - FRAME   = a heavy stone archway: two block pillars + a round arch, hewn from mortared
 *               blocks, with a wall-mounted torch on each inner pillar face.
 *   - OPENING = the dark depths beyond, where the DRAGON looms (the real heraldic Welsh
 *               dragon, vectorised by scripts/trace-dragon-reference.cjs into
 *               scripts/dragon-traced.json) — recoloured near-black with a torch-lit rim and
 *               a pair of glowing amber eyes.
 *   - FLOOR   = flagstones in the foreground; a TREASURE HOARD (gold pile + open chest +
 *               gems) glints at the dragon's feet inside the opening.
 *   - CEILING = the top sinks into black (a dark fade) so the band blends seamlessly into the
 *               theme's dark body gradient above it (sized `100% auto`, anchored bottom).
 *
 * QUALITY DISCIPLINE (from the Hogwarts scene): FLAT vector + SVG gradients only — NO SVG
 * filters (feTurbulence/feGaussianBlur don't render identically under `sharp`, which would
 * make the preview lie). Animated torch flicker + embers are CSS overlays in themes.css, not
 * baked here. Deterministic mulberry32 PRNG only (no clock, no global random) so the baked
 * data-URI is reproducible.
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
// floor / arch geometry
const FLOOR_Y = 660;          // top of the foreground flagstone floor
const OPEN_L = 300, OPEN_R = 1300;   // inner faces of the pillars (opening width)
const SPRING_Y = 300;         // arch springline
const CROWN_Y = 116;          // arch crown
const CROWN_X = 800;

// ── palette ──
const DEPTH_TOP = '#070504', DEPTH_BOT = '#16110a';   // the dark beyond
const STONE = '#39322a', STONE_HI = '#4d4538', STONE_LO = '#231d15', MORTAR = '#14100a';
const DRAGON = '#0a0805', DRAGON_RIM = '#211a10';
const FLOOR_C = '#1b1610', FLOOR_HI = '#272016', FLOOR_JOINT = '#0d0a06';
const GOLD = '#ffd24a', GOLD_DEEP = '#caa23a', GOLD_DK = '#7a5a16';
const WOOD = '#3a2a18', WOOD_DK = '#211408', IRON = '#2a231a';
const GEM_TEAL = '#67d6e0', GEM_PINK = '#e0607a';

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

// the stone frame = full rect MINUS the round-arch opening (even-odd → the opening is a hole)
const OPENING_D =
  `M${OPEN_L} ${FLOOR_Y} L${OPEN_L} ${SPRING_Y} ` +
  `Q${OPEN_L} ${CROWN_Y} ${CROWN_X} ${CROWN_Y} ` +
  `Q${OPEN_R} ${CROWN_Y} ${OPEN_R} ${SPRING_Y} L${OPEN_R} ${FLOOR_Y} Z`;
const FRAME_D = `M0 0 H${VW} V${VH} H0 Z ${OPENING_D}`;

// point on the arch centreline at parameter t∈[0,1] (left springline → crown → right springline)
function archPoint(t) {
  if (t <= 0.5) {
    const u = t / 0.5; // left quadratic: (OPEN_L,SPRING_Y) ctrl (OPEN_L,CROWN_Y) -> (CROWN_X,CROWN_Y)
    const mt = 1 - u;
    return [mt * mt * OPEN_L + 2 * mt * u * OPEN_L + u * u * CROWN_X,
            mt * mt * SPRING_Y + 2 * mt * u * CROWN_Y + u * u * CROWN_Y];
  }
  const u = (t - 0.5) / 0.5; // right quadratic: (CROWN_X,CROWN_Y) ctrl (OPEN_R,CROWN_Y) -> (OPEN_R,SPRING_Y)
  const mt = 1 - u;
  return [mt * mt * CROWN_X + 2 * mt * u * OPEN_R + u * u * OPEN_R,
          mt * mt * CROWN_Y + 2 * mt * u * CROWN_Y + u * u * SPRING_Y];
}

// ── mortared blocks inside a clip rect: horizontal courses + staggered vertical joints ──
function blockwork(x0, x1, y0, y1, rng, course = 64) {
  let out = '';
  let row = 0;
  for (let y = y0; y <= y1 + course; y += course, row++) {
    out += `<line x1='${x0}' y1='${f2(y)}' x2='${x1}' y2='${f2(y)}' stroke='${MORTAR}' stroke-width='3'/>`;
    // a faint lit top-edge on each course (catches torchlight) just under the mortar
    out += `<line x1='${x0}' y1='${f2(y + 2.5)}' x2='${x1}' y2='${f2(y + 2.5)}' stroke='${STONE_HI}' stroke-opacity='0.18' stroke-width='2'/>`;
    const offset = (row % 2) * (course * 0.5);
    for (let x = x0 + offset; x <= x1; x += course) {
      const jx = x + (rng() - 0.5) * 8;
      out += `<line x1='${f2(jx)}' y1='${f2(y)}' x2='${f2(jx)}' y2='${f2(y + course)}' stroke='${MORTAR}' stroke-width='2.5'/>`;
    }
  }
  return out;
}

// ── a wall-mounted torch sconce (bracket + handle + bowl + flame), bowl centred at (x,y) ──
function torch(x, y, flip) {
  const s = flip ? -1 : 1; // bracket arm points toward the opening
  return `<g transform='translate(${f2(x)} ${f2(y)})'>` +
    // soft baked glow (a static warm pool; the animated flicker is a CSS overlay)
    `<ellipse cx='0' cy='6' rx='150' ry='200' fill='url(#torchGlow)'/>` +
    // wall bracket plate + arm
    `<rect x='${f2(s * 14 - 9)}' y='40' width='18' height='30' rx='3' fill='${WOOD_DK}'/>` +
    `<rect x='${f2(Math.min(0, s * 30))}' y='44' width='30' height='7' rx='3' fill='${IRON}'/>` +
    // handle
    `<rect x='-6' y='8' width='12' height='150' rx='5' fill='${WOOD}'/>` +
    `<rect x='-6' y='8' width='5' height='150' rx='3' fill='${WOOD_DK}'/>` +
    // wrap bands
    `<rect x='-7' y='34' width='14' height='4' rx='1.5' fill='${WOOD_DK}'/>` +
    `<rect x='-7' y='70' width='14' height='4' rx='1.5' fill='${WOOD_DK}'/>` +
    `<rect x='-7' y='110' width='14' height='4' rx='1.5' fill='${WOOD_DK}'/>` +
    // bowl
    `<path d='M-26 4 Q0 24 26 4 L18 -6 Q0 8 -18 -6 Z' fill='${IRON}'/>` +
    `<ellipse cx='0' cy='-4' rx='24' ry='8' fill='#3a3024'/>` +
    `<ellipse cx='0' cy='-4' rx='18' ry='5.5' fill='#0e0b06'/>` +
    // flame (baked static; CSS adds the flicker)
    `<path d='M0 -8 Q-16 -44 0 -78 Q16 -44 0 -8 Z' fill='#ff8a2a'/>` +
    `<path d='M0 -12 Q-8 -40 0 -62 Q8 -40 0 -12 Z' fill='#ffd757'/>` +
    `<path d='M0 -16 Q-3 -34 0 -50 Q3 -34 0 -16 Z' fill='#fff1b8'/>` +
    `</g>`;
}

function buildSvg() {
  // ── dragon: traced silhouette, recoloured + torch-lit rim + glowing eyes ──
  const traced = JSON.parse(fs.readFileSync(path.join(__dirname, 'dragon-traced.json'), 'utf8'));
  const [dx0, dy0, dx1, dy1] = traced.bbox;
  const dw = dx1 - dx0, dh = dy1 - dy0;
  // fit the dragon into the opening: imposing, head high, feet near the floor
  const targetH = 470;
  const scale = targetH / dh;
  const dragonW = dw * scale;
  const tx = CROWN_X - dragonW * 0.52 - dx0 * scale; // centre-ish, leaning slightly left (it faces left)
  const ty = (FLOOR_Y - 18) - dy1 * scale;           // feet just above the opening floor
  const dragon =
    // a faint warm ember-glow deep behind the dragon so it silhouettes naturally (not pure black)
    `<ellipse cx='${CROWN_X}' cy='420' rx='430' ry='270' fill='url(#depthHaze)'/>` +
    `<g transform='translate(${f2(tx)} ${f2(ty)}) scale(${f2(scale)})'>` +
    // rim first (small offset up/left), then the body on top → just a faint torch-lit edge, not an outline
    `<path fill-rule='evenodd' fill='${DRAGON_RIM}' d='${traced.path}'/>` +
    `<g transform='translate(2.5 3)'><path fill-rule='evenodd' fill='${DRAGON}' d='${traced.path}'/></g>` +
    `</g>`;
  // glowing eyes — placed over the dragon's head (upper-left of the silhouette). Two stacked
  // for a soft socket glow + a hot core. Coords derived from the head region of the trace.
  const eyeX = tx + (dx0 + dw * 0.205) * scale;
  const eyeY = ty + (dy0 + dh * 0.165) * scale;
  const eyes =
    `<ellipse cx='${f2(eyeX)}' cy='${f2(eyeY)}' rx='19' ry='13' fill='url(#eyeGlow)'/>` +
    `<ellipse cx='${f2(eyeX + 26)}' cy='${f2(eyeY - 3)}' rx='16' ry='11' fill='url(#eyeGlow)'/>` +
    `<ellipse cx='${f2(eyeX)}' cy='${f2(eyeY)}' rx='4' ry='7.5' fill='#3a1c00'/>` +
    `<ellipse cx='${f2(eyeX + 26)}' cy='${f2(eyeY - 3)}' rx='3.6' ry='6.5' fill='#3a1c00'/>`;

  // ── treasure hoard on the opening floor (gold pile + open chest + gems + sparkle) ──
  const hrng = mulberry32(0xd4a9203);
  const hr = (lo, hi) => lo + (hi - lo) * hrng();
  const HX = 905, HY = 600;
  let coins = '';
  for (let i = 0; i < 26; i++) {
    const cx = HX + hr(-120, 150), cy = HY + hr(-6, 48), r = hr(7, 14);
    coins += `<ellipse cx='${f2(cx)}' cy='${f2(cy)}' rx='${f2(r)}' ry='${f2(r * 0.4)}' fill='${hrng() < 0.5 ? GOLD : GOLD_DEEP}'/>`;
  }
  const hoard =
    `<ellipse cx='${HX + 10}' cy='${HY + 30}' rx='230' ry='95' fill='url(#hoardGlow)'/>` +
    `<ellipse cx='${HX + 10}' cy='${HY + 44}' rx='165' ry='40' fill='${GOLD_DK}'/>` +
    coins +
    // open chest, lid back
    `<g transform='translate(${HX - 150} ${HY + 6})'>` +
    `<path d='M-6 56 Q44 30 94 56 L94 44 Q44 20 -6 44 Z' fill='${WOOD_DK}'/>` +
    `<rect x='-6' y='52' width='100' height='44' rx='5' fill='${WOOD}'/>` +
    `<rect x='-6' y='52' width='100' height='44' rx='5' fill='none' stroke='${WOOD_DK}' stroke-width='3'/>` +
    `<rect x='2' y='60' width='84' height='30' fill='${GOLD_DEEP}'/>` +
    `<rect x='38' y='58' width='12' height='40' fill='${IRON}'/></g>` +
    // gems
    `<path d='M${HX + 150} ${HY + 18} l11 14 l-11 14 l-11 -14 Z' fill='${GEM_TEAL}'/>` +
    `<path d='M${HX + 186} ${HY + 36} l8 10 l-8 10 l-8 -10 Z' fill='${GEM_PINK}'/>` +
    // sparkles
    `<g fill='#fff7d6'><circle cx='${HX - 30}' cy='${HY + 6}' r='2.6'/><circle cx='${HX + 70}' cy='${HY - 2}' r='2.6'/><circle cx='${HX + 130}' cy='${HY + 20}' r='2.2'/></g>`;

  // ── stone frame + blockwork + arch voussoirs ──
  const srng = mulberry32(0x57a93b1);
  const frame = `<path fill='url(#stoneGrad)' fill-rule='evenodd' d='${FRAME_D}'/>`;
  const mortar =
    `<g clip-path='url(#leftWall)'>${blockwork(-4, OPEN_L + 4, 110, FLOOR_Y, srng)}</g>` +
    `<g clip-path='url(#rightWall)'>${blockwork(OPEN_R - 4, VW + 4, 110, FLOOR_Y, srng)}</g>`;
  // voussoir stones along the arch (radial ticks straddling the arch line)
  let vouss = '';
  for (let i = 0; i <= 22; i++) {
    const t = i / 22;
    const [ax, ay] = archPoint(t);
    // outward normal ≈ away from arch centre (CROWN_X, SPRING_Y+40)
    const nx = ax - CROWN_X, ny = ay - (SPRING_Y + 60);
    const nl = Math.hypot(nx, ny) || 1;
    const ux = nx / nl, uy = ny / nl;
    vouss += `<line x1='${f2(ax - ux * 4)}' y1='${f2(ay - uy * 4)}' x2='${f2(ax + ux * 64)}' y2='${f2(ay + uy * 64)}' stroke='${MORTAR}' stroke-width='3'/>`;
  }
  // a lit inner edge around the opening (torchlight catching the arch reveal)
  const reveal = `<path d='${OPENING_D}' fill='none' stroke='${STONE_HI}' stroke-opacity='0.5' stroke-width='4'/>` +
    `<path d='${OPENING_D}' fill='none' stroke='#000' stroke-opacity='0.55' stroke-width='10' transform='translate(6 6)'/>`;

  // ── foreground flagstone floor ──
  let floor = `<rect x='0' y='${FLOOR_Y}' width='${VW}' height='${VH - FLOOR_Y}' fill='url(#floorGrad)'/>`;
  floor += `<line x1='0' y1='${FLOOR_Y + 2}' x2='${VW}' y2='${FLOOR_Y + 2}' stroke='${FLOOR_HI}' stroke-opacity='0.5' stroke-width='2'/>`;
  // perspective joints fanning from a vanishing point above the centre
  const vpx = CROWN_X, vpy = 360;
  for (let gx = -200; gx <= VW + 200; gx += 150) {
    floor += `<line x1='${f2(vpx + (gx - vpx) * 0.45)}' y1='${FLOOR_Y}' x2='${gx}' y2='${VH}' stroke='${FLOOR_JOINT}' stroke-width='2.5'/>`;
  }
  for (const fy of [FLOOR_Y + 40, FLOOR_Y + 78]) {
    floor += `<line x1='0' y1='${fy}' x2='${VW}' y2='${fy}' stroke='${FLOOR_JOINT}' stroke-width='2'/>`;
  }

  // ── ceiling fade (top sinks to black so it blends into the body gradient) + vignette ──
  const ceiling = `<rect x='0' y='0' width='${VW}' height='240' fill='url(#topFade)'/>`;
  const vignette = `<rect x='0' y='0' width='${VW}' height='${VH}' fill='url(#vig)'/>`;

  return `<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}' viewBox='0 0 ${VW} ${VH}' preserveAspectRatio='xMidYMax meet'>` +
    `<defs>` +
    `<linearGradient id='depthGrad' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${DEPTH_TOP}'/><stop offset='1' stop-color='${DEPTH_BOT}'/></linearGradient>` +
    `<linearGradient id='stoneGrad' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${STONE_LO}'/><stop offset='0.4' stop-color='${STONE}'/><stop offset='0.85' stop-color='${STONE}'/><stop offset='1' stop-color='${STONE_LO}'/></linearGradient>` +
    `<linearGradient id='floorGrad' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${FLOOR_HI}'/><stop offset='1' stop-color='${FLOOR_C}'/></linearGradient>` +
    `<linearGradient id='topFade' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${DEPTH_TOP}'/><stop offset='1' stop-color='${DEPTH_TOP}' stop-opacity='0'/></linearGradient>` +
    `<radialGradient id='torchGlow' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(255,185,85,0.5)'/><stop offset='0.45' stop-color='rgba(255,140,45,0.16)'/><stop offset='1' stop-color='rgba(255,130,40,0)'/></radialGradient>` +
    `<radialGradient id='eyeGlow' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='#fff3c0'/><stop offset='0.45' stop-color='#ffac2e'/><stop offset='1' stop-color='rgba(255,140,20,0)'/></radialGradient>` +
    `<radialGradient id='depthHaze' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(120,60,18,0.34)'/><stop offset='0.6' stop-color='rgba(90,44,14,0.12)'/><stop offset='1' stop-color='rgba(60,30,10,0)'/></radialGradient>` +
    `<radialGradient id='hoardGlow' cx='0.5' cy='0.55' r='0.55'><stop offset='0' stop-color='rgba(255,200,80,0.45)'/><stop offset='1' stop-color='rgba(255,170,40,0)'/></radialGradient>` +
    `<radialGradient id='vig' cx='0.5' cy='0.46' r='0.72'><stop offset='0.5' stop-color='rgba(0,0,0,0)'/><stop offset='1' stop-color='rgba(0,0,0,0.66)'/></radialGradient>` +
    `<clipPath id='leftWall'><rect x='0' y='0' width='${OPEN_L}' height='${FLOOR_Y}'/></clipPath>` +
    `<clipPath id='rightWall'><rect x='${OPEN_R}' y='0' width='${VW - OPEN_R}' height='${FLOOR_Y}'/></clipPath>` +
    `</defs>` +
    `<rect width='${VW}' height='${VH}' fill='url(#depthGrad)'/>` +
    dragon +
    eyes +
    hoard +
    frame +
    mortar +
    vouss +
    reveal +
    floor +
    torch(OPEN_L + 30, 332, false) +
    torch(OPEN_R - 30, 332, true) +
    ceiling +
    vignette +
    `</svg>`;
}

const toDataUri = (svg) => 'data:image/svg+xml,' + encodeURIComponent(svg);

function writeCss(dataUri) {
  const cssPath = path.join(__dirname, '..', 'src', 'styles', 'themes.css');
  let css = fs.readFileSync(cssPath, 'utf8');
  // Match the SCENE data-URI specifically (it carries width='1600'), NOT other url() layers
  // (the ::after also holds the JS-driven mover sprite layers, which must be left untouched).
  const re = /(\[data-theme="dnd"\]::after\s*\{[\s\S]*?url\(")data:image\/svg\+xml,[^"]*width%3D'1600'[^"]*("\))/;
  if (!re.test(css)) throw new Error('D&D ::after scene data-URI (width=1600) not found in themes.css');
  css = css.replace(re, `$1${dataUri}$2`);
  fs.writeFileSync(cssPath, css);
  console.log('Baked D&D dungeon scene into', path.relative(process.cwd(), cssPath), `(${dataUri.length} bytes)`);
}

async function writePreviewPng(svg, outPath) {
  const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));
  // composite over the theme's dark body gradient so the preview matches the live page
  const grad = Buffer.from(`<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#0a0805'/><stop offset='1' stop-color='#16110a'/></linearGradient></defs><rect width='${VW}' height='${VH}' fill='url(#g)'/></svg>`);
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
