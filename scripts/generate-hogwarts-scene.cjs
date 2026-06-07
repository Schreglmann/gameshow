/* Compose the Harry Potter theme's Hogwarts-night background and (optionally) bake
 * it into the `[data-theme="harry-potter"]::after` rule in src/styles/themes.css.
 *
 * The castle is the REAL Hogwarts, vectorised from the classic blue reference
 * (pa-Hogwarts.png) by scripts/trace-hogwarts-reference.cjs into
 * scripts/hogwarts-traced.json (two shading tones — shadow/highlight — + gold
 * windows). This script recolours those traced paths to the theme and composes the
 * scene.
 *
 * Composition (see specs/themes.md for the full history of rejected approaches):
 *  - The traced block's LEFT edge is a natural craggy slope, but its RIGHT edge is
 *    a hard vertical image crop. A hill drawn over that crop only re-creates a wall
 *    (the crop is tall + narrow). So instead the castle keeps its AUTHENTIC
 *    orientation (never mirrored) and is pushed RIGHT until the crop sits exactly at
 *    the right viewBox edge (x=VW) — there it reads as "the cliff continues
 *    off-frame", never as a wall. Only the natural slope is on-screen, flowing down
 *    into the grounds.
 *  - Off-centre (castle right), so the open LEFT holds soft Catmull-Rom rolling
 *    hills + a Forbidden-Forest tree line; the middle stays calm (content sits there).
 *  - The moon + stars + Great-Hall candles live in the CSS ::before (moon upper-left
 *    to balance the right-side castle).
 *
 * To re-vectorise from a new reference: re-run trace-hogwarts-reference.cjs (needs
 * the reference PNG), then re-run this with --write-css.
 *
 * Usage (from repo root):
 *   node scripts/generate-hogwarts-scene.cjs              # preview PNG to $TMPDIR
 *   node scripts/generate-hogwarts-scene.cjs --write-css  # bake into themes.css
 *   node scripts/generate-hogwarts-scene.cjs --png out.png
 */
'use strict';
const fs = require('fs');
const path = require('path');

const VW = 1600, VH = 430;
// shadow/high = the castle cliff's two tones (kept as-is — the user likes the
// castle). The extended mountain uses its OWN slightly-lighter pair (mtnBase +
// crest) so it reads across the WHOLE width: the warm horizon glow only lights the
// centre/right, so the castle's own dark tones stayed invisible on the unlit far
// left and the bottom looked empty there. mtnBase is still dark enough to read as
// the same landmass as the cliff at the join.
const THEME = {
  shadow: '#2c2658', high: '#473f6f', gold: '#f2c75c', pine: '#241c4e',
  mtnBase: '#3e3876', crest: '#5e58a0',
};
const n = (v) => Math.round(v * 10) / 10;

// Open smooth Catmull-Rom curve through ridge points (just the top edge — no
// straight segments, no sharp apexes).
function openCurve(pts) {
  let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1];
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return d;
}
// the full mountain mass: ridge crest down to the baseline (shadow tone)
const massPath = (ridge) => openCurve(ridge) + `L${n(ridge[ridge.length - 1][0])} ${VH} L${n(ridge[0][0])} ${VH} Z`;
// moonlit highlight crest: the band between the ridge and a copy offset down by
// `off` — echoes the castle cliff's lighter (#473f6f) faces so the extended
// mountain reads as ONE craggy mass with the cliff, not a flat dark sliver.
function crestBand(ridge, off) {
  const lower = ridge.slice().reverse().map(([x, y]) => [x, y + off]);
  return openCurve(ridge) + 'L' + openCurve(lower).slice(1) + 'Z';
}
const terrainY = (ridge, x) => {
  for (let i = 0; i < ridge.length - 1; i++) {
    const [x0, y0] = ridge[i], [x1, y1] = ridge[i + 1];
    if (x >= x0 && x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return ridge[ridge.length - 1][1];
};
// little fir trees sitting on the terrain ridge (two stacked triangles each)
const pines = (ridge, spec) => spec.map(([cx, h]) => {
  const by = terrainY(ridge, cx) + 5, hw = Math.max(11, h * 0.32);
  return `<polygon points='${n(cx - hw)},${n(by)} ${cx},${n(by - h)} ${n(cx + hw)},${n(by)}'/>` +
    `<polygon points='${n(cx - hw * 0.72)},${n(by - h * 0.44)} ${cx},${n(by - h * 1.1)} ${n(cx + hw * 0.72)},${n(by - h * 0.44)}'/>`;
}).join('');

function buildSvg() {
  const traced = JSON.parse(fs.readFileSync(path.join(__dirname, 'hogwarts-traced.json'), 'utf8'));
  const [, , bx1, by1] = traced.bbox;
  const s = 400 / (by1 - traced.bbox[1]);

  // Push the castle right until its hard crop edge (local x=bx1) lands on x=VW,
  // hiding the crop at the frame edge. Authentic orientation (never mirrored).
  const tx = VW - bx1 * s;
  const ty = VH - by1 * s;

  // ONE continuous mountain: the ridge rises on the right to meet the castle's
  // left toe (~x=1027, y≈289 at this scale) so the cliff under Hogwarts simply
  // KEEPS GOING — sweeping down-left as a craggy massif with foothills + forest,
  // not a separate ground band. Drawn behind the castle (same tones → seamless).
  // It is kept TALL (crest up in the lighter mid-sky, ~y=244–300) so the filled
  // mass reads down to the bottom edge — a low ridge sat entirely in the dark
  // lower gradient and the body vanished, making the bottom look empty.
  const ridge = [
    [-60, 270], [150, 226], [350, 264], [560, 246], [760, 272], [940, 244],
    [1020, 262], [1045, 284], [1200, 296], [1313, 306], [1660, 322],
  ];
  // Forbidden-Forest firs on the mountain's lower-left slope + a couple further in
  const pineSpec = [
    [70, 30], [104, 42], [140, 34], [180, 48], [250, 38], [560, 24], [600, 30],
  ];

  const p = (d, color) => `<path fill='${color}' d='${d}'/>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}' viewBox='0 0 ${VW} ${VH}' preserveAspectRatio='xMidYMax meet'>` +
    `<g fill='${THEME.mtnBase}'>${massPath(ridge)}</g>` +
    `<g fill='${THEME.crest}'>${crestBand(ridge, 100)}</g>` +
    `<g transform='translate(${n(tx)} ${n(ty)}) scale(${Math.round(s * 1e4) / 1e4})'>` +
    p(traced.shadow, THEME.shadow) + p(traced.high, THEME.high) + p(traced.gold, THEME.gold) +
    `</g>` +
    `<g fill='${THEME.pine}'>${pines(ridge, pineSpec)}</g>` +
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
  // gradient = the body-gradient slice BEHIND the scene band (lightest in the
  // middle, dark top+bottom). MUST stay dark at the bottom: an over-light preview
  // gradient hides the low terrain that's actually invisible on the real page.
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
