/* Generate the Harry Potter theme's Hogwarts-night background as ONE cohesive,
 * hand-drawn inline-SVG silhouette, and (optionally) bake it into the
 * `[data-theme="harry-potter"]::after` rule in src/styles/themes.css.
 *
 * Why this exists: the HP `::after` used to layer an embedded reference PNG of
 * the castle over a SEPARATE forest SVG — which read as two disconnected things
 * ("this background makes no sense"). This script draws the whole scene as a
 * SINGLE continuous landscape from the classic blue Hogwarts reference: a craggy
 * faceted cliff + the castle + Forbidden-Forest pines on both flanks, with the
 * dominant Astronomy Tower, the Great Hall's row of tall lit arched windows, the
 * Clock/Bell tower, and a dense cluster of witch-hat turrets at varied heights.
 * Two stone tones (receding back-spires vs. advancing front buildings) give depth.
 *
 * Kept in the repo (like scripts/generate-laendergrenzen-maps.ts) so the castle
 * stays reproducible and tweakable — edit the layout below and re-run.
 *
 * Usage (from repo root):
 *   node scripts/generate-hogwarts-scene.cjs              # print data-URI + write preview PNG to $TMPDIR
 *   node scripts/generate-hogwarts-scene.cjs --write-css  # bake the data-URI into src/styles/themes.css
 *   node scripts/generate-hogwarts-scene.cjs --png out.png # write a preview PNG to a path
 */
'use strict';
const fs = require('fs');
const path = require('path');

const W = 1600, H = 330; // wider aspect = shorter band when bottom-anchored, so the
                         // castle sits LOWER in the viewport (less empty cliff foreground)

// ---------- shape helpers ----------
const n = (v) => (Math.round(v * 10) / 10);
const poly = (pts) => `<polygon points='${pts.map((p) => n(p[0]) + ',' + n(p[1])).join(' ')}'/>`;
const rect = (x, y, w, h) => `<rect x='${n(x)}' y='${n(y)}' width='${n(w)}' height='${n(h)}'/>`;
const circle = (cx, cy, r) => `<circle cx='${n(cx)}' cy='${n(cy)}' r='${n(r)}'/>`;
const cone = (cx, hw, baseY, peakY) => poly([[cx - hw, baseY], [cx, peakY], [cx + hw, baseY]]);
const finial = (cx, baseY, topY) => poly([[cx - 2, baseY], [cx, topY], [cx + 2, baseY]]);
function crenel(x, w, y, mh = 7, mw = 9, gap = 7) {
  let out = '', cx = x;
  while (cx + mw <= x + w + 0.1) { out += rect(cx, y - mh, mw, mh); cx += mw + gap; }
  return out;
}
function archWin(cx, topY, botY, w) {
  const r = w / 2, x0 = cx - r, x1 = cx + r, ay = topY + r;
  return `<path d='M${n(x0)} ${n(ay)} A${n(r)} ${n(r)} 0 0 1 ${n(x1)} ${n(ay)} L${n(x1)} ${n(botY)} L${n(x0)} ${n(botY)} Z'/>`;
}
// slim background spire (body + cone + finial) — the receding cluster behind the main mass
function spire(cx, w, baseY, bodyTopY, peakY) {
  return rect(cx - w / 2, bodyTopY, w, baseY - bodyTopY) +
         cone(cx, w / 2 + 4, bodyTopY, peakY) +
         finial(cx, peakY, peakY - 18);
}

function buildSvg() {
  let back = '', front = '', win = '';
  const BASE = 262; // building footing line; the plateau top sits a few px above it
                    // (≤256) everywhere under the castle so NOTHING floats

  // The "Hogwarts" read comes from a DENSE pile of slender pointed towers at many
  // heights with ONE dominant Astronomy Tower towering over everything, the lit
  // Great Hall with a round rose window + steep ridge-spired roof, all sprawling
  // across a cliff — NOT a row of crenellated fortress keeps.

  // ===== BACK CLUSTER — many thin spires behind the mass for a dense skyline =====
  [
    [300, 14, 122], [360, 16, 96], [430, 14, 70], [506, 16, 104], [560, 14, 78],
    [612, 16, 116], [690, 14, 92], [958, 16, 96], [1024, 14, 70], [1096, 16, 112],
    [1150, 14, 64], [1240, 16, 104], [1316, 14, 84], [1390, 16, 120],
  ].forEach(([cx, w, peak]) => { back += spire(cx, w, BASE, peak + 44, peak); });

  // ===== far-LEFT tower cluster (pointed, anchors the left wing) =====
  front += rect(244, 178, 30, BASE - 178) + cone(259, 22, 178, 138) + finial(259, 138, 120);
  win += rect(252, 196, 8, 12) + rect(252, 220, 8, 12);
  front += rect(286, 140, 32, BASE - 140) + cone(302, 24, 140, 98) + finial(302, 98, 80); // taller
  win += rect(293, 160, 9, 13) + rect(293, 186, 9, 13);
  front += rect(330, 196, 18, BASE - 196) + cone(339, 14, 196, 162) + finial(339, 162, 146);
  front += rect(356, 240, 50, BASE - 240) + crenel(356, 50, 240); // short link wall
  win += rect(378, 246, 6, 9);

  // ===== ASTRONOMY TOWER (THE dominant spire — tall + slim, towers over all) cx=452 =====
  const ax = 452;
  front += rect(424, 232, 56, BASE - 232);            // plinth
  front += rect(432, 86, 40, 146);                    // slim body
  front += cone(ax, 33, 86, 16);                      // tall narrow witch-hat
  front += finial(ax, 16, 2) + circle(ax, 2, 2.5);    // spire + ball (peak near the very top)
  front += cone(434, 6, 100, 66) + cone(470, 6, 100, 66); // shoulder pinnacles
  win += archWin(444, 116, 214, 8) + archWin(460, 116, 214, 8);
  win += rect(447, 98, 9, 12);

  // ===== central cluster between Astronomy and the Great Hall (varied heights) =====
  front += rect(496, 150, 30, BASE - 150) + cone(511, 23, 150, 108) + finial(511, 108, 90);
  win += rect(502, 168, 9, 13) + rect(502, 194, 9, 13);
  front += rect(544, 116, 28, BASE - 116) + cone(558, 21, 116, 78) + finial(558, 78, 60); // tall
  win += rect(551, 138, 8, 12) + rect(551, 162, 8, 12);
  front += rect(590, 162, 26, BASE - 162) + cone(603, 20, 162, 126) + finial(603, 126, 110);
  win += rect(599, 178, 8, 11);
  front += rect(636, 196, 16, BASE - 196) + cone(644, 12, 196, 164);

  // ===== GREAT HALL (centre, lit focal point) x=700..960 =====
  front += rect(700, 168, 260, BASE - 168);                          // long wall
  front += poly([[700, 168], [744, 96], [916, 96], [960, 168]]);     // steep pitched roof
  // a row of small ridge spires (cathedral-like — very Hogwarts)
  [744, 778, 812, 846, 880, 914].forEach((cx) => { front += finial(cx, 96, 78); });
  front += rect(692, 150, 22, BASE - 150) + cone(703, 17, 150, 112) + finial(703, 112, 96); // left turret
  front += rect(946, 150, 24, BASE - 150) + cone(958, 18, 150, 110) + finial(958, 110, 92); // right turret
  win += circle(830, 138, 15);                                       // ROSE WINDOW (round, lit)
  [724, 756, 788, 820, 852, 884, 916, 948].forEach((cx) => { win += archWin(cx, 178, 250, 17); });

  // ===== right-central cluster (varied heights) =====
  front += rect(982, 150, 30, BASE - 150) + cone(997, 23, 150, 108) + finial(997, 108, 90);
  win += rect(988, 168, 9, 13) + rect(988, 194, 9, 13);
  front += rect(1030, 120, 28, BASE - 120) + cone(1044, 21, 120, 82) + finial(1044, 82, 64); // tall
  win += rect(1037, 142, 8, 12) + rect(1037, 166, 8, 12);

  // ===== second dominant tower (Clock/Dark tower) cx=1158 =====
  const cx2 = 1158;
  front += rect(1130, 104, 56, BASE - 104);                  // tall body
  front += cone(cx2, 40, 104, 36) + finial(cx2, 36, 18) + circle(cx2, 18, 3);
  win += circle(cx2, 148, 9);                                // clock face
  win += archWin(1144, 166, 250, 9) + archWin(1172, 166, 250, 9);

  // ===== right wing — pointed tower cluster sprawling to the edge =====
  front += rect(1210, 150, 30, BASE - 150) + cone(1225, 23, 150, 108) + finial(1225, 108, 90);
  win += rect(1216, 168, 9, 13) + rect(1216, 194, 9, 13);
  front += rect(1258, 118, 28, BASE - 118) + cone(1272, 21, 118, 80) + finial(1272, 80, 62); // tall
  win += rect(1265, 140, 8, 12) + rect(1265, 164, 8, 12);
  front += rect(1304, 170, 18, BASE - 170) + cone(1313, 14, 170, 136) + finial(1313, 136, 120);
  front += rect(1340, 152, 28, BASE - 152) + cone(1354, 21, 152, 112) + finial(1354, 112, 96);
  win += rect(1347, 170, 8, 11);
  front += rect(1400, 140, 32, BASE - 140) + cone(1416, 24, 140, 98) + finial(1416, 98, 80); // edge anchor
  win += rect(1409, 160, 9, 13) + rect(1409, 186, 9, 13);
  front += rect(1444, 188, 16, BASE - 188) + cone(1452, 12, 188, 156);

  // ---------- cliff: a WIDE FLAT PLATEAU (top ~250) under the whole castle so
  //            no building floats, with craggy edges dropping off to the forest ----------
  const cliff = poly([
    [80, H],
    [80, 306], [124, 286], [166, 270], [206, 257], [242, 250],   // left crag → plateau
    [360, 248], [620, 250], [880, 249], [1100, 250], [1320, 248], [1450, 250], [1486, 252], // flat plateau
    [1520, 263], [1548, 284], [1574, 306], [1594, 324], [1600, H], // right crag drop
  ]);
  // (No rock facets: a clean SOLID cliff avoids the "what is that?" ledge/plane
  // artifacts of earlier drafts. The flat plateau + craggy drop-off edges carry it.)

  // ---------- back hills (full width, furthest) ----------
  const backHills = poly([
    [0, H], [0, 300], [160, 290], [360, 298], [560, 290], [800, 297],
    [1040, 290], [1280, 299], [1500, 290], [1600, 299], [1600, H],
  ]);

  // ---------- forest pines — frame the extreme edges (the castle fills the
  //            middle width), two-tier ----------
  const pineSpecs = [
    [20, 304, 42], [52, 310, 54], [86, 302, 36], [120, 310, 50], [150, 322, 34],
    [1456, 322, 36], [1492, 310, 48], [1524, 304, 40], [1558, 312, 58], [1590, 304, 42],
  ];
  const pines = pineSpecs.map(([cx, by, h]) => {
    const hw = Math.max(13, h * 0.34);
    return poly([[cx - hw, by], [cx, by - h], [cx + hw, by]]) +
           poly([[cx - hw * 0.74, by - h * 0.42], [cx, by - h * 1.12], [cx + hw * 0.74, by - h * 0.42]]);
  }).join('');

  // ---------- assemble (back→front) ----------
  const C = {
    hill: '#15102e', pine: '#1c1545', cliff: '#1b1342',
    back: '#201654', front: '#2c1f5e', gold: '#f2c75c',
  };
  return `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMax meet'>` +
    `<g fill='${C.hill}'>${backHills}</g>` +
    `<g fill='${C.back}'>${back}</g>` +
    `<g fill='${C.cliff}'>${cliff}</g>` +
    `<g fill='${C.front}'>${front}</g>` +
    `<g fill='${C.pine}'>${pines}</g>` +
    `<g fill='${C.gold}'>${win}</g>` +
    `</svg>`;
}

function toDataUri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// Bake the data-URI into the FIRST url() of the HP ::after rule in themes.css.
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
  // optional: requires the project's `sharp` dependency. Renders over a night-sky
  // gradient so the silhouette + lit windows are visible like in the app.
  const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));
  const grad = Buffer.from(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#0c0820'/><stop offset='0.45' stop-color='#1c0b2e'/><stop offset='0.75' stop-color='#2a0e3a'/><stop offset='1' stop-color='#1a0820'/></linearGradient></defs><rect width='${W}' height='${H}' fill='url(#g)'/></svg>`
  );
  const bg = await sharp(grad).png().toBuffer();
  await sharp(bg).composite([{ input: Buffer.from(svg) }]).png().toFile(outPath);
  console.log('Wrote preview PNG:', outPath);
}

(async () => {
  const args = process.argv.slice(2);
  const svg = buildSvg();
  const dataUri = toDataUri(svg);

  if (args.includes('--write-css')) {
    writeCss(dataUri);
    return;
  }

  const pngFlag = args.indexOf('--png');
  const pngPath = pngFlag !== -1 ? args[pngFlag + 1] : path.join(process.env.TMPDIR || '.', 'hogwarts-scene.png');
  console.log(`SVG ${svg.length} bytes, data-URI ${dataUri.length} bytes`);
  try { await writePreviewPng(svg, pngPath); } catch (e) { console.error('preview skipped:', e.message); }
})();
