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
 * Reference (current): a CURLED-UP SLEEPING dragon, 3D render with transparency —
 * pngimg.com "dragon_PNG1603" (free for personal/non-commercial use, CC BY-NC 4.0).
 * Tail wraps a full loop, head rests on the ground at the right, both wings folded as two
 * peaks over the back, spiked ridge — the pose reads entirely from the OUTER CONTOUR, which
 * is the property that matters (poses whose head/legs sit INSIDE the outline silhouette to a
 * blob; that killed the earlier Wikimedia "Dragon_silhouette_2" rearing emblem AND every
 * line-art candidate). NOT committed; fetch + re-vectorise with:
 *   curl -sL "https://pngimg.com/uploads/dragon/dragon_PNG1603.png" -o "$TMPDIR/dragon-ref.png"
 *   RENDER_W=800 node scripts/trace-dragon-reference.cjs "$TMPDIR/dragon-ref.png" --minloop=300
 * General usage:
 *   node scripts/trace-dragon-reference.cjs [path/to/reference.(svg|png)] [--luma[=N]] [--fill[=R]] [--solid[=K]] [--minloop[=A]] [--renderw=W] [--bands=T1,T2]
 *
 * --bands=T1[,T2[,...]]: ALSO posterise the reference's own shading into tone layers — for
 * each threshold T a band mask (pixel inside the silhouette AND luminance >= T) is traced and
 * stored under `bands` in the JSON. The generator stacks them lighter-over-darker, so the
 * dragon's anatomy (wing membranes, lit flanks, skull) reads INSIDE the dark mass. This is
 * what fixed "the dragon is just a weird blob": a single flat fill cannot carry a shape that
 * big — same lesson as the hoard's layered gold-scape.
 * --renderw=W: trace resolution (default 520; use the source's native width for crispest
 * edges). Equivalent to the RENDER_W env var, but preferred (no env prefix in the command).
 *
 * Masking: by default any opaque pixel = dragon (alpha >= 128). For references WITHOUT
 * transparency (an illustration on a white page) pass --luma (dark pixel = dragon,
 * luminance < N, default 128) — this is also auto-selected when the image has no
 * meaningful alpha coverage.
 *
 * --solid[=K]: keep only the K largest loops by area (default 1). NOTE: does NOT rescue
 * line art — marching squares merges a stroke network's outer+inner edges into one
 * wandering loop at junctions, so the "largest loop" still renders as outlines.
 *
 * --fill: for LINE ART (closed outlines). Flood-fills the BACKGROUND from the image
 * borders through non-dragon pixels; everything not reached (strokes + the areas they
 * enclose) becomes the solid mask, then only the largest connected component is kept
 * (drops smoke puffs / watermarks). Combine with --luma for line art on a white page.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'node_modules', 'sharp'));

const argv = process.argv.slice(2);
const lumaArg = argv.find((a) => a.startsWith('--luma'));
const LUMA_T = lumaArg ? (Number(lumaArg.split('=')[1]) || 128) : null;
const solidArg = argv.find((a) => a.startsWith('--solid'));
const SOLID_K = solidArg ? (Number(solidArg.split('=')[1]) || 1) : null;
const fillArg = argv.find((a) => a.startsWith('--fill'));
const FILL = fillArg ? (Number(fillArg.split('=')[1]) || 3) : null; // gap-closing radius (px)
const minloopArg = argv.find((a) => a.startsWith('--minloop'));
const MIN_LOOP = minloopArg ? (Number(minloopArg.split('=')[1]) || 300) : 0; // drop loops below this area (px²) — sliver holes read as cracks in the silhouette
const bandsArg = argv.find((a) => a.startsWith('--bands'));
const BANDS = bandsArg ? bandsArg.split('=')[1].split(',').map(Number).filter((n) => !isNaN(n)) : [];
// --erase=x0,y0,x1,y1 (repeatable): zero out a mask rect (in TRACE-canvas px) before
// tracing — surgical removal of misleading appendages (e.g. a thin horn that read as a
// tail tip and made viewers parse the whole dragon backwards).
const ERASES = argv.filter((a) => a.startsWith('--erase') && !a.startsWith('--eraseband'))
  .map((a) => a.split('=')[1].split(',').map(Number))
  .filter((r) => r.length === 4 && r.every((n) => !isNaN(n)));
// --eraseband=x0,y0,x1,y1 (repeatable): zero a rect in the BAND masks only (silhouette
// keeps the area) — kills a shading patch whose straight edge reads as a seam.
const BAND_ERASES = argv.filter((a) => a.startsWith('--eraseband'))
  .map((a) => a.split('=')[1].split(',').map(Number))
  .filter((r) => r.length === 4 && r.every((n) => !isNaN(n)));
const minbandArg = argv.find((a) => a.startsWith('--minband'));
// per-band area cutoffs (px²), comma-separated to match --bands; last value repeats. Raise
// until each band is a handful of big anatomy regions, not speckle.
const MIN_BAND_LOOPS = minbandArg
  ? minbandArg.split('=')[1].split(',').map(Number).filter((n) => !isNaN(n))
  : [90];

// Chebyshev dilate/erode by r px (separable: horizontal then vertical sliding max)
function morph(mask, W, H, r, dilate) {
  const pass = (src, len, stride, count, base) => {
    const out = new Uint8Array(len);
    for (let c = 0; c < count; c++) {
      for (let i = 0; i < len; i++) {
        let v = dilate ? 0 : 1;
        for (let k = Math.max(0, i - r); k <= Math.min(len - 1, i + r); k++) {
          const px = src[base(c) + k * stride];
          if (dilate ? px : !px) { v = dilate ? 1 : 0; break; }
        }
        out[i] = v;
      }
      for (let i = 0; i < len; i++) src[base(c) + i * stride] = out[i];
    }
  };
  pass(mask, W, 1, H, (y) => y * W);      // horizontal
  pass(mask, H, W, W, (x) => x);          // vertical
}
const SRC = argv.find((a) => !a.startsWith('--')) || (process.env.TMPDIR || '.') + '/dragon-ref.svg';
const renderwArg = (process.argv.find((a) => a.startsWith('--renderw')) || '').split('=')[1];
const RENDER_W = Number(renderwArg) || Number(process.env.RENDER_W) || 520; // trace resolution (px wide); higher = finer contour, bigger path
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

function loopsToPath(loops, eps = EPS) {
  // keep every loop (outer contours + internal holes); fill-rule:evenodd in the generator
  // turns the inner loops into holes (gaps between legs, tail curl) for a cleaner silhouette.
  return loops.map((lp) => {
    const l = dp(lp, eps);
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
  let opaque = 0;
  for (let i = 3; i < data.length; i += channels) if (data[i] >= 128) opaque++;
  // no meaningful transparency (white-page illustration) → fall back to luminance threshold
  const useLuma = LUMA_T !== null || opaque > W * H * 0.98;
  const lumaT = LUMA_T !== null ? LUMA_T : 128;
  if (useLuma) console.log(`luma mask (dark < ${lumaT} = dragon)${LUMA_T === null ? ' [auto: no alpha coverage]' : ''}`);
  for (let i = 0, p = 0; i < data.length; i += channels, p++) {
    mask[p] = useLuma
      ? data[i + 3] >= 128 && (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) < lumaT
      : data[i + 3] >= 128; // any opaque pixel = dragon
  }
  if (FILL) {
    // close small outline gaps so the flood can't leak into the figure
    morph(mask, W, H, FILL, true);
    // background = flood from every border pixel through non-dragon pixels (4-connectivity)
    const bg = new Uint8Array(W * H);
    const stack = [];
    const seed = (i) => { if (!mask[i] && !bg[i]) { bg[i] = 1; stack.push(i); } };
    for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p / W) | 0;
      if (x > 0) seed(p - 1);
      if (x < W - 1) seed(p + 1);
      if (y > 0) seed(p - W);
      if (y < H - 1) seed(p + W);
    }
    for (let i = 0; i < W * H; i++) mask[i] = !bg[i];
    // undo the dilation on the filled shape (restores the original outer edge)
    morph(mask, W, H, FILL, false);
    // keep only the largest solid component (drops smoke puffs, watermarks, specks)
    const lbl = new Int32Array(W * H);
    let cur = 0; const size = [0];
    const cstack = [];
    for (let i = 0; i < W * H; i++) {
      if (!mask[i] || lbl[i]) continue;
      cur++; let sz = 0; cstack.length = 0; cstack.push(i); lbl[i] = cur;
      while (cstack.length) {
        const p = cstack.pop(); sz++;
        const x = p % W, y = (p / W) | 0;
        if (x > 0 && mask[p - 1] && !lbl[p - 1]) { lbl[p - 1] = cur; cstack.push(p - 1); }
        if (x < W - 1 && mask[p + 1] && !lbl[p + 1]) { lbl[p + 1] = cur; cstack.push(p + 1); }
        if (y > 0 && mask[p - W] && !lbl[p - W]) { lbl[p - W] = cur; cstack.push(p - W); }
        if (y < H - 1 && mask[p + W] && !lbl[p + W]) { lbl[p + W] = cur; cstack.push(p + W); }
      }
      size[cur] = sz;
    }
    const biggest = size.indexOf(Math.max(...size));
    for (let i = 0; i < W * H; i++) mask[i] = lbl[i] === biggest;
    console.log(`--fill: closed gaps (r=${FILL}), flood-filled background, kept largest solid component`);
  }
  for (const [ex0, ey0, ex1, ey1] of ERASES) {
    for (let y = Math.max(0, ey0); y < Math.min(H, ey1); y++)
      for (let x = Math.max(0, ex0); x < Math.min(W, ex1); x++) mask[y * W + x] = false;
    console.log(`--erase: cleared ${ex0},${ey0} → ${ex1},${ey1}`);
  }
  keepLargeComponents(mask, W, H, MIN_COMPONENT);
  let loops = marchingSquares(mask, W, H);
  const area = (lp) => Math.abs(lp.reduce((a, p, i) => {
    const q = lp[(i + 1) % lp.length];
    return a + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2);
  if (SOLID_K !== null) {
    loops = loops.map((lp) => [area(lp), lp]).sort((a, b) => b[0] - a[0])
      .slice(0, SOLID_K).map(([, lp]) => lp);
    console.log(`--solid: kept ${loops.length} largest loop(s)`);
  }
  if (MIN_LOOP > 0) {
    const before = loops.length;
    loops = loops.filter((lp) => area(lp) >= MIN_LOOP);
    console.log(`--minloop: dropped ${before - loops.length} loop(s) under ${MIN_LOOP} px²`);
  }
  const dragonPath = loopsToPath(loops);
  // bbox of the kept loops (for placement / scaling in the generator)
  let bx0 = W, bx1 = 0, by0 = H, by1 = 0;
  for (const lp of loops) for (const [x, y] of lp) {
    if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
  }
  bx0 = Math.floor(bx0); by0 = Math.floor(by0); bx1 = Math.ceil(bx1); by1 = Math.ceil(by1);
  // tone bands: posterise the reference's shading INSIDE the final silhouette mask
  const bands = [];
  for (let bi = 0; bi < BANDS.length; bi++) {
    const t = BANDS[bi];
    const minBand = MIN_BAND_LOOPS[Math.min(bi, MIN_BAND_LOOPS.length - 1)];
    const bmask = new Array(W * H);
    for (let i = 0, p = 0; i < data.length; i += channels, p++) {
      bmask[p] = !!mask[p] &&
        (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) >= t;
    }
    for (const [ex0, ey0, ex1, ey1] of BAND_ERASES) {
      for (let y = Math.max(0, ey0); y < Math.min(H, ey1); y++)
        for (let x = Math.max(0, ex0); x < Math.min(W, ex1); x++) bmask[y * W + x] = false;
    }
    let blooks = marchingSquares(bmask, W, H).filter((lp) => area(lp) >= minBand);
    // shading boundaries are soft forms — simplify MUCH harder than the outline: big smooth
    // tone regions read as shading, small wiggly patches read as stains/camouflage
    const bandPath = loopsToPath(blooks, EPS * 4.5);
    bands.push({ t, path: bandPath });
    console.log(`--bands: t=${t} → ${blooks.length} loop(s), ${bandPath.length} chars`);
  }
  const out = { w: W, h: H, bbox: [bx0, by0, bx1, by1], path: dragonPath };
  if (bands.length) out.bands = bands;
  fs.writeFileSync(path.join(__dirname, 'dragon-traced.json'), JSON.stringify(out) + '\n');
  console.log('Wrote', path.relative(process.cwd(), path.join(__dirname, 'dragon-traced.json')),
    '| path', dragonPath.length, 'chars |', loops.length, 'loops | bbox', bx0, by0, bx1, by1, '| canvas', W, H);
  console.log('Now run: node scripts/generate-dungeon-scene.cjs');
})();
