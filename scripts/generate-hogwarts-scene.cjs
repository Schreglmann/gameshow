/* Compose the Harry Potter theme's Hogwarts-night background and (optionally) bake
 * it into the `[data-theme="harry-potter"]::after` rule in src/styles/themes.css.
 *
 * The castle is the REAL Hogwarts, vectorised from the classic blue reference
 * (pa-Hogwarts.png) by scripts/trace-hogwarts-reference.cjs into
 * scripts/hogwarts-traced.json (two shading tones — shadow #2c2658 / highlight
 * #473f6f — + gold windows).
 *
 * MOUNTAINS — the extended massif is drawn in the CASTLE CLIFF'S OWN VISUAL VOCABULARY
 * so the whole width reads as one rock (per the user: "I want the style of the mountain
 * under Hogwarts for the entire screen width" / "the second color forms rocks" / "the
 * second color is just some random lines without purpose"). The traced cliff (see
 * scripts/hogwarts-traced.json `high` path, studied in isolation) is FLAT and TWO-TONE:
 * a DARK-DOMINANT body (#2c2658) over which #473f6f appears as (a) clean, ELONGATED,
 * TAPERED edge-slivers tracing the lit arête grain of the crags and (b) a few BROAD
 * irregular lit faces on the moon-facing upper flanks. There are NO near-black marks —
 * the darkness between lit shapes is simply the shadow body. We reproduce exactly that:
 *   - Dark body = the massif silhouette filled #2c2658.
 *   - sliver(): a tapered #473f6f quad descending from just below the crest, leaning
 *     mostly down-left (moonward grain), width tapering to a point — a lit rock edge.
 *   - broadFace(): a wider irregular #473f6f polygon on a moon-facing upper flank — a
 *     lit rock face, like the cliff's broad facets.
 *   - Density profile: dense clusters on the far-left peaks and the right rise into the
 *     castle (to continue the cliff seamlessly), sparse over the low calm centre.
 *   ONLY TWO TONES (#2c2658 / #473f6f) — no #211b45, no gradients, no SVG filters, no
 *   grain — so it matches the flat traced cliff exactly and renders identically
 *   everywhere. Drawn BEHIND the full castle so the cliff shows on top and the massif
 *   simply continues it leftward (no seam). [Technique G, chosen from a multi-candidate
 *   exploration that first tried slab/ridge-&-gully faceting — see specs/themes.md.]
 *
 * SHAPE: a tall craggy peak far-left → a low calm centre (content sits above) → a
 * rise on the right to the castle's left toe (~1027,285). Moon/stars/candles live in
 * the CSS ::before; the moon is upper-left.
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

const VW = 1600, VH = 430, BASE = 430;
const C_SHADOW = '#2c2658', C_HIGH = '#473f6f', GOLD = '#f2c75c';

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

// Organic ridge: Catmull-Rom control points → cubic Beziers (the approved SHAPE).
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
  // ── approved silhouette ──
  const rng = mulberry32(987654321);
  const r = (lo, hi) => lo + (hi - lo) * rng();
  const ridge = [
    [-90, 430], [-90, 250], [-40, 205], [10, 150], [40, 96], [70, 132], [96, 110],
    [120, 158], [150, 196], [185, 175], [220, 228], [262, 256], [305, 286],
    [350, 300], [415, 312], [480, 318], [545, 314], [610, 320], [680, 312],
    [750, 318], [820, 300], [880, 286], [945, 270], [995, 296], [1027, 285],
    [1080, 300], [1180, 320], [1330, 350], [1500, 400], [1660, 425], [1660, 430],
  ];
  const fixed = new Set([0, 1, ridge.length - 1, ridge.length - 2]);
  const anchorXs = new Set([40, 1027]);
  const jittered = ridge.map((p, i) => {
    if (fixed.has(i) || anchorXs.has(p[0])) return [p[0], p[1]];
    const amp = p[0] < 300 ? r(-7, 7) : (p[0] < 850 ? r(-3, 3) : r(-5, 5));
    return [p[0] + r(-4, 4), p[1] + amp];
  });
  const massifPath = smoothPath(jittered) + ' L 1660 430 L -90 430 Z';

  // ── cliff-vocabulary faceting (separate seeded stream → silhouette unchanged) ──
  const drng = mulberry32(0x5f3a91c7);
  const dr = (lo, hi) => lo + (hi - lo) * drng();
  const crest = jittered.filter((p) => p[1] < 360);
  const crestYat = (x) => {
    if (x <= crest[0][0]) return crest[0][1];
    if (x >= crest[crest.length - 1][0]) return crest[crest.length - 1][1];
    for (let i = 0; i < crest.length - 1; i++) {
      const a = crest[i], b = crest[i + 1];
      if (x >= a[0] && x <= b[0]) return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
    }
    return BASE;
  };

  // Lit #473f6f shapes set on the dark body, in the cliff's own vocabulary.
  const lit = [];
  // a tapered lit edge-sliver descending from just below the crest, leaning mostly
  // down-left (moonward grain), width tapering to a point — a lit rock edge/arête.
  const sliver = (xTop) => {
    const yTop = crestYat(xTop) + dr(2, 14);
    const crag = BASE - yTop;
    let len = Math.min(crag * dr(0.45, 0.9), dr(42, 150));
    if (xTop >= 350 && xTop <= 930) len = Math.min(len, dr(22, 60)); // short & calm in centre
    const dir = drng() < 0.88 ? -1 : 1;          // mostly down-left grain, occasional down-right
    const lean = dr(0.32, 0.72) * dir;           // dx per dy
    const wid = drng() < 0.22 ? dr(9, 15) : dr(3.5, 9); // occasional broader sliver
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
  // a wider irregular lit face on a moon-facing upper flank — like the cliff's broad facets.
  const broadFace = (xTop) => {
    const yTop = crestYat(xTop) + dr(2, 10), crag = BASE - yTop;
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
  // density: dense clusters on the far-left peaks + the right rise to the castle (to
  // continue the cliff seamlessly), sparse over the low calm centre (content sits above).
  const spacing = (x) => (x < 350 ? dr(18, 30) : (x > 930 ? dr(18, 28) : dr(54, 100)));
  let x = crest[0][0] + 8;
  const xEnd = 1024; // stop at the castle toe; the traced cliff takes over from ~1027
  while (x < xEnd) {
    const onActive = x < 340 || x > 930;
    if (onActive && drng() < 0.42) broadFace(x);
    else if (!onActive && drng() < 0.12) broadFace(x); // occasional broad face in the centre too
    else if (drng() < (onActive ? 0.95 : 0.55)) sliver(x);
    x += spacing(x);
  }

  let inner = '';
  for (const p of lit) inner += `<polygon fill='${C_HIGH}' points='${poly(p)}'/>`;

  // full castle (traced) ON TOP — same tones + flat faceting as the massif → one rock.
  const traced = JSON.parse(fs.readFileSync(path.join(__dirname, 'hogwarts-traced.json'), 'utf8'));
  const castle = `<g transform='translate(1026.9 23.7) scale(0.8969)'>` +
    `<path fill='${C_SHADOW}' d='${traced.shadow}'/>` +
    `<path fill='${C_HIGH}' d='${traced.high}'/>` +
    `<path fill='${GOLD}' d='${traced.gold}'/></g>`;

  return `<svg xmlns='http://www.w3.org/2000/svg' width='${VW}' height='${VH}' viewBox='0 0 ${VW} ${VH}' preserveAspectRatio='xMidYMax meet'>` +
    `<defs><clipPath id='massifClip'><path d='${massifPath}'/></clipPath></defs>` +
    `<path fill='${C_SHADOW}' d='${massifPath}'/>` +
    `<g clip-path='url(#massifClip)'>${inner}</g>` +
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
  // body-gradient slice behind the scene band; MUST stay dark at the bottom. Flat
  // faceting renders faithfully in sharp/resvg (no filters), so this matches the browser.
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
