import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  buildFlight,
  newWisp,
  wispXY,
  wispLevel,
  wispPos,
  eyeFrame,
  newEyeShow,
  eyePos,
  createDriver,
  spriteUri,
  STYLES,
  FLAP,
  FACE_RIGHT,
  PARK,
  LAYERS,
  WISPS,
  EYES,
  WITCH,
  BATS,
  GLOWS,
  SPRITE_LAYERS,
  EYE_SPOTS,
  WITCH_BAND,
  BAT_BAND,
  WISP_X_MIN,
  WISP_X_MAX,
  WISP_Y_MIN,
  WISP_Y_MAX,
  WISP_LEVELS,
  WISP_MAX_LIT,
  WISP_SPAWN_GAP_MS,
  WEB_SPIDER,
  HANG_SPIDER,
  WEB,
  WEB_A0,
  WEB_RINGS,
  HANG,
  HANG_TOP,
  HANG_MAX,
  BAT_W,
  BAT_H,
  batWing,
  newWebWalk,
  webPoint,
  HANG_THREAD,
  hangThreadSize,
  allSpriteUris,
  WEB_TURN_STEP,
} from '@/utils/maerchenCreatures';
import type { RNG } from '@/utils/hpFlyers';

function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const parseXY = (s: string) => s.split(' ').map((v) => parseFloat(v));
// The driver joins layers with ', ' — but an eye position contains `calc(…)` with no comma,
// so a plain split is safe.
const layersOf = (v: string) => v.split(', ');

describe('buildFlight', () => {
  it('crosses off-screen→off-screen and stays inside its band', () => {
    for (let s = 0; s < 60; s++) {
      const rng = mulberry32(s + 1);
      for (const [layer, band] of [[WITCH, WITCH_BAND], [BATS[0], BAT_BAND]] as const) {
        const f = buildFlight(rng, STYLES[layer]!, band);
        const first = f.pts[0]!, last = f.pts[f.pts.length - 1]!;
        expect(Math.abs(first[0]! - 50)).toBeGreaterThan(60);
        expect(Math.abs(last[0]! - 50)).toBeGreaterThan(60);
        expect(f.ltr).toBe(first[0]! < last[0]!);
        for (const p of f.pts) {
          expect(p[1]).toBeGreaterThanOrEqual(band.yMin);
          expect(p[1]).toBeLessThanOrEqual(band.yMax);
        }
        expect(f.dur).toBeGreaterThanOrEqual(STYLES[layer]!.durMin);
        expect(f.dur).toBeLessThanOrEqual(STYLES[layer]!.durMax);
      }
    }
  });
});

describe('wisps', () => {
  it('stay inside the forest band while they drift and bob', () => {
    for (let s = 0; s < 40; s++) {
      const p = newWisp(mulberry32(s + 1), 0);
      for (let t = 0; t <= p.lifeMs; t += 250) {
        const [x, y] = wispXY(p, t);
        expect(x).toBeGreaterThanOrEqual(WISP_X_MIN);
        expect(x).toBeLessThanOrEqual(WISP_X_MAX);
        expect(y).toBeGreaterThanOrEqual(WISP_Y_MIN);
        expect(y).toBeLessThanOrEqual(WISP_Y_MAX);
      }
    }
  });

  it('fade in, flicker without going dark, fade out, then disappear', () => {
    for (let s = 0; s < 40; s++) {
      const p = newWisp(mulberry32(s + 1), 1000);
      expect(wispLevel(p, 999)).toBeNull();
      expect(wispLevel(p, 1000)).toBe(0);
      for (let t = 1000 + 1400; t <= 1000 + p.lifeMs - 1400; t += 100) {
        const lv = wispLevel(p, t)!;
        expect(lv).toBeGreaterThanOrEqual(5); // 0.56 of full at the flicker's lowest
        expect(lv).toBeLessThanOrEqual(WISP_LEVELS);
      }
      expect(wispLevel(p, 1000 + p.lifeMs)).toBe(0);
      expect(wispLevel(p, 1000 + p.lifeMs + 1)).toBeNull();
    }
  });

  it('positions track the 100%-width scene in vw, centred on the sprite', () => {
    expect(wispPos(800, 640, 20)).toBe('calc(50vw - 10px) calc(100% - 0vw + 10px)');
  });

  it('weave around: a wisp covers real ground during its life', () => {
    for (let s = 0; s < 40; s++) {
      const p = newWisp(mulberry32(s + 1), 0);
      let path = 0;
      let [px, py] = wispXY(p, 0);
      for (let t = 100; t <= p.lifeMs; t += 100) {
        const [x, y] = wispXY(p, t);
        path += Math.hypot(x - px, y - py);
        [px, py] = [x, y];
      }
      expect(path).toBeGreaterThan(250); // scene px — not a wisp hovering in place
    }
  });

  it('background only: at most WISP_MAX_LIT at once, spawns spaced apart, all inside the band', () => {
    for (let s = 0; s < 6; s++) {
      const d = createDriver(mulberry32(s + 3), undefined, 0);
      const vw = 100 / 1600;
      const seen = new Set<number>();
      let prevLit = new Set<number>();
      let lastSpawn = -Infinity;
      for (let now = 0; now < 180000; now += 100) {
        const out = layersOf(d.tick(now));
        const lit = new Set<number>();
        for (const l of WISPS) {
          if (out[l] === PARK[l]) continue;
          const m = /^calc\(([\d.]+)vw - [\d.]+px\) calc\(100% - ([\d.]+)vw \+ [\d.]+px\)$/.exec(out[l]!);
          expect(m).not.toBeNull();
          const sx = +m![1]! / vw, sy = 640 - +m![2]! / vw;
          expect(sx).toBeGreaterThanOrEqual(WISP_X_MIN - 1);
          expect(sx).toBeLessThanOrEqual(WISP_X_MAX + 1);
          expect(sy).toBeGreaterThanOrEqual(WISP_Y_MIN - 1);
          expect(sy).toBeLessThanOrEqual(WISP_Y_MAX + 1);
          lit.add(l);
          seen.add(l);
        }
        expect(lit.size).toBeLessThanOrEqual(WISP_MAX_LIT);
        for (const l of lit) {
          if (prevLit.has(l)) continue;
          // a wisp is parked for the first ~100 ms of its fade-in, so it shows up within a tick
          // or two of its spawn
          expect(now - lastSpawn).toBeGreaterThanOrEqual(WISP_SPAWN_GAP_MS - 200);
          lastSpawn = now;
        }
        prevLit = lit;
      }
      // over three minutes every wisp got its turn (long pauses: each comes back only every 20–40 s)
      expect(seen.size).toBe(WISPS.length);
    }
  });
});

describe('eyes', () => {
  it('fade in, hold with blinks, fade out, then disappear', () => {
    const show = newEyeShow(mulberry32(7), 1000, -1);
    expect(eyeFrame(show, 999)).toBeNull();
    expect(eyeFrame(show, 1000)).toEqual({ lid: 'open', opacity: 0.35 });
    const firstBlink = 1000 + 3 * 170 + show.blinksAt[0]!;
    expect(eyeFrame(show, firstBlink + 30)!.lid).toBe('half');
    expect(eyeFrame(show, firstBlink + 100)!.lid).toBe('closed');
    expect(eyeFrame(show, firstBlink + 400)).toEqual({ lid: 'open', opacity: 1 });
    const end = 1000 + 2 * 3 * 170 + show.holdMs;
    expect(eyeFrame(show, end - 1)!.opacity).toBe(0.35);
    expect(eyeFrame(show, end + 1)).toBeNull();
  });

  it('never picks the spot the other pair is using', () => {
    for (let s = 0; s < 200; s++) {
      const avoid = s % EYE_SPOTS.length;
      expect(newEyeShow(mulberry32(s + 1), 0, avoid).spot).not.toBe(avoid);
    }
  });

  it('positions track the 100%-width scene in vw', () => {
    // scene (800, 634) = centre bottom: the 36×12 sprite's left edge at 782 px → 48.88vw, 0vw up
    expect(eyePos(800, 634)).toBe('calc(48.88vw) calc(100% - 0vw)');
  });
});

describe('createDriver', () => {
  it('always composes the full layer count: glows held at 0 0, the scene last', () => {
    const d = createDriver(mulberry32(1), undefined, 0);
    for (let now = 0; now < 200000; now += 777) {
      const out = layersOf(d.tick(now));
      expect(out).toHaveLength(LAYERS);
      for (const l of GLOWS) expect(out[l]).toBe('0 0');
      expect(out[LAYERS - 1]).toBe('center bottom');
    }
  });

  it('parks the sky flyers and eyes before their first appearance', () => {
    const out = layersOf(createDriver(mulberry32(1), undefined, 0).tick(0));
    for (const l of [...EYES, WITCH, ...BATS]) expect(out[l]).toBe(PARK[l]);
  });

  it('flies the witch and bats inside their bands, the witch mirrored to face travel', () => {
    const imgs: Record<number, string> = {};
    const d = createDriver(mulberry32(11), undefined, 0, (l, uri) => { imgs[l] = uri; });
    let witchSeen = false, batSeen = false;
    const prev: Record<number, number> = {};
    for (let now = 0; now < 300000; now += 200) {
      const out = layersOf(d.tick(now));
      for (const [l, band] of [[WITCH, WITCH_BAND], [BATS[0], BAT_BAND], [BATS[1], BAT_BAND]] as const) {
        if (out[l] === PARK[l]) { delete prev[l]; continue; }
        const [x, y] = parseXY(out[l]!);
        expect(y).toBeGreaterThanOrEqual(band.yMin);
        expect(y).toBeLessThanOrEqual(band.yMax);
        if (l === WITCH) witchSeen = true; else batSeen = true;
        // the witch faces her travel direction: mirrored iff moving against FACE_RIGHT (the
        // front-view bats look the same both ways)
        if (l === WITCH && prev[l] !== undefined && Math.abs(x - prev[l]!) > 0.05) {
          const movingRight = x > prev[l]!;
          const mirrored = decodeURIComponent(imgs[l]!).includes('scale(-1,1)');
          expect(mirrored).toBe(movingRight !== FACE_RIGHT[l]);
        }
        prev[l] = x;
      }
    }
    expect(witchSeen).toBe(true);
    expect(batSeen).toBe(true);
  });

  it('opens eyes only on the baked eye spots', () => {
    const d = createDriver(mulberry32(5), undefined, 0);
    const allowed = new Set(EYE_SPOTS.map(([x, y]) => eyePos(x, y)));
    let seen = 0;
    for (let now = 0; now < 200000; now += 300) {
      const out = layersOf(d.tick(now));
      for (const l of EYES) {
        if (out[l] === PARK[l]) continue;
        expect(allowed.has(out[l]!)).toBe(true);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});

describe('spriteUri', () => {
  it('bat: both wings flap together (a flap, not a see-saw), up and down through the stroke', () => {
    for (let i = 0; i < FLAP[BATS[0]]!.n; i++) {
      const svg = decodeURIComponent(spriteUri(BATS[0], { flapPhase: i / FLAP[BATS[0]]!.n }));
      // the left wing is the right wing's markup again, inside one mirror group
      const mirror = /<g transform='translate\(48 0\) scale\(-1 1\)'>(.*?)<\/g>/.exec(svg);
      expect(mirror).not.toBeNull();
      expect(svg.indexOf(mirror![1]!)).toBeLessThan(svg.indexOf(mirror![0]));
    }
    // top of the stroke: wing tips above the shoulder; bottom: below it — and spread wider
    const up = batWing(1, 0.82), down = batWing(-1, 0.82);
    for (const f of up.F) expect(f[1]).toBeLessThan(up.S[1]);
    for (const f of down.F) expect(f[1]).toBeGreaterThan(down.S[1]);
    const reach = (k: number) => Math.max(...batWing(0, k).F.map((f) => f[0]));
    expect(reach(1)).toBeGreaterThan(reach(0.64));
  });

  it('bat fits its sprite at every point of the wingbeat', () => {
    for (let u = 0; u < 1; u += 0.05) {
      const e = Math.cos(2 * Math.PI * u), k = 0.82 + 0.18 * Math.sin(2 * Math.PI * u);
      const { S, W, F, H } = batWing(e, k);
      for (const [x, y] of [S, W, ...F, H]) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(BAT_W);
        expect(y + 4).toBeGreaterThanOrEqual(0); // drawn shifted down 4 px
        expect(y + 4).toBeLessThanOrEqual(BAT_H);
      }
    }
  });

  it('eye lids narrow for the blink and the fade is baked into the sprite', () => {
    const open = decodeURIComponent(spriteUri(EYES[0]));
    const closed = decodeURIComponent(spriteUri(EYES[0], { lid: 'closed', opacity: 0.35 }));
    expect(open).toContain("opacity='1'");
    expect(open).toContain("fill='#2a0000'"); // pupils show when open
    expect(closed).toContain("opacity='0.35'");
    expect(closed).not.toContain("fill='#2a0000'");
  });

  it('every sprite layer has a sprite', () => {
    for (let l = 0; l < SPRITE_LAYERS; l++) expect(spriteUri(l)).toMatch(/^url\("data:image\/svg\+xml,/);
  });
});

describe('spiders', () => {
  it('web walks stay on the threads: every point lies on a spoke or a ring of the web', () => {
    const rng = mulberry32(9);
    let at: [number, number] = [0, 0];
    for (let w = 0; w < 200; w++) {
      const walk = newWebWalk(rng, at);
      expect(walk.pts[0]).toEqual(webPoint(at[0], at[1]));
      expect(walk.pts[walk.pts.length - 1]).toEqual(webPoint(walk.to[0], walk.to[1]));
      for (const [x, y] of walk.pts) {
        // inside the web: never past the outermost ring the spider uses
        const a = Math.atan2(y! - WEB.y, x! - WEB.x);
        const n = WEB.lens.length;
        const i = Math.round(((a - WEB_A0) / (2 * Math.PI)) * n);
        const reach = Math.max(WEB.lens[((i % n) + n) % n]!, WEB.lens[(((i + 1) % n) + n) % n]!, WEB.lens[(((i - 1) % n) + n) % n]!);
        expect(Math.hypot(x! - WEB.x, y! - WEB.y)).toBeLessThanOrEqual(reach * WEB_RINGS[4] + 1e-6);
      }
      at = walk.to;
    }
  });

  it('the web spider rests in the middle, then now and then scuttles off and settles again', () => {
    const imgs: string[] = [];
    const d = createDriver(mulberry32(4), undefined, 0, (l, uri) => { if (l === WEB_SPIDER) imgs.push(uri); });
    const seen = new Set<string>();
    expect(layersOf(d.tick(0))[WEB_SPIDER]).toBe(PARK[WEB_SPIDER]);
    for (let now = 0; now < 180000; now += 50) seen.add(layersOf(d.tick(now))[WEB_SPIDER]!);
    expect(seen.size).toBeGreaterThan(20); // it moved
    // it turned and walked: the sprite was posed several ways
    expect(new Set(imgs).size).toBeGreaterThan(4);
  });

  it('the web spider turns quickly but smoothly — never snaps round', () => {
    const angles: number[] = [];
    const d = createDriver(mulberry32(4), undefined, 0, (l, uri) => {
      if (l === WEB_SPIDER) angles.push(+/rotate\((-?[\d.]+)\) scale/.exec(decodeURIComponent(uri))![1]!);
    });
    let turns = 0;
    let prevLen = 0;
    for (let now = 0; now < 180000; now += 50) {
      d.tick(now);
      for (let i = Math.max(1, prevLen); i < angles.length; i++) {
        const diff = Math.abs(((((angles[i]! - angles[i - 1]!) % 360) + 540) % 360) - 180);
        // at most 720°/s × 50 ms = 36° per tick, plus one display step
        expect(diff).toBeLessThanOrEqual(36 + WEB_TURN_STEP);
        if (diff > 0) turns++;
      }
      prevLen = angles.length;
    }
    expect(turns).toBeGreaterThan(10);
  });

  it('the dangling spider moves up and down on a thread exactly as long as its drop', () => {
    const vw = 100 / 1600;
    let thread = '';
    const d = createDriver(mulberry32(6), undefined, 0, undefined, (v) => { thread = v; });
    const drops: number[] = [];
    for (let now = 0; now < 240000; now += 50) {
      const out = layersOf(d.tick(now));
      // the spider's centre, from its layer position (a 32 px sprite placed by its bottom edge)
      const m = /^calc\(([\d.]+)vw\) calc\(100% - ([\d.]+)vw\)$/.exec(out[HANG_SPIDER]!)!;
      expect(+m[1]! / vw).toBeCloseTo(HANG.x - 16, 0); // it hangs straight down
      const drop = 640 - +m[2]! / vw - 16 - HANG.y;
      drops.push(drop);
      // the thread starts at the branch and ends at the abdomen
      expect(out[HANG_THREAD]!.startsWith(`calc(${HANG.x * vw}vw - 0.5px) `)).toBe(true);
      const t = /^1px ([\d.]+)vw$/.exec(thread);
      if (drop > HANG_TOP + 2.5) {
        expect(t).not.toBeNull();
        expect(Math.abs(+t![1]! / vw - (drop - 7.7 * 1.4))).toBeLessThan(0.4);
      }
    }
    expect(Math.min(...drops)).toBeGreaterThanOrEqual(HANG_TOP - 0.3);
    expect(Math.max(...drops)).toBeLessThanOrEqual(HANG_MAX + 0.3);
    expect(Math.max(...drops) - Math.min(...drops)).toBeGreaterThan(30);
    // climbed all the way up: no thread left
    expect(hangThreadSize(HANG_TOP)).toBe('0 0');
  });

  it('every sprite a mover ever shows is in the preloaded set — no image is new mid-animation', () => {
    const all = new Set(allSpriteUris());
    let shown = 0;
    const d = createDriver(mulberry32(8), undefined, 0, (_l, uri) => { expect(all.has(uri)).toBe(true); shown++; });
    for (let now = 0; now < 300000; now += 40) d.tick(now);
    expect(shown).toBeGreaterThan(100);
    expect(all.size).toBeLessThan(250); // small enough to load up front
  });
});

describe('scene sync', () => {
  // the eye spots, the CSS glow centres and the baked scene are copied by hand between three
  // files — this keeps them from drifting apart when the generator changes
  const gen = createRequire(__filename)(join(__dirname, '../../../scripts/generate-maerchen-scene.cjs')) as {
    buildSvg: () => string; WINDOWS: number[][]; PUMPKIN_GLOWS: number[][]; EYE_SPOTS: number[][]; VH: number;
    WEB_GEOM: { x: number; y: number; lens: number[] }; WEB_A0: number; WEB_RINGS: number[]; HANG: { x: number; y: number };
  };
  gen.buildSvg(); // places the knot-hole eye spot on the generated trunk

  it('the spiders live on the generated web and branch', () => {
    expect({ x: WEB.x, y: WEB.y, lens: [...WEB.lens] }).toEqual(gen.WEB_GEOM);
    expect(WEB_A0).toBe(gen.WEB_A0);
    expect([...WEB_RINGS]).toEqual(gen.WEB_RINGS);
    expect({ ...HANG }).toEqual(gen.HANG);
  });

  it('eye spots match the scene generator', () => {
    expect(EYE_SPOTS.map((p) => [...p])).toEqual(gen.EYE_SPOTS);
  });

  it('the CSS window glows sit on the generated windows', () => {
    const css = readFileSync(join(__dirname, '../../../src/styles/themes.css'), 'utf8');
    const glows = [...css.matchAll(/radial-gradient\(circle 1\.1vw at ([\d.]+)vw calc\(100% - ([\d.]+)vw\)/g)]
      .map((m) => [Math.round(+m[1]! * 16), Math.round(gen.VH - +m[2]! * 16)]);
    expect(glows).toEqual(gen.WINDOWS);
  });

  it("the CSS candle glows sit on the generated jack-o'-lanterns", () => {
    const css = readFileSync(join(__dirname, '../../../src/styles/themes.css'), 'utf8');
    const glows = [...css.matchAll(/radial-gradient\(circle 3vw at ([\d.]+)vw calc\(100% - ([\d.]+)vw\), rgb\(255 150 50 /g)]
      .map((m) => [Math.round(+m[1]! * 16), Math.round(gen.VH - +m[2]! * 16)]);
    expect(glows).toEqual(gen.PUMPKIN_GLOWS);
  });
});
