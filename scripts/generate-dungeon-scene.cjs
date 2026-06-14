/* Compose the D&D theme's "dragon's lair" background and (optionally) bake it into the
 * `[data-theme="dnd"]::after` rule in src/styles/themes.css.
 *
 * SCENE: you look THROUGH a torchlit stone archway into a dragon's lair:
 *   - FRAME   = a heavy weathered stone archway. The field masonry is ONE continuous course
 *               grid across pillars + spandrel (a single pass clipped to the frame — separate
 *               per-wall passes left mortar lines that didn't line up). The opening is finished
 *               like real construction: a ring of VOUSSOIR wedge stones around the arch with a
 *               lighter keystone, and jamb QUOINS down the vertical edges. Moss creeps over the
 *               damp low blocks; an iron torch burns on the front face of each pillar.
 *   - OPENING = the cave beyond. A warm ember haze deep in the dark, faint stalactites, a few
 *               drifting embers — and the DRAGON, ASLEEP: a TRACED curled-up silhouette
 *               (scripts/dragon-traced.json — see the dragon() block) filling the cave BEHIND
 *               the treasure hoard. The whole pose reads from the outer contour alone: tail
 *               wrapping a full loop at the left, spiked back ridge, both wings folded as two
 *               peaks, head resting on the ground at the right. No eye — it sleeps.
 *   - HOARD   = the bright focal point: a mound of gold (shaded coins, coin stacks, an open
 *               chest spilling coins, a crown, a half-buried sword, goblets, gems, glints).
 *   - FLOOR   = a warm-lit inner cave floor + a foreground flagstone threshold with the hoard
 *               light spilling out of the opening toward the viewer.
 *   - CEILING = the top sinks into DEPTH_TOP (must match --bg-gradient-from) so the band blends
 *               into the theme's dark body gradient above (sized `100% auto`, anchored bottom).
 *
 * QUALITY DISCIPLINE (from the Hogwarts scene): FLAT vector + SVG gradients only — NO SVG
 * filters (feTurbulence/feGaussianBlur don't render identically under `sharp`). Animated torch
 * flicker is a CSS overlay in themes.css, not baked here. Deterministic mulberry32 PRNG only
 * (no clock/random) so the baked data-URI is reproducible.
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
const FLOOR_Y = 640;          // top of the foreground flagstone threshold
const OPEN_L = 200, OPEN_R = 1400;   // inner faces of the pillars (opening width)
const SPRING_Y = 330;         // arch springline
const CROWN_Y = 84;           // arch crown
const CROWN_X = 800;

// ── palette (dark, weathered, serious) ──
const DEPTH_TOP = '#070504';  // MUST match --bg-gradient-from in themes.css (seam rule)
const DEPTH_BOT = '#171008';
const MORTAR = '#0b0906';
// stone block tones — desaturated cool-brown grey, mostly mid with darker weathered ones
const STONE_TONES = ['#2b2620', '#332d25', '#262019', '#3a342a', '#201b15', '#2e2922', '#241f18'];
const STONE_HI = '#4a4336';   // lit lower-lip / torch-side
const DRAGON = '#0c0806';     // the sleeping mass (darkest base)
const DRAGON_MID = '#150d08'; // posterised mid tone (traced from the reference's own shading)
const DRAGON_LIT = '#2a190d'; // posterised lit tone (wing membranes, lit flank, skull)
const RIM = '#3a2812';        // haze-backlit rim peeking over the silhouette's upper edges
const FLOOR_TONES = ['#1a160f', '#211b12', '#15110b', '#241d13', '#181309'];
const GROUT = '#080603';
const MOSS = '#2c3a1c', MOSS_DK = '#1e2a12';
// warm browns-golds — the old GOLD_DK was olive and tinted the whole mound lime
const GOLD = '#f8c947', GOLD_HI = '#ffefa8', GOLD_DEEP = '#c3922e', GOLD_DK = '#664a10', GOLD_SHADE = '#42300a';
const WOOD = '#3a2812', WOOD_DK = '#221608', IRON = '#211b13', IRON_HI = '#3a3328';
const GEM_TEAL = '#4fb6c2', GEM_RED = '#c2495f', GEM_PURPLE = '#8a61ba';

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

// Catmull-Rom control points → cubic Beziers (open + closed organic curves)
function smoothPath(pts) {
  let d = `M ${f2(pts[0][0])} ${f2(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const k = 1 / 6;
    d += ` C ${f2(p1[0] + (p2[0] - p0[0]) * k)} ${f2(p1[1] + (p2[1] - p0[1]) * k)} ${f2(p2[0] - (p3[0] - p1[0]) * k)} ${f2(p2[1] - (p3[1] - p1[1]) * k)} ${f2(p2[0])} ${f2(p2[1])}`;
  }
  return d;
}
function smoothClosed(pts) {
  const n = pts.length;
  let d = `M ${f2(pts[0][0])} ${f2(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const k = 1 / 6;
    d += ` C ${f2(p1[0] + (p2[0] - p0[0]) * k)} ${f2(p1[1] + (p2[1] - p0[1]) * k)} ${f2(p2[0] - (p3[0] - p1[0]) * k)} ${f2(p2[1] - (p3[1] - p1[1]) * k)} ${f2(p2[0])} ${f2(p2[1])}`;
  }
  return d + ' Z';
}

// the stone frame = full rect MINUS the round-arch opening (even-odd → the opening is a hole)
const OPENING_D =
  `M${OPEN_L} ${FLOOR_Y} L${OPEN_L} ${SPRING_Y} ` +
  `Q${OPEN_L} ${CROWN_Y} ${CROWN_X} ${CROWN_Y} ` +
  `Q${OPEN_R} ${CROWN_Y} ${OPEN_R} ${SPRING_Y} L${OPEN_R} ${FLOOR_Y} Z`;
const FRAME_D = `M0 0 H${VW} V${VH} H0 Z ${OPENING_D}`;

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

// a small damp moss cluster hanging at (x, y) — overlapping soft lobes
function mossTuft(x, y, w, rng) {
  let m = '';
  const n = 3 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const lx = x + (i / (n - 1) - 0.5) * w;
    const rx = w * (0.14 + rng() * 0.12), ry = 4 + rng() * 5;
    m += `<ellipse cx='${f2(lx)}' cy='${f2(y - 1 + rng() * 2)}' rx='${f2(rx)}' ry='${f2(ry)}' fill='${rng() < 0.6 ? MOSS : MOSS_DK}' fill-opacity='0.55'/>`;
  }
  return m;
}

// ── field masonry: ONE continuous course grid over the whole frame (clipped to it), so the
//    mortar lines line up everywhere — across both pillars AND the band above the arch ──
function masonry() {
  const rng = mulberry32(0x57a93b1);
  let out = `<g clip-path='url(#frameClip)'>`;
  const GAP = 5;
  let row = 0;
  for (let y = -12; y < FLOOR_Y; row++) {
    const courseH = 58 + rng() * 16;             // varied but globally consistent course height
    const stagger = (row % 2) * (0.45 + rng() * 0.15);
    let x = -20 - stagger * 150;
    while (x < VW + 60) {
      const w = 112 + rng() * 68;                // large, calm blocks
      const bx = x + GAP / 2, by = y + GAP / 2, bw = w - GAP, bh = courseH - GAP;
      const tone = STONE_TONES[(rng() * STONE_TONES.length) | 0];
      out += `<rect x='${f2(bx)}' y='${f2(by)}' width='${f2(bw)}' height='${f2(bh)}' rx='2.5' fill='${tone}'/>`;
      // light skims the bottom edge; AO under the course above — both subtle
      out += `<line x1='${f2(bx + 1)}' y1='${f2(by + bh - 1.5)}' x2='${f2(bx + bw - 1)}' y2='${f2(by + bh - 1.5)}' stroke='${STONE_HI}' stroke-opacity='0.11' stroke-width='2'/>`;
      out += `<line x1='${f2(bx + 1)}' y1='${f2(by + 1)}' x2='${f2(bx + bw - 1)}' y2='${f2(by + 1)}' stroke='#000' stroke-opacity='0.22' stroke-width='2'/>`;
      if (rng() < 0.08) {                        // occasional crack
        let cx = bx + bw * (0.2 + rng() * 0.6), cy = by + 2;
        let d = `M${f2(cx)} ${f2(cy)}`;
        const segs = 2 + ((rng() * 3) | 0);
        for (let s = 0; s < segs; s++) { cx += (rng() - 0.5) * 16; cy += bh / segs; d += ` L${f2(cx)} ${f2(Math.min(cy, by + bh - 1))}`; }
        out += `<path d='${d}' fill='none' stroke='#000' stroke-opacity='0.4' stroke-width='1.3'/>`;
      }
      if (rng() < 0.05) {                        // occasional chipped corner
        const left = rng() < 0.5;
        const c = left ? [bx, by] : [bx + bw, by];
        const sgn = left ? 1 : -1;
        out += `<path d='M${f2(c[0])} ${f2(c[1])} l${f2(sgn * 10)} 0 l${f2(-sgn * 10)} 10 Z' fill='${MORTAR}'/>`;
      }
      if (by > 480 && rng() < 0.28) {            // moss on the damp low blocks
        out += mossTuft(bx + bw * (0.2 + rng() * 0.5), by + bh - 2, 22 + rng() * 28, rng);
      }
      x += w;
    }
    y += courseH;
  }
  // large-scale shading so the wall doesn't read flat: dark sinks in from the top
  out += `<rect x='0' y='0' width='${VW}' height='${FLOOR_Y}' fill='url(#wallShade)'/>`;
  out += '</g>';
  return out;
}

// ── the arch is BUILT: a ring of voussoir wedge stones (lighter keystone in the middle) +
//    jamb quoins down the vertical opening edges. This is what makes the opening read as
//    constructed instead of mortar lines randomly crossing the arch curve. ──
function voussoirsAndQuoins() {
  const vr = mulberry32(0x9e3779b9);
  const C = [CROWN_X, SPRING_Y + 120];           // virtual center for outward normals
  const unit = (p) => {
    const dx = p[0] - C[0], dy = p[1] - C[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const N = 19;                                  // odd → middle wedge sits at the crown
  const R_OUT = 70;
  let out = '';
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    const p0 = archPoint(t0), p1 = archPoint(t1);
    const n0 = unit(p0), n1 = unit(p1);
    const isKey = i === (N - 1) / 2;
    const r = isKey ? R_OUT + 22 : R_OUT;
    const q = [
      [p0[0] - n0[0] * 1, p0[1] - n0[1] * 1],
      [p1[0] - n1[0] * 1, p1[1] - n1[1] * 1],
      [p1[0] + n1[0] * r, p1[1] + n1[1] * r],
      [p0[0] + n0[0] * r, p0[1] + n0[1] * r],
    ];
    // lighter tone subset so the built ring reads against the field masonry
    const ringTones = [STONE_TONES[1], STONE_TONES[3], STONE_TONES[5]];
    const tone = isKey ? '#403a2e' : ringTones[(vr() * ringTones.length) | 0];
    out += `<polygon points='${poly(q)}' fill='${tone}' stroke='${MORTAR}' stroke-width='5'/>`;
    // lit inner lip of each wedge (the torch light catches the reveal)
    out += `<line x1='${f2(q[0][0])}' y1='${f2(q[0][1])}' x2='${f2(q[1][0])}' y2='${f2(q[1][1])}' stroke='${STONE_HI}' stroke-opacity='0.14' stroke-width='2'/>`;
  }
  // jamb quoins: alternating-depth stones stacked down the vertical opening edges
  for (const side of [-1, 1]) {                  // -1 = left jamb, 1 = right jamb
    const xEdge = side === -1 ? OPEN_L : OPEN_R;
    let y = SPRING_Y - 2;
    let k = 0;
    while (y < FLOOR_Y) {
      const h = 50 + vr() * 14;
      const w = k % 2 === 0 ? 56 : 36;
      const tone = STONE_TONES[(vr() * STONE_TONES.length) | 0];
      const x = side === -1 ? xEdge - w : xEdge;
      out += `<rect x='${f2(x)}' y='${f2(y)}' width='${f2(w)}' height='${f2(Math.min(h, FLOOR_Y - y))}' fill='${tone}' stroke='${MORTAR}' stroke-width='5'/>`;
      out += `<line x1='${f2(xEdge - side * 1.5)}' y1='${f2(y + 2)}' x2='${f2(xEdge - side * 1.5)}' y2='${f2(y + Math.min(h, FLOOR_Y - y) - 2)}' stroke='${STONE_HI}' stroke-opacity='0.13' stroke-width='2'/>`;
      y += h; k++;
    }
  }
  return out;
}

// ── an iron torch mounted on the FRONT pillar face (backplate + shaft + basket + flame) ──
function torch(x, y) {
  return `<g transform='translate(${f2(x)} ${f2(y)})'>` +
    `<ellipse cx='0' cy='0' rx='190' ry='250' fill='url(#torchGlow)'/>` +        // big soft pool
    `<ellipse cx='0' cy='-38' rx='70' ry='96' fill='url(#torchCore)'/>` +        // tight bright core
    // wall backplate + rivets (front mount)
    `<rect x='-10' y='14' width='20' height='62' rx='4' fill='${IRON}'/>` +
    `<circle cx='0' cy='24' r='2.4' fill='${IRON_HI}'/><circle cx='0' cy='66' r='2.4' fill='${IRON_HI}'/>` +
    // shaft
    `<rect x='-6' y='-26' width='12' height='66' rx='4' fill='${IRON}'/>` +
    `<rect x='-6' y='-26' width='5' height='66' rx='2.5' fill='#15110b'/>` +
    // fire-basket (tapered iron cage)
    `<path d='M-26 -30 L26 -30 L18 4 L-18 4 Z' fill='${IRON}'/>` +
    `<path d='M-26 -30 L26 -30 L18 4 L-18 4 Z' fill='none' stroke='#15110b' stroke-width='2'/>` +
    `<path d='M-15 -30 L-11 4 M0 -30 L0 4 M15 -30 L11 4' stroke='#15110b' stroke-width='1.8'/>` +
    `<ellipse cx='0' cy='-30' rx='26' ry='7' fill='${IRON_HI}'/>` +
    // organic flame (asymmetric, layered hot → bright core)
    `<g transform='translate(0 -30) scale(1.3) translate(0 30)'>` +
    `<path d='M-15 -32 Q-20 -66 -3 -86 Q-10 -58 4 -66 Q-2 -46 12 -60 Q10 -38 16 -32 Q4 -24 -15 -32 Z' fill='#e9621a'/>` +
    `<path d='M-9 -34 Q-13 -60 0 -78 Q-5 -54 6 -60 Q1 -44 9 -52 Q8 -40 9 -34 Q1 -28 -9 -34 Z' fill='#ff9b2e'/>` +
    `<path d='M-4 -36 Q-7 -56 1 -70 Q-1 -52 4 -54 Q2 -42 4 -38 Z' fill='#ffd95e'/>` +
    `<path d='M-1 -38 Q-3 -52 1 -62 Q1 -48 2 -42 Z' fill='#fff6c8'/>` +
    `</g></g>`;
}

// ════════════════════════════════════════════════════════════════════════════════════════
// THE DRAGON — ASLEEP, a TRACED silhouette (scripts/dragon-traced.json). Five hand-drawn
// attempts failed in five different ways (see specs/themes.md); the fix was the same as the
// Hogwarts castle: trace a real reference. Current reference: a curled-up sleeping dragon
// (pngimg.com dragon_PNG1603 — tail wrapping a full loop, head resting on the ground at the
// right, both wings folded as two peaks over the back, spiked ridge). Re-vectorise with:
//   curl -sL "https://pngimg.com/uploads/dragon/dragon_PNG1603.png" -o "$TMPDIR/dragon-ref.png"
//   node scripts/trace-dragon-reference.cjs "$TMPDIR/dragon-ref.png" --renderw=1024 --minloop=480 --bands=95,150 --minband=1500,400 --erase=845,0,1024,768 --eraseband=755,360,845,768
// (--minloop drops sliver holes that read as cracks — the tail-coil loop hole survives and
// the warm haze glows through it, a feature; --bands posterises the reference's own shading
// into the mid/lit tone layers; --erase removes the ENTIRE right end — a featureless
// 3/4-view balloon dome ("the head does not fit") + the claw mass below it — which
// dragonHead() replaces with a designed neck + proportioned wedge head; --eraseband kills
// the shoulder shading patch whose straight edge read as a seam at the neck junction.)
// REFERENCE-PICKING RULE learned here: judge a candidate by its outer contour ALONE (fill it
// black and squint) — poses with the head/legs INSIDE the outline silhouette to a blob.
// Contrast-first rule still applies: the warm haze band + pockets behind it (buildSvg) are
// what make the silhouette readable; keep them keyed to the wing peaks / head / coil.
// The belly line sits BELOW the gold (BASE_Y > floor): legs/claws bury in the hoard and the
// half-sunk head reads as resting on the treasure.
// Readability was verified with BLIND JUDGE PANELS (agents describing renders with no
// context): round 1 flat fill = "weird blob" (risk 7/10); + tone bands + continuous rim
// strokes + grafted head = round 3 "very high confidence sleeping dragon" (risk 2/10).
// ════════════════════════════════════════════════════════════════════════════════════════
const TRACED = JSON.parse(fs.readFileSync(path.join(__dirname, 'dragon-traced.json'), 'utf8'));

// Horizontal shift applied to the WHOLE dragon (body group, glow pockets, chin drift) so it
// sits centered in the opening (body spans ~472-1352 unshifted → center 912; opening center
// is 800). All coordinates in dragon()/dragonHead()/bellyFill stay in UNSHIFTED calibration
// space — the shift is one group translate, so the measured-coordinate workflow keeps working.
const DRAGON_DX = -112;

function dragon() {
  // CALIBRATION: the transform is pinned to the FULL reference's bbox ([138,301,954,694] at
  // renderw 1024), NOT to TRACED.bbox — --erase changes the traced bbox, and deriving the
  // transform from it would shift/rescale the whole body and invalidate every measured
  // coordinate (dragonHead anchors, belly filler, glow pockets).
  const [bx0, , bx1, by1] = [138, 301, 954, 694];
  const W = 880;                     // on-scene width — fills the cave behind the hoard
  const s = W / (bx1 - bx0);
  const RIGHT_X = 1352;              // right calibration edge (tall heap's right slope)
  const BASE_Y = 712;                // belly line SUNK below the gold — legs/claws are buried
                                     // in the hoard, so the head reads as resting ON the gold
  const tx = RIGHT_X - bx1 * s, ty = BASE_Y - by1 * s;
  const place = (fill, d, extra = '') =>
    `<g transform='translate(${f2(tx)} ${f2(ty)}) scale(${f2(s)})'>` +
    `<path d='${d}' fill='${fill}' fill-rule='evenodd'${extra}/></g>`;
  // CONTINUOUS warm rim light tracing the whole contour (blind-judge verdict: the single
  // highest-impact readability fix — one lit creature outline instead of a near-black mass).
  // Two stroke passes under the fill = flat-vector glow; the lower half is hidden behind
  // the hoard/floor, and the tail-loop hole's edge gets lit too (sells the loop crossover).
  const rim =
    place('none', TRACED.path, ` stroke='#d66e22' stroke-opacity='0.14' stroke-width='14' stroke-linejoin='round'`) +
    place('none', TRACED.path, ` stroke='#9c5e26' stroke-opacity='0.5' stroke-width='4.5' stroke-linejoin='round'`);
  // tone bands: the reference's own shading posterised into mid/lit layers (traced via
  // --bands). A single flat fill cannot carry a shape this big — it reads as "a weird blob";
  // the bands put the anatomy (wing membranes, lit flank, skull) INSIDE the dark mass.
  // Same lesson as the hoard: overlapping values = form, one value = blob.
  const tones = [DRAGON_MID, DRAGON_LIT];
  const bands = (TRACED.bands || [])
    .map((b, i) => place(tones[Math.min(i, tones.length - 1)], b.path)).join('');
  // belly filler: the reference's belly line rises between the coil and the foreleg
  // (scene x ≈ 700-820, bottom edge y ≈ 495-510), leaving a warm slit between body and
  // gold that made the dragon FLOAT and the body look too thin for the wing. This drops
  // the chest into the gold; the hoard (drawn after) buries its lower edge. The tail-loop
  // window further left stays open (it ends at x ≈ 700).
  const bellyFill =
    `<path d='M 696 498 Q 780 482 868 515 L 886 596 Q 852 646 776 650 Q 712 650 696 612 Z' fill='${DRAGON}'/>`;
  return `<g transform='translate(${DRAGON_DX} 0)'>` +
    rim +
    place(DRAGON, TRACED.path) +
    bellyFill +
    bands +
    dragonHead() +
    // hoard light licking the belly/coil/jaw from below — ties the dragon to the gold
    place('url(#dragonBelly)', TRACED.path) +
    `</g>`;
}

// The NECK + HEAD, drawn as one designed unit (scene coords). The trace's own right end was
// a huge featureless 3/4-view dome ("the head does not fit") — it is ERASED from the trace
// (--erase=845,0,...) and replaced: the remaining slope reads as the shoulder, and from it a
// neck flows down-right into a properly PROPORTIONED wedge head resting on the gold (dragon
// heads are small relative to the body). The left/throat edge of the path runs INSIDE the
// remaining body mass, burying the seam; it also covers the rim-stroked vertical cut edge.
function dragonHead() {
  if (process.argv.includes('--no-head')) return '';
  const headD =
    'M 1178 416' +                       // inside the body's back slope
    ' Q 1235 446 1280 478' +             // neck top edge (continues the slope's curvature)
    ' Q 1308 498 1318 514' +             // crown
    ' Q 1336 528 1360 552 Q 1382 572 1392 592' + // brow → snout bridge
    ' Q 1398 602 1392 610' +             // blunt snout tip
    ' Q 1372 620 1348 620' +             // upper lip
    ' Q 1310 630 1284 640 L 1258 648' +  // jaw → chin into the gold
    ' Q 1224 600 1206 540' +             // throat
    ' Q 1196 480 1178 416 Z';            // back into the body (seam inside the mass)
  // ONE modest horn from the crown, lying back-up-left into the haze ABOVE the neck edge
  // (the dome-era variants all failed: pair = fused blade, up-right cone = "hat",
  // shallow-angle = swallowed by the slope, oversized = a crest dominating the head).
  const hornD =
    'M 1314 506 Q 1288 470 1262 440 Q 1276 478 1300 504 Q 1310 512 1312 514 Z';
  // rim-stroke ONLY the outer profile (crown → snout → jaw → chin) — stroking the closed
  // path also lit the throat/seam edges that run INSIDE the body (a warm line through the
  // dark mass)
  const profileD =
    'M 1244 452 Q 1284 480 1318 514 Q 1336 528 1360 552 Q 1382 572 1392 592' +
    ' Q 1398 602 1392 610 Q 1372 620 1348 620 Q 1310 630 1284 640 L 1258 648';
  const rimStroke = ` stroke='#9c5e26' stroke-opacity='0.5' stroke-width='4.5' stroke-linejoin='round'`;
  return (
    `<path d='${profileD}' fill='none'${rimStroke}/>` +
    `<path d='${headD}' fill='${DRAGON}'/>` +
    `<path d='${hornD}' fill='${DRAGON}'/>` +
    // belly glow on the head too — the body's glow copy uses the TRACED path, which ends at
    // the erase cut; without this the warm underside stopped at a hard vertical edge
    `<path d='${headD}' fill='url(#dragonBelly)'/>` +
    // closed eye + nostril in the warm RIM-LIGHT tone — a dark-on-dark eye is invisible at
    // presentation brightness, and an invisible eye leaves the head parsing as a boulder
    `<path d='M 1316 542 Q 1334 552 1352 545' fill='none' stroke='#b4682a' stroke-opacity='0.85' stroke-width='4' stroke-linecap='round'/>` +
    `<ellipse cx='1378' cy='596' rx='3' ry='2.2' fill='#b4682a' fill-opacity='0.85'/>`
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════
// THE HOARD — a layered GOLD-SCAPE, not a single mound: a dark back bank fading into the
// dragon's shadow, two heaps of different heights, and a bright front bank spilling toward
// the threshold. Overlapping silhouettes at different values = depth; one textured dome = a
// blob (the "rethink the entire hoard" complaint). Items sit half-buried BETWEEN the layers.
// HX = composition center (the glow ellipses in buildSvg key on it).
// ════════════════════════════════════════════════════════════════════════════════════════
const HX = 990;

// one bumpy gold bank/heap: silhouette from x0..x1 rising to peakH at peakX, lumpy with
// coin-scale bumps. Returns the gradient fill + a thin crest highlight along the top edge.
function bank(x0, x1, baseY, peakX, peakH, rng, fillUrl, crestColor, crestOp, seg = 26) {
  const n = Math.max(7, Math.round((x1 - x0) / seg));
  const top = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const half = x < peakX ? peakX - x0 : x1 - peakX;
    const d = Math.min(1, Math.abs(x - peakX) / (half || 1));
    const h = peakH * Math.pow(Math.cos((d * Math.PI) / 2), 1.2);
    top.push([x + (i === 0 || i === n ? 0 : rng() * 11 - 5.5), baseY - h + (rng() * 6 - 3)]);
  }
  // irregular coin-scale bumps: varied amplitude, and some midpoints SKIPPED so the edge
  // never falls into a regular scallop rhythm (uniform bumps read as a decorative border)
  const bumpy = [];
  for (let i = 0; i < top.length - 1; i++) {
    const a = top[i], b = top[i + 1];
    bumpy.push(a);
    if (rng() < 0.3) continue;
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const o = 1.5 + rng() * 5;
    const t = 0.35 + rng() * 0.3;
    bumpy.push([a[0] + dx * t + (dy / l) * o, a[1] + dy * t - (dx / l) * o]);
  }
  bumpy.push(top[top.length - 1]);
  const closed = [...bumpy, [x1 + 6, baseY + 14], [x0 - 6, baseY + 14]];
  return `<path d='${smoothClosed(closed)}' fill='${fillUrl}'/>` +
    `<path d='${smoothPath(bumpy)}' fill='none' stroke='${crestColor}' stroke-opacity='${f2(crestOp)}' stroke-width='2'/>`;
}

function hoard() {
  const hrng = mulberry32(0xd4a9203);
  const hr = (lo, hi) => lo + (hi - lo) * hrng();
  const coin = (cx, cy, r) => {
    const base = hrng() < 0.45 ? GOLD : GOLD_DEEP;
    return `<ellipse cx='${f2(cx)}' cy='${f2(cy)}' rx='${f2(r)}' ry='${f2(r * 0.34)}' fill='${GOLD_SHADE}'/>` +
      `<ellipse cx='${f2(cx)}' cy='${f2(cy - r * 0.14)}' rx='${f2(r)}' ry='${f2(r * 0.34)}' fill='${base}'/>` +
      `<path d='M${f2(cx - r * 0.74)} ${f2(cy - r * 0.2)} Q${f2(cx)} ${f2(cy - r * 0.5)} ${f2(cx + r * 0.74)} ${f2(cy - r * 0.2)}' fill='none' stroke='${GOLD_HI}' stroke-opacity='0.45' stroke-width='${f2(r * 0.16)}'/>`;
  };

  // ── the four silhouette layers, back → front ──
  // back + front banks span the WHOLE opening (jamb to jamb) — the hoard fills the lair
  const backBank = bank(225, 1392, 614, 1010, 56, hrng, 'url(#goldBack)', '#8a6a1d', 0.3);
  // a modest far-left heap so the left stretch isn't two flat bands
  const farLeftHeap = bank(232, 545, 638, 352, 58, hrng, 'url(#goldMid)', '#ecc456', 0.3);
  const leftHeap = bank(544, 832, 634, 676, 84, hrng, 'url(#goldMid)', '#ecc456', 0.35);
  const tallHeap = bank(838, 1212, 636, 1016, 126, hrng, 'url(#goldTall)', '#ffe79a', 0.45);
  const frontBank = bank(205, 1396, 643, 944, 34, hrng, 'url(#goldFront)', '#ffd56a', 0.35, 38);
  // a small gold drift under the dragon's chin (follows DRAGON_DX) — without it the head
  // hovered over bare ledge ("the chin does not actually rest in the gold") and the
  // under-jaw glow read as a lit doorway instead of reflected gold
  const chinDrift = bank(1224 + DRAGON_DX, 1398 + DRAGON_DX, 650, 1322 + DRAGON_DX, 30, hrng, 'url(#goldFront)', '#ffd56a', 0.3, 20);

  // sparse coin-edge glints on the two heaps + a few coin tops near each peak
  let glints = '';
  for (let i = 0; i < 13; i++) {
    const y = 542 + Math.pow(hrng(), 0.8) * 76;
    const spread = 24 + (y - 542) * 0.9;
    const x = 1016 + hr(-1, 1) * spread;
    const l = hr(3.5, 7.5);
    glints += `<line x1='${f2(x - l)}' y1='${f2(y)}' x2='${f2(x + l)}' y2='${f2(y + hr(-1.4, 1.4))}' stroke='${GOLD_HI}' stroke-opacity='${f2(hr(0.16, 0.34))}' stroke-width='${f2(hr(1.6, 2.3))}'/>`;
  }
  for (let i = 0; i < 7; i++) {
    const y = 584 + hrng() * 42;
    const spread = 18 + (y - 584) * 1.1;
    const x = 676 + hr(-1, 1) * spread;
    const l = hr(3, 6.5);
    glints += `<line x1='${f2(x - l)}' y1='${f2(y)}' x2='${f2(x + l)}' y2='${f2(y + hr(-1.2, 1.2))}' stroke='${GOLD_HI}' stroke-opacity='${f2(hr(0.14, 0.3))}' stroke-width='2'/>`;
  }
  glints += coin(982, 522, 8) + coin(1052, 528, 7.5) + coin(1016, 514, 7) +
    coin(652, 600, 7.5) + coin(700, 594, 7);

  // ── items, half-buried between the layers ──
  // open chest sunk into the left heap (tilted), lid standing open showing its lit interior
  const chest =
    `<g transform='translate(622 566) rotate(-6)'>` +
    `<path d='M0 14 L104 14 L98 -36 Q52 -46 6 -36 Z' fill='${WOOD_DK}'/>` +
    `<path d='M6 10 L98 10 L93 -30 Q52 -39 11 -30 Z' fill='#4a3216'/>` +
    `<ellipse cx='52' cy='-10' rx='34' ry='15' fill='rgba(255,190,80,0.18)'/>` +
    `<path d='M44 -40 L60 -40 L60 12 L44 12 Z' fill='${IRON}' fill-opacity='0.85'/>` +
    `<ellipse cx='52' cy='16' rx='52' ry='14' fill='${GOLD_DEEP}'/>` +
    `<ellipse cx='38' cy='12' rx='26' ry='9' fill='${GOLD}'/>` +
    `<ellipse cx='72' cy='13' rx='20' ry='8' fill='${GOLD}'/>` +
    `<path d='M16 8 Q38 0 60 6' fill='none' stroke='${GOLD_HI}' stroke-opacity='0.6' stroke-width='3'/>` +
    `<rect x='-4' y='16' width='112' height='52' rx='6' fill='${WOOD}'/>` +
    `<rect x='-4' y='16' width='112' height='52' rx='6' fill='none' stroke='${WOOD_DK}' stroke-width='4'/>` +
    `<rect x='44' y='14' width='16' height='56' fill='${IRON}'/>` +
    `<rect x='47' y='34' width='10' height='14' rx='2' fill='${IRON_HI}'/>` +
    `</g>`;
  // round shield leaning against the tall heap's flank (bottom buried by the front bank)
  const shield =
    `<g transform='translate(902 582) rotate(-10)'>` +
    `<ellipse rx='25' ry='29' fill='#8a671a'/>` +
    `<ellipse rx='25' ry='29' fill='none' stroke='#c9a02e' stroke-width='3'/>` +
    `<ellipse rx='15' ry='18' fill='none' stroke='#a37c1e' stroke-width='2'/>` +
    `<circle r='5.5' fill='#e6bf45'/>` +
    `</g>`;
  // crown on the tall heap's peak
  const crown =
    `<g transform='translate(1018 506) rotate(-8)'><path d='M-30 16 L-30 -2 L-16 9 L0 -10 L16 9 L30 -2 L30 16 Z' fill='${GOLD_DEEP}'/>` +
    `<path d='M-30 16 L30 16' stroke='${GOLD_HI}' stroke-width='3'/>` +
    `<circle cx='-16' cy='10' r='2.8' fill='${GEM_RED}'/><circle cx='0' cy='-8' r='3' fill='${GEM_TEAL}'/><circle cx='16' cy='10' r='2.8' fill='${GEM_PURPLE}'/></g>`;
  // half-buried sword (hilt out of the tall heap's right slope)
  const sword =
    `<g transform='translate(1124 566) rotate(24)'>` +
    `<rect x='-3' y='-6' width='6' height='34' fill='#5a5648'/>` +
    `<rect x='-16' y='-12' width='32' height='7' rx='3' fill='${GOLD_DEEP}'/>` +
    `<rect x='-3.4' y='-34' width='6.8' height='23' rx='3' fill='${WOOD_DK}'/>` +
    `<circle cx='0' cy='-38' r='6' fill='${GOLD_DEEP}'/>` +
    `</g>`;
  // NO goblet: every variant failed at scene scale — upright read as a stray glyph, toppled
  // (at the dragon's chin) as a floating strap/rope. The hoard has enough item vocabulary.
  const goblets = '';
  // gems nestled into the heap faces (a coin overlaps each pavilion tip)
  const gem = (x, y, s, c, hi) =>
    `<path d='M${f2(x - 8 * s)} ${f2(y)} L${f2(x - 4.5 * s)} ${f2(y - 6 * s)} L${f2(x + 4.5 * s)} ${f2(y - 6 * s)} L${f2(x + 8 * s)} ${f2(y)} L${f2(x)} ${f2(y + 7.5 * s)} Z' fill='${c}'/>` +
    `<path d='M${f2(x - 4.5 * s)} ${f2(y - 6 * s)} L${f2(x + 4.5 * s)} ${f2(y - 6 * s)} L${f2(x)} ${f2(y)} Z' fill='${hi}' fill-opacity='0.8'/>` +
    `<ellipse cx='${f2(x + 3 * s)}' cy='${f2(y + 5.5 * s)}' rx='${f2(8 * s)}' ry='${f2(3 * s)}' fill='${GOLD_DEEP}'/>`;
  const gems =
    gem(966, 546, 0.8, GEM_TEAL, '#a8dde6') +
    gem(1066, 560, 0.7, GEM_RED, '#dfa3b0') +
    gem(706, 600, 0.7, GEM_PURPLE, '#c3aade');
  // a couple of coin stacks in front of the front bank, grounded with contact shadows
  let stacks = '';
  for (const [sx, sy, nn] of [[772, 634, 4], [1102, 635, 3], [928, 637, 2], [356, 636, 3]]) {
    stacks += `<ellipse cx='${f2(sx)}' cy='${f2(sy + 4)}' rx='16' ry='3' fill='#000' fill-opacity='0.3'/>`;
    for (let i = 0; i < nn; i++) {
      const wob = hr(-1.5, 1.5);
      stacks += `<ellipse cx='${f2(sx + wob)}' cy='${f2(sy - i * 6.5)}' rx='13' ry='5' fill='${i === nn - 1 ? GOLD : GOLD_DEEP}'/>` +
        (i === nn - 1 ? `<path d='M${f2(sx + wob - 9)} ${f2(sy - i * 6.5 - 1)} Q${f2(sx + wob)} ${f2(sy - i * 6.5 - 4.5)} ${f2(sx + wob + 9)} ${f2(sy - i * 6.5 - 1)}' fill='none' stroke='${GOLD_HI}' stroke-opacity='0.5' stroke-width='2'/>`
                       : `<rect x='${f2(sx + wob - 13)}' y='${f2(sy - i * 6.5 - 3)}' width='26' height='3' fill='${GOLD_DK}'/>`);
    }
  }
  // sparse star glints
  const star = (x, y, s) =>
    `<path d='M${f2(x)} ${f2(y - s)} L${f2(x + s * 0.24)} ${f2(y - s * 0.24)} L${f2(x + s)} ${f2(y)} L${f2(x + s * 0.24)} ${f2(y + s * 0.24)} L${f2(x)} ${f2(y + s)} L${f2(x - s * 0.24)} ${f2(y + s * 0.24)} L${f2(x - s)} ${f2(y)} L${f2(x - s * 0.24)} ${f2(y - s * 0.24)} Z' fill='#fff7d6' fill-opacity='0.9'/>`;
  // glints sit ON gold surfaces — a glint over the dragon's dark mass reads as an indoor
  // star (blind-judge catch); (1018,470) floated on the dragon after the body grew
  const stars = star(1020, 502, 7) + star(668, 514, 6) + star(886, 566, 5);

  return backBank + farLeftHeap +
    leftHeap + chest +
    tallHeap + shield + glints + gems + crown + sword +
    frontBank + chinDrift + stacks + goblets + stars;
}

function buildSvg() {
  // ── inside the opening (everything clipped to the arch) ──
  const orng = mulberry32(0xbeefcafe);
  // inner cave floor (warm-lit dirt receding into the dark)
  let inner = `<rect x='${OPEN_L}' y='548' width='${OPEN_R - OPEN_L}' height='${FLOOR_Y - 548}' fill='url(#innerFloorG)'/>`;
  // stalactites high in the cave (faint)
  const stal = [[330, 56], [420, 88], [1180, 64], [1290, 96]]
    .map(([sx, sl]) => {
      const w = 16 + (sl % 20);
      return `<path d='M${f2(sx - w / 2)} ${CROWN_Y - 40} L${f2(sx + w / 2)} ${CROWN_Y - 40} L${f2(sx + w * 0.12)} ${f2(CROWN_Y + sl)} Q${f2(sx)} ${f2(CROWN_Y + sl + 10)} ${f2(sx - w * 0.12)} ${f2(CROWN_Y + sl)} Z' fill='#0d0805'/>`;
    }).join('');
  // baked drifting embers (static; sparse warm dots in the haze)
  let embers = '';
  for (let i = 0; i < 12; i++) {
    // keep embers in the AIR above the dragon's back (an ember on the dark mass reads as
    // a star drawn on the creature)
    const exx = 480 + orng() * 760, eyy = 160 + orng() * 150;
    const rr = 1 + orng() * 1.3, oo = 0.16 + orng() * 0.34;
    embers += `<circle cx='${f2(exx)}' cy='${f2(eyy)}' r='${f2(rr)}' fill='${orng() < 0.5 ? '#ff9a40' : '#ffd27a'}' fill-opacity='${f2(oo)}'/>`;
  }
  // scattered loose coins on the inner floor (a trail of gold; the tail barb ends near them)
  const crng = mulberry32(0x77aa11);
  let loose = '';
  const looseAt = [[500, 634], [524, 638], [1330, 630], [1354, 636], [1296, 626], [298, 632], [338, 638]];
  for (const [lx, ly] of looseAt) {
    const r = 6.5 + crng() * 3;
    loose += `<ellipse cx='${f2(lx)}' cy='${f2(ly)}' rx='${f2(r)}' ry='${f2(r * 0.4)}' fill='${crng() < 0.5 ? GOLD_DEEP : GOLD_DK}'/>` +
      `<path d='M${f2(lx - r * 0.7)} ${f2(ly - r * 0.18)} Q${f2(lx)} ${f2(ly - r * 0.5)} ${f2(lx + r * 0.7)} ${f2(ly - r * 0.18)}' fill='none' stroke='${GOLD_HI}' stroke-opacity='0.4' stroke-width='${f2(r * 0.16)}'/>`;
  }
  const opening =
    `<g clip-path='url(#openClip)'>` +
    inner + stal +
    `<ellipse cx='1000' cy='420' rx='560' ry='300' fill='url(#depthHaze)'/>` +   // ember backlight deep in the cave
    `<ellipse cx='${860 + DRAGON_DX}' cy='380' rx='600' ry='250' fill='url(#emberLow)' opacity='0.85'/>` + // broad haze band the wing peaks + spiked ridge silhouette against
    `<ellipse cx='${560 + DRAGON_DX}' cy='545' rx='240' ry='150' fill='url(#emberLow)' opacity='0.6'/>` +  // left pocket (glows through the tail coil's loop)
    `<ellipse cx='${1300 + DRAGON_DX}' cy='530' rx='210' ry='150' fill='url(#emberLow)' opacity='0.9'/>` + // pocket behind the resting head (skull + horn + snout read against it)
    embers +
    dragon() +
    `<ellipse cx='${HX}' cy='608' rx='560' ry='115' fill='url(#emberLow)'/>` +   // hot strip silhouetting the mass base
    `<ellipse cx='${HX - 10}' cy='600' rx='540' ry='140' fill='url(#hoardGlow)'/>` +
    loose +
    hoard() +
    `</g>`;

  // ── stone frame: mortar fill → continuous field masonry → voussoirs/quoins → AO ──
  const frame = `<path fill='${MORTAR}' fill-rule='evenodd' d='${FRAME_D}'/>`;
  const walls = masonry();
  const archStones = voussoirsAndQuoins();
  // ambient occlusion: stone darkens into the opening (a soft dark reveal) + a lit inner edge
  const ao =
    `<path d='${OPENING_D}' fill='none' stroke='#000' stroke-opacity='0.38' stroke-width='22'/>` +
    `<path d='${OPENING_D}' fill='none' stroke='#000' stroke-opacity='0.35' stroke-width='10'/>` +
    `<path d='${OPENING_D}' fill='none' stroke='${STONE_HI}' stroke-opacity='0.35' stroke-width='2.5'/>`;
  // warm torch wash on the stone near each torch (low opacity, over the masonry)
  const warmWash =
    `<ellipse cx='100' cy='330' rx='190' ry='260' fill='url(#warmStone)'/>` +
    `<ellipse cx='${VW - 100}' cy='330' rx='190' ry='260' fill='url(#warmStone)'/>`;

  // ── foreground flagstone threshold (perspective rows + warm spill from the lair) ──
  let floor = `<rect x='0' y='${FLOOR_Y}' width='${VW}' height='${VH - FLOOR_Y}' fill='url(#floorGrad)'/>`;
  const frng = mulberry32(0x1f7b3c);
  const rows = [FLOOR_Y, FLOOR_Y + 34, FLOOR_Y + 74, VH];
  for (let r = 0; r < rows.length - 1; r++) {
    const yT = rows[r], yB = rows[r + 1];
    const persp = 0.5 + r * 0.24;                 // nearer rows have wider tiles
    const tileW = 130 * persp;
    const off = (r % 2) * tileW * 0.5;
    for (let x = -tileW; x < VW + tileW; x += tileW) {
      const tone = FLOOR_TONES[(frng() * FLOOR_TONES.length) | 0];
      const x0t = x + off + 3, x1t = x + off + tileW - 3;
      floor += `<path d='M${f2(x0t)} ${f2(yT + 2)} H${f2(x1t)} V${f2(yB - 2)} H${f2(x0t)} Z' fill='${tone}'/>`;
      floor += `<line x1='${f2(x0t)}' y1='${f2(yB - 3)}' x2='${f2(x1t)}' y2='${f2(yB - 3)}' stroke='${STONE_HI}' stroke-opacity='0.09' stroke-width='2'/>`;
      if (frng() < 0.13) floor += `<path d='M${f2(x0t + (x1t - x0t) * 0.4)} ${f2(yT + 4)} L${f2(x0t + (x1t - x0t) * 0.55)} ${f2(yB - 6)}' stroke='${GROUT}' stroke-width='1.3'/>`;
    }
  }
  floor += `<line x1='0' y1='${FLOOR_Y + 1}' x2='${VW}' y2='${FLOOR_Y + 1}' stroke='${GROUT}' stroke-width='3'/>`;
  // hoard light spilling out of the opening across the threshold (no bright edge line —
  // a hard line under the heap was part of the pasted-on look)
  floor += `<path d='M560 ${FLOOR_Y} L1340 ${FLOOR_Y} L1480 ${VH} L420 ${VH} Z' fill='url(#spillG)'/>`;
  // rubble at the pillar bases + moss in the floor joints
  const rrng = mulberry32(0x8d33f1);
  const rubbleAt = [[176, 652], [238, 668], [1372, 656], [1428, 670], [98, 660]];
  let rubble = '';
  for (const [rx, ry] of rubbleAt) {
    const s = 8 + rrng() * 9;
    const tone = STONE_TONES[(rrng() * STONE_TONES.length) | 0];
    rubble += `<ellipse cx='${f2(rx)}' cy='${f2(ry + s * 0.45)}' rx='${f2(s * 1.25)}' ry='${f2(s * 0.4)}' fill='#000' fill-opacity='0.4'/>` +
      `<polygon points='${poly([[rx - s, ry + s * 0.4], [rx - s * 0.5, ry - s * 0.5], [rx + s * 0.3, ry - s * 0.65], [rx + s, ry - s * 0.05], [rx + s * 0.7, ry + s * 0.45]])}' fill='${tone}'/>`;
    rubble += `<line x1='${f2(rx - s * 0.5)}' y1='${f2(ry + s * 0.35)}' x2='${f2(rx + s * 0.55)}' y2='${f2(ry + s * 0.4)}' stroke='${STONE_HI}' stroke-opacity='0.15' stroke-width='1.6'/>`;
  }
  rubble += mossTuft(290, FLOOR_Y + 36, 40, rrng) + mossTuft(1330, FLOOR_Y + 30, 34, rrng);

  // ── ceiling fade + corner vignette ──
  const ceiling = `<rect x='0' y='0' width='${VW}' height='250' fill='url(#topFade)'/>`;
  const vignette = `<rect x='0' y='0' width='${VW}' height='${VH}' fill='url(#vig)'/>`;

  return `<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}' viewBox='0 0 ${VW} ${VH}' preserveAspectRatio='xMidYMax meet'>` +
    `<defs>` +
    `<linearGradient id='depthGrad' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${DEPTH_TOP}'/><stop offset='1' stop-color='${DEPTH_BOT}'/></linearGradient>` +
    `<linearGradient id='innerFloorG' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${DEPTH_BOT}' stop-opacity='0'/><stop offset='1' stop-color='#2a1d0e'/></linearGradient>` +
    `<linearGradient id='floorGrad' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#0e0b07'/><stop offset='1' stop-color='#19140d'/></linearGradient>` +
    `<linearGradient id='spillG' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='rgba(255,180,70,0.13)'/><stop offset='1' stop-color='rgba(255,160,55,0)'/></linearGradient>` +
    `<linearGradient id='topFade' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='${DEPTH_TOP}'/><stop offset='1' stop-color='${DEPTH_TOP}' stop-opacity='0'/></linearGradient>` +
    `<linearGradient id='wallShade' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='rgba(0,0,0,0.4)'/><stop offset='0.55' stop-color='rgba(0,0,0,0.08)'/><stop offset='1' stop-color='rgba(0,0,0,0)'/></linearGradient>` +
    `<radialGradient id='torchGlow' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(255,180,80,0.45)'/><stop offset='0.45' stop-color='rgba(255,135,40,0.14)'/><stop offset='1' stop-color='rgba(255,125,35,0)'/></radialGradient>` +
    `<radialGradient id='torchCore' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(255,225,150,0.65)'/><stop offset='0.5' stop-color='rgba(255,170,70,0.2)'/><stop offset='1' stop-color='rgba(255,150,50,0)'/></radialGradient>` +
    `<radialGradient id='warmStone' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(255,150,60,0.18)'/><stop offset='1' stop-color='rgba(255,140,50,0)'/></radialGradient>` +
    `<radialGradient id='depthHaze' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(176,92,28,0.48)'/><stop offset='0.55' stop-color='rgba(112,54,16,0.2)'/><stop offset='1' stop-color='rgba(60,30,10,0)'/></radialGradient>` +
    `<radialGradient id='emberLow' cx='0.5' cy='0.5' r='0.5'><stop offset='0' stop-color='rgba(214,110,34,0.45)'/><stop offset='0.5' stop-color='rgba(180,90,26,0.18)'/><stop offset='1' stop-color='rgba(150,70,20,0)'/></radialGradient>` +
    // hoard light on the dragon's underside (fills the traced path, objectBoundingBox)
    `<linearGradient id='dragonBelly' x1='0' y1='1' x2='0' y2='0'><stop offset='0' stop-color='rgba(255,170,60,0.30)'/><stop offset='0.38' stop-color='rgba(214,110,34,0.12)'/><stop offset='0.7' stop-color='rgba(214,110,34,0)'/></linearGradient>` +
    `<radialGradient id='hoardGlow' cx='0.5' cy='0.55' r='0.55'><stop offset='0' stop-color='rgba(255,200,85,0.38)'/><stop offset='0.45' stop-color='rgba(255,175,55,0.16)'/><stop offset='1' stop-color='rgba(255,165,38,0)'/></radialGradient>` +
    `<linearGradient id='goldBack' gradientUnits='userSpaceOnUse' x1='0' y1='552' x2='0' y2='628'><stop offset='0' stop-color='#6b4e12'/><stop offset='1' stop-color='#33240a'/></linearGradient>` +
    `<linearGradient id='goldMid' gradientUnits='userSpaceOnUse' x1='0' y1='546' x2='0' y2='648'><stop offset='0' stop-color='#d9ab36'/><stop offset='1' stop-color='#6b4c11'/></linearGradient>` +
    `<linearGradient id='goldTall' gradientUnits='userSpaceOnUse' x1='0' y1='504' x2='0' y2='650'><stop offset='0' stop-color='#f2c84e'/><stop offset='0.5' stop-color='#b08526'/><stop offset='1' stop-color='#5c430f'/></linearGradient>` +
    `<linearGradient id='goldFront' gradientUnits='userSpaceOnUse' x1='0' y1='606' x2='0' y2='656'><stop offset='0' stop-color='#eebc42'/><stop offset='1' stop-color='#735112'/></linearGradient>` +
    `<radialGradient id='vig' cx='0.5' cy='0.45' r='0.74'><stop offset='0.45' stop-color='rgba(0,0,0,0)'/><stop offset='1' stop-color='rgba(0,0,0,0.76)'/></radialGradient>` +
    `<clipPath id='openClip'><path d='${OPENING_D}'/></clipPath>` +
    `<clipPath id='frameClip'><path d='${FRAME_D}' clip-rule='evenodd'/></clipPath>` +
    `</defs>` +
    `<rect width='${VW}' height='${VH}' fill='url(#depthGrad)'/>` +
    opening +
    frame +
    walls +
    archStones +
    warmWash +
    ao +
    floor +
    rubble +
    torch(100, 300) +
    torch(VW - 100, 300) +
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
