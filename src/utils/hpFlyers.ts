// Runtime driver for the Harry Potter theme's animated easter-egg "flyers".
//
// The baked `html::after` scene can't self-animate (it's a background-image), and a CSS
// `@keyframes` animation can only loop ONE fixed path identically — so to make the flyers
// truly RANDOM (different direction, path, height and speed every flight, never repeating)
// the motion is driven from JS. Each frame this composes the 9-layer `background-position`
// and writes it to the `--hp-bgpos` custom property, read by `themes.css` in
// `[data-theme="harry-potter"]::after`.
//
// MIRRORING: each flyer sprite has a fixed facing (owl looks right, broom + dragon look
// left). When a flight travels against that facing the sprite would look like it's flying
// BACKWARDS — so the driver swaps in a horizontally-mirrored sprite (via the per-layer
// `--hp-img5/6/7` custom properties, set once at flight start while the flyer is off-screen)
// so the image always faces its travel direction.
//
// FLIGHT BAND: flyers may fly anywhere in the sky ABOVE the terrain — including up through
// and above the question banner (a hard floor keeps them above the mountains/Hogwarts/lake;
// there is intentionally NO ceiling). Only ONE of the three flyers is airborne at a time
// (serialised). The tiny Snitch roams the upper sky continuously (it's occluded by the
// opaque banner when it passes behind it).
//
// Self-installing + cheap: only runs while the HP theme is active on <html>, on screens
// wider than the phone breakpoint, and when reduced motion is NOT requested. Otherwise it
// removes `--hp-bgpos` so the CSS fallback (everything parked, a static Snitch glint) applies.
//
// Layer order (matches the background-image list in themes.css):
//   0 moonlight · 1 squid · 2 scene · 3 warm glow · 4 snitch · 5 Hedwig · 6 broom · 7 dragon · 8 star

export type RNG = () => number;

const FIXED: Record<number, string> = { 0: 'center', 2: 'center bottom', 3: 'center bottom' };
const PARK: Record<number, string> = { 1: '62% 128%', 5: '-22% 40%', 6: '122% 40%', 7: '122% 40%', 8: '112% -20%' };

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (n: number) => Math.round(n * 100) / 100;
const posStr = (x: number, y: number) => `${r2(x)}% ${r2(y)}%`;

// flyers may fly up to the top of the sky (no ceiling, just below the very edge) but never
// below this floor — which keeps them above the mountains / Hogwarts / lake skyline.
const FLY_Y_MIN = 8;
const FLY_Y_MAX = 61;

// ── smooth interpolation (Catmull-Rom) so the motion curves naturally ──
export function catmull(p0: number[], p1: number[], p2: number[], p3: number[], f: number): [number, number] {
  const f2 = f * f, f3 = f2 * f;
  const c = (a: number, b: number, cc: number, d: number) =>
    0.5 * (2 * b + (cc - a) * f + (2 * a - 5 * b + 4 * cc - d) * f2 + (-a + 3 * b - 3 * cc + d) * f3);
  return [c(p0[0]!, p1[0]!, p2[0]!, p3[0]!), c(p0[1]!, p1[1]!, p2[1]!, p3[1]!)];
}
export function sampleSpline(pts: number[][], u: number): [number, number] {
  const n = pts.length;
  if (n === 1) return [pts[0]![0]!, pts[0]![1]!];
  const fu = clamp(u, 0, 1) * (n - 1);
  const seg = Math.min(n - 2, Math.floor(fu));
  return catmull(pts[Math.max(0, seg - 1)]!, pts[seg]!, pts[seg + 1]!, pts[Math.min(n - 1, seg + 2)]!, fu - seg);
}
export function sampleLinear(pts: number[][], u: number): [number, number] {
  const n = pts.length;
  if (n === 1) return [pts[0]![0]!, pts[0]![1]!];
  const fu = clamp(u, 0, 1) * (n - 1);
  const seg = Math.min(n - 2, Math.floor(fu));
  const f = fu - seg, a = pts[seg]!, b = pts[seg + 1]!;
  return [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f];
}

// ── per-flyer character: just overall duration ranges (paths/heights are fully random) ──
export interface FlyStyle { durMin: number; durMax: number; }
// DEPTH: nearer flyers are bigger (background-size in themes.css), more opaque (FLY_OPACITY
// below) and a touch faster; farther ones are smaller, hazier and slower. Order near→far:
// Hedwig → broom → dragon (dragon is the farthest).
export const STYLES: Record<number, FlyStyle> = {
  5: { durMin: 16000, durMax: 23000 }, // Hedwig — nearest (a touch faster)
  6: { durMin: 18000, durMax: 26000 }, // broom — mid
  7: { durMin: 24000, durMax: 35000 }, // dragon — farthest (slowest)
};
// atmospheric haze: opacity baked into the JS-driven sprite (the parked CSS fallback is
// always off-screen, so only these matter). Farther = fainter.
export const FLY_OPACITY: Record<number, number> = { 5: 0.95, 6: 0.8, 7: 0.62 };
// wing flap — Hedwig + dragon beat their wings: the driver rotates the wing group through a
// small set of cached poses while airborne (broom has no wings, so it isn't listed). `amp` =
// max rotation°, `n` = poses per beat, `frameMs` = ms per pose (beat period = n·frameMs).
export const FLAP: Record<number, { amp: number; n: number; frameMs: number }> = {
  5: { amp: 14, n: 8, frameMs: 95 },  // Hedwig — quicker beat (both wings beat in unison)
  7: { amp: 15, n: 8, frameMs: 175 }, // dragon — slow, majestic beat
};
// natural facing of each sprite (true = looks right). Mirror when travel ≠ facing.
export const FACE_RIGHT: Record<number, boolean> = { 5: true, 6: false, 7: false };

// A GENTLE monotonic time→progress warp: speed eases up and down by only a SMALL amount
// (so it isn't always exactly the same pace) but never rushes — it's a background gimmick.
// velocity v(u) = 1 + a1·sin(2πu) + a2·sin(4πu) with small random amplitudes, integrated to
// a progress map with p(0)=0, p(1)=1. dp/du stays ≈[0.75, 1.25] → smooth fades, no jumps.
export function makeWarp(rng: RNG): (u: number) => number {
  const a1 = (rng() - 0.5) * 0.34; // ±0.17
  const a2 = (rng() - 0.5) * 0.18; // ±0.09
  const TAU = Math.PI * 2;
  return (u: number) => {
    u = clamp(u, 0, 1);
    return clamp(u + (a1 / TAU) * (1 - Math.cos(TAU * u)) + (a2 / (2 * TAU)) * (1 - Math.cos(2 * TAU * u)), 0, 1);
  };
}

export interface Flight { pts: number[][]; dur: number; warp: (u: number) => number; ltr: boolean; }

// Build ONE random flight: random direction (kept monotonic so the facing stays correct),
// a varied vertical profile (random walk anywhere in the band — may climb above the banner
// or skim low), a random duration and a random speed warp.
export function buildFlight(rng: RNG, style: FlyStyle): Flight {
  const ltr = rng() < 0.5;
  const startX = ltr ? -22 : 122, endX = ltr ? 122 : -22;
  const n = 5 + Math.floor(rng() * 3); // 5–7 waypoints
  const pts: number[][] = [];
  let y = FLY_Y_MIN + rng() * (FLY_Y_MAX - FLY_Y_MIN);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    pts.push([r2(startX + (endX - startX) * u), r2(clamp(y, FLY_Y_MIN, FLY_Y_MAX))]);
    y = clamp(y + (rng() - 0.5) * 28, FLY_Y_MIN, FLY_Y_MAX); // random walk (±14)
  }
  return { pts, dur: style.durMin + rng() * (style.durMax - style.durMin), warp: makeWarp(rng), ltr };
}

export function nextSnitchTarget(rng: RNG, prev: { x: number; y: number }): { x: number; y: number } {
  if (rng() < 0.22) return { x: clamp(prev.x + (rng() - 0.5) * 10, 8, 92), y: clamp(prev.y + (rng() - 0.5) * 8, 14, 58) };
  return { x: 8 + rng() * 84, y: 14 + rng() * 44 };
}

export const composeBgPos = (positions: string[]): string => positions.join(', ');

// ── flyer sprite SVGs (source of truth for the mirrored variants; the baked URLs in
//    themes.css are the no-JS fallback and must match these "normal" shapes) ──
// Each sprite is split into a STATIC body and zero-or-more WING parts, each rotated about ITS
// OWN root for the flap. Hedwig has TWO wings (each rotates about its own shoulder so both
// tips beat up/down in unison — a real flap, not a rigid tilt); the dragon has one bat-wing;
// the broom rider has none.
const SPRITES: Record<number, { w: number; h: number; staticBody: string; wings: { pivot: [number, number]; m: string }[] }> = {
  5: {
    w: 42, h: 24,
    staticBody: "<g fill='#e9eaf4' fill-opacity='0.88'><ellipse cx='23' cy='14' rx='9' ry='4.6' transform='rotate(-10 23 14)'/><circle cx='33' cy='9.5' r='5'/><path d='M37.5 10 L40 11.2 L37 12.2Z'/><path d='M16 15 L8 18 L11 19 L15 18.5 L16 17Z'/></g>",
    wings: [
      { pivot: [25, 11], m: "<g fill='#e9eaf4' fill-opacity='0.88'><path d='M25 11 C18 4 10 1 3 3 Q7 5 9 6 Q5 6 3 8 Q8 8 11 9 Q7 10 5 12 Q11 11 15 11 C19 11 23 12 25 12Z'/></g>" },
      { pivot: [24, 16], m: "<g fill='#e9eaf4' fill-opacity='0.88'><path d='M24 16 C20 20 15 22 11 22 Q15 19 18 16 Q15 17 13 17 C17 15 21 15 24 16Z'/></g>" },
    ],
  },
  6: {
    w: 44, h: 24,
    staticBody: "<path d='M3 17 L34 11' stroke='#2b2748' stroke-width='1.8' stroke-linecap='round'/><path d='M31 11.4 L33 11Z' stroke='#1c1838' stroke-width='2.4'/><path d='M33 11 L44 4 L44 8 L43 10 L44 13 L42 15 L33 13Z' fill='#3a3460'/><g fill='#4a4478'><path d='M19 9 C25 3 31 1 34 3 C31 7 27 10 22 12 C21 11 20 10 19 9Z'/><path d='M22 12 C20 7 18 4 14 5 C12 6 11 8 12 11 C9 11 7 13 8 14 C11 14 14 13 17 13 C19 13 21 13 22 12Z'/><circle cx='11' cy='4.4' r='3'/></g><path d='M22 12 C20 7 18 4 14 5' fill='none' stroke='#8b85bd' stroke-width='0.7' stroke-opacity='0.5'/>",
    wings: [],
  },
  7: {
    w: 66, h: 36,
    staticBody: "<g fill='#403a6e'><path d='M32 20 C44 21 53 17 64 9 L60 11.5 L63 12.5 L58 14 C50 19 41 23 32 23Z'/><path d='M3 13.5 L11 11 L10 14 L4 16Z'/><path d='M10.5 11 L12 5 L13 10.5Z'/><path d='M12 11 L15 7 L15 11Z'/><path d='M10 12 C14 13 17 15 20 19 L31 20 C33 23 30 25 26 24 L20 23 C15 22 11 18 10 14.5Z'/><path d='M25 23 L23 30 L25 30 L27 24Z'/></g><path d='M3 13.5 L11 11' fill='none' stroke='#7d77b2' stroke-width='0.7' stroke-opacity='0.6'/><path d='M32 20 C44 21 53 17 64 9' fill='none' stroke='#7d77b2' stroke-width='0.6' stroke-opacity='0.4'/>",
    wings: [
      { pivot: [21, 17], m: "<path d='M20 18 C24 10 29 5 33 4 L43 6 Q40 10 40 13 Q36 13 34 16 Q31 14 29 16 Q26 14 24 18 Z' fill='#403a6e'/><g stroke='#2c2750' stroke-width='0.7' fill='none' stroke-opacity='0.6'><path d='M33 4 L43 6'/><path d='M33 4 L40 13'/><path d='M33 4 L34 16'/><path d='M33 4 L29 16'/></g><path d='M20 18 C24 10 29 5 33 4 L43 6' fill='none' stroke='#7d77b2' stroke-width='0.8' stroke-opacity='0.6'/>" },
    ],
  },
};
export function spriteUri(layer: number, mirror: boolean, flapDeg = 0): string {
  const s = SPRITES[layer]!;
  const wingPart = s.wings.map((w) => `<g transform='rotate(${flapDeg} ${w.pivot[0]} ${w.pivot[1]})'>${w.m}</g>`).join('');
  let content = s.staticBody + wingPart;
  if (mirror) content = `<g transform='translate(${s.w},0) scale(-1,1)'>${content}</g>`;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${s.w}' height='${s.h}' viewBox='0 0 ${s.w} ${s.h}'><g opacity='${FLY_OPACITY[layer]}'>${content}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const SQUID_PTS = [[62, 128], [60, 91], [50, 89], [43, 90], [38, 93], [33, 102], [29, 116], [26, 128]];
const STAR_PTS = [[112, -20], [92, 0], [6, 52], [-18, 62]];

interface Sched { layer: number; start: number; dur: number; pts: number[][] | null; nextAt: number; }

// Driver: holds all state; `tick(now)` returns the composed 9-layer string (and, if given,
// writes it to `--hp-bgpos`; `setImg(layer, uri)` swaps a flyer's mirrored sprite).
export function createDriver(rng: RNG, setProp?: (v: string) => void, startNow = 0, setImg?: (layer: number, uri: string) => void) {
  // SINGLE serialised flyer slot — only one of 5/6/7 airborne at a time, and the NEXT flight
  // starts 30–60s after the previous one starts (so a flyer appears ~once every 30–60s).
  const fly: { layer: number; flight: Flight | null; start: number; endAt: number; nextAt: number; mirror: boolean; flapIdx: number } =
    { layer: 0, flight: null, start: 0, endAt: 0, nextAt: startNow + 3000 + rng() * 6000, mirror: false, flapIdx: -1 };
  const flyerPos = (now: number): { layer: number; pos: string } | null => {
    if (fly.flight) {
      if (now >= fly.endAt) fly.flight = null;
      else {
        // flap: cycle the wing through a small set of cached poses while airborne
        const flap = FLAP[fly.layer];
        if (flap && setImg) {
          const idx = Math.floor(now / flap.frameMs) % flap.n;
          if (idx !== fly.flapIdx) {
            fly.flapIdx = idx;
            setImg(fly.layer, spriteUri(fly.layer, fly.mirror, +(flap.amp * Math.sin((2 * Math.PI * idx) / flap.n)).toFixed(2)));
          }
        }
        const [x, y] = sampleSpline(fly.flight.pts, fly.flight.warp((now - fly.start) / fly.flight.dur));
        return { layer: fly.layer, pos: posStr(x, clamp(y, FLY_Y_MIN, FLY_Y_MAX)) };
      }
    }
    if (!fly.flight && now >= fly.nextAt) {
      const layer = [5, 6, 7][Math.floor(rng() * 3)]!;
      const f = buildFlight(rng, STYLES[layer]!);
      fly.layer = layer;
      fly.flight = f;
      fly.start = now;
      fly.endAt = now + f.dur;
      fly.nextAt = now + 30000 + rng() * 30000; // next flight 30–60s after this one starts
      fly.mirror = f.ltr !== FACE_RIGHT[layer];
      fly.flapIdx = -1;
      if (setImg) setImg(layer, spriteUri(layer, fly.mirror, 0));
      const [x, y] = sampleSpline(f.pts, 0);
      return { layer, pos: posStr(x, clamp(y, FLY_Y_MIN, FLY_Y_MAX)) };
    }
    return null;
  };

  // squid + star — independent (water + a brief meteor, different "zones" from the flyers)
  const squid: Sched = { layer: 1, start: 0, dur: 0, pts: null, nextAt: startNow + 30000 + rng() * 40000 };
  const star: Sched = { layer: 8, start: 0, dur: 0, pts: null, nextAt: startNow + 12000 + rng() * 30000 };
  const stepLinear = (s: Sched, now: number, mkPts: number[][], dur: number, gap: () => number): string => {
    if (s.pts) {
      if (now >= s.start + s.dur) { s.pts = null; s.nextAt = now + gap(); }
      else { const [x, y] = sampleLinear(s.pts, (now - s.start) / s.dur); return posStr(x, y); }
    }
    if (!s.pts && now >= s.nextAt) { s.pts = mkPts; s.start = now; s.dur = dur; const [x, y] = sampleLinear(mkPts, 0); return posStr(x, y); }
    return PARK[s.layer]!;
  };

  // Snitch — continuous slow random roam (with the occasional hover) in the upper sky
  const SPEED = 0.0028;
  const snitch = [{ x: 82, y: 22, t: startNow - 4000 }, { x: 70, y: 30, t: startNow }];
  const snitchPos = (now: number): [number, number] => {
    while (snitch[snitch.length - 1]!.t < now + 20000) {
      const prev = snitch[snitch.length - 1]!;
      const tgt = nextSnitchTarget(rng, prev);
      const dt = clamp(Math.hypot(tgt.x - prev.x, tgt.y - prev.y) / SPEED, 3500, 16000);
      snitch.push({ x: tgt.x, y: tgt.y, t: prev.t + dt });
    }
    while (snitch.length > 3 && snitch[1]!.t < now - 1000) snitch.shift();
    let i = 0;
    while (i < snitch.length - 2 && snitch[i + 1]!.t <= now) i++;
    const a = snitch[Math.max(0, i - 1)]!, b = snitch[i]!, c = snitch[i + 1]!, d = snitch[Math.min(snitch.length - 1, i + 2)]!;
    const f = clamp((now - b.t) / (c.t - b.t || 1), 0, 1);
    const [x, y] = catmull([a.x, a.y], [b.x, b.y], [c.x, c.y], [d.x, d.y], f);
    return [x, clamp(y, 14, 60)];
  };

  const tick = (now: number): string => {
    const out: string[] = new Array(9);
    out[0] = FIXED[0]!; out[2] = FIXED[2]!; out[3] = FIXED[3]!;
    const [sx, sy] = snitchPos(now);
    out[4] = posStr(sx, sy);
    out[5] = PARK[5]!; out[6] = PARK[6]!; out[7] = PARK[7]!;
    const fr = flyerPos(now);
    if (fr) out[fr.layer] = fr.pos;
    out[1] = stepLinear(squid, now, SQUID_PTS, 14000, () => 55000 + rng() * 70000);
    out[8] = stepLinear(star, now, STAR_PTS, 1400, () => 28000 + rng() * 55000);
    const value = composeBgPos(out);
    if (setProp) setProp(value);
    return value;
  };

  return { tick };
}

// ── DOM glue ──
export function installHpFlyers(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const root = document.documentElement;
  const reduceMM = window.matchMedia('(prefers-reduced-motion: reduce)');

  let raf = 0;
  let running = false;
  let driver: ReturnType<typeof createDriver> | null = null;

  const shouldRun = () => root.dataset.theme === 'harry-potter' && !reduceMM.matches && window.innerWidth > 576;
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
      (v) => root.style.setProperty('--hp-bgpos', v),
      performance.now(),
      (layer, uri) => root.style.setProperty(`--hp-img${layer}`, uri),
    );
    loop();
  };
  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    driver = null;
    root.style.removeProperty('--hp-bgpos');
  };
  const update = () => (shouldRun() ? start() : stop());

  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', update, { passive: true });
  if (reduceMM.addEventListener) reduceMM.addEventListener('change', update);
  else if (reduceMM.addListener) reduceMM.addListener(update);

  update();
}
