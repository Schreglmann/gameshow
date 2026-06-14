// Runtime driver for the D&D theme's animated easter-egg creatures.
//
// Mirrors src/utils/hpFlyers.ts: the baked `[data-theme="dnd"]::after` dungeon scene can't
// self-animate (it's a background-image data-URI) and a CSS @keyframes loop can only repeat
// ONE fixed path — so the moving creatures are layered as extra `background-image` layers on
// `html::after` and driven from JS for per-flight randomness (never the same flight twice).
// Each frame this composes the 4-layer `background-position` and writes it to `--dnd-bgpos`,
// read by themes.css. Bats swap a horizontally-mirrored sprite (via `--dnd-img1/2`) so they
// always face their travel direction.
//
// The cast (a torchlit dungeon at night):
//   - WILL-O'-WISP — a small teal flame-spirit that roams the lair air continuously (slow
//     random wander with occasional hovers), like the HP Snitch.
//   - TWO BATS — dark fluttering bats that take occasional, independent randomised flights
//     across the upper air (wing-flap pose cycling; mirrored to face their direction).
//
// Self-installing + cheap: only runs while the D&D theme is active on <html>, on screens
// wider than the phone breakpoint, and when reduced motion is NOT requested — otherwise it
// removes `--dnd-bgpos` so the CSS fallback (everything parked) applies.
//
// Layer order (matches the background-image list in themes.css):
//   0 wisp · 1 bat0 · 2 bat1 · 3 dungeon scene

export type RNG = () => number;

const FIXED: Record<number, string> = { 3: 'center bottom' };
// off-screen park positions when a mover is idle (matches the CSS fallback values)
const PARK: Record<number, string> = { 0: '50% 132%', 1: '-24% 122%', 2: '124% 122%' };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (n: number) => Math.round(n * 100) / 100;
const posStr = (x: number, y: number) => `${r2(x)}% ${r2(y)}%`;

// creatures fly in the lair air — above the foreground floor/hoard, below the very top.
const FLY_Y_MIN = 8;
const FLY_Y_MAX = 54;

// ── smooth interpolation (Catmull-Rom) so the motion curves naturally ──
export function catmull(p0: number[], p1: number[], p2: number[], p3: number[], f: number): [number, number] {
  const f2 = f * f, f3 = f2 * f;
  const c = (a: number, b: number, cc: number, d: number) =>
    0.5 * (2 * b + (cc - a) * f + (2 * a - 5 * b + 4 * cc - d) * f2 + (-a + 3 * b - 3 * cc + d) * f3);
  return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
}
export function sampleSpline(pts: number[][], u: number): [number, number] {
  const n = pts.length;
  if (n === 1) return [pts[0][0], pts[0][1]];
  const fu = clamp(u, 0, 1) * (n - 1);
  const seg = Math.min(n - 2, Math.floor(fu));
  return catmull(pts[Math.max(0, seg - 1)], pts[seg], pts[seg + 1], pts[Math.min(n - 1, seg + 2)], fu - seg);
}

// ── per-bat character: overall duration ranges (paths/heights are fully random) ──
export interface FlyStyle { durMin: number; durMax: number; }
// Background ambience, NOT an attraction: slow crossings (faster ones drew the eye).
export const STYLES: Record<number, FlyStyle> = {
  1: { durMin: 20000, durMax: 30000 }, // bat0
  2: { durMin: 24000, durMax: 34000 }, // bat1 (a touch slower)
};
// wing flap — both bats beat their wings: rotate the wing group through cached poses.
export const FLAP: Record<number, { amp: number; n: number; frameMs: number }> = {
  1: { amp: 26, n: 6, frameMs: 70 },  // quick erratic bat flap
  2: { amp: 24, n: 6, frameMs: 82 },
};
// natural facing of the bat sprite (true = looks right). Mirror when travel ≠ facing.
export const FACE_RIGHT: Record<number, boolean> = { 1: true, 2: true };

// A GENTLE monotonic time→progress warp (speed eases up/down a little, never rushes).
export function makeWarp(rng: RNG): (u: number) => number {
  const a1 = (rng() - 0.5) * 0.4;
  const a2 = (rng() - 0.5) * 0.22;
  const TAU = Math.PI * 2;
  return (u: number) => {
    u = clamp(u, 0, 1);
    return clamp(u + (a1 / TAU) * (1 - Math.cos(TAU * u)) + (a2 / (2 * TAU)) * (1 - Math.cos(2 * TAU * u)), 0, 1);
  };
}

export interface Flight { pts: number[][]; dur: number; warp: (u: number) => number; ltr: boolean; }

// Build ONE random bat flight: random direction (monotonic so facing stays correct), a varied
// vertical profile (random walk in the band), a random duration and a random speed warp.
export function buildFlight(rng: RNG, style: FlyStyle): Flight {
  const ltr = rng() < 0.5;
  const startX = ltr ? -24 : 124, endX = ltr ? 124 : -24;
  const n = 5 + Math.floor(rng() * 3); // 5–7 waypoints
  const pts: number[][] = [];
  let y = FLY_Y_MIN + rng() * (FLY_Y_MAX - FLY_Y_MIN);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    pts.push([r2(startX + (endX - startX) * u), r2(clamp(y, FLY_Y_MIN, FLY_Y_MAX))]);
    y = clamp(y + (rng() - 0.5) * 22, FLY_Y_MIN, FLY_Y_MAX); // gentle vertical wander (±11)
  }
  return { pts, dur: style.durMin + rng() * (style.durMax - style.durMin), warp: makeWarp(rng), ltr };
}

// will-o'-wisp roam target — wanders the lair air with the occasional small step (hover)
export function nextWispTarget(rng: RNG, prev: { x: number; y: number }): { x: number; y: number } {
  if (rng() < 0.25) return { x: clamp(prev.x + (rng() - 0.5) * 12, 10, 90), y: clamp(prev.y + (rng() - 0.5) * 10, 14, 50) };
  return { x: 10 + rng() * 80, y: 14 + rng() * 36 };
}

export const composeBgPos = (positions: string[]): string => positions.join(', ');

// ── creature sprite SVGs (source of truth for the mirrored variants; the baked URLs in
//    themes.css are the no-JS fallback and must match these "normal" shapes) ──
// The bat is split into a STATIC body + two WING parts, each rotated about its own shoulder
// for the flap. The wisp is a static glowing orb (no flap).
const BAT = {
  w: 44, h: 26,
  staticBody:
    "<g fill='#0b0805'><ellipse cx='22' cy='15' rx='4.4' ry='6'/><circle cx='22' cy='8.5' r='3.4'/>" +
    "<path d='M19.5 6 L18 1 L21 4.5Z'/><path d='M24.5 6 L26 1 L23 4.5Z'/>" +
    "<path d='M20 20 L22 25 L24 20Z'/></g>",
  wings: [
    { pivot: [20, 13], m: "<path d='M20 13 C12 7 5 6 1 9 Q5 10 7 12 Q3 12 1 15 Q6 14 9 15 Q5 17 4 19 Q11 16 20 17 Z' fill='#0b0805'/>" },
    { pivot: [24, 13], m: "<path d='M24 13 C32 7 39 6 43 9 Q39 10 37 12 Q41 12 43 15 Q38 14 35 15 Q39 17 40 19 Q33 16 24 17 Z' fill='#0b0805'/>" },
  ],
};
export function spriteUri(layer: number, mirror: boolean, flapDeg = 0): string {
  if (layer === 0) {
    // will-o'-wisp — a plain glowing orb: soft halo + bright core, NOTHING above it. Both
    // attempts at an upward flame lick (24px spike, then a short lick inside the halo) read
    // as "a beam on top" — the wisp gets no directional feature at all.
    const svg =
      "<svg xmlns='http://www.w3.org/2000/svg' width='40' height='52' viewBox='0 0 40 52'>" +
      "<defs><radialGradient id='w' cx='0.5' cy='0.5' r='0.5'>" +
      "<stop offset='0' stop-color='#eafff4'/><stop offset='0.35' stop-color='#6ff0d8'/>" +
      "<stop offset='0.7' stop-color='#2bb6a6' stop-opacity='0.5'/><stop offset='1' stop-color='#1b8f86' stop-opacity='0'/>" +
      "</radialGradient></defs>" +
      "<ellipse cx='20' cy='34' rx='18' ry='16' fill='url(#w)'/>" +
      "<circle cx='20' cy='34' r='5.5' fill='#eafff4'/></svg>";
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  }
  const s = BAT;
  // Opposite signs per wing: in SVG (y-down) a positive rotation lifts the LEFT wing tip but
  // DROPS the right one — same-sign rotation makes the bat see-saw instead of flap.
  const wingPart = s.wings
    .map((w, i) => `<g transform='rotate(${i === 0 ? flapDeg : -flapDeg} ${w.pivot[0]} ${w.pivot[1]})'>${w.m}</g>`)
    .join('');
  let content = s.staticBody + wingPart;
  if (mirror) content = `<g transform='translate(${s.w},0) scale(-1,1)'>${content}</g>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s.w}' height='${s.h}' viewBox='0 0 ${s.w} ${s.h}'>${content}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

interface BatState { flight: Flight | null; start: number; endAt: number; nextAt: number; mirror: boolean; flapIdx: number; }

// Driver: holds all state; `tick(now)` returns the composed 4-layer string (and, if given,
// writes it to `--dnd-bgpos`; `setImg(layer, uri)` swaps a bat's mirrored/flapped sprite).
export function createDriver(rng: RNG, setProp?: (v: string) => void, startNow = 0, setImg?: (layer: number, uri: string) => void) {
  // two independent bats (each parks off-screen between its own occasional flights)
  const bats: Record<number, BatState> = {
    1: { flight: null, start: 0, endAt: 0, nextAt: startNow + 2000 + rng() * 6000, mirror: false, flapIdx: -1 },
    2: { flight: null, start: 0, endAt: 0, nextAt: startNow + 9000 + rng() * 10000, mirror: false, flapIdx: -1 },
  };
  const batPos = (layer: number, now: number): string => {
    const b = bats[layer];
    if (b.flight) {
      if (now >= b.endAt) b.flight = null;
      else {
        const flap = FLAP[layer];
        let bob = 0;
        if (flap) {
          // cos sweeps through the FULL ±amp range (sin over 6 frames never passes ±0.87·amp
          // and holds poses for two frames — looked stuttery)
          const phase = (2 * Math.PI * now) / (flap.frameMs * flap.n);
          if (setImg) {
            const idx = Math.floor(now / flap.frameMs) % flap.n;
            if (idx !== b.flapIdx) {
              b.flapIdx = idx;
              setImg(layer, spriteUri(layer, b.mirror, +(flap.amp * Math.cos((2 * Math.PI * idx) / flap.n)).toFixed(2)));
            }
          }
          // wingbeat-synced body bob: the body rides each downstroke (highest when wings are
          // down, phase π) instead of gliding on rails — without it the flap looks decorative.
          // Keep it SUBTLE: ±1.1 read as bouncing ("the bats move too much").
          bob = 0.4 * Math.cos(phase);
        }
        const [x, y] = sampleSpline(b.flight.pts, b.flight.warp((now - b.start) / b.flight.dur));
        return posStr(x, clamp(y + bob, FLY_Y_MIN, FLY_Y_MAX));
      }
    }
    if (!b.flight && now >= b.nextAt) {
      const f = buildFlight(rng, STYLES[layer]);
      b.flight = f;
      b.start = now;
      b.endAt = now + f.dur;
      b.nextAt = now + 38000 + rng() * 42000; // next flight 38–80s after this one starts
      b.mirror = f.ltr !== FACE_RIGHT[layer];
      b.flapIdx = -1;
      if (setImg) setImg(layer, spriteUri(layer, b.mirror, 0));
      const [x, y] = sampleSpline(f.pts, 0);
      return posStr(x, clamp(y, FLY_Y_MIN, FLY_Y_MAX));
    }
    return PARK[layer];
  };

  // will-o'-wisp — continuous slow random roam (with the occasional hover) in the lair air
  const SPEED = 0.0022;
  const wisp = [{ x: 30, y: 26, t: startNow - 4000 }, { x: 44, y: 22, t: startNow }];
  const wispPos = (now: number): [number, number] => {
    while (wisp[wisp.length - 1].t < now + 20000) {
      const prev = wisp[wisp.length - 1];
      const tgt = nextWispTarget(rng, prev);
      const dt = clamp(Math.hypot(tgt.x - prev.x, tgt.y - prev.y) / SPEED, 4000, 17000);
      wisp.push({ x: tgt.x, y: tgt.y, t: prev.t + dt });
    }
    while (wisp.length > 3 && wisp[1].t < now - 1000) wisp.shift();
    let i = 0;
    while (i < wisp.length - 2 && wisp[i + 1].t <= now) i++;
    const a = wisp[Math.max(0, i - 1)], b = wisp[i], c = wisp[i + 1], d = wisp[Math.min(wisp.length - 1, i + 2)];
    const f = clamp((now - b.t) / (c.t - b.t || 1), 0, 1);
    const [x, y] = catmull([a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y], f);
    return [x, clamp(y, 14, 50)];
  };

  const tick = (now: number): string => {
    const out: string[] = new Array(4);
    const [wx, wy] = wispPos(now);
    out[0] = posStr(wx, wy);
    out[1] = batPos(1, now);
    out[2] = batPos(2, now);
    out[3] = FIXED[3];
    const value = composeBgPos(out);
    if (setProp) setProp(value);
    return value;
  };

  return { tick };
}

// ── DOM glue ──
export function installDndCreatures(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const root = document.documentElement;
  const reduceMM = window.matchMedia('(prefers-reduced-motion: reduce)');

  let raf = 0;
  let running = false;
  let driver: ReturnType<typeof createDriver> | null = null;

  const shouldRun = () => root.dataset.theme === 'dnd' && !reduceMM.matches && window.innerWidth > 576;
  const loop = () => {
    if (!running || !driver) return;
    driver.tick(performance.now());
    raf = requestAnimationFrame(loop);
  };
  const start = () => {
    if (running) return;
    running = true;
    driver = createDriver(
      Math.random,
      (v) => root.style.setProperty('--dnd-bgpos', v),
      performance.now(),
      (layer, uri) => root.style.setProperty(`--dnd-img${layer}`, uri),
    );
    loop();
  };
  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    driver = null;
    root.style.removeProperty('--dnd-bgpos');
  };
  const update = () => (shouldRun() ? start() : stop());

  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', update, { passive: true });
  if (reduceMM.addEventListener) reduceMM.addEventListener('change', update);
  else if (reduceMM.addListener) reduceMM.addListener(update);

  update();
}
