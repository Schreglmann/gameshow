// Runtime driver for the "Halloween" theme's (id `maerchen`) animated easter eggs.
//
// Mirrors src/utils/hpFlyers.ts and src/utils/dndCreatures.ts: the baked
// `[data-theme="maerchen"]::after` enchanted-forest scene can't self-animate (it's a
// background-image data-URI) and a CSS @keyframes loop can only repeat ONE fixed path — so the
// moving creatures are layered as extra `background-image` layers on `html::after` and driven
// from JS for per-flight randomness. Each frame this composes the 23-layer
// `background-position` and writes it to `--mg-bgpos`, read by themes.css. Sprites that change
// shape (wisp flicker, eye blink, cape flutter, wingbeat, spider steps + turns, mirroring)
// are swapped via `--mg-img0` … `--mg-img11`, only when their cached pose changes.
//
// The cast:
//   - WILL-O'-THE-WISPS (Irrlichter) — pale ghost lights (at most two at once) that light up in the forest,
//     weave through it at an uneven speed while flickering, and fade out again; each rests a while.
//   - RED EYES — two pairs that open now and then in the scene's dark hiding places — the knot-hole
//     in the left tree, the eye sockets of the face in the right tree and the undergrowth tufts (spots
//     baked into the scene by scripts/generate-maerchen-scene.cjs — EYE_SPOTS must match),
//     blink once or twice and fade away again.
//   - A WITCH ON A BROOMSTICK — a rare silhouette crossing the night sky (cape fluttering),
//     mirrored to face her travel direction.
//   - TWO BATS — slow, fluttering background ambience; a real bat-wing build whose wingbeat
//     changes the wing's shape (see batWing).
//   - TWO SPIDERS — one in the web (now and then scuttles a few steps along the threads), one
//     dangling from a branch (now and then lets itself down, or climbs up and reels its thread in).
//
// Self-installing + cheap: only runs while the theme is active on <html>, on screens wider
// than the phone breakpoint, and when reduced motion is NOT requested — otherwise it removes
// `--mg-bgpos` so the CSS fallback (everything parked) applies.
//
// Layer order (matches the background-image list in themes.css):
//   0–4 wisps · 5–6 eyes · 7 witch · 8–9 bats · 10 web spider · 11 dangling spider · 12 its thread ·
//   13–21 glows (castle windows + jack-o'-lanterns; CSS-animated, fixed) · 22 scene

import { makeWarp, sampleSpline, type RNG } from './hpFlyers';

export const LAYERS = 23;
export const WISPS = [0, 1, 2, 3, 4] as const;
export const EYES = [5, 6] as const;
export const WITCH = 7;
export const BATS = [8, 9] as const;
export const WEB_SPIDER = 10;
export const HANG_SPIDER = 11;
// the dangling spider's thread: a plain CSS gradient line (no image), its length set through
// --mg-thread — so lowering and climbing never swap an image
export const HANG_THREAD = 12;
// the glow layers are full-size gradients animated by CSS — the driver only holds them at 0 0
export const GLOWS = [13, 14, 15, 16, 17, 18, 19, 20, 21] as const;
// layers 0–11 are sprites (posed via --mg-img0…11)
export const SPRITE_LAYERS = 12;
const SCENE = 22;

// off-screen park positions when a mover is idle (match the CSS fallback values); the spiders'
// entries (resting in place) are added below, once the scene geometry is defined
export const PARK: Record<number, string> = {
  0: '20% -30%', 1: '40% -30%', 2: '60% -30%', 3: '80% -30%', 4: '90% -30%',
  5: '-20% 140%', 6: '120% 140%', 7: '-30% 30%', 8: '-24% 122%', 9: '124% 122%',
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (n: number) => Math.round(n * 100) / 100;
const posStr = (x: number, y: number) => `${r2(x)}% ${r2(y)}%`;

// ── the scene's geometry (scripts/generate-maerchen-scene.cjs: a 1600×640 band sized
//    `100% auto`, bottom-anchored — so scene px map to vw: 1vw = 16 scene px) ──
const SCENE_W = 1600, SCENE_H = 640;
// eye spots (scene px): the left tree's knot-hole, the right tree's face + the undergrowth
// tufts — must match EYE_SPOTS in the generator (`node -e "const m=require('./scripts/generate-maerchen-scene.cjs');
// m.buildSvg();console.log(JSON.stringify(m.EYE_SPOTS))"`)
export const EYE_SPOTS: ReadonlyArray<readonly [number, number]> = [
  [122, 486], [1530, 520], [300, 604], [470, 604], [612, 604], [1120, 604], [1250, 604], [1380, 604],
];
// eye sprite size in scene px (themes.css sizes the layer to 2.25vw × 0.75vw to match)
const EYE_W = 36, EYE_H = 12;
// Position string for a vw-sized sprite of w×h scene px whose top-left corner sits on scene
// point (sx, sy): a vw length from the left + a vw offset of its bottom edge up from the
// bottom, so it tracks the 100%-width scene at every size.
function scenePos(sx: number, sy: number, h: number): string {
  const vw = 100 / SCENE_W;
  return `calc(${r2(sx * vw)}vw) calc(100% - ${r2((SCENE_H - sy - h) * vw)}vw)`;
}
// an eye pair centred on scene point (sx, sy)
export function eyePos(sx: number, sy: number): string {
  return scenePos(sx - EYE_W / 2, sy - EYE_H / 2, EYE_H);
}

// ── the spiders — geometry from the generator (WEB_GEOM / WEB_A0 / WEB_RINGS / HANG, placed on
//    the generated left tree; a unit test checks these copies against it) ──
export const WEB = { x: 180, y: 252, lens: [58, 70, 114, 76, 60, 70, 63, 96, 62] } as const;
export const WEB_A0 = 0.2;
export const WEB_RINGS = [0.14, 0.27, 0.4, 0.53, 0.66, 0.79] as const;
export const HANG = { x: 452, y: 350 } as const;
// sprite size in scene px (themes.css sizes both spider layers 2vw square to match)
export const SPIDER_SCALE = 1.4;             // the spider art is drawn at 1.4× its base size
export const SPIDER_SIZE = 32;
export const HANG_MAX = 100;                 // the longest the thread gets
export const HANG_REST = 58;                 // the drop it hangs at when nothing moves (no-JS too)
export const HANG_TOP = 14;                  // climbed all the way up: just under the branch, thread gone
// the thread meets the tip of the abdomen, 7.7 base px above the hanging spider's centre
const threadLen = (drop: number) => drop - 7.7 * SPIDER_SCALE;
// The web spider stands on the hub or where a ring crosses a spoke: ring index r (0 = hub,
// 1–4 = WEB_RINGS[1…4]; the innermost and outermost rings are left alone) on spoke i.
const WEB_STOPS = [0, WEB_RINGS[1], WEB_RINGS[2], WEB_RINGS[3], WEB_RINGS[4]];
export function webPoint(i: number, r: number): [number, number] {
  const n = WEB.lens.length;
  const a = WEB_A0 + ((((i % n) + n) % n) * 2 * Math.PI) / n;
  const l = WEB.lens[((i % n) + n) % n]! * WEB_STOPS[r]!;
  return [WEB.x + Math.cos(a) * l, WEB.y + Math.sin(a) * l];
}
export const webSpiderPos = (x: number, y: number): string => scenePos(x - SPIDER_SIZE / 2, y - SPIDER_SIZE / 2, SPIDER_SIZE);
// the dangling spider, centred `drop` px below its branch
export const hangSpiderPos = (drop: number): string => scenePos(HANG.x - SPIDER_SIZE / 2, HANG.y + drop - SPIDER_SIZE / 2, SPIDER_SIZE);
// its thread: a 1px line from the branch down to the abdomen (position + background-size)
export const hangThreadPos = (drop: number): string =>
  `calc(${r2(HANG.x * (100 / SCENE_W))}vw - 0.5px) calc(100% - ${r2((SCENE_H - HANG.y - Math.max(0, threadLen(drop))) * (100 / SCENE_W))}vw)`;
export const hangThreadSize = (drop: number): string =>
  drop > HANG_TOP + 2 ? `1px ${r2(threadLen(drop) * (100 / SCENE_W))}vw` : '0 0';
// the spiders never leave: their "park" is the resting pose — in the middle of the web, and
// hanging at HANG_REST (the no-JS / reduced-motion fallback shows them there, still)
PARK[WEB_SPIDER] = webSpiderPos(...webPoint(0, 0));
PARK[HANG_SPIDER] = hangSpiderPos(HANG_REST);
PARK[HANG_THREAD] = hangThreadPos(HANG_REST);
export interface WebWalk { pts: number[][]; to: [number, number]; }
// A short random walk across the web from stop (i, r): 2–4 steps, each along a spoke (in or out
// by one ring, or to/from the hub) or along a ring to the next spoke — never straight back. Ring
// steps follow the thread's sag (the same quadratic the generator draws).
export function newWebWalk(rng: RNG, from: [number, number]): WebWalk {
  const n = WEB.lens.length;
  let [i, r] = from;
  let prev: [number, number] | null = null;
  const pts: number[][] = [webPoint(i, r)];
  const steps = 2 + Math.floor(rng() * 3);
  for (let s = 0; s < steps; s++) {
    const opts: [number, number][] = r === 0
      ? Array.from({ length: n }, (_, k) => [k, 1] as [number, number])
      : [[i, r - 1], ...(r < 4 ? [[i, r + 1] as [number, number]] : []), [i + 1, r], [i - 1, r]];
    const ok = opts.filter(([oi, or]) => !prev || !(or === prev[1] && (or === 0 || ((oi - prev[0]) % n + n) % n === 0)));
    const [ni, nr] = ok[Math.floor(rng() * ok.length)]!;
    if (nr === r && r > 0) {
      // along the ring: the sagging quadratic from spoke i to spoke ni
      const p = webPoint(i, r), q = webPoint(ni, r);
      const m = [WEB.x + ((p[0] + q[0]) / 2 - WEB.x) * 0.86, WEB.y + ((p[1] + q[1]) / 2 - WEB.y) * 0.86];
      for (let t = 1; t <= 6; t++) {
        const u = t / 6;
        pts.push([(1 - u) * (1 - u) * p[0] + 2 * (1 - u) * u * m[0]! + u * u * q[0], (1 - u) * (1 - u) * p[1] + 2 * (1 - u) * u * m[1]! + u * u * q[1]]);
      }
    } else {
      pts.push(webPoint(ni, nr));
    }
    prev = [i, r];
    i = (((ni % n) + n) % n); r = nr;
  }
  return { pts, to: [i, r] };
}

// ── sky flights (witch + bats) ──
export interface Band { yMin: number; yMax: number; }
export const WITCH_BAND: Band = { yMin: 6, yMax: 50 };
export const BAT_BAND: Band = { yMin: 8, yMax: 50 };
export interface FlyStyle { durMin: number; durMax: number; }
// Background ambience, NOT an attraction: slow crossings.
export const STYLES: Record<number, FlyStyle> = {
  7: { durMin: 22000, durMax: 32000 }, // witch
  8: { durMin: 20000, durMax: 30000 }, // bat0
  9: { durMin: 24000, durMax: 34000 }, // bat1 (a touch slower)
};
// cape flutter (witch, ±amp degrees) + wingbeat (bats, n phases of batSvg — amp unused): cycle
// a cached set of poses while airborne
export const FLAP: Record<number, { amp: number; n: number; frameMs: number }> = {
  7: { amp: 7, n: 6, frameMs: 120 },
  8: { amp: 0, n: 8, frameMs: 62 },
  9: { amp: 0, n: 8, frameMs: 72 },
};
// natural facing of the witch sprite (true = looks right). Mirror when travel ≠ facing. The
// front-view bats look the same either way.
export const FACE_RIGHT: Record<number, boolean> = { 7: true };

export interface Flight { pts: number[][]; dur: number; warp: (u: number) => number; ltr: boolean; }

// Build ONE random flight: random direction (kept monotonic so the facing stays correct), a
// random-walk vertical profile inside the band, a random duration and speed warp.
export function buildFlight(rng: RNG, style: FlyStyle, band: Band): Flight {
  const ltr = rng() < 0.5;
  const startX = ltr ? -22 : 122, endX = ltr ? 122 : -22;
  const n = 5 + Math.floor(rng() * 3); // 5–7 waypoints
  const pts: number[][] = [];
  let y = band.yMin + rng() * (band.yMax - band.yMin);
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    pts.push([r2(startX + (endX - startX) * u), r2(clamp(y, band.yMin, band.yMax))]);
    y = clamp(y + (rng() - 0.5) * 24, band.yMin, band.yMax); // random walk (±12)
  }
  return { pts, dur: style.durMin + rng() * (style.durMax - style.durMin), warp: makeWarp(rng), ltr };
}

// ── will-o'-the-wisps (Irrlichter) ──
// A wisp lives in SCENE px (like the eyes), so it stays in the forest at every screen shape:
// it lights up somewhere between the mid tree line and the foreground floor, weaves through the
// trees along a zigzag spline at an uneven speed while jittering, flickers, and fades out again.
export interface Wisp { pts: number[][]; warp: (u: number) => number; bobAmp: number; bobMs: number; phase: number; flickMs: number; lifeMs: number; start: number; }
export const WISP_X_MIN = 40, WISP_X_MAX = 1560;
export const WISP_Y_MIN = 430, WISP_Y_MAX = 606;
const WISP_FADE_MS = 900;
// brightness is quantized so a wisp swaps between a few cached sprites, not one per frame
export const WISP_LEVELS = 10;
// background ambience: never more than this many wisps at once, a pause between two appearances
export const WISP_MAX_LIT = 2;
export const WISP_SPAWN_GAP_MS = 2500;
export function newWisp(rng: RNG, now: number): Wisp {
  // 5–7 waypoints, each a sideways hop (mostly continuing the same way, sometimes doubling
  // back) with a rise or dip — a restless zigzag, not a straight drift
  const n = 5 + Math.floor(rng() * 3);
  let x = 160 + rng() * 1280, y = WISP_Y_MIN + 20 + rng() * (WISP_Y_MAX - WISP_Y_MIN - 40);
  let dir = rng() < 0.5 ? -1 : 1;
  const pts: number[][] = [[x, y]];
  for (let i = 1; i < n; i++) {
    if (rng() < 0.25) dir = -dir;
    x = clamp(x + dir * (70 + rng() * 150), WISP_X_MIN + 40, WISP_X_MAX - 40);
    y = clamp(y + (rng() - 0.5) * 110, WISP_Y_MIN + 10, WISP_Y_MAX - 10);
    pts.push([x, y]);
  }
  return {
    pts,
    warp: makeWarp(rng),             // speeds up and slows down along the way
    bobAmp: 3 + rng() * 5,
    bobMs: 850 + rng() * 850,        // a quick nervous jitter on top of the path
    phase: rng() * Math.PI * 2,
    flickMs: 500 + rng() * 600,
    lifeMs: 7500 + rng() * 5000,
    start: now,
  };
}
export function wispXY(p: Wisp, now: number): [number, number] {
  const t = now - p.start;
  const [sx, sy] = sampleSpline(p.pts, p.warp(t / p.lifeMs));
  // the spline can overshoot its waypoints a little — keep the wisp in the forest
  const x = clamp(sx, WISP_X_MIN, WISP_X_MAX);
  const y = clamp(sy + p.bobAmp * Math.sin((2 * Math.PI * t) / p.bobMs + p.phase), WISP_Y_MIN, WISP_Y_MAX);
  return [x, y];
}
// Brightness level 0…WISP_LEVELS: fade in, an uneven flicker (two sines that never line up),
// fade out; null once the wisp is gone.
export function wispLevel(p: Wisp, now: number): number | null {
  const t = now - p.start;
  if (t < 0 || t > p.lifeMs) return null;
  const env = Math.min(1, t / WISP_FADE_MS, (p.lifeMs - t) / WISP_FADE_MS);
  const flicker = 0.78 + 0.14 * Math.sin((2 * Math.PI * t) / p.flickMs + p.phase) + 0.08 * Math.sin((2 * Math.PI * t) / (p.flickMs * 0.37));
  return Math.round(env * flicker * WISP_LEVELS);
}
// Position string for a wisp sprite of `size` px centred on scene point (sx, sy).
export function wispPos(sx: number, sy: number, size: number): string {
  const vw = 100 / SCENE_W;
  return `calc(${r2(sx * vw)}vw - ${size / 2}px) calc(100% - ${r2((SCENE_H - sy) * vw)}vw + ${size / 2}px)`;
}

// ── eyes ──
// Lifecycle: away → fade in (3 steps) → open (with 1–2 blinks) → fade out (3 steps) → away.
export type EyeLid = 'open' | 'half' | 'closed';
export interface EyeFrame { lid: EyeLid; opacity: number; }
const FADE_STEPS = [0.35, 0.7, 1];
const FADE_MS = 170;
const BLINK = [{ lid: 'half', ms: 60 }, { lid: 'closed', ms: 120 }, { lid: 'half', ms: 60 }] as const;
export interface EyeShow { spot: number; start: number; holdMs: number; blinksAt: number[]; }
export function eyeFrame(show: EyeShow, now: number): EyeFrame | null {
  const t = now - show.start;
  const fadeIn = FADE_STEPS.length * FADE_MS;
  if (t < 0) return null;
  if (t < fadeIn) return { lid: 'open', opacity: FADE_STEPS[Math.floor(t / FADE_MS)]! };
  const h = t - fadeIn;
  if (h < show.holdMs) {
    for (const b of show.blinksAt) {
      let bt = h - b;
      if (bt < 0) continue;
      for (const step of BLINK) {
        if (bt < step.ms) return { lid: step.lid, opacity: 1 };
        bt -= step.ms;
      }
    }
    return { lid: 'open', opacity: 1 };
  }
  const o = h - show.holdMs;
  if (o < fadeIn) return { lid: 'open', opacity: FADE_STEPS[FADE_STEPS.length - 1 - Math.floor(o / FADE_MS)]! };
  return null; // gone
}
export function newEyeShow(rng: RNG, now: number, avoidSpot: number): EyeShow {
  let spot = Math.floor(rng() * EYE_SPOTS.length);
  if (spot === avoidSpot) spot = (spot + 1 + Math.floor(rng() * (EYE_SPOTS.length - 1))) % EYE_SPOTS.length;
  const holdMs = 2600 + rng() * 2800;
  const blinksAt = [600 + rng() * (holdMs * 0.45 - 600)];
  if (rng() < 0.5) blinksAt.push(holdMs * 0.6 + rng() * (holdMs * 0.3));
  return { spot, start: now, holdMs, blinksAt };
}

export const composeBgPos = (positions: string[]): string => positions.join(', ');

// ── sprite SVGs (source of truth for the posed / mirrored variants; the baked URLs in
//    themes.css are the no-JS fallback and must match the "normal" pose: spriteUri(layer)) ──
const svgUri = (w: number, h: number, body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

// Wisp sprite sizes per layer (depth: bigger = nearer); themes.css uses the same sizes.
export const WISP_SIZE: Record<number, number> = { 0: 42, 1: 30, 2: 48, 3: 26, 4: 36 };
// a ghostly pale-mint light: a white-hot core in a soft halo; `level` sets its brightness
function wispSvg(layer: number, level: number): string {
  const s = WISP_SIZE[layer]!;
  const c = s / 2;
  return svgUri(s, s,
    `<defs><radialGradient id='w'><stop offset='0' stop-color='#f4fff9'/><stop offset='0.1' stop-color='#d6faea' stop-opacity='0.95'/><stop offset='0.22' stop-color='#9eecc8' stop-opacity='0.65'/>` +
    `<stop offset='0.5' stop-color='#6fdcb0' stop-opacity='0.26'/><stop offset='1' stop-color='#5fd6a8' stop-opacity='0'/></radialGradient></defs>` +
    `<circle cx='${c}' cy='${c}' r='${c}' fill='url(#w)' opacity='${r2(level / WISP_LEVELS)}'/>`);
}

// a pair of slanted, glowing red eyes; `lid` narrows them for the blink
function eyeSvg(lid: EyeLid, opacity: number): string {
  const k = lid === 'open' ? 1 : lid === 'half' ? 0.45 : 0.08;
  const eye = (cx: number, slant: number) =>
    `<g transform='rotate(${slant} ${cx} 6)'>` +
    `<path d='M ${cx - 6} 6 Q ${cx} ${r2(6 - 3.4 * k)} ${cx + 6} 6 Q ${cx} ${r2(6 + 3.4 * k)} ${cx - 6} 6 Z' fill='#ff3d2e'/>` +
    (k > 0.3 ? `<ellipse cx='${cx}' cy='6' rx='0.9' ry='${r2(2.4 * k)}' fill='#2a0000'/>` : '') +
    `</g>`;
  return svgUri(EYE_W, EYE_H,
    `<defs><radialGradient id='g'><stop offset='0' stop-color='#ff4a3a' stop-opacity='${r2(0.5 * k)}'/><stop offset='1' stop-color='#ff4a3a' stop-opacity='0'/></radialGradient></defs>` +
    `<g opacity='${opacity}'><ellipse cx='9' cy='6' rx='9' ry='6' fill='url(#g)'/><ellipse cx='27' cy='6' rx='9' ry='6' fill='url(#g)'/>` +
    eye(9, 9) + eye(27, -9) + `</g>`);
}

// The witch (facing right): leaning forward on a long broom with a bristle tail, a pointed hat
// bent back by the wind; the streaming CAPE is the part that flutters. Medium moonlit tones +
// a lighter rim keep the silhouette legible against the dark plum sky.
const WITCH_SPRITE = {
  w: 64, h: 36,
  cape: { pivot: [36, 13] as [number, number], m: "<path d='M37 12 C30 10.6 22 12.6 13 11.6 L17.6 14.6 L12 16.8 L18.6 18 L14.4 21 C21 20 27 21 31 22.6Z' fill='#46345f'/>" },
  body:
    "<g fill='#46345f'>" +
    // broom stick + fanned bristle tail
    "<path d='M8 26.2 L60 19.6 L60.2 21.2 L8.2 27.8Z'/>" +
    "<path d='M1 21 L12 24.6 L12.4 29.2 L0 33 L4.6 28.6 L-0.4 27.6 L4.4 25.2Z'/>" +
    // torso leaning forward, head, hooked nose
    "<path d='M29 24.6 C29 19 32 14 37 12 C40 11.8 42.4 13.6 42.4 16 C40.6 19.4 38.6 22.4 36.6 24.6Z'/>" +
    "<circle cx='41' cy='10.4' r='2.9'/><path d='M43.4 9.8 L46.6 11.6 L43.2 12Z'/>" +
    // hat: brim + cone whose tip bends back in the wind
    "<path d='M34.6 9.4 L46.4 7.2 L46.6 8.4 L34.8 10.6Z'/>" +
    "<path d='M37 9 C37.6 6 37 3.4 33.2 1.4 C38.4 2 41.6 4.2 43.6 8Z'/>" +
    "</g>" +
    // arm reaching to the stick + bent leg (strokes)
    "<path d='M40 14.6 C44 16.4 46.6 18.4 48.4 20.6' stroke='#46345f' stroke-width='2.2' fill='none' stroke-linecap='round'/>" +
    "<path d='M33.6 24 C36.6 26 38.6 27.6 40.6 31' stroke='#46345f' stroke-width='2.4' fill='none' stroke-linecap='round'/>" +
    // moonlit rim on the top edges
    "<path d='M34.6 9.4 L46.4 7.2 M33.2 1.4 C38.4 2 41.6 4.2 43.6 8 M8 26.2 L60 19.6' stroke='#9a89c0' stroke-width='0.7' fill='none' stroke-opacity='0.6'/>",
};

// ── the bat (front view): a real bat-wing build — an arm from the shoulder to the wrist, three
//    finger bones fanning out from the wrist, and the membrane stretched between the finger tips
//    in scallops back to the hip. The wingbeat changes the wing's SHAPE, not just its angle: it
//    sweeps from raised to lowered and folds a little on the upstroke, spreads on the downstroke. ──
export const BAT_W = 48, BAT_H = 44;
const BAT_FILL = '#0c0612', BAT_BONE = '#2e2142', BAT_RIM = '#5a4878';
type Pt = [number, number];
// the right wing at elevation e (+1 raised … −1 lowered) and spread k (1 = fully open)
export function batWing(e: number, k: number): { S: Pt; W: Pt; F: Pt[]; H: Pt } {
  const S: Pt = [26.4, 18.6], H: Pt = [25.8, 24.8];
  const th = -e * 0.8; // y-down: raised = negative angle
  const out = (from: Pt, a: number, l: number): Pt => [from[0] + Math.cos(a) * l, from[1] + Math.sin(a) * l];
  const W = out(S, th - 0.2, 8.6 * (0.78 + 0.22 * k));
  const F = [-0.4, 0.22, 0.82].map((b, j) => out(W, th + b * (0.55 + 0.45 * k), [12.2, 11, 8.8][j]! * (0.72 + 0.28 * k)));
  return { S, W, F, H };
}
function batWingSvg(e: number, k: number): string {
  const { S, W, F, H } = batWing(e, k);
  const p = (q: Pt) => `${r2(q[0])} ${r2(q[1])}`;
  // each scallop between two tips is pulled toward the wrist (toward the arm for the last one)
  const pull = (a: Pt, b: Pt, c: Pt, f: number): Pt => {
    const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return [m[0] + (c[0] - m[0]) * f, m[1] + (c[1] - m[1]) * f];
  };
  const arm: Pt = [(S[0] + W[0]) / 2, (S[1] + W[1]) / 2];
  const membrane = `M ${p(S)} L ${p(W)} L ${p(F[0]!)} Q ${p(pull(F[0]!, F[1]!, W, 0.34))} ${p(F[1]!)} ` +
    `Q ${p(pull(F[1]!, F[2]!, W, 0.34))} ${p(F[2]!)} Q ${p(pull(F[2]!, H, arm, 0.3))} ${p(H)} Z`;
  const thumb = `M ${p(W)} l -1.4 -1.6 l 1.9 0.4 Z`;
  const bones = `M ${p(S)} L ${p(W)} ` + F.map((f) => `M ${p(W)} L ${p(f)}`).join(' ');
  return `<path d='${membrane}' fill='${BAT_FILL}'/><path d='${thumb}' fill='${BAT_FILL}'/>` +
    `<path d='${bones}' stroke='${BAT_BONE}' stroke-width='0.7' fill='none' stroke-linecap='round'/>` +
    // moonlight on the leading edge
    `<path d='M ${p(S)} L ${p(W)} L ${p(F[0]!)}' stroke='${BAT_RIM}' stroke-width='0.6' fill='none' opacity='0.7'/>`;
}
// the furry body, head, pointed ears and two dim red eyes (symmetric round x = 24)
const BAT_BODY =
  `<g fill='${BAT_FILL}'><ellipse cx='24' cy='20.8' rx='3.4' ry='5.4'/><circle cx='24' cy='15.2' r='3.1'/>` +
  `<path d='M 21.5 14 L 20.3 8.6 L 23.3 12.6 Z'/><path d='M 26.5 14 L 27.7 8.6 L 24.7 12.6 Z'/></g>` +
  `<path d='M 21.5 14 L 20.3 8.6 L 23.3 12.6 M 26.5 14 L 27.7 8.6 L 24.7 12.6' stroke='${BAT_RIM}' stroke-width='0.5' fill='none' opacity='0.7'/>` +
  `<path d='M 22.9 25.8 L 22.4 28 M 25.1 25.8 L 25.6 28' stroke='${BAT_FILL}' stroke-width='0.9' stroke-linecap='round'/>` +
  `<circle cx='23' cy='15.2' r='0.55' fill='#a8242c'/><circle cx='25' cy='15.2' r='0.55' fill='#a8242c'/>`;
// one frame of the wingbeat at phase u (0 = top of the stroke, 0.5 = bottom)
function batSvg(u: number): string {
  const e = Math.cos(2 * Math.PI * u);
  const k = 0.82 + 0.18 * Math.sin(2 * Math.PI * u); // spread on the way down, folding on the way up
  const wing = batWingSvg(e, k);
  // the left wing is the right one mirrored — the flap is symmetric by construction
  // shifted down 4 px: headroom for the wing tips at the top of the stroke
  return svgUri(BAT_W, BAT_H, `<g transform='translate(0 4)'>${wing}<g transform='translate(${BAT_W} 0) scale(-1 1)'>${wing}</g>${BAT_BODY}</g>`);
}

// ── a spider (top view, head toward −y) in local coordinates round (0,0). `legPose` 1/2 are
//    the two halves of an alternating walking gait (0 = standing). A faint red hourglass. ──
// the gait cycles 1 → 0 → 2 → 0, so the legs swing through the middle instead of flipping
// straight from one extreme to the other (that read as jitter)
export const GAIT = [1, 0, 2, 0] as const;
// the web spider's turn is drawn in these steps (degrees)
export const WEB_TURN_STEP = 15;
function spiderSvg(legPose: number): string {
  const legs: string[] = [];
  const feet: Pt[] = [[5, -8.6], [7.8, -3.6], [7.8, 2.8], [5.4, 8.4]];
  for (const s of [-1, 1]) {
    feet.forEach(([fx, fy], k) => {
      // alternating tetrapod gait: legs (left 0/2 + right 1/3) step together, the rest opposite
      const group = (k % 2 === 0) === (s < 0) ? 1 : -1;
      const step = legPose === 0 ? 0 : (legPose === 1 ? 1 : -1) * group;
      const hip: Pt = [s * 1.5, -3.6 + k * 1.3];
      const foot: Pt = [s * fx, fy - step];
      const knee: Pt = [(hip[0] + foot[0]) / 2 + s * 1.5, (hip[1] + foot[1]) / 2 - 1.3];
      legs.push(`M ${r2(hip[0])} ${r2(hip[1])} Q ${r2(knee[0])} ${r2(knee[1])} ${r2(foot[0])} ${r2(foot[1])}`);
    });
  }
  return `<path d='${legs.join(' ')}' stroke='${BAT_FILL}' stroke-width='1.1' fill='none' stroke-linecap='round'/>` +
    `<g fill='${BAT_FILL}' stroke='${BAT_RIM}' stroke-width='0.5' stroke-opacity='0.8'>` +
    `<ellipse cx='0' cy='3.4' rx='3.4' ry='4.3'/><ellipse cx='0' cy='-2.7' rx='2.3' ry='2.5'/></g>` +
    `<path d='M -1 2 L 1 2 L 0 3.4 Z M -1 4.8 L 1 4.8 L 0 3.4 Z' fill='#b0161e' opacity='0.85'/>`;
}
// the web spider, turned to face `deg` (0 = head up)
function webSpiderSvg(deg: number, legPose: number): string {
  const c = SPIDER_SIZE / 2;
  return svgUri(SPIDER_SIZE, SPIDER_SIZE, `<g transform='translate(${c} ${c}) rotate(${deg}) scale(${SPIDER_SCALE})'>${spiderSvg(legPose)}</g>`);
}
// the dangling spider, head down (its thread is a separate layer, HANG_THREAD)
function hangSpiderSvg(legPose: number): string {
  const c = SPIDER_SIZE / 2;
  return svgUri(SPIDER_SIZE, SPIDER_SIZE, `<g transform='translate(${c} ${c}) rotate(180) scale(${SPIDER_SCALE})'>${spiderSvg(legPose)}</g>`);
}

const mirrorWrap = (w: number, content: string, mirror: boolean) =>
  mirror ? `<g transform='translate(${w},0) scale(-1,1)'>${content}</g>` : content;

export interface SpritePose {
  mirror?: boolean; flapDeg?: number; flapPhase?: number; wispLevel?: number; lid?: EyeLid; opacity?: number;
  facing?: number; legPose?: number;
}
export function spriteUri(layer: number, pose: SpritePose = {}): string {
  if (layer < 5) return wispSvg(layer, pose.wispLevel ?? WISP_LEVELS);
  if (layer < 7) return eyeSvg(pose.lid ?? 'open', pose.opacity ?? 1);
  if (layer === WEB_SPIDER) return webSpiderSvg(pose.facing ?? 0, pose.legPose ?? 0);
  if (layer === HANG_SPIDER) return hangSpiderSvg(pose.legPose ?? 0);
  if (layer === WITCH) {
    const s = WITCH_SPRITE;
    const cape = `<g transform='rotate(${pose.flapDeg ?? 0} ${s.cape.pivot[0]} ${s.cape.pivot[1]})'>${s.cape.m}</g>`;
    return svgUri(s.w, s.h, `<g opacity='0.92'>${mirrorWrap(s.w, cape + s.body, !!pose.mirror)}</g>`);
  }
  // a front-view bat looks the same both ways, so it never needs mirroring
  return batSvg(pose.flapPhase ?? 0);
}

interface FlyState { flight: Flight | null; start: number; endAt: number; nextAt: number; mirror: boolean; flapIdx: number; }
interface WispState { p: Wisp | null; nextAt: number; level: number; }
interface EyeState { show: EyeShow | null; nextAt: number; key: string; }

// Driver: holds all state; `tick(now)` returns the composed 23-layer string (and, if given,
// writes it to `--mg-bgpos`; `setImg(layer, uri)` swaps a layer's posed sprite; `setThread(v)`
// sets the dangling spider's thread size, --mg-thread).
export function createDriver(
  rng: RNG, setProp?: (v: string) => void, startNow = 0, setImg?: (layer: number, uri: string) => void,
  setThread?: (v: string) => void,
) {
  // ── wisps: background only — at most WISP_MAX_LIT at once, never two lighting up together ──
  const wisps: Record<number, WispState> = {};
  for (const l of WISPS) wisps[l] = { p: null, nextAt: startNow + 1000 + rng() * 24000, level: -1 };
  let lastSpawn = -Infinity;
  const wispPosFor = (layer: number, now: number): string => {
    const st = wisps[layer]!;
    if (!st.p && now >= st.nextAt) {
      const lit = WISPS.filter((l) => wisps[l]!.p).length;
      if (lit < WISP_MAX_LIT && now - lastSpawn >= WISP_SPAWN_GAP_MS) {
        st.p = newWisp(rng, now); st.level = -1; lastSpawn = now;
      } else {
        st.nextAt = now + 500 + rng() * 2000; // try again shortly
      }
    }
    if (!st.p) return PARK[layer]!;
    const lv = wispLevel(st.p, now);
    if (lv === null) { st.p = null; st.nextAt = now + 20000 + rng() * 20000; return PARK[layer]!; }
    if (lv === 0) return PARK[layer]!;
    if (lv !== st.level && setImg) { st.level = lv; setImg(layer, spriteUri(layer, { wispLevel: lv })); }
    const [x, y] = wispXY(st.p, now);
    return wispPos(x, y, WISP_SIZE[layer]!);
  };

  // ── eyes: two pairs, each away most of the time, never on the same spot ──
  const eyes: Record<number, EyeState> = {
    5: { show: null, nextAt: startNow + 4000 + rng() * 8000, key: '' },
    6: { show: null, nextAt: startNow + 12000 + rng() * 10000, key: '' },
  };
  const eyePosFor = (layer: number, now: number): string => {
    const st = eyes[layer]!;
    if (!st.show && now >= st.nextAt) {
      const other = eyes[layer === 5 ? 6 : 5]!;
      st.show = newEyeShow(rng, now, other.show ? other.show.spot : -1);
      st.key = '';
    }
    if (!st.show) return PARK[layer]!;
    const fr = eyeFrame(st.show, now);
    if (!fr) { st.show = null; st.nextAt = now + 8000 + rng() * 12000; return PARK[layer]!; }
    const key = `${fr.lid}:${fr.opacity}`;
    if (key !== st.key && setImg) { st.key = key; setImg(layer, spriteUri(layer, fr)); }
    const [sx, sy] = EYE_SPOTS[st.show.spot]!;
    return eyePos(sx, sy);
  };

  // ── witch + bats: occasional independent flights; the witch is the rarer ──
  const fly: Record<number, FlyState> = {
    7: { flight: null, start: 0, endAt: 0, nextAt: startNow + 15000 + rng() * 20000, mirror: false, flapIdx: -1 },
    8: { flight: null, start: 0, endAt: 0, nextAt: startNow + 4000 + rng() * 8000, mirror: false, flapIdx: -1 },
    9: { flight: null, start: 0, endAt: 0, nextAt: startNow + 12000 + rng() * 12000, mirror: false, flapIdx: -1 },
  };
  const flyPos = (layer: number, now: number): string => {
    const f = fly[layer]!;
    const band = layer === WITCH ? WITCH_BAND : BAT_BAND;
    if (f.flight && now >= f.endAt) f.flight = null;
    if (!f.flight && now >= f.nextAt) {
      const fl = buildFlight(rng, STYLES[layer]!, band);
      f.flight = fl;
      f.start = now;
      f.endAt = now + fl.dur;
      // the next flight waits for this one to END: witch 15–40 s later, bats 6–20 s
      f.nextAt = f.endAt + (layer === WITCH ? 15000 + rng() * 25000 : 6000 + rng() * 14000);
      f.mirror = layer === WITCH && fl.ltr !== FACE_RIGHT[layer];
      f.flapIdx = -1;
    }
    if (!f.flight) return PARK[layer]!;
    const flap = FLAP[layer]!;
    const idx = Math.floor(now / flap.frameMs) % flap.n;
    if (idx !== f.flapIdx && setImg) {
      f.flapIdx = idx;
      setImg(layer, layer === WITCH
        // cos sweeps through the FULL ±amp range (sin over 6 frames never reaches it)
        ? spriteUri(layer, { mirror: f.mirror, flapDeg: +(flap.amp * Math.cos((2 * Math.PI * idx) / flap.n)).toFixed(2) })
        : spriteUri(layer, { flapPhase: idx / flap.n }));
    }
    // bats: wingbeat-synced body bob (subtle — more reads as bouncing)
    const bob = layer === WITCH ? 0 : 0.4 * Math.cos((2 * Math.PI * now) / (flap.frameMs * flap.n));
    const [x, y] = sampleSpline(f.flight.pts, f.flight.warp((now - f.start) / f.flight.dur));
    return posStr(x, clamp(y + bob, band.yMin, band.yMax));
  };

  // ── the web spider: sits still in its web most of the time, now and then scuttles a few steps
  //    along the threads — in bursts, legs going, turned the way it walks. A change of direction
  //    is a quick turn on the spot (TURN_SPEED), not a snap: it turns first, then walks on. ──
  const WEB_SPEED = 18; // scene px per second while its legs move
  const TURN_SPEED = 720; // degrees per second — an about-face takes a quarter second
  const ws = {
    at: [0, 0] as [number, number], walk: null as WebWalk | null, cum: [] as number[], dist: 0,
    pos: webPoint(0, 0), facing: 0, last: startNow, nextAt: startNow + 4000 + rng() * 8000, key: '',
  };
  const webSpiderPosFor = (now: number): string => {
    // frames can stall (background tab): never jump more than a quarter second of walking
    const dt = clamp((now - ws.last) / 1000, 0, 0.25);
    ws.last = now;
    if (!ws.walk && now >= ws.nextAt) {
      ws.walk = newWebWalk(rng, ws.at);
      ws.cum = [0];
      for (let j = 1; j < ws.walk.pts.length; j++) {
        const a = ws.walk.pts[j - 1]!, b = ws.walk.pts[j]!;
        ws.cum.push(ws.cum[j - 1]! + Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!));
      }
      ws.dist = 0;
    }
    let legPose = 0;
    if (ws.walk) {
      const pts = ws.walk.pts, cum = ws.cum;
      const segAt = (d: number) => { let j = 1; while (j < cum.length - 1 && cum[j]! < d) j++; return j; };
      // the way the current stretch of thread runs; the sprite's head points up (−90°)
      let j = segAt(ws.dist);
      let a = pts[j - 1]!, b = pts[j]!;
      const want = (Math.atan2(b[1]! - a[1]!, b[0]! - a[0]!) * 180) / Math.PI + 90;
      const diff = ((((want - ws.facing) % 360) + 540) % 360) - 180; // the short way round
      const turn = TURN_SPEED * dt;
      ws.facing = ((((Math.abs(diff) <= turn ? want : ws.facing + Math.sign(diff) * turn) % 360) + 360) % 360);
      if (Math.abs(diff) > 30) {
        legPose = GAIT[Math.floor(now / 55) % 4]!; // a sharp turn: legs patter on the spot first
      } else if ((now / 1000) % 0.85 < 0.6) { // a burst of steps, then a short freeze
        ws.dist += WEB_SPEED * dt;
        legPose = GAIT[Math.floor(now / 70) % 4]!;
      }
      if (ws.dist >= cum[cum.length - 1]!) {
        ws.pos = pts[pts.length - 1] as [number, number];
        ws.at = ws.walk.to;
        ws.walk = null;
        ws.nextAt = now + 5000 + rng() * 12000;
        legPose = 0;
      } else {
        j = segAt(ws.dist);
        a = pts[j - 1]!; b = pts[j]!;
        const f = (ws.dist - cum[j - 1]!) / Math.max(1e-6, cum[j]! - cum[j - 1]!);
        ws.pos = [a[0]! + (b[0]! - a[0]!) * f, a[1]! + (b[1]! - a[1]!) * f];
      }
    }
    // the turn is shown in WEB_TURN_STEP steps — a fixed set of sprites, all preloaded
    const shown = (Math.round(ws.facing / WEB_TURN_STEP) % (360 / WEB_TURN_STEP)) * WEB_TURN_STEP;
    const key = `${shown}:${legPose}`;
    if (key !== ws.key && setImg) { ws.key = key; setImg(WEB_SPIDER, spriteUri(WEB_SPIDER, { facing: shown, legPose })); }
    return webSpiderPos(ws.pos[0], ws.pos[1]);
  };

  // ── the dangling spider: now and then lets itself down on its thread, or climbs back up and
  //    reels the thread in (sometimes all the way onto its branch) ──
  const hs = { drop: HANG_REST as number, target: HANG_REST as number, last: startNow, nextAt: startNow + 6000 + rng() * 10000, key: '', thread: '' };
  // moves the spider; returns its drop (the layer positions are derived from it)
  const hangSpiderStep = (now: number): number => {
    const dt = clamp((now - hs.last) / 1000, 0, 0.25);
    hs.last = now;
    if (hs.drop === hs.target && now >= hs.nextAt) {
      if (rng() < 0.35) hs.target = HANG_TOP; // all the way up
      else {
        do hs.target = Math.round(20 + rng() * (HANG_MAX - 20)); while (Math.abs(hs.target - hs.drop) < 15);
      }
    }
    let legPose = 0;
    if (hs.drop !== hs.target) {
      const down = hs.target > hs.drop;
      // down: a smooth slide on the silk; up: hand over hand, in bursts
      if (down || (now / 1000) % 0.7 < 0.45) {
        const step = (down ? 24 : 14) * dt;
        hs.drop = down ? Math.min(hs.target, hs.drop + step) : Math.max(hs.target, hs.drop - step);
        if (!down) legPose = GAIT[Math.floor(now / 80) % 4]!;
      }
      if (hs.drop === hs.target) hs.nextAt = now + (hs.target === HANG_TOP ? 8000 + rng() * 14000 : 6000 + rng() * 12000);
    }
    const key = `${legPose}`;
    if (key !== hs.key && setImg) { hs.key = key; setImg(HANG_SPIDER, spriteUri(HANG_SPIDER, { legPose })); }
    // the thread's length is a background-size, written only when it changes
    const thread = hangThreadSize(hs.drop);
    if (thread !== hs.thread && setThread) { hs.thread = thread; setThread(thread); }
    return hs.drop;
  };

  const tick = (now: number): string => {
    const out: string[] = new Array(LAYERS);
    for (const l of WISPS) out[l] = wispPosFor(l, now);
    for (const l of EYES) out[l] = eyePosFor(l, now);
    out[WITCH] = flyPos(WITCH, now);
    for (const l of BATS) out[l] = flyPos(l, now);
    out[WEB_SPIDER] = webSpiderPosFor(now);
    const drop = hangSpiderStep(now);
    out[HANG_SPIDER] = hangSpiderPos(drop);
    out[HANG_THREAD] = hangThreadPos(drop);
    for (const l of GLOWS) out[l] = '0 0';
    out[SCENE] = 'center bottom';
    const value = composeBgPos(out);
    if (setProp) setProp(value);
    return value;
  };

  return { tick };
}

// Every pose any sprite layer can take — a fixed, finite set (the movers never build a sprite
// outside it).
export function allSpriteUris(): string[] {
  const uris = new Set<string>();
  for (const l of WISPS) for (let lv = 1; lv <= WISP_LEVELS; lv++) uris.add(spriteUri(l, { wispLevel: lv }));
  for (const l of EYES) {
    for (const opacity of FADE_STEPS) uris.add(spriteUri(l, { lid: 'open', opacity }));
    for (const step of BLINK) uris.add(spriteUri(l, { lid: step.lid, opacity: 1 }));
  }
  for (let i = 0; i < FLAP[WITCH]!.n; i++) {
    for (const mirror of [false, true]) uris.add(spriteUri(WITCH, { mirror, flapDeg: +(FLAP[WITCH]!.amp * Math.cos((2 * Math.PI * i) / FLAP[WITCH]!.n)).toFixed(2) }));
  }
  for (const l of BATS) for (let i = 0; i < FLAP[l]!.n; i++) uris.add(spriteUri(l, { flapPhase: i / FLAP[l]!.n }));
  for (let deg = 0; deg < 360; deg += WEB_TURN_STEP) for (const legPose of [0, 1, 2]) uris.add(spriteUri(WEB_SPIDER, { facing: deg, legPose }));
  for (const legPose of [0, 1, 2]) uris.add(spriteUri(HANG_SPIDER, { legPose }));
  return [...uris];
}

// Load every pose up front. A background layer whose image URL changes to one the browser has
// not loaded yet can paint EMPTY for a frame while it loads — a visible flicker mid-animation.
// Loading them all once at start puts them in the browser's image cache, so every later swap
// is instant. (Data URIs, so no network requests — unlike the asset preloading in
// usePreloadAsset, `new Image()` is fine here.) Kept referenced so they stay cached.
let warmed: HTMLImageElement[] | null = null;
function warmSprites(): void {
  if (warmed) return;
  warmed = allSpriteUris().map((u) => {
    const img = new Image();
    img.src = u.slice('url("'.length, -'")'.length);
    return img;
  });
}

// ── DOM glue ──
export function installMaerchenCreatures(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const root = document.documentElement;
  const reduceMM = window.matchMedia('(prefers-reduced-motion: reduce)');

  let raf = 0;
  let running = false;
  let driver: ReturnType<typeof createDriver> | null = null;

  const shouldRun = () => root.dataset.theme === 'maerchen' && !reduceMM.matches && window.innerWidth > 576;
  const loop = () => {
    if (!running || !driver) return;
    driver.tick(performance.now());
    raf = requestAnimationFrame(loop);
  };
  const start = () => {
    if (running) return;
    running = true;
    warmSprites();
    driver = createDriver(
      Math.random,
      (v) => root.style.setProperty('--mg-bgpos', v),
      performance.now(),
      (layer, uri) => root.style.setProperty(`--mg-img${layer}`, uri),
      (v) => root.style.setProperty('--mg-thread', v),
    );
    loop();
  };
  const stop = () => {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    driver = null;
    root.style.removeProperty('--mg-bgpos');
    root.style.removeProperty('--mg-thread');
    for (let l = 0; l < SPRITE_LAYERS; l++) root.style.removeProperty(`--mg-img${l}`);
  };
  const update = () => (shouldRun() ? start() : stop());

  new MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  window.addEventListener('resize', update, { passive: true });
  if (reduceMM.addEventListener) reduceMM.addEventListener('change', update);
  else if (reduceMM.addListener) reduceMM.addListener(update);

  update();
}
