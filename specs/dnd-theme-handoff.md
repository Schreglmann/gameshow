# D&D Theme — Handoff for further design work

> **You are the next model picking this up.** The D&D frontend theme (`[data-theme="dnd"]`,
> *"Drachenhort" / dragon's lair*) was rebuilt around a **sleeping dragon** — a curled-up
> sleeping dragon **TRACED from a real reference** (no eye), half-buried in a glowing treasure
> hoard. This doc is your map: what exists, **the exact iteration loop**, the hard rules that
> keep it from breaking, every tuning knob, and ideas to push the design further. Read this +
> the D&D section of [`themes.md`](themes.md) before touching anything.

---

## 1. What the theme is now

A torchlit **stone-archway dragon's lair**. You look through a weathered stone arch (one
continuous masonry course grid, voussoir ring + keystone, jamb quoins, moss, rubble) into a dark
cave where a **dragon SLEEPS half-buried in the gold** — a **TRACED silhouette** of a real
curled-up sleeping-dragon render ([`scripts/dragon-traced.json`](../scripts/dragon-traced.json)):
**tail wrapping a full loop** at the left (the warm haze glows through the loop hole), **both
wings folded as two peaks** over a **spiked back ridge**, and the **head resting on the ground
at the right**, snout buried in the tall heap's slope — **no eye** (per explicit user direction
the dragon stays background presence, not protagonist). Its belly line sits BELOW the gold, so
the legs/claws bury in the hoard and the half-sunk head reads as resting on the treasure. The
governing **contrast-first rule**: the silhouette only reads where warm haze sits behind it —
the glow band + pockets are keyed to the wing peaks, the tail loop and the head. The hoard is the bright focal point:
~74 shaded coins on layered slopes, coin stacks, an open chest whose standing lid shows its
gold-lit interior, a crown, a half-buried sword, goblets, muted gems and sparse star glints.
Hoard light spills out of the opening across the foreground flagstones. Content sits on
**aged-parchment "spell-scroll" cards** (dark ink, gold trim) with Red-Dragon/Blue-Dragon team
accents and a dark-stone score header.

It deliberately mirrors the Harry Potter theme's architecture (the in-repo gold standard).

### Files that make it up

| File | Role |
|------|------|
| [`scripts/generate-dungeon-scene.cjs`](../scripts/generate-dungeon-scene.cjs) | **Composes the whole baked scene** (arch, masonry, torches, floors, hoard — and places the TRACED dragon from `dragon-traced.json`; placement knobs in `dragon()`). Preview PNG or `--write-css` to bake into `themes.css`. **This is where you do 90% of design work.** |
| [`scripts/trace-dragon-reference.cjs`](../scripts/trace-dragon-reference.cjs) + [`scripts/dragon-traced.json`](../scripts/dragon-traced.json) | **ACTIVE.** Vectorises a flat reference image into the silhouette + tone bands the generator consumes (alpha/luma threshold + marching-squares + Douglas-Peucker). Modes: `--luma[=N]` (dark-on-white art), `--fill[=R]` (line art: close gaps, flood-fill, largest component), `--solid[=K]` (keep K largest loops), `--minloop[=A]` (drop sliver holes), `--bands=T1,T2`/`--minband=A1,A2` (posterise the reference's own shading into tone layers), `--erase=x0,y0,x1,y1` (surgical mask-rect removal), `--eraseband=…` (band-masks only — kills a shading patch whose straight edge reads as a seam), `--renderw=W` (trace resolution). Current reference + exact re-trace command: header of the script / dragon block of the generator. |
| [`src/styles/themes.css`](../src/styles/themes.css) | The `[data-theme="dnd"]` block: palette, parchment-card + in-card-ink vars, house accents, header, torch-flicker `::before`, the baked scene data-URI on `::after`, `dndTorch` keyframes, responsive + isolation resets. |
| [`src/utils/dndCreatures.ts`](../src/utils/dndCreatures.ts) | JS motion engine (mirrors `hpFlyers.ts`): randomised will-o'-wisp + 2 bats → writes `--dnd-bgpos` / `--dnd-img1`/`--dnd-img2`. Installed from [`src/entries/frontend.tsx`](../src/entries/frontend.tsx). |
| [`tests/unit/utils/dndCreatures.test.ts`](../tests/unit/utils/dndCreatures.test.ts) | 15 unit tests for the engine (spline/warp/flights/sprites, incl. opposite-sign flap + wisp-lick shape). |
| [`themes.md`](themes.md) | Canonical spec — the **D&D design-notes section** is the authoritative description; keep it in sync. |

The HP files ([`scripts/generate-hogwarts-scene.cjs`](../scripts/generate-hogwarts-scene.cjs),
[`src/utils/hpFlyers.ts`](../src/utils/hpFlyers.ts)) are the reference patterns — copy their ideas.

---

## 2. THE ITERATION LOOP (how to improve the scene fast)

Design is visual + iterative. **Do NOT edit CSS by hand or restart the dev server for every
tweak.** Use the preview render:

```bash
# 1. Edit scripts/generate-dungeon-scene.cjs (composition / palette / dragon / hoard)
node scripts/generate-dungeon-scene.cjs            # → preview PNG at $TMPDIR/dungeon-scene.png
#    ...open/Read that PNG, judge it, tweak, repeat. Fast (no browser).
# 2. Zoom into regions (head, hoard, wing) AND a small glance version — batch ALL views into
#    ONE script file run as one bare command (avoid `node -e`, pipes, && — each prompts the
#    user). Pattern: a /tmp/claude/.../iterate.cjs that execFileSync's the generator then
#    sharp-crops it-full/it-zoom/it-small/it-head/it-wing in one go.
# 3. When it looks right, bake it into themes.css:
node scripts/generate-dungeon-scene.cjs --write-css
```

Three meta-techniques that paid off (use them, they're cheap):
- **Measure, don't eyeball.** When placing shapes over the traced dragon, print the contour
  numerically (a script that scans the mask and prints top-edge/run tables in SCENE coords —
  see the `measure-head.cjs` pattern referenced in the generator). Grid-overlay screenshots
  get downsampled to unreadability; numbers don't.
- **Blind judge panels for readability.** Self-judging your own crops lies. Spawn agents that
  Read the renders with NO context ("describe what you see; where is the creature's head?")
  plus one primed anatomist. Iterate until blind judges name the subject unprompted.
- **Judge at the USER's zoom.** The scene is a full-viewport background — a render that reads
  at 480px can still be an empty blob at 1900px. Always judge the zoom crop too.

### Live verification (after baking)
- Backend: `ulimit -n 8192; node --import=tsx server/index.ts` — **`tsx watch` fails in the
  sandbox** (IPC pipe EPERM); use this instead. The vite client: `npm run dev:client`.
- **Vite's file watcher is broken in the sandbox** — after `--write-css` (or ANY themes.css
  change), **restart the vite client** or the browser serves the stale stylesheet (the module
  graph caches the old transform; a page reload is NOT enough).
- Set the theme without server round-trips: load `http://localhost:5173/show/`, wait for it to
  settle, then `document.documentElement.dataset.theme = 'dnd'` (this also starts the JS engine
  via its MutationObserver). React won't revert it (the theme `useEffect` only fires on change).
- The **`/show/game` route with no game started** shows the title-phase card — the best screen to
  judge the dragon (small card, dragon fully visible). The name-entry `/show/` screen covers the
  wings/center with its card; the head (right, with horn + eye) and the tail loop (left) stay
  visible beside it — the full creature is a "second-look" reveal between games.
- Screenshot at **375 / 768 / 1024 / 1920** (AGENTS.md responsiveness rule).

---

## 3. HARD RULES (break these and the preview lies or the build breaks)

1. **Baked scene = FLAT vector + SVG `<linearGradient>`/`<radialGradient>` ONLY. NO SVG filters**
   (`feGaussianBlur`, `feTurbulence`, etc.). `sharp` (the preview renderer) does not render filters
   the same as the browser, so the preview would lie. All *soft glow* is SVG radial-gradients; all
   *animation* (torch flicker) lives in `themes.css` keyframes, **not** baked into the SVG.
2. **Deterministic only.** The generator uses `mulberry32` PRNG — **no `Math.random()` / `Date.now()`**
   so the baked data-URI is reproducible.
3. **`VW = 1600`** is the bake marker. `--write-css` finds the scene via a regex keyed on
   `width%3D'1600'` inside the `[data-theme="dnd"]::after` rule. Keep `VW=1600` or update the regex.
4. **The `::after` layer model is shared between CSS and JS.** Order is `0 wisp · 1 bat · 2 bat · 3 scene`.
   `dndCreatures.ts` composes a 4-value `background-position` → `--dnd-bgpos`; the CSS fallback
   (parked positions) + the baked mover sprite URLs **must match** the engine's "normal" sprites.
   If you add/reorder layers, change **both** the CSS `::after` (`background-image` / `-position` /
   `-size`) **and** `dndCreatures.ts` (PARK, FIXED, `tick()` array, sprite URLs).
5. **Scene blends into the body gradient.** It's `background-size: 100% auto; background-position:
   center bottom`. The SVG's top fades to `DEPTH_TOP` (`#070504`) which MUST equal
   `--bg-gradient-from` in the dnd palette, or you'll see a seam on tall viewports. (This seam
   existed before the rebuild — the palette had drifted to `#111111`.)
6. **Torch flicker is position-coupled to the baked torches.** The scene maps to vw (1vw = 16
   scene-px): torches at scene x 100/1500 → `::before` glows at `6.25vw` / `93.75vw`,
   `calc(100% - 35vw)` (core) / `- 29vw` (ambient). Move the baked torches → update these.
7. **Cross-theme isolation.** `dnd` is listed in the `[data-theme]:not(...)` reset chains for the
   `--card-*` / `--card-text*` / `--team*-house` / `--header-*` vars (so parchment/header styling
   doesn't leak into nested `[data-theme]` panels in `/theme-showcase`). If you add new surface vars
   for dnd, add `dnd` to those reset blocks too. The parchment card vars themselves live in the
   `[data-theme="dnd"]` block (don't delete them — the isolation chains assume they exist).
8. **Atmosphere is disabled in `.theme-preview-panel`** (the `::before/::after` overlays are
   `position: fixed`). The showcase shows dnd's palette + parchment cards but not the live scene —
   verify the scene on the real `/show/` page.
9. **WCAG AA:** if you change the palette, re-check the contrast table in `themes.md` (page text on
   the dark bg; dark-ink card text on parchment). Don't regress below the documented ratios.

---

## 4. TUNING KNOBS (all in `scripts/generate-dungeon-scene.cjs`)

- **Geometry:** `VW/VH`, `FLOOR_Y` (640 — foreground threshold), `OPEN_L/OPEN_R` (200/1400 —
  opening width), `SPRING_Y`/`CROWN_Y`/`CROWN_X` (arch). The dragon is clipped to `openClip`
  (the opening path) — that's what lets `BASE_Y` sit below the floor (the buried belly).
- **Palette consts (top of file):** `DEPTH_TOP/BOT`, `STONE_TONES[]`, `STONE_HI`, `DRAGON`
  (the sleeping mass), `RIM` (haze-backlit rim over the silhouette's upper edges),
  `FLOOR_TONES[]`, `MOSS*`, `GOLD*`, `WOOD*`, `IRON*`, `GEM_*` (muted on purpose).
- **The SLEEPING DRAGON** (placement + lighting in `dragon()`, head detail in `dragonHead()`,
  shape in `dragon-traced.json`):
  - The BODY shape comes from the trace — don't redraw it by hand (see §5). To change the
    dragon, change the REFERENCE and re-trace; to move it, change the placement knobs. The
    exact production trace command (with `--renderw/--minloop/--bands/--minband/--erase`) is
    in the dragon block comment of the generator.
  - Placement knobs: `W` (880 — on-scene width), `RIGHT_X` (1352) / `BASE_Y` (712 — **below
    the floor on purpose**: the belly line sinks under the gold so the render's legs/claws
    are buried and the half-sunk head reads as resting ON the treasure) form the
    **calibration frame**, and **`DRAGON_DX` (−112)** shifts the WHOLE dragon (body group +
    glow pockets + chin drift, via one group translate) to center it in the opening. All
    internal coordinates (dragonHead, bellyFill, measure tables) stay in UNSHIFTED
    calibration space — change position via `DRAGON_DX`, never by editing shape coords.
  - **A FLAT FILL IS NOT ENOUGH — "the dragon is just a weird blob".** Blind-judge-verified
    layer stack, in order of impact:
    1. **Continuous rim light**: two stroke passes UNDER the dark fill (broad faint `#d66e22`
       w14 halo + tight `#9c5e26` w4.5) — one lit creature outline. The tail-loop hole's edge
       gets lit too (sells the loop crossover). The old offset-copy rim was invisible.
    2. **Tone bands** (`--bands=95,150`): the reference's own shading posterised into
       `DRAGON_MID`/`DRAGON_LIT` fills — wing membranes + lit flank read INSIDE the mass
       (the hoard lesson again: overlapping values = form, one value = blob). Keep band
       regions BIG and SMOOTH (`--minband`, coarse simplify) — small wiggly patches read as
       camouflage stains.
    3. **REPLACED head** (`dragonHead()`): the trace's own right end is a huge featureless
       3/4-view balloon dome. DECORATING it failed twice (muzzle wedge + horn on the dome →
       "the head does not fit"): the dome is **erased from the trace** (`--erase=845,0,…`)
       and a designed unit takes its place — a **neck flowing from the shoulder into a
       properly proportioned wedge head** resting on the gold (dragon heads are SMALL vs the
       body). Components: crown → brow → tapering snout → blunt tip → lip → jaw → chin, the
       throat/return edge running INSIDE the body mass (buries the seam + covers the
       rim-stroked vertical cut edge); ONE modest backswept horn; warm closed-eye crescent
       `#b4682a` (a dark-on-dark eye is invisible — judges' #1 fix); nostril dot; its own
       `dragonBelly` glow copy (the body's copy stops at the erase cut → hard vertical glow
       edge otherwise); and a **gold drift under the chin** (`chinDrift` in `hoard()`) so the
       snout rests IN treasure, not over bare ledge. Graft anchors were MEASURED
       (`measure-head.cjs` pattern: print contour runs in scene coords — don't eyeball crops).
       **CALIBRATION:** `--erase` shrinks the traced bbox — the placement transform is pinned
       to the FULL reference bbox `[138,301,954,694]`, never derived from `TRACED.bbox`, or
       every measured coordinate shifts.
       HORN HISTORY (5 variants — don't repeat): a PAIR fuses into one triangular blade;
       up-LEFT blades parallel the wing fingers and parse as wing spars; an up-RIGHT cone
       perched on the dome reads as **"a hat"** (with the ear nub as its brim); OVERSIZED
       reads as a crest dominating the head; what works is one modest curved horn from the
       crown. Rim-stroke ONLY the outer head profile — stroking the closed path lights the
       throat seam inside the body; stroking thin shapes makes hollow double lines.
    4. **Belly underglow** (`dragonBelly` gradient fill of the whole path) — hoard light
       licking the underside ties the dragon to the gold — plus the **belly filler** path in
       `dragon()`: the reference's belly line RISES between coil and foreleg (bottom edge
       ~y 495-510 at scene x 700-820), leaving a warm slit that made the dragon float and
       the body look too thin for the wing ("the proportions of the body under the wing are
       weird"). The filler drops the chest into the gold; the hoard buries its lower edge;
       the tail-loop window further left stays open.
  - Trace with `--minloop=480` — sliver holes read as cracks. The BIG hole (the tail-coil
    loop) must survive: the haze glowing through it is a key recognition cue. `--erase` the
    reference's lower-right claw mass (it hid the muzzle taper + left floor debris).
  - **THE CONTRAST-FIRST RULE (still the law):** the silhouette only reads where warm haze sits
    behind it. Three `emberLow` pockets in `buildSvg()` are keyed to the anatomy: the broad
    **haze band** (860,380) behind the wing peaks + ridge, the **left pocket** (560,545)
    glowing through the tail loop, the **head pocket** (1270,505) behind the skull. If you
    move/rescale the dragon, MOVE THE POCKETS with it.
  - **Reference-picking rule:** judge a candidate by its OUTER CONTOUR alone — fill it black
    and squint. Sleeping poses usually tuck head/legs INSIDE the outline → blob. (An
    "engraving" variant — silhouette + the art's own interior lines in faint RIM — dies at
    background scale: the lines vanish, leaving a boulder.)
  - **Verification method that actually works: BLIND JUDGE PANELS.** Spawn agents that Read
    the zoom/thumbnail renders with NO context ("describe what you see") plus one primed
    anatomist ("judge ruthlessly whether the head/tail/wings read"). Self-judging crops lies;
    the panels caught the backwards-parsing stick, the boulder head, the invisible eye and
    the hollow horn. Iterate until blind judges name the creature unprompted (blob-risk went
    7 → 3 → 2 over three rounds).
- **Hoard — a layered GOLD-SCAPE (the structural rule that finally made it work):**
  - **Never build the hoard as ONE mound.** A single dome — however textured — reads as a blob
    ("rethink the entire hoard"). The hoard is FIVE overlapping `bank()` silhouettes back→front,
    spanning the **whole opening jamb to jamb** (per user request):
    `backBank` (225–1392, dark, fades into the dragon's shadow) → `farLeftHeap` (so the left
    stretch isn't two flat bands) → `leftHeap` (the chest sinks into it) →
    `tallHeap` (crown + sword) → `frontBank` (205–1396, brightest, spreads toward the
    threshold) — plus `chinDrift` under the dragon's head (follows `DRAGON_DX`). The
    overlaps create valleys + depth; each layer has its own userSpaceOnUse vertical gradient
    (`goldBack/Mid/Tall/Front`) + a thin crest highlight stroke. The base glow strip and
    `hoardGlow` are widened (rx 560/540) to light the full spread.
  - `bank(x0, x1, baseY, peakX, peakH, rng, fill, crestColor, crestOp, seg)` builds one bumpy
    pile. The bumps must be IRREGULAR — varied amplitude, randomly skipped midpoints, jittered
    positions (uniform scallops read as a decorative cake-frosting border). The opening clip
    cuts everything at `FLOOR_Y` — bank bases sit at ~612–646 and close below the clip.
  - Items sit half-buried BETWEEN layers: the chest is drawn after `leftHeap` and buried by
    `frontBank` (tilted −6°, standing OPEN lid showing its gold-lit interior — a dark closed
    lid face read as a floating canopy); shield leans ON the tall heap's flank (free-standing
    it read as a wheel); crown on the tall peak; sword in its right slope; **NO goblet** —
    upright it read as a stray glyph, toppled (which landed at the dragon's chin) as a
    floating strap/rope; `gem()` (side-view cut profile, small + muted, a
    coin overlapping each pavilion); sparse coin tops near the peaks + glint dashes
    (eye-level = coin EDGES on faces; full coin-tops across a face imply a bird's-eye view);
    2–3 coin stacks with contact shadows; `star()` glints (3 max).
  - Glow gradients multi-stop (a 2-stop radial leaves a visible oval = spotlight sticker).
    Golds must stay warm — the old `GOLD_DK #6e5113` was olive and tinted everything lime.
- **Lighting (defs):** `depthHaze` (big ember backlight), `emberLow` (hot pockets silhouetting
  the mass — haze band, tail-loop pocket, head pocket, base strip), `hoardGlow`, `torchGlow`/`torchCore`,
  `warmStone`, `wallShade` (wall sinks dark toward the top), `innerFloorG`, `spillG` (light
  spilling out the opening), `floorGrad`, `topFade`, `vig`.
- **Masonry:** `masonry()` — ONE pass over the whole frame, clipped to `frameClip` (`FRAME_D`
  with `clip-rule='evenodd'`), so courses align everywhere. **Never go back to per-wall passes
  with separate seeds — misaligned mortar lines were the "stone lines don't fit" complaint.**
  Knobs: course height 58+16, block width 112+68, crack 0.08, chip 0.05, moss on low blocks.
  `voussoirsAndQuoins()` — the built arch ring (19 wedges, lighter tone subset, keystone at the
  crown) + alternating-depth jamb quoins down the opening edges. `mossTuft()`, rubble loop, AO.
- **Torches:** `torch(x,y)` — front-mounted at x 100/1500. Animated flicker is CSS
  (`themes.css` `::before`, see Hard rule 6).
- **Embers/stalactites/loose coins:** small loops in `buildSvg()` — counts/areas inline (kept
  sparse on purpose; more reads as noise).

---

## 5. The dragon: history + lessons (so you don't relearn them)

Six versions were tried:
1. **Traced Wikimedia silhouette** (`File:Dragon_silhouette_2.svg`) — a rearing heraldic
   full-body dragon. Read as a goofy "dancing" emblem in situ; a fresh sweep of
   Wikimedia/free-SVG hosts found only more of the same pose family (emblems, tribal logos).
2. **Hand-drawn AWAKE dragon** (S-neck, horned head, fire-lit open maw, glowing slit eye looming
   over the hoard). Technically fine, but the user judged it still not good and asked for the
   dragon to recede: *background shape, sleeping, maybe not even the head*.
3. **Hand-drawn SLEEPING silhouette, fully headless** — ridge + spine sawteeth + wing fin +
   barbed tail. The user liked the direction but couldn't tell front from back, and the tall
   wing fin read as "a tree": an abstract silhouette has no orientation anchor.
4. **Sleeping silhouette + head resting on a forepaw at the dark left corner** — anatomically
   right, but dark-on-dark: in front of the body there is no contrast, so the head stayed
   near-invisible and the silhouette still confused.
5. **Hand-drawn curled pose, head resting on its own back** — head + horns broke the ridge line
   against the haze (contrast solved), but the hand-drawn anatomy still didn't convince
   ("you just moved the head — redo the entire dragon").
6. **TRACED curled-up sleeping dragon** (current) — a fresh multi-host sweep specifically for
   *sleeping/curled* references (not generic "dragon") found pngimg `dragon_PNG1603`: tail loop
   + folded wing peaks + spiked ridge + resting head, all ON the outer contour. Traced, sunk
   belly-deep into the gold, glow pockets keyed to the anatomy. Hand-drawing the dragon BODY is
   the approach that failed five times — don't go back to it; swap the REFERENCE instead.
   6a. **The flat-fill trap** — the first traced version still got "now the dragon is just a
   weird blob": a single dark fill cannot carry an 880px shape. Fixed (blind-judge-verified,
   three rounds, blob-risk 7→2) by the layer stack in §4: continuous rim-light strokes,
   posterised tone bands from the reference's own shading, a small MEASURED head graft
   (muzzle + one curved horn + warm closed-eye crescent — detail-level hand-drawing on a
   traced base is fine; whole-anatomy hand-drawing is what fails), and belly underglow.

Candidate-sweep lessons (so the next sweep is cheap): the freesvg CC0 line-art sleeping dragon
and every coloring-page candidate silhouette to a BLOB (head/legs inside the outline — test
candidates by filling the outer contour black before committing); photo/mural sources (e.g. the
Syrau sleeping-dragon mural, hue-masked) fragment too much for a clean trace; head-grafting two
references never produced a clean seam.

Silhouette lessons (paid for in iterations):
- Concave membrane edges read as "wing"; symmetric/convex masses read as mountains.
- Interior detail strokes (wing ribs) read as cracks at silhouette contrast — leave silhouettes
  empty and let glow pockets + rims do the separating.
- Smoke as thin strokes reads as a hanging wire; smoke as soft circles reads as bokeh blobs.
  Static baked smoke just doesn't work — if you want breath, it has to MOVE (CSS layer).
- The clip-to-opening trick (mass exits the frame) made the hand-drawn eras feel huge; the
  traced dragon instead fits inside the opening and gets its scale from filling the cave
  behind the hoard — both work, pick per shape.
- From the awake-head era (if a head ever returns): explicit lit maw-wedge under the jaws, few
  LARGE fangs, ONE curved horn, head scaled up vs the neck, short/thin lower jaw. That code is
  in git history (`git log -- scripts/generate-dungeon-scene.cjs`, "looming" era).

The trace pipeline (`trace-dragon-reference.cjs`) is now the production path for the dragon and
the right tool whenever a scene needs a complex REAL shape (like Hogwarts was). Its `--luma` /
`--fill` / `--solid` / `--minloop` modes were added during this rebuild to handle white-page art,
line art and noisy masks — see the script header.

---

## 5b. The movers (wisp + bats): lessons

- **Front-view wings need OPPOSITE rotation signs.** The bat sprite is front-view, wings splayed
  both sides. In SVG (y-down) one positive `rotate()` lifts the LEFT wing tip but DROPS the right
  — the original same-sign version visibly **see-sawed** ("the wings seem weird") instead of
  flapping. `spriteUri()` now rotates wing 0 by `+flapDeg`, wing 1 by `-flapDeg`. Hedwig in
  `hpFlyers.ts` is the contrasting case: SIDE-PROFILE, both wings point the same direction, so
  same-sign is correct there. Check the sprite's viewpoint before copying flap code.
- **Pose table: cos, not sin.** `sin(2πi/6)` over 6 frames gives 0, ±.87a, ±.87a, 0 — never the
  full amplitude, and each extreme holds two frames (stuttery). `cos(2πi/6)` sweeps a, .5a, −.5a,
  −a, −.5a, .5a — full range, no holds.
- **Pace the bats as BACKGROUND, not as a show.** "They are just background and should not be
  distracting": crossings take 20–30s / 24–34s (`STYLES` — the original 11–20s read as too fast),
  the per-waypoint vertical wander is ±11 (±17 zigzagged), and the next flight starts 38–80s
  after the previous one (`nextAt` in `createDriver`) so a bat is the exception, not the rule.
- **Bob the body with the wingbeat — SUBTLY.** A bat gliding on spline rails with animated wings
  reads as decorative. `batPos()` adds `0.4 · cos(phase)` vh to y (phase = wingbeat cycle; body
  highest just after the downstroke). Clamped into the air band, so the band tests still hold.
  ±1.1 read as bouncing ("the bats move a bit too much") — keep the amplitude well under 0.5.
- **Wisp = orb, FULL STOP.** Two flame-lick attempts both failed: a 24px spike above the orb read
  as "a beam on top", and a shorter lick INSIDE the halo was still called a beam. The wisp is
  halo + bright core only — no directional feature above it (a unit test asserts no `<path>` in
  the sprite).
- **The CSS fallbacks are HAND-maintained.** `--write-css` only replaces the SCENE layer (the
  `width='1600'` URI). The parked no-JS fallback sprites for `--dnd-img0/1/2` in `themes.css`
  must be edited by hand to match `spriteUri(layer, false, 0)` exactly — verify with a tsx
  parity script (pattern: `/tmp/claude/dragon-refs/creatures-preview.ts` — decodes the themes.css
  URIs, compares to runtime output, AND renders a 6× sprite sheet of flap poses via sharp so you
  can judge the flap visually without a browser).
- **Live-verifying movers:** sample `--dnd-bgpos`/`--dnd-img1` from `documentElement.style` in a
  Playwright `evaluate` loop (proves motion + both rotation signs numerically), and for a visual,
  hide `#root` (opacity 0), wait until the bat's x is mid-screen, screenshot + sharp-crop at the
  sampled %-position (background-position % maps to `(viewport − sprite) · x/100`).

---

## 6. Ideas to push the design further (your brief)

Roughly ordered easy → ambitious:

- **Breathing (the natural next step for a sleeping dragon).** The baked SVG can't self-animate,
  but the torch-flicker overlay (Hard rule 6) proves vw-mapped CSS overlays track the scene: a
  soft dark ellipse over the ridge whose `opacity`/`transform` pulses on a slow (6–8s) cycle
  would read as the flank rising and falling. Gate it under `prefers-reduced-motion` like the
  flicker. Animated smoke puffs above the wing (slow rise + fade keyframes) would also work
  where static smoke failed.
- **Atmosphere depth:** drifting dust motes in the torch pools; a faint dripping-water glint.
- **Parchment cards:** torn/burnt edges, a wax seal, a faint ink-bleed texture, a corner curl.
- **More movers:** a peering kobold/rat at the floor (eyes glinting from the rubble), the wisp
  casting a faint moving glow on nearby stone (extra JS layer).
- **Sound/music** already seeded (`local-assets/background-music/dnd/`).

Whatever you change: **preview → judge (zoomed AND small) → bake → restart vite → verify live at
all 4 breakpoints**, update the D&D design-notes in [`themes.md`](themes.md), keep the contrast
table honest, and run `npm run test:related -- src/utils/dndCreatures.ts` if you touch the engine.

---

## 7. Quick checklist before you call it done
- [ ] `node scripts/generate-dungeon-scene.cjs --write-css` baked the latest scene
- [ ] `themes.css` braces balanced, no stray markers, `data-theme="dnd"` block intact
- [ ] Vite RESTARTED after the bake (sandbox watcher misses the write)
- [ ] Live at 375 / 768 / 1024 / 1920 — scene blends (no top seam), parchment cards + house
      accents render, torch flicker sits ON the baked flames, wisp/bats move, reduced-motion parks them
- [ ] `npm run test:related -- src/utils/dndCreatures.ts src/entries/frontend.tsx` green
- [ ] WCAG AA contrast still holds (table in `themes.md`)
- [ ] `themes.md` D&D design-notes updated to match what you built
