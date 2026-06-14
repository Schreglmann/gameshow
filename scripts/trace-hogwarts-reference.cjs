/* Vectorise the flat-colour Hogwarts reference into clean theme-recoloured contours.
 *
 * This produces scripts/hogwarts-traced.json (two shading paths + a gold-windows
 * path), which scripts/generate-hogwarts-scene.cjs composes into the theme's
 * background. A hand-drawn silhouette of generic towers never reads as "Hogwarts";
 * tracing the real castle's intricate massing does. Pipeline:
 *   reference PNG → classify flat colours → marching-squares contours →
 *   Douglas-Peucker simplify → recolour → hogwarts-traced.json (+ preview PNG).
 *
 * The reference image (a free, non-commercial blue Hogwarts silhouette from
 * pngall.com) is NOT committed; pass its path as the first arg (defaults to
 * $TMPDIR/pa-Hogwarts.png). Re-run only to re-vectorise from a new reference:
 *   node scripts/trace-hogwarts-reference.cjs [path/to/reference.png]
 *
 * Classification keys off the reference's own flat palette: transparent background,
 * warm-yellow gold windows, and two blue shading tones split by "blueness" (b-r) —
 * the darker SHADOW areas are less blue than the lighter HIGHLIGHT areas. */
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));

const SRC = process.argv[2] || (process.env.TMPDIR || '.') + '/pa-Hogwarts.png';
const EPS = 1.4;            // Douglas-Peucker tolerance (px); recolouring happens in the generator

function classify(r, g, b, a) {
  if (a < 128) return 0;                                  // transparent background
  if (r > 170 && b < 150 && (r - b) > 60) return 3;       // gold windows (warm yellow)
  // the reference's darker SHADOW areas are LESS blue than its lighter HIGHLIGHTS
  return (b - r) < 51 ? 1 : 2;                            // 1 = shadow, 2 = highlight
}

// ---- marching squares: boolean mask (W x H) -> array of closed loops [[x,y],...] ----
function marchingSquares(mask, W, H) {
  const inside = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? mask[y * W + x] : false;
  // segment table by case idx = tl*8|tr*4|br*2|bl
  const P = (cx, cy) => ({
    T: [cx + 0.5, cy], R: [cx + 1, cy + 0.5], B: [cx + 0.5, cy + 1], L: [cx, cy + 0.5],
  });
  const TBL = {
    1: [['L', 'B']], 2: [['B', 'R']], 3: [['L', 'R']], 4: [['T', 'R']],
    5: [['L', 'T'], ['B', 'R']], 6: [['T', 'B']], 7: [['L', 'T']], 8: [['T', 'L']],
    9: [['T', 'B']], 10: [['T', 'R'], ['L', 'B']], 11: [['T', 'R']], 12: [['L', 'R']],
    13: [['B', 'R']], 14: [['L', 'B']],
  };
  const key = (p) => `${Math.round(p[0] * 2)}_${Math.round(p[1] * 2)}`;
  const coord = new Map();
  const adj = new Map();           // key -> [{to, id}]
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
  // chain edges into loops
  const used = new Array(edges.length).fill(false);
  const loops = [];
  for (let s = 0; s < edges.length; s++) {
    if (used[s]) continue;
    const loop = [];
    let curKey = edges[s][0];
    let startKey = curKey;
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

// ---- Douglas-Peucker for a closed loop ----
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

// ---- window regularisation ----
// Marching-squares + Douglas-Peucker distorts the tiny window blobs into skewed 5–6
// point shapes ("weird forms"). Replace each window loop with a TIGHT oriented
// rectangle whose orientation is CONSTRAINED to within ±25° of an axis: a near-square
// window stays upright (never rotates to a diamond), while a clearly-slanted window
// (the covered-bridge bars) may lean a little to follow its wall. Tight = no spill past
// the building edge, so the lit windows fit the rest of the castle.
const RECT_LIMIT = 25 * Math.PI / 180;
function bboxAt(pts, ang) {
  const c = Math.cos(-ang), s = Math.sin(-ang);
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const p of pts) {
    const rx = p[0] * c - p[1] * s, ry = p[0] * s + p[1] * c;
    if (rx < minx) minx = rx; if (rx > maxx) maxx = rx;
    if (ry < miny) miny = ry; if (ry > maxy) maxy = ry;
  }
  return { area: (maxx - minx) * (maxy - miny), ang, minx, maxx, miny, maxy };
}
function minAreaRect(pts) {
  if (pts.length < 3) return pts;
  const cands = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    let ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    ang = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);  // fold to [0,90°)
    if (ang > Math.PI / 4) ang -= Math.PI / 2;                    // -> [-45°,45°]
    if (Math.abs(ang) <= RECT_LIMIT) cands.push(ang);
  }
  let best = null;
  for (const ang of cands) { const box = bboxAt(pts, ang); if (best === null || box.area < best.area) best = box; }
  const { ang, minx, maxx, miny, maxy } = best;
  const c = Math.cos(ang), s = Math.sin(ang);
  const corner = (rx, ry) => [rx * c - ry * s, rx * s + ry * c];
  return [corner(minx, miny), corner(maxx, miny), corner(maxx, maxy), corner(minx, maxy)];
}
// regularise an existing committed gold path (used when no reference PNG is available)
function regularizeGoldPath(goldPath) {
  const r1 = (n) => Math.round(n * 10) / 10;
  return goldPath.split('Z').map((s) => s.trim()).filter(Boolean).map((sp) => {
    const nums = (sp.match(/-?\d*\.?\d+/g) || []).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    if (pts.length < 3) return '';
    const rect = minAreaRect(pts);
    return 'M' + rect.map((p) => `${r1(p[0])} ${r1(p[1])}`).join(' L') + 'Z';
  }).join('');
}

// zero out connected components smaller than `minSize` (8-connectivity)
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

function signedArea(loop) {
  let a = 0;
  for (let i = 0; i < loop.length; i++) { const p = loop[i], q = loop[(i + 1) % loop.length]; a += p[0] * q[1] - q[0] * p[1]; }
  return a / 2;
}

function loopsToPath(loops) {
  return loops.map((lp) => {
    let l = dp(lp, EPS);
    if (l.length < 3) return '';
    if (signedArea(l) < 0) l = l.reverse();   // force CCW so nonzero fill fills holes (covered by upper layers)
    return 'M' + l.map((p) => `${Math.round(p[0] * 10) / 10} ${Math.round(p[1] * 10) / 10}`).join(' L') + 'Z';
  }).join('');
}

// `--regularize [path.json]` — re-straighten the windows of an ALREADY-traced JSON in
// place (no reference PNG needed). The committed trace was produced this way after the
// reference image was no longer available.
if (process.argv.includes('--regularize')) {
  const jsonPath = process.argv[process.argv.indexOf('--regularize') + 1] && !process.argv[process.argv.indexOf('--regularize') + 1].startsWith('--')
    ? process.argv[process.argv.indexOf('--regularize') + 1]
    : path.join(__dirname, 'hogwarts-traced.json');
  const t = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const before = (t.gold.match(/M/g) || []).length;
  t.gold = regularizeGoldPath(t.gold);
  fs.writeFileSync(jsonPath, JSON.stringify(t) + '\n');
  console.log(`Regularised ${before} windows in ${path.relative(process.cwd(), jsonPath)} -> oriented rects`);
  console.log('Now run: node scripts/generate-hogwarts-scene.cjs --write-css');
  return;
}

(async () => {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;
  const cls = new Uint8Array(W * H);
  for (let i = 0, p = 0; i < data.length; i += channels, p++) {
    cls[p] = classify(data[i], data[i + 1], data[i + 2], data[i + 3]);
  }
  // The reference's two blue tones are its own SHADOW (darker, class 1) vs
  // HIGHLIGHT (lighter, class 2) shading — recolour both + gold windows for a
  // faithful reproduction (we don't try to isolate "the castle" — can't, by colour).
  const shadow = new Array(W * H), high = new Array(W * H), gold = new Array(W * H);
  for (let i = 0; i < W * H; i++) {
    shadow[i] = (cls[i] === 1);
    high[i] = (cls[i] === 2);
    gold[i] = (cls[i] === 3);
  }
  keepLargeComponents(shadow, W, H, 200);
  keepLargeComponents(high, W, H, 120);
  const shadowPath = loopsToPath(marchingSquares(shadow, W, H));
  const highPath = loopsToPath(marchingSquares(high, W, H));
  // windows: simplify, then snap each to a tight near-upright rectangle so the lit
  // windows come out clean (not skewed) and fit the building (see minAreaRect above).
  const goldLoops = marchingSquares(gold, W, H).map((lp) => minAreaRect(dp(lp, EPS)));
  const goldPath = loopsToPath(goldLoops);
  // foreground bbox (all opaque ink) for placement
  let bx0 = W, bx1 = 0, by0 = H, by1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (shadow[y * W + x] || high[y * W + x] || gold[y * W + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  }

  // save traced paths + bbox for the generator (committed source of truth)
  fs.writeFileSync(path.join(__dirname, 'hogwarts-traced.json'),
    JSON.stringify({ w: W, h: H, bbox: [bx0, by0, bx1, by1], shadow: shadowPath, high: highPath, gold: goldPath }));
  console.log('Wrote', path.relative(process.cwd(), path.join(__dirname, 'hogwarts-traced.json')),
    '| shadow', shadowPath.length, 'high', highPath.length, 'gold', goldPath.length, '| bbox', bx0, by0, bx1, by1);
  console.log('Now run: node scripts/generate-hogwarts-scene.cjs --write-css');
})();
