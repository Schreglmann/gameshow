/* Vectorise a flat dragon reference into ONE clean silhouette contour.
 *
 * The D&D theme's "dragon's lair" scene (scripts/generate-dungeon-scene.cjs) needs a
 * recognizable dragon lurking in the dark depths. A hand-drawn dragon from SVG primitives
 * reads as clip-art (see specs/themes.md / the HP castle history) — so we trace a real
 * reference into a clean silhouette path instead, exactly like the Hogwarts pipeline
 * (scripts/trace-hogwarts-reference.cjs):
 *   reference (SVG or PNG) → rasterise → alpha mask → marching-squares contours →
 *   Douglas-Peucker simplify → scripts/dragon-traced.json (single even-odd path + bbox).
 *
 * The generator recolours it near-black with a subtle rim-light and overlays glowing eyes,
 * so only the SHAPE matters here (not the reference's own colours) — hence we threshold on
 * alpha (any opaque pixel = dragon) and keep internal holes (gaps between legs / tail curl).
 *
 * Reference: a fierce Western dragon silhouette from Wikimedia Commons —
 * "File:Dragon_silhouette_2.svg" (a muscular, spread-winged, snarling Western dragon; CC BY-SA
 * 3.0 / GFDL). Chosen over the heraldic Welsh dragon because the latter read as comic/goofy;
 * this one is serious + menacing. NOT committed; pass its path as the first arg
 * (defaults to $TMPDIR/dragon-ref.svg). Fetch it with:
 *   curl -sL "https://commons.wikimedia.org/wiki/Special:FilePath/Dragon_silhouette_2.svg" -o "$TMPDIR/dragon-ref.svg"
 * Re-run only to re-vectorise from a new reference:
 *   node scripts/trace-dragon-reference.cjs [path/to/reference.(svg|png)]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));

const SRC = process.argv[2] || (process.env.TMPDIR || '.') + '/dragon-ref.svg';
const RENDER_W = 520;   // trace resolution (px wide); higher = finer contour, bigger path
const EPS = 1.1;        // Douglas-Peucker tolerance (px)
const MIN_COMPONENT = 60; // drop opaque specks smaller than this (8-connectivity)

// ---- marching squares: boolean mask (W x H) -> array of closed loops [[x,y],...] ----
function marchingSquares(mask, W, H) {
  const inside = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? mask[y * W + x] : false;
  const P = (cx, cy) => ({ T: [cx + 0.5, cy], R: [cx + 1, cy + 0.5], B: [cx + 0.5, cy + 1], L: [cx, cy + 0.5] });
  const TBL = {
    1: [['L', 'B']], 2: [['B', 'R']], 3: [['L', 'R']], 4: [['T', 'R']],
    5: [['L', 'T'], ['B', 'R']], 6: [['T', 'B']], 7: [['L', 'T']], 8: [['T', 'L']],
    9: [['T', 'B']], 10: [['T', 'R'], ['L', 'B']], 11: [['T', 'R']], 12: [['L', 'R']],
    13: [['B', 'R']], 14: [['L', 'B']],
  };
  const key = (p) => `${Math.round(p[0] * 2)}_${Math.round(p[1] * 2)}`;
  const coord = new Map();
  const adj = new Map();
  const edges = [];
  const addEdge = (a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === kb) return;
    coord.set(ka, a); coord.set(kb, b);
    const id = edges.length; edges.push([ka, kb]);
    if (!adj.has(ka)) adj.set(ka, []); adj.get(ka).push({ to: kb, id });
    if (!adj.has(kb)) adj.set(kb, []); adj.get(kb).push({ to: ka, id });
  };
  for (let cy = -1; cy < H; cy++) {
    for (let cx = -1; cx < W; cx++) {
      const tl = inside(cx, cy), tr = inside(cx + 1, cy), br = inside(cx + 1, cy + 1), bl = inside(cx, cy + 1);
      const idx = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      const segs = TBL[idx];
      if (!segs) continue;
      const pts = P(cx, cy);
      for (const [a, b] of segs) addEdge(pts[a], pts[b]);
    }
  }
  const used = new Array(edges.length).fill(false);
  const loops = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const loop = [];
    let curKey = edges[s][0];
    const startKey = curKey;
    let guard = 0;
    while (guard++ < 1e7) {
      const nbrs = adj.get(curKey) || [];
      let next = null;
      for (const e of nbrs) { if (!used[e.id]) { next = e; break; } }
      if (!next) break;
      used[next.id] = true;
      loop.push(coord.get(curKey));
      curKey = next.to;
      if (curKey === startKey) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function dp(points, eps) {
  if (points.length < 4) return points;
  const sqd = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1e-9;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + t * dx, py = a[1] + t * dy;
    return (p[0] - px) ** 2 + (p[1] - py) ** 2;
  };
  const simplify = (pts) => {
    let maxD = 0, idx = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = sqd(pts[i], pts[0], pts[pts.length - 1]); if (d > maxD) { maxD = d; idx = i; } }
    if (maxD > eps * eps) {
      const l = simplify(pts.slice(0, idx + 1)), r = simplify(pts.slice(idx));
      return l.slice(0, -1).concat(r);
    }
    return [pts[0], pts[pts.length - 1]];
  };
  return simplify(points.concat([points[0]])).slice(0, -1);
}

function keepLargeComponents(mask, W, H, minSize) {
  const lbl = new Int32Array(W * H);
  let cur = 0; const size = [0];
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || lbl[i]) continue;
    cur++; let sz = 0; stack.length = 0; stack.push(i); lbl[i] = cur;
    while (stack.length) {
      const p = stack.pop(); sz++;
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (mask[ni] && !lbl[ni]) { lbl[ni] = cur; stack.push(ni); }
      }
    }
    size[cur] = sz;
  }
  for (let i = 0; i < W * H; i++) if (mask[i] && size[lbl[i]] < minSize) mask[i] = false;
}

function loopsToPath(loops) {
  // keep every loop (outer contours + internal holes); fill-rule:evenodd in the generator
  // turns the inner loops into holes (gaps between legs, tail curl) for a cleaner silhouette.
  return loops.map((lp) => {
    const l = dp(lp, EPS);
    if (l.length < 3) return '';
    return 'M' + l.map((p) => `${Math.round(p[0] * 10) / 10} ${Math.round(p[1] * 10) / 10}`).join(' L') + 'Z';
  }).join('');
}

(async () => {
  const { data, info } = await sharp(SRC, { density: 220 })
    .resize({ width: RENDER_W })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;
  const mask = new Array(W * H);
  for (let i = 0, p = 0; i < data.length; i += channels, p++) {
    mask[p] = data[i + 3] >= 128; // any opaque pixel = dragon
  }
  keepLargeComponents(mask, W, H, MIN_COMPONENT);
  const loops = marchingSquares(mask, W, H);
  const dragonPath = loopsToPath(loops);
  // bbox of the opaque silhouette (for placement / scaling in the generator)
  let bx0 = W, bx1 = 0, by0 = H, by1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (mask[y * W + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }
  fs.writeFileSync(path.join(__dirname, 'dragon-traced.json'),
    JSON.stringify({ w: W, h: H, bbox: [bx0, by0, bx1, by1], path: dragonPath }) + '\n');
  console.log('Wrote', path.relative(process.cwd(), path.join(__dirname, 'dragon-traced.json')),
    '| path', dragonPath.length, 'chars |', loops.length, 'loops | bbox', bx0, by0, bx1, by1, '| canvas', W, H);
  console.log('Now run: node scripts/generate-dungeon-scene.cjs');
})();
