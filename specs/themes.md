# Spec: Theme System

## Goal

Provide switchable visual themes for the gameshow app, allowing different colors, styles, fonts, border-radius, glass effects, and animations — while the DOM stays identical. Admin and frontend (gameshow) themes are independent.

## Acceptance criteria

- [x] At least 5 themes: Galaxia (default), Harry Potter, D&D, Tiefsee, Enterprise
- [x] Retro theme — 8-bit pixel optic, NES palette, immersive CRT atmosphere (scanlines, pixel stars, phosphor glow, vignette + scan sweep)
- [x] Minecraft theme — blocky Überwelt, sky-blue daylight background with drifting cubic clouds, pixel-art grass-and-dirt block horizon, pixel sun, inventory-slot panels, VT323 font (frontend-scoped immersion)
- [x] Classical Music theme — Notenblatt & Konzertsaal, warm parchment background with faint repeating five-line musical staff, large treble-clef watermark, soft aged-paper vignette, parchment-sheet panels, Cinzel serif (frontend-scoped immersion, fully static)
- [x] Modern Music theme — Neon & DJ-Booth, near-black background with neon-pink + cyan + lime accents, animated equalizer bar silhouette at the floor, concentric sound-wave rings + corner glow, dark-club glass panels, DM Sans 800 uppercase (frontend-scoped immersion)
- [x] Filme theme — Kino & roter Teppich, near-black/crimson background with Hollywood-gold accents, film-strip perforated edges, warm searchlight beams rising from the bottom corners, vignette + faint film grain, dark-warm glass panels, Oswald condensed font (frontend-scoped immersion)
- [x] Tiefsee theme — Biolumineszenz & Lichtstrahlen, deep-ocean teal background with caustic light rays slanting down from the surface and drifting bioluminescent plankton, frosted-glass panels, aqua accent, Inter font (frontend-scoped immersion)
- [x] Themes change colors, gradients, fonts, border-radius, glass opacity, button styles, and animations
- [x] Immersive themes (Harry Potter, D&D) have unique background effects. **Harry Potter — Große Halle bei Nacht (Great Hall at night):** layered night-sky body gradient + warm candlelight floor pool, a static enchanted starry ceiling with a pale **moon**, a recognizable **Hogwarts castle scene** sitting low and **off-centre** on the horizon — the **real Hogwarts, vectorised from the classic reference** (moonlit, with lit gold windows incl. the covered-bridge strip) on a **craggy cliff**, the moon balancing it from the upper-left and the cliff under the castle **continuing as one connected craggy massif** painted in the cliff's own two tones + faceting (so the extended mountain and the cliff read as the **same rock**, not two art styles), **aged-parchment "spell scroll" content cards with dark-ink text**, house-color team accents (Gryffindor crimson / Slytherin green), and a dark night-sky score header. The ceiling + castle scene are static; subtle "second-look" easter eggs animate over them (a Snitch roaming the whole screen, occasional sky visitors — Hedwig, a broomstick rider, a dragon, a shooting star — a lake squid, flickering boat lanterns, blinking forest eyes), all motion-gated under `prefers-reduced-motion`. **D&D — Drachenhort (dragon's lair):** you look through a torchlit **stone archway** into the dark depths where a **dragon** looms — a **fierce Western dragon, vectorised** from a public-domain Wikimedia Commons reference and recoloured near-black against a faint ember-haze, with a **glowing reptilian slit eye** — a **treasure hoard** glints on the flagstone floor, two wall torches flicker. **Aged-parchment "spell scroll" content cards with dark-ink text**, Red-Dragon / Blue-Dragon team accents, a dark-stone score header, and JS-driven "second-look" easter eggs (a roaming **will-o'-wisp** + occasional **bats** with beating wings) plus a torch-flicker glow and rising embers — all motion-gated under `prefers-reduced-motion`. The scene is baked by [`scripts/generate-dungeon-scene.cjs`](../scripts/generate-dungeon-scene.cjs) (dragon traced by [`scripts/trace-dragon-reference.cjs`](../scripts/trace-dragon-reference.cjs)); the movers by [`src/utils/dndCreatures.ts`](../src/utils/dndCreatures.ts)
- [x] DOM structure is unchanged — only CSS custom properties differ
- [x] Frontend and admin themes are independent (separate selectors, separate localStorage keys)
- [x] The **Admin** selector exposes only a curated subset — `galaxia` (Galaxia), `deepsea` (Tiefsee), `enterprise` (Enterprise). The **Gameshow** selector still exposes all 10 themes. A saved admin theme outside the subset (e.g. a legacy `harry-potter`) falls back to `galaxia` on load and `setAdminTheme` rejects non-subset ids
- [x] Theme persists across page reloads via localStorage
- [x] Cross-tab sync: changing theme in one tab updates others
- [x] Smooth transition animation when switching themes
- [x] Theme selector UI in admin Config tab (two selectors: Gameshow + Admin)
- [x] All themes pass WCAG AA contrast requirements (see Accessibility section)
- [x] Enterprise theme: no animations, no glow, sharp corners, professional look
- [x] All 1020 tests pass with ThemeProvider wired in
- [x] Responsive at 375px, 768px, 1024px, 1920px

## Accessibility — contrast requirements

All themes MUST meet **WCAG 2.1 AA** contrast ratios:

| Pair | Minimum ratio | Notes |
|------|--------------|-------|
| Primary text on background | **4.5:1** | Normal body text |
| Secondary text (70% opacity) on background | **3.0:1** | Used for labels, subtitles (large text context) |
| Muted text (50% opacity) on background | **3.0:1** | Hint/decorative text (large text context) |
| Button text on accent button | **3.0:1** | Buttons are large text (≥18px or ≥14px bold) |
| Success text on background | **4.5:1** | Answer reveals — shown at readable size |
| Error text on background | **4.5:1** | Timer warnings — shown at readable size |
| Gold/highlight text on background | **3.0:1** | Winner displays, quizjagd labels (large text) |
| Primary text on glass card | **4.5:1** | White text on glass overlay panels |

**Audit results (post-fix):**

| Pair | Galaxia | Harry Potter | D&D | Enterprise | Retro | Filme | Tiefsee |
|------|---------|-------------|-----|------------|-------|------------|---------|
| Text on bg | 7.4:1 | 14.7:1 | 13.4:1 | 14.9:1 | 17.1:1 | 16.9:1 | 12.7:1 |
| Secondary on bg | 4.6:1 | 9.1:1 | 9.1:1 | 8.6:1 | 8.8:1 | 8.5:1 | 7.5:1 |
| Button text on accent | 5.1:1 | 4.7:1 | 6.7:1 | 5.2:1 | 4.2:1 | 8.4:1 | 8.2:1 |
| Success on bg | 5.3:1 | 5.4:1 † | 11.3:1 | 9.3:1 | 7.3:1 | 10.2:1 | 9.2:1 |
| Error on bg | 3.9:1 | 5.5:1 † | 6.4:1 | 5.9:1 | 4.8:1 | 6.3:1 | 5.6:1 |
| Text on glass card | 5.2:1 | 11.8:1 † | 10.0:1 | 9.3:1 | 19.3:1 | 16.8:1 | 8.8:1 |

† **Harry Potter** content cards are opaque **cream parchment** (not translucent glass), so card content uses dark ink instead of light text. The marked rows are measured as the in-card colour on the cream parchment surface (`--card-text` #2a1c08, `--card-success` #1a5c39, `--card-error` #9e1b15, `--card-gold` #6b4f08, `--card-heading-*` burgundy→bronze — all ≥ 4.5:1 on parchment). The unmarked rows (Text/Secondary on bg, Button text on accent) are the warm-parchment text + gold buttons on the **dark night-sky** background, unchanged.

‡ **D&D** content cards are now opaque cream **parchment** too (the immersive redesign — "spell scrolls"), so in-card text uses the same dark-ink `--card-*` family as Harry Potter (`--card-text` #2a1c08, `--card-success` #1a5c39, `--card-error` #9e1b15, `--card-gold` #6b4f08, `--card-heading-*` crimson→bronze — all ≥ 4.5:1 on parchment). The Text/Secondary/Button rows are the warm text + blood-red/gold buttons on the **dark lair** background (now `#070504`→`#15110a`, so those ratios are unchanged or slightly higher).

**When adding a new theme:** run the contrast audit script and verify all pairs meet the minimums before merging.

### Harry Potter theme — design notes

- **Font:** `Cinzel` (already preloaded), classical serif for every element. Fallback `'Georgia', serif`.
- **Concept:** *Große Halle bei Nacht* — the Hogwarts Great Hall under its enchanted ceiling at night, with the castle on the horizon and content presented on aged-parchment "spell scrolls".
- **Palette:** deep purple-maroon night sky (`#0c0820` → `#1c0b2e` → `#2a0e3a` → `#1a0820`), warm parchment text on the dark sky (`#f5e6d0`), gold heading gradient (`#ffd700` → `#c9a227`), gold accent buttons (dark text), deep-burgundy secondary, emerald success, scarlet error.
- **Atmosphere stack (immersive, body + ::before / ::after — no DOM changes; renders on `html` in-app and on `.theme-preview-panel` in the showcase):**
  - **`body` background** — layered vertical night-sky gradient + a warm candlelight pool at the floor (`radial-gradient … rgba(201,162,39,0.10)`), `background-attachment: fixed`. `--bg-animate: none`.
  - **`::before`** — the **enchanted ceiling**: a **pale moon** (disc + soft halo, **upper-left at `13% 15%`** to balance the right-side castle in the `::after` scene; the `15%` keeps it clear of the sticky score [`Header`](../src/components/layout/Header.tsx) (~60–100px) that renders during games, so the moon is never hidden behind it) **+** a golden/white star field **+** soft magical haze. **Fully static** (no animation, no global `background-size`: a global size override would stretch per-layer gradients into full-viewport washes — that previously turned the top of the page light/low-contrast). *(Floating Great-Hall candle glows were tried here but removed — they read as stray warm dots competing with the lanterns, not as candles.)*
  - **`::after`** — a **single inline-SVG** Hogwarts-night scene spanning the full width (sized `100% auto`, anchored `center bottom`), so it renders as a band low in the viewport (castle in roughly the bottom third, night sky above). The castle is the **REAL Hogwarts**, *vectorised from the classic blue reference* (pa-Hogwarts.png) rather than hand-drawn from primitives — a flat geometric silhouette of generic towers never read as Hogwarts no matter how it was tweaked, so the actual castle's intricate massing is traced instead. [`scripts/trace-hogwarts-reference.cjs`](../scripts/trace-hogwarts-reference.cjs) classifies the reference's flat colours (its own **shadow** vs **highlight** shading + **gold** windows), extracts clean contours via marching-squares + Douglas-Peucker, and writes [`scripts/hogwarts-traced.json`](../scripts/hogwarts-traced.json) (two shading paths + a gold path). [`scripts/generate-hogwarts-scene.cjs`](../scripts/generate-hogwarts-scene.cjs) recolours those to the theme (moonlit so they read against the dark sky) and composes the scene. **Placement (the key to avoiding hard edges):** the traced block's *left* edge is a natural craggy slope, but its *right* edge is a hard vertical image crop. A hill drawn over that crop only re-creates a wall (the crop is tall + narrow). So the castle keeps its **authentic orientation** (never mirrored) and is **pushed right until the crop lands exactly on the right viewBox edge (`x=1600`)** — there it reads as "the cliff continues off-frame", never as a wall, and only the natural slope is on-screen. That makes the castle **off-centre (right)**. The cliff under the castle then **continues as ONE connected mountain**: a Catmull-Rom ridge (`openCurve` + `massPath`) rises on the right to meet the castle's left toe (~`x=1027, y≈289` at the bake scale) and sweeps down-left as a craggy massif with foothills + a Forbidden-Forest fir line — not a separate ground band. So it reads as a single landmass, Hogwarts on its right summit. The ridge is kept **tall** (crest up in the lighter mid-sky) and spans the **full width** so the filled mass reads down to the bottom edge on every aspect ratio — a low ridge sat entirely in the dark lower gradient and the bottom looked empty. The mountain has the cliff's two-tone craggy structure (a `massPath` base + a `crestBand` lit crest, **each emitted as a real `<path d=…>`** — emitting the path *data* as a text child of `<g>` is invalid SVG and renders nothing, which is the bug that made the ground silently disappear for several iterations). It uses its **own MOONLIT tones** (`mtnBase` `#322c60` + a lighter `#4d4578` crest) — a hair lighter than the castle's dark cliff (`#2c2658`/`#473f6f`) so it reads against the dark sky yet still joins the cliff as one landmass. A **cool moonlight pool** (a `radial-gradient` layered as the FIRST `::after` background layer, i.e. ON TOP of the SVG) brightens the bottom-left, where the warm horizon glow doesn't reach (the moon is upper-left, so this is also physically consistent). The middle stays calm (content sits there). Re-run `generate-hogwarts-scene.cjs --write-css` to regenerate the baked data-URI; re-run the tracer (needs the reference PNG) to re-vectorise. (The script's preview gradient deliberately stays **dark at the bottom** to match the real body gradient — an over-light preview hides exactly this low terrain.) The `max-width: 576px` query switches to `auto 30vh` anchored **`right bottom`** so phones show the castle at a usable size. **History:** before tracing, many hand-drawn attempts (flat tower rows, a humped cliff that floated buildings, a "generic fortress", an atmosphere pass whose bloom/mist/mountains read as artefacts) all failed to look like Hogwarts — primitive silhouettes can't capture the real castle's form. Vectorising fixed recognizability; a first composed pass then centred the castle and hid the crop behind a same-tone ground hill + a **craggy talus slope**, but that slope was a sharp triangular peak and the slope-vs-castle boundary was a hard vertical wall (the lighter cliff face ended on the crop line) — so the talus was dropped in favour of pushing the crop off the frame edge. A second pass used low rolling hills, but those were too dark/low to read against the real (dark-bottomed) page gradient, leaving the forest looking like it floated — fixed by making the terrain one substantial mountain continuous with the cliff. The mountain first reused the cliff's own dark tones, but those stayed invisible on the unlit far left (the bottom still looked empty there on wide/short windows) — so it was given its own lighter moonlit tones + a left moonlight pool. **The real culprit, though, was an SVG bug:** the ground/crest path data had been emitted as a text child of `<g fill=…>` instead of a `<path d=…>`, so the terrain never actually rendered at all — every "mountain" seen until then was just the castle's own traced cliff, and all the tone/height tweaks were no-ops. Wrapping the path data in real `<path>` elements fixed it; the mass now fills the bottom edge-to-edge on every aspect ratio.
- **Content panels** (`.quiz-container`, `.rules-container`, `.winner-announcement`, `.name-form`, `.team`, `.gamemaster-card`, `.bandle-track`, `.statement`, inputs): **aged-parchment scrolls** — opaque cream gradient (`#f3e6c9` → `#dcc596`) with a faint vertical grain, 2px gold border + inset gold ring, `--card-backdrop-blur: 0`. Set via the standard `--card-*` / `--input-*` surface variables. Because the cards are **light** while the theme background is **dark**, in-card text uses the **`--card-text*` family** (see *Surface variables* → *In-card text*) so it renders as dark ink instead of the light page text.
- **House-color team accents:** `#team1` / `#team2` get an inset 3px ring from `--team1-house` (Gryffindor crimson `#7f0909`) / `--team2-house` (Slytherin green `#1a472a`); defaults to transparent on other themes.
- **Sticky header:** the bright parchment cards would clash with a translucent header letting the busy atmosphere bleed through, so Harry Potter swaps in a dark night-sky banner via `--header-bg` (`rgba(18,8,28,0.86)`) + gold separator + `--header-blur: 14px`. The header-vars isolation `:not()` chain is extended with `harry-potter`.
- **Easter eggs (JS-driven, truly random):** the baked `::after` scene SVG can't self-animate (it's a `background-image` data-URI), and a CSS `@keyframes` animation can only loop **one fixed path identically** — so the moving easter eggs are layered as **extra `background-image` layers on `html::after`** and driven from JS for **per-flight randomness** (never the same flight twice). [`src/utils/hpFlyers.ts`](../src/utils/hpFlyers.ts) runs a `requestAnimationFrame` loop that composes the live 9-layer `background-position` and writes it to the **`--hp-bgpos`** custom property, which `themes.css` reads via `background-position: var(--hp-bgpos, <parked fallback>)`. It is **installed once from [`src/entries/frontend.tsx`](../src/entries/frontend.tsx)** (`installHpFlyers()`) and **self-gates**: it only runs while `data-theme="harry-potter"` is on `<html>` (`MutationObserver`), the viewport is wider than 576px, and `prefers-reduced-motion` is *not* set — otherwise it removes `--hp-bgpos` so the CSS fallback (everything parked, a static Snitch glint) applies. The cast:
  - **Golden Snitch** — a tiny, low-opacity gold ball + wings that **roams the upper sky continuously** (a slow random wander with occasional near-stationary **hovers**). It paints *behind* the centred content card (`::after` is `z-index: 0`), so it peeks out around the card's edges — sneaky by design.
  - **Sky visitors** — a snowy owl **(Hedwig)**, a **broomstick rider** and a distant **dragon** (slower), plus a quick faint **shooting star**. Every flight is **fully random and never repeats**: random direction (L→R or R→L), random entry/exit, a **varied vertical path** (a random walk that may climb, dive or skim) and a **gently varying speed** (a small, smooth ease up/down — never a rush; it's a background gimmick), random duration, and the next flight begins **30–60s (random) after the previous one starts** — so a flyer appears roughly once every 30–60s, parked off-screen in between. They may fly **anywhere in the sky above the terrain — including up through and above the question banner** (with content opaque, "through" reads as passing behind it); there is intentionally **no ceiling**, only a **floor** (`Y ≤ 61%`) that keeps them above the mountains / Hogwarts / lake skyline. **Only ONE flyer is airborne at a time** (the three share a single serialised slot), so they never bunch up.
    - **Depth (atmospheric perspective):** the flyers read at different distances — **Hedwig nearest, broom mid, dragon farthest**. Nearer = bigger (`background-size` in `themes.css`), more opaque (`FLY_OPACITY` baked into the JS sprite) and a touch faster; farther = smaller, hazier (the dragon fades to ~0.62 opacity) and slower (`STYLES` durations). The dragon's moonlit edge strokes keep it legible even when faint.
    - **Facing / mirroring:** each sprite has a fixed natural facing (the owl looks right; the broom rider + dragon look left — `FACE_RIGHT` in `hpFlyers.ts`). When a flight travels *against* that facing, the driver swaps in a **horizontally-mirrored sprite** (a `scale(-1,1)` variant) via the per-layer **`--hp-img5/6/7`** custom properties — set once at flight start while the flyer is off-screen — so the image always faces its travel direction (never flies backwards). The baked URLs in `themes.css` are wrapped as `var(--hp-img5, <url>)` etc.; the baked URL is the no-JS fallback and must match the "normal" sprite in `hpFlyers.ts` (which is the source of truth for the mirrored variants).
    - **Wing flap:** **Hedwig and the dragon beat their wings** (the broom rider has none). Each sprite is split into a static body + one-or-more wing parts, each rotated about **its own root**. Hedwig has **two wings** (so both tips beat up/down *in unison* — rotating one shared group around a central pivot read as a rigid tilt, not a flap); the dragon has one bat-wing. While airborne the driver rotates the wing(s) through a small set of **cached poses** (`FLAP` config — Hedwig a quicker beat, the dragon a slow majestic one), re-setting `--hp-img{5,7}` only when the pose index changes. Cycling a *fixed* set of poses means each data-URI decodes once and is then reused, so it stays flicker-free (a continuous angle would mint a new URI every frame). SVG/SMIL animation inside a `background-image` data-URI doesn't run, which is why the flap is driven this way.
  - **Giant Squid (kraken)** — surfaces on the lake, glides left just under the surface, then dives smoothly out of frame (same signed-off shape; now triggered at random intervals).
  - **Boat lanterns** (`body::before`) — three warm halos at the lake waterline, flickering lightly in unison (`hpLanternFlicker`, still pure CSS).
  - **Forbidden-forest eyes** (`body::after`) — a faint amber pair in the treeline that stays **hidden most of the time**, appears for a stretch with a single slow blink, then slips back into the dark (`hpForestBlink`, still pure CSS).
  - **Sprite design** matters at render size: the owl is unmistakably an owl, **not** the Snitch (distinct round head + beak + fanned tail vs. ball-with-two-wings); the dragon is a horned head + serpentine body + **webbed bat-wing** (fanned finger struts) + barbed tail; the rider is a hunched cloaked figure on a broomstick with billowing cloak. Medium moonlit tones + moonlit edge strokes keep the dark-toned visitors visible against the night sky.
  - **Natural motion:** flight paths are **Catmull-Rom splines** sampled each frame, so the motion curves smoothly (no robotic straight segments); a per-flight speed warp adds gentle acceleration/deceleration. The horizontal direction stays monotonic across a single flight (so the facing/mirroring is decided once and never looks backwards). The sprite data-URIs + `background-size` stay baked in `themes.css`; only the *positions* (and the mirrored sprite swap) are JS-driven. The pure path/band/mirror helpers are unit-tested ([`tests/unit/utils/hpFlyers.test.ts`](../tests/unit/utils/hpFlyers.test.ts)), including that flyers are serialised and stay above the floor.
- **Responsive simplification:** `@media (max-width: 576px)` switches the castle scene from a full-width band (`100% auto`) to a height-based `auto 30vh` anchored `right bottom` so phones keep the castle at a usable size; the star ceiling stays as-is. On phones the JS driver **doesn't run** (the >576px gate), so `--hp-bgpos` is unset and the phone `::after` rule parks every mover off-screen with only a static Snitch glint top-right; the lantern/eye overlays are hidden (the phone scene crops the boats + forest off anyway).
- **Reduced motion:** the **ceiling** (moon + stars + haze) and the **scene SVG** are static regardless. The JS flyer driver checks `prefers-reduced-motion` and **does not run** when reduced motion is requested → the parked CSS fallback applies (static scene + a steady Snitch glint). The lantern/eye overlays are gated under `@media (prefers-reduced-motion: no-preference)` so they too stay still. (In the `/theme-showcase` preview the atmosphere renders on a nested `.theme-preview-panel`, not `<html>`, so the JS driver — which targets `<html>` — leaves the preview's flyers in the static parked state.)
- **Frontend-scoped immersion:** the immersive layers apply to whichever element carries `data-theme="harry-potter"`. Harry Potter is **not** an admin theme (admin picker = galaxia/deepsea/enterprise only), so the parchment surfaces + atmosphere never reach the admin CMS.
- **Background music:** `local-assets/background-music/harry-potter/` (already seeded).

### D&D theme — design notes

- **Font:** `Cinzel` (already preloaded), classical serif for every element. Fallback `'Georgia', serif`.
- **Concept:** *Drachenhort* — you look through a torchlit stone archway into a dragon's lair: the dragon looms in the dark depths, a treasure hoard glints on the flagstone floor, and content sits on aged-parchment "spell scrolls".
- **Palette:** dungeon stone-dark background (`#070504` → `#15110a` — matches the baked scene's ceiling fade so the band blends in), warm parchment page text (`#e8e0d4`), goldenrod heading gradient (`#daa520` → `#b8860b`), blood-red accent buttons (`#8b0000` → `#b22222`), dark-forest primary, emerald success, fiery-orange error, treasure-gold highlight.
- **Atmosphere stack (immersive, body + ::before / ::after — no DOM changes; renders on `html` in-app; disabled inside `.theme-preview-panel` because the overlays are viewport-fixed):**
  - **`::before`** (z-index 0) — a faint static ambient (warm floor glow + a dark top wash) so the void above the scene band never reads flat.
  - **`::after`** (z-index 0, behind content) — the baked **dungeon scene** (a single inline-SVG sized `100% auto`, anchored `center bottom`, so it reads as a band low in the viewport that blends into the dark body gradient above) PLUS the JS-driven **mover layers** (will-o'-wisp + two bats) composited on top via `background-position: var(--dnd-bgpos, …)` + `var(--dnd-img1/2, …)`. Layers: `0 wisp · 1 bat · 2 bat · 3 scene`.
  - **`body::before`** (z-index 1, above the scene, below content) — animated **torch flicker**: a warm pulsing glow over each baked sconce on the arch pillars (≈ 20.6% / 79.4% across, ≈ 27vw up), `dndTorch` 4.5s.
  - **`body::after`** (z-index 1) — **embers** drifting up from the two torches (`dndEmberRise` 5.5s).
- **The scene (baked, FLAT vector):** the **stone archway** = full-rect-minus-round-arch (even-odd) over a dark depth gradient, with mortared blockwork courses, arch voussoirs and a torch-lit reveal edge; a **wall torch** on each inner pillar face (bracket + wrapped handle + bowl + baked flame + soft baked glow); a **flagstone floor** with perspective joints; a **treasure hoard** (gold pile + open chest + gems + sparkles) on the opening floor; and the **dragon** — a fierce Western dragon vectorised by [`scripts/trace-dragon-reference.cjs`](../scripts/trace-dragon-reference.cjs) into [`scripts/dragon-traced.json`](../scripts/dragon-traced.json) (a clean even-odd silhouette) from a public-domain Wikimedia Commons reference (`File:Dragon_silhouette_2.svg`), recoloured near-black with a faint torch-lit rim, silhouetted against a warm ember-haze, with a single glowing reptilian **slit eye** on its snarling head. Like the Hogwarts scene it is **flat vector + SVG gradients only — no SVG filters** (so the `sharp` preview matches the browser) and **deterministic** (`mulberry32`, no clock/random). Re-bake with `node scripts/generate-dungeon-scene.cjs --write-css`; preview with `node scripts/generate-dungeon-scene.cjs` (PNG to `$TMPDIR`).
- **Content panels** (`.quiz-container`, `.rules-container`, `.winner-announcement`, `.name-form`, `.team`, `.gamemaster-card`, `.bandle-track`, `.statement`, inputs): **aged-parchment spell scrolls** — opaque cream gradient with a faint vertical grain, 2px gold border + inset gold ring, `--card-backdrop-blur: 0`. In-card text uses the dark-ink `--card-text*` family (cards are light on the dark lair). Set via the standard `--card-*` / `--input-*` surface vars; the cross-theme isolation `:not()` chains are extended to also exclude `dnd`.
- **Team "house" accents:** `#team1` / `#team2` get an inset ring from `--team1-house` (Red-Dragon crimson `#7a1220`) / `--team2-house` (Blue-Dragon steel `#1f3b52`).
- **Sticky header:** opaque dark-stone banner via `--header-bg` (`rgba(14,10,6,0.9)`) + `--header-blur: 12px`, so the parchment cards don't clash with the busy lair bleeding through. The header isolation `:not()` chain is extended with `dnd`.
- **Easter eggs (JS-driven, truly random):** [`src/utils/dndCreatures.ts`](../src/utils/dndCreatures.ts) (mirrors `hpFlyers.ts`) runs a `requestAnimationFrame` loop composing the live 4-layer `background-position` into `--dnd-bgpos` (and swaps mirrored bat sprites via `--dnd-img1/2`). Installed once from [`src/entries/frontend.tsx`](../src/entries/frontend.tsx) (`installDndCreatures()`); **self-gates** on `data-theme="dnd"` + viewport > 576px + no reduced-motion. The cast: a **will-o'-wisp** (teal flame-spirit roaming the lair air continuously, with the occasional hover — the Snitch analogue) and **two bats** (dark, beating wings via cached flap poses, each taking independent randomised flights — never the same flight twice — mirrored to face their travel direction). The dragon's eyes are **steady** (baked) so it watches from behind the content card. The pure path/warp/sprite helpers are unit-tested ([`tests/unit/utils/dndCreatures.test.ts`](../tests/unit/utils/dndCreatures.test.ts)).
- **Responsive:** the scene stays `100% auto` at all sizes. `@media (max-width: 1024px)` drops the embers (GPU); `@media (max-width: 576px)` drops the flicker + ember overlays (the JS movers are gated off below 576px too). The baked scene + parchment cards remain on phones.
- **Reduced motion:** the JS mover driver does not run (parked fallback); the torch-flicker + ember animations are gated under `@media (prefers-reduced-motion: no-preference)`. The scene + steady dragon eyes are static regardless.
- **Frontend-scoped immersion:** D&D is **not** an admin theme (admin picker = galaxia/deepsea/enterprise only), so the parchment surfaces + lair never reach the admin CMS. The atmosphere is disabled inside `.theme-preview-panel`; the showcase still shows the D&D palette + parchment cards.
- **Background music:** `local-assets/background-music/dnd/` (already seeded).

### Retro theme — design notes

- **Font:** `VT323` (Google Fonts, CRT terminal monospace) for every element — headings, buttons, body, inputs. VT323 reads cleanly at the global heading scale (`clamp(1.8em, 5vw, 3.5em)` for `h1` etc., set in `base.css`) without wrapping, so no per-theme `font-size` override is needed. Fallback: `'Courier New', monospace`. German umlauts supported. (Press Start 2P was used earlier for headings + buttons, but its wide glyphs required per-theme `font-size: clamp(...)` overrides that leaked via descendant selectors into nested `[data-theme]` panels — see *Cross-theme isolation* below.)
- **Palette:** NES classic — deep starry-night purple sky (`#04001a` → `#1a0538` vertical gradient) with `#d52b1e → #f8b500` accent (Mario red → arcade gold), `#58c043` 1-up green success, `#d52b1e` red error, `#ffd700` highlight gold, white primary text. Black text on accent buttons (contrast-safe vs. red+gold). `--bg-gradient-from/to` are kept in sync for any downstream component that reads them, but the actual body background is layered (see below).
- **Atmosphere stack (immersive, pseudo-elements + body background — no DOM changes):**
  - **`body` background** — pixel-art mountain silhouette (two-ridge SVG data-URI, near-black + dark purple) anchored at the bottom 28vh, plus a magenta/red sunset glow gradient bleeding upward 60vh, plus the vertical sky gradient. All three use `background-attachment: fixed` so the horizon stays put while content scrolls.
  - **`::before`** — fixed CRT scanlines (`repeating-linear-gradient` 2px on / 1px off) plus a subtle horizontal scan sweep band animated 8s ease-in-out.
  - **`::after`** — vignette (radial dark corners), a gold pixel "moon" disc with soft halo in the upper-right, plus ~25 pixel-stars (small `radial-gradient` dots in white / gold / green) twinkling with **stepped** keyframes (`steps(6)`) so movement reads as 8-bit, not modern.
- **Icon-button fonts:** `[data-theme="retro"] .music-controls button`, `.audio-ctrl-btn`, `.music-toggle` are forced to `font-family: 'Courier New', monospace` with `font-variant-emoji: text` because VT323 doesn't include U+25B6 ▶, U+23ED ⏭ etc., and browsers otherwise render them as system color emoji that ignore CSS `color` (rendering them dark/invisible inside the dark-fill control buttons).
- **Buttons:** sharp corners (`--radius-* : 0`), uppercase, generous letter-spacing, accent box-shadow glow. No glass blur.
- **Content panels** (quiz / rules / name-form / team / gamemaster card / image-guess / bandle / statement / winner) and inputs: retro sets `--card-bg`, `--card-border`, `--card-shadow`, `--card-backdrop-blur`, `--input-*` CSS variables (see *Surface variables* below). Every panel gets a chunky 2px arcade-gold pixel border + 1px black outer ring (faux double-pixel NES UI frame) + soft gold box-shadow with a solid `rgba(0, 0, 0, 0.78)` fill so it reads as a discrete info box against the immersive horizon. Inputs/textareas get the same treatment in subtler form.
- **Responsive simplification:**
  - `@media (max-width: 1024px)` — drop scan sweep; reduce star field to ~12 stars.
  - `@media (max-width: 576px)` — also drop vignette; keep scanlines (cheap + defining).
- **Reduced motion:** atmosphere keyframes wrapped in `@media (prefers-reduced-motion: no-preference)`; users with reduced-motion get the static themed view (scanlines + vignette only).
- **Background music:** `local-assets/background-music/retro/` seeded via the built-in admin YouTube downloader (`POST /api/backend/assets/background-music/youtube-download` with `subfolder: 'retro'`). Initial seed: `ytsearch3:nes chiptune game soundtrack` → "2.5+ Hours of Boppin NES Music.mp3". The endpoint handles MP3 extraction, −16 LUFS normalization, and NAS sync automatically.

### Minecraft theme — design notes

- **Font:** `VT323` (already preloaded for the Retro theme on `show/index.html`), applied to every element. VT323 was chosen over Press Start 2P / Silkscreen to avoid per-theme heading size overrides — the same lesson Retro banked on. Fallback: `'Courier New', monospace`. German umlauts supported.
- **Palette:** Overworld daylight — sky-blue vertical gradient (`#4a85d8` top → `#6aa0e8` → `#a5d0f8` horizon), torch-orange accent (`#b85a0e → #e88a2a`), grass-green primary/success (`#5fb932 → #3f8a1f`), redstone-red error (`#ff5a5a`), gold-block yellow highlight (`#fcee4b`), white primary text (displayed on opaque stone cards so contrast is card-bound, not sky-bound). Heading gradient runs white → gold to evoke the game logo's gold trim.
- **Atmosphere stack (immersive, pseudo-elements + body background — no DOM changes):**
  - **`body` background** — vertical sky gradient (`#4a85d8` → `#6aa0e8` → `#a5d0f8`) with `background-attachment: fixed` so the horizon stays put while content scrolls.
  - **`::before`** — repeating cubic-cloud SVG tile (three Minecraft-style flat white cloud shapes per 1200px, `shape-rendering='crispEdges'`), positioned at 22vh so clouds sit well below the sticky header, drifting horizontally via `mcCloudDrift` over 90s linear infinite.
  - **`::after`** — two static layers: a pixel square sun (flat two-tone yellow SVG with no radial blur, upper-right at `right 6vw top 10vh`, size `clamp(56px, 6vw, 96px)`) layered over a pixel-art grass-and-dirt block horizon silhouette anchored at the bottom 22vh (3vh grass strip `#5fb932` with jagged pixel-step transition into 15vh dirt band `#6b4423` with darker `#58371c` and lighter `#7a5a30` specks, plus darker grass accents scattered across the top edge). Both are two-color pixel SVG data-URIs with `shape-rendering='crispEdges'`.
- **Buttons:** sharp pixel corners (`--radius-* : 0`), uppercase, moderate letter-spacing, 3D inventory-slot bevel via multi-layer box-shadow (inner highlight top-left + inner shadow bottom-right + hard drop shadow). No glass blur. Hover adds a gold glow halo.
- **Content panels** and inputs: inventory-slot look — opaque stone-dark `rgba(60, 60, 60, 0.92)` fill, thick 3px black pixel border, 3-layer bevel box-shadow matching Minecraft's in-game UI panels. Inputs use the same black border with a gold focus ring. Set via the standard `--card-*` / `--input-*` surface variables (see *Surface variables* above); the cross-theme isolation `:not()` selector is extended to also exclude Minecraft so the vars don't leak into nested panels.
- **Responsive simplification:**
  - `@media (max-width: 1024px)` — disable the cloud drift animation; clouds + sun + grass block remain visible (GPU savings on tablets).
  - `@media (max-width: 576px)` — drop clouds entirely (`::before` cleared); sun + grass-block horizon remain on `::after`. Mobile gets the identifying silhouette without animation overhead.
- **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables cloud drift; static sky + clouds + sun + grass block remain visible.
- **Frontend-scoped immersion:** The immersive layers (`body` bg override, `::before`, `::after`) apply to whichever element carries `data-theme="minecraft"` — `html` on the frontend or `.theme-preview-panel` in the showcase. The admin shell (`.admin-shell[data-theme="minecraft"]`) receives only the palette/accent variables, not the atmosphere — so selecting Minecraft as the admin theme recolors the UI without rendering clouds/horizon inside the admin.
- **Background music:** `local-assets/background-music/minecraft/` folder is auto-created on server boot (see `server/index.ts:5351` loop over `VALID_THEMES`). Seed via the admin YouTube downloader with `subfolder: 'minecraft'` — recommended search: `ytsearch3:minecraft calm soundtrack c418`.

### Classical Music theme — design notes

- **Font:** `Cinzel` (already preloaded in `show/index.html`), classical Roman-square-capital serif, applied to every element. Reads cleanly at the global heading clamp without per-theme heading-size overrides — same lesson Retro/Minecraft banked on. Body falls back to `'DM Sans'` (also preloaded), then `Georgia`, `serif`. German umlauts supported.
- **Palette:** warm parchment vertical gradient (`#f4ecd8` → `#e8dcc0` → `#d4c39e`), wine-red accent (`#7a1a2e` → `#a8344a`), forest-green success (`#2d5a3d`), wine-red error (same family as accent — visually distinct from success), brass-gold highlight (`#b8941f`), deep-ink primary text (`#1a1428`). White text on accent buttons (≥ 5.5:1 on the wine-red gradient).
- **Atmosphere stack (immersive, pseudo-elements + body background — no DOM changes, fully static):**
  - **`body` background** — vertical parchment gradient (`#f4ecd8` → `#e8dcc0` → `#d4c39e`) with `background-attachment: fixed` so the page texture stays put while content scrolls.
  - **`::before`** — repeating five-line musical staff via `repeating-linear-gradient`: 5 thin ink lines (1px each) with 6px gaps stacked into one staff, then an 88px gap before the next staff, looping infinitely down the viewport. `background-attachment: fixed`. Low opacity (`rgba(26, 20, 40, 0.18)`) so card content stays readable.
  - **`::after`** — large treble-clef SVG watermark (single-color `#1a1428` data-URI at 6% fill-opacity), positioned `right 8vw center` at `clamp(180px, 22vw, 360px)` tall, layered over a soft aged-paper vignette (`radial-gradient` with darker warm corners).
- **Buttons:** small radius (`--radius-sm: 2px` … `--radius-xl: 6px`), uppercase, generous letter-spacing (`0.08em`), no glow, subtle wine-red box-shadow. No glass blur.
- **Content panels** and inputs: parchment-sheet look — opaque cream `rgba(244, 236, 216, 0.96)` fill, 2px wine-red border, soft shadow with brass-gold inner ring. Inputs use a translucent off-white background (`rgba(255, 250, 240, 0.85)`) with a wine-red focus ring + brass-gold focus halo. Set via the standard `--card-*` / `--input-*` surface variables; the cross-theme isolation `:not()` selector is extended to also exclude `classical-music` so the vars don't leak into nested panels.
- **Sticky header:** the default translucent glass header lets the staff-line atmosphere and scrolling content bleed through, which reads as visual noise. Classical Music swaps in a fully opaque parchment background (`#f4ecd8`) with a thin wine-red separator border via `--header-bg` / `--header-border-bottom`. The Minecraft-only header isolation reset at the end of the Minecraft block was widened to `:not([data-theme="minecraft"]):not([data-theme="classical-music"])` so the opaque header vars stay scoped to the two themes that override them.
- **No entrance animation:** Classical Music sets `--entrance-animate: none` AND `--card-entrance-animate: none`. The h1 entrance (`--entrance-animate`, consumed by `h1` in `base.css`) and the panel entrances (`--card-entrance-animate`, consumed by `.quiz-container` and `.rules-container` via `var(--card-entrance-animate, scaleIn 0.5s ease-out)`) both briefly drop content opacity to zero, which exposes the underlying staff lines during phase transitions (title → rules → game) and reads as a flicker. A static instant transition is calmer and matches the classical-music aesthetic. The `--card-entrance-animate` var is reset to `initial` on every other theme so nested showcase panels under `[data-theme="classical-music"]` still get their own entrance animations.
- **Responsive simplification:**
  - `@media (max-width: 1024px)` — scale treble clef to ~60% size; staff lines remain unchanged.
  - `@media (max-width: 576px)` — drop the treble clef entirely; `::after` keeps only the warm vignette. Staff lines remain (cheap + identifying).
- **Reduced motion:** No animations in this theme, so no `@media (prefers-reduced-motion)` block is needed — the static visual is the same for all users.
- **Frontend-scoped immersion:** The immersive layers (`body` bg override, `::before`, `::after`) apply to whichever element carries `data-theme="classical-music"` — `html` on the frontend or `.theme-preview-panel` in the showcase. The admin shell receives only the palette/accent variables, not the atmosphere.
- **Background music:** `local-assets/background-music/classical-music/` folder is auto-created on server boot (see `server/index.ts:5351` loop over `VALID_THEMES`). Seed via the admin YouTube downloader with `subfolder: 'classical-music'` — recommended search: `ytsearch3:classical music piano relaxing royalty free`.

### Modern Music theme — design notes

- **Font:** `DM Sans` (already preloaded), `font-weight: 800`, uppercase, wide letter-spacing (`0.12em` on buttons). Heavy weight + uppercase + wide tracking gives the EDM-poster feel without adding a new font load. Fallback: `system-ui`, `sans-serif`.
- **Palette:** near-black with violet hint (`#0a0a14` → `#1a0a1f`), neon-pink → cyan accent (`#ff00aa` → `#00e5ff`), neon-mint success (`#00ff88`), hot magenta-red error (`#ff3366`), lime highlight (`#aaff00` — used as the "drop accent"), bright primary text (`#f5f5ff`). **Black** text on accent buttons — neon-pink and cyan both give ≥ 7:1 contrast on black, so contrast is safe across the entire gradient.
- **Atmosphere stack (immersive, pseudo-elements + body background — no DOM changes):**
  - **`body` background** — vertical near-black gradient (`#0a0a14` → `#14091c` → `#1a0a1f`) layered with a faint diagonal scan-line texture (`repeating-linear-gradient` at 1°, 1px every 4px at 1.5% white). `background-attachment: fixed`.
  - **`::before`** — equalizer bar row at the floor: **16 individual bars**, each rendered as its own `background-image` layer (a one-stop `linear-gradient(<color>, <color>)` is the cheapest way to draw a filled rectangle). All bars share the pseudo-element but each bar's height is driven by its own registered custom property `--mm-bar-1-h` … `--mm-bar-16-h` (declared via `@property` with `<percentage>` syntax — percentages resolve against the viewport when the pseudo-element is on `html`, so a value of `9%` = 9vh tall). Each bar gets its own `@keyframes mmBarN` and its own animation declaration with a unique duration (1.1s–2.4s), unique negative delay (-0.15s to -1.5s) and unique min/max height range (3%–15%vh) — the result is **per-bar pulsing** that looks like a real chaotic audio EQ instead of every bar moving in lockstep. Bar widths are 2.6% (≈ 50px on a 1920-wide viewport); positions are evenly spaced 0% → 100% in 6.67% increments. Bars alternate neon-pink (`#ff00aa`) and cyan (`#00e5ff`).
  - **`::after`** — two layered radials: a static neon-pink corner glow at the **top-left** plus animated sound-wave rings continuously emanating from the **bottom-right** corner. The ring layer is a phase-shifted `repeating-radial-gradient` with **percentage stops**:
    ```
    0% transparent → 2.5% peak cyan → 5% transparent → 10% transparent  (period 10%)
    ```
    Each stop has `+ var(--modern-music-ring-phase)` added via `calc()`. The 5%-wide cyan halo (with smooth ramps on both sides) gives the **soft blurred glow**; the 5% transparent gap from 5%→10% prevents adjacent rings from blurring into each other. Percentage stops are essential — pixel stops are absolute in the gradient's coordinate space and would not scale with the phase shift, leaving the animation visually static.
    The registered custom property `--modern-music-ring-phase` (defined via `@property` so CSS can interpolate it as a percentage) animates `0% → 10%` linear infinite over 16s — exactly **one ring period** per cycle. Because `repeating-radial-gradient` is mathematically periodic (`f(p + period) = f(p)`), the visual at the keyframe's `to` (`phase: 10%`) is **identical** to its `from` (`phase: 0%`); the loop reset is invisible without any alpha fade. Result: rings drift outward continuously, new rings spawn at the corner, old rings leave the viewport, and after running for an hour the animation is indistinguishable from t=0. Browser support: Chrome 85+, Safari 16.4+, Firefox 128+ — older browsers fall back to the `initial-value: 0%` and just see static rings.
- **Buttons:** medium radius (`--radius-md: 8px`), uppercase, wide letter-spacing (`0.12em`), neon pink-to-cyan accent gradient. Hover adds an outer cyan glow halo + intensified pink inner glow.
- **Content panels** and inputs: dark-club glass — opaque-enough dark fill (`rgba(15, 10, 25, 0.85)`) with a 1px neon-pink border + cyan inner ring, 24px pink outer glow. Backdrop blur 12px (this theme keeps the glass aesthetic, unlike Retro/Minecraft/Classical Music which all set blur to 0). Inputs get a cyan focus ring + pink outer glow. Set via the standard `--card-*` / `--input-*` surface variables; the cross-theme isolation `:not()` selector is extended to also exclude `modern-music` so the vars don't leak into nested panels.
- **Sticky header:** the default 8px header blur let the EQ bars and sound-wave rings bleed through too aggressively. Modern Music swaps in an opaque dark fill (`rgba(15, 10, 25, 0.82)`) with a thin neon-pink separator border and a much stronger 24px blur via `--header-bg` / `--header-border-bottom` / `--header-blur`. `--header-blur` is a new var consumed by `header` in `layout.css` (`backdrop-filter: blur(var(--header-blur, var(--glass-blur)))`) — it lets the header use a different blur from the rest of the theme's `--glass-blur` without affecting other glass surfaces. The header isolation reset block was extended to `:not([data-theme="minecraft"]):not([data-theme="classical-music"]):not([data-theme="retro"]):not([data-theme="modern-music"])` so the override stays scoped.
- **Tighter top spacing on `#gameScreen`:** the EQ-bar row consumes ~15vh at the floor, so to give game content more vertical room Modern Music shrinks `#gameScreen`'s top margin via `--game-screen-margin-top: 8px`. `#gameScreen` in `game.css` reads this through `margin-top: var(--game-screen-margin-top, clamp(16px, 3vw, 40px))`, falling back to the original responsive default for every other theme. A dedicated `:not([data-theme="modern-music"])` block resets the var to `initial` so nested showcase panels don't inherit the override.
- **Responsive simplification:**
  - `@media (max-width: 1024px)` — disable both the EQ pulse and sound-wave slide animations (GPU savings on tablets); silhouette + rings + corner glow remain visible static.
  - `@media (max-width: 576px)` — drop the sound-wave rings entirely (`::after` keeps only the corner glow); EQ bar silhouette remains at the floor as the identifying element.
- **Reduced motion:** Both animations are wrapped in `@media (prefers-reduced-motion: no-preference)` so the keyframes only apply when the user has not requested reduced motion. Reduced-motion users see static silhouette + static rings + corner glow.
- **Frontend-scoped immersion:** The immersive layers (`body` bg override, `::before`, `::after`) apply to whichever element carries `data-theme="modern-music"` — `html` on the frontend or `.theme-preview-panel` in the showcase. The admin shell receives only the palette/accent variables, not the atmosphere.
- **Background music:** `local-assets/background-music/modern-music/` folder is auto-created on server boot (see `server/index.ts:5351` loop over `VALID_THEMES`). Seed via the admin YouTube downloader with `subfolder: 'modern-music'` — recommended search: `ytsearch3:edm festival mix royalty free`.

### Filme theme — design notes

- **Font:** `Oswald` (Google Fonts, condensed movie-poster / film-credits sans), applied to every element. Condensed glyphs read cleanly at the global heading clamp without per-theme size overrides — same lesson Retro/Minecraft/Classical/Modern banked on. Fallback: `'Arial Narrow', system-ui, sans-serif`. German umlauts supported. Added to the Google-Fonts `css2` link in `show/index.html`, `admin/index.html`, `gamemaster/index.html` (weights 400;500;600;700, `display=swap`).
- **Palette:** darkened-cinema red-carpet — near-black/crimson vertical gradient (`#0d0608` → `#1a0a0d` → `#0a0506`), Hollywood-gold accent (`#f5c518` → `#e0a008`), crimson-velvet primary (`#c8102e` → `#7a0a1e`, used for secondary buttons / team / bandle gradients), bright-mint success (`#5fd38a` — distinct from the warm bg), bright-red error (`#ff5a5a` — distinct from the crimson primary so error ≠ team color), gold highlight (`#f5c518`), warm-white primary text (`#f5f0e6`). **Dark** text (`#1a0a0d`) on gold accent buttons (gold is light → dark text clears ≥3:1 across the whole gradient). `--bg-gradient-from/to` are kept in sync for downstream components, but the body background is layered (see below).
- **Atmosphere stack (immersive, pseudo-elements + body background — no DOM changes):**
  - **`body` background** — vertical near-black/crimson gradient layered with a faint film-grain texture (`repeating-linear-gradient` at ~1.5% white). `background-attachment: fixed`.
  - **`::before`** — two warm-gold **searchlight beams** rising from the bottom-left and bottom-right corners (blurred `linear-gradient` light cones, `mix-blend-mode: screen`). Animated with a slow sway via `@keyframes movieSearchlights`, wrapped in `@media (prefers-reduced-motion: no-preference)`.
  - **`::after`** — **film-strip edges**: a left and a right vertical strip of sprocket-hole perforations (two `background` layers, `background-size: 40px 100%`, `background-position` left/right, `no-repeat`), layered over a soft radial **vignette** that darkens the corners.
- **Buttons:** moderate radius (`--radius-sm: 6px` … `--radius-xl: 24px`), uppercase, `0.1em` letter-spacing, gold accent gradient with a soft gold glow; hover intensifies the glow and lifts (`--hover-lift: translateY(-3px)`). Keeps glass blur (unlike Retro/Minecraft/Classical).
- **Content panels** and inputs: dark-warm glass — `rgba(26, 12, 14, 0.82)` fill, 1px gold border (`rgba(245, 197, 24, 0.45)`), soft gold outer glow + faint gold inner ring, `--card-backdrop-blur: 10px`. Inputs get a gold focus ring. Set via the standard `--card-*` / `--input-*` surface variables; the cross-theme isolation `:not()` selector is extended to also exclude `movie-quiz` so the vars don't leak into nested panels.
- **Sticky header:** the default translucent glass header would let the film strips + searchlights + scrolling content bleed through. Filme swaps in a near-opaque dark-warm fill (`rgba(15, 7, 9, 0.86)`) with a thin gold separator border and a 16px blur via `--header-bg` / `--header-border-bottom` / `--header-blur`. The opaque-header isolation reset block is extended with `:not([data-theme="movie-quiz"])` so the override stays scoped.
- **Responsive simplification:**
  - `@media (max-width: 1024px)` — disable the searchlight sway animation (keep the static beams); GPU savings on tablets.
  - `@media (max-width: 576px)` — drop the film-strip edges (`::after` keeps only the vignette); the searchlight glow + vignette remain as the identifying elements.
- **Reduced motion:** the searchlight sway is wrapped in `@media (prefers-reduced-motion: no-preference)`; reduced-motion users see static beams + film strips + vignette.
- **Frontend-scoped immersion:** the immersive layers (`body` bg override, `::before`, `::after`) apply to whichever element carries `data-theme="movie-quiz"` — `html` on the frontend or `.theme-preview-panel` in the showcase. The admin shell receives only the palette/accent variables, not the atmosphere.
- **Background music:** `local-assets/background-music/movie-quiz/` folder is auto-created on server boot (see the `VALID_THEMES` loop in `server/index.ts`). No music seeded initially — falls back to the root `background-music/` folder until MP3s are dropped in. Recommended later seed: `ytsearch3:epic movie soundtrack royalty free`.

### Tiefsee theme — design notes

- **Font:** `Inter` (already preloaded), applied to every element — clean modern sans at the global heading clamp, no per-theme size override. Fallback: `'Segoe UI', system-ui, sans-serif`.
- **Palette:** deep-ocean teal — vertical gradient (`#04303f` top → `#021a26` → `#010f17` floor), bright-aqua accent (`#22d3ee → #2dd4bf`), ocean-blue primary/secondary (`#0ea5e9 → #0284c7`), mint success (`#6ee7b7`), warm coral error (`#ff7a7a` — distinct from the cool palette), soft-gold highlight (`#ffe08a`), near-white primary text (`#e6f7fb`). **Dark** text (`#022a33`) on the bright aqua accent buttons (≥ 7:1 across the gradient). `--glass-rgb` stays white so panels are frosted-light glass over the dark water — no `--card-*`/`--header-*` overrides, so the isolation `:not()` chains are untouched.
- **Atmosphere stack (immersive, pseudo-elements + body background — no DOM changes):**
  - **`body` background** — vertical deep-ocean gradient with `background-attachment: fixed` so the water stays put while content scrolls.
  - **`::before`** — caustic light rays: three slanted, low-opacity teal/blue `linear-gradient` shafts descending from the surface, plus a faint surface glow at the top. `mix-blend-mode: screen` so the rays read as added light. A slow `deepRays` opacity breathe (12s).
  - **`::after`** — drifting bioluminescent plankton: four tiled `radial-gradient` glow dots (teal / blue / aqua, varying size) plus a darker deep-floor glow at the bottom. A slow upward `deepDrift` (30s linear) makes the plankton rise.
- **Buttons:** rounded (`--radius-xl: 50px` pill), uppercase, soft aqua glow; no glass-surface override (uses the default frosted glass).
- **Responsive simplification:**
  - `@media (max-width: 1024px)` — disable the ray breathe + plankton drift animations (GPU savings on tablets); rays + plankton remain static.
  - `@media (max-width: 576px)` — thin the plankton to a single tiled layer, keep the deep-floor glow.
- **Reduced motion:** both animations are wrapped in `@media (prefers-reduced-motion: no-preference)`; reduced-motion users get the static rays + plankton.
- **Frontend-scoped immersion:** the immersive layers apply to whichever element carries `data-theme="deepsea"` — `html` on the frontend or `.theme-preview-panel` in the showcase. The admin shell receives only the palette/accent variables, not the atmosphere.
- **Background music:** `local-assets/background-music/deepsea/` folder is auto-created on server boot (the `VALID_THEMES` loop in `server/index.ts`). No music seeded initially — falls back to the root `background-music/` folder until MP3s are dropped in.

### Cross-theme isolation — no descendant selectors that cross `[data-theme]` islands

`<html>` carries the frontend theme; nested elements (e.g. `.admin-shell` inside `.frontend`, or the `.theme-preview-panel[data-theme]` blocks in `/theme-showcase`) can carry a *different* `[data-theme]`. A descendant selector like `[data-theme="retro"] .quiz-container { background: black; }` will match every `.quiz-container` under an `html[data-theme="retro"]` root — *including* one inside a nested `[data-theme="galaxia"]` panel. That caused Retro's styling to bleed into every other theme's preview in the showcase.

**Rule:** no CSS rule in `themes.css` may use `[data-theme="<id>"] <class>` or `[data-theme="<id>"] <element>` descendant selectors for styling that differs between themes. Instead:

1. Define the theme-specific value as a CSS custom property in the theme block.
2. Reset the property to `initial` on all other themes with a single `[data-theme]:not([data-theme="<id>"])` block.
3. Consume it in the target rule with `var(--my-prop, <default>)`.

Inheritance then stops at each nested `[data-theme]` island, so each panel renders its own theme's values.

### Surface variables (`--card-*`, `--input-*`)

Retro replaces the standard glass surfaces (translucent white over the bg gradient) with opaque near-black frames. These are the vars:

| Var | Retro value | Default (fallback at consumer) |
|-----|-------------|--------------------------------|
| `--card-bg` | `rgba(0, 0, 0, 0.78)` | `rgba(var(--glass-rgb), var(--glass-opacity))` or similar, per consumer |
| `--card-border` | `2px solid var(--accent-to)` | `1px solid rgba(var(--glass-rgb), var(--glass-border-opacity))` |
| `--card-shadow` | `0 0 0 1px #000, 0 0 18px rgba(248,181,0,0.25)` | `0 8px 32px rgba(0, 0, 0, 0.2)` |
| `--card-backdrop-blur` | `0` | `var(--glass-blur-heavy)` |
| `--input-border-color` | `rgba(248, 181, 0, 0.45)` | `rgba(var(--glass-rgb), 0.3)` |
| `--input-bg` | `rgba(0, 0, 0, 0.55)` | `rgba(var(--glass-rgb), 0.1)` |
| `--input-focus-border-color` | `var(--accent-to)` | `rgba(var(--glass-rgb), 0.6)` |
| `--input-focus-bg` | `rgba(0, 0, 0, 0.7)` | `rgba(var(--glass-rgb), 0.15)` |
| `--input-focus-shadow` | `0 0 0 1px #000, 0 0 14px rgba(248,181,0,0.4)` | `0 0 20px rgba(var(--glass-rgb), 0.2)` |

Consumers (in `src/styles/game.css`, `screens.css`, `layout.css`, `gamemaster.css`, `base.css`): `.quiz-container`, `.rules-container`, `.winner-announcement`, `.name-form`, `.team`, `.gamemaster-card`, `.image-guess-container`, `.bandle-track`, `.statement`, `input`, `textarea`. Each reads the var via `var(--card-bg, <default>)` so non-retro themes get their original (theme-aware) glass-rgb styling unchanged.

### In-card text variables (`--card-text*`) — light cards on dark themes

Retro/Minecraft/etc. give cards an opaque **dark** fill, so the existing **light** card text (`--text-primary`, `rgba(var(--text-rgb), x)`, `--success`, gold) stays readable. **Harry Potter** is the opposite: opaque **cream parchment** cards on a **dark** night-sky theme — light card text would be invisible. The `--card-text*` family lets a theme override **in-card** text colour independently of the page text, **without** descendant `[data-theme] .class` selectors (which the isolation rule forbids).

| Var | Default (fallback at consumer) | HP value |
|-----|-------------------------------|----------|
| `--card-text` | `var(--text-primary)` | `#2a1c08` |
| `--card-text-rgb` | `var(--text-rgb)` | `42, 28, 8` |
| `--card-text-muted` | `var(--text-muted, …)` | `rgba(42,28,8,0.62)` |
| `--card-success` / `--card-success-rgb` | `var(--success)` / `var(--success-rgb)` | `#1a5c39` / `26,92,57` |
| `--card-error` / `--card-error-rgb` | `var(--error)` / `var(--error-rgb)` | `#9e1b15` / `158,27,21` |
| `--card-gold` / `--card-gold-rgb` | `var(--gold)` / `var(--gold-warm-rgb)` | `#6b4f08` / `107,79,8` |
| `--card-accent` | `var(--accent-from)` | `#6b1d3a` |
| `--card-heading-from` / `--card-heading-to` | `var(--text-heading-from)` / `var(--text-heading-to)` | `#6b1d3a` / `#6b4f08` |

Every in-card text declaration consumes its value as `var(--card-X, <existing light value>)`, so all other themes are byte-for-byte unchanged. Headings rendered inside cards (`.quiz-container h2/h3`, `.rules-container h1`, `.winner-announcement h1`, `.team h2`, …) consume `--card-text` / `--card-heading-*` too (base.css + screens.css). Both the `--card-text*` family **and** `--team1-house` / `--team2-house` are reset to `initial` on the same `[data-theme]:not(…):not([data-theme="harry-potter"])` isolation block as the surface vars, so nested showcase panels of other themes keep their own light card text.

## State / data changes

- No changes to `AppState` — theme is client-side only
- New React context: `ThemeContext` with `ThemeProvider`
  - `theme: ThemeId` — frontend theme (applied on `<html data-theme>`)
  - `adminTheme: ThemeId` — admin theme (applied on `.admin-shell data-theme`)
  - `setTheme(id)` / `setAdminTheme(id)` — setters. `setTheme` accepts any of the 10 `THEMES`; `setAdminTheme` accepts only the curated `ADMIN_THEME_IDS` and is a no-op otherwise
  - Exports: `THEMES` (all 10) and `ADMIN_THEMES` (the admin subset, derived from `THEMES` via `ADMIN_THEME_IDS = ['galaxia', 'deepsea', 'enterprise']`). The admin read/sync paths validate against `VALID_ADMIN_THEMES` and fall back to `DEFAULT_THEME` (`galaxia`)
- Persisted on the server at `theme-settings.json` (authoritative, shared across devices)
- Cached in localStorage for instant initial render (avoids theme flash on reload):
  - `gameshow-theme` — frontend theme
  - `gameshow-theme-admin` — admin theme
  - Cache is written on every successful fetch/save and read synchronously at mount

## UI behaviour

- **Config tab** in admin shows two theme selector cards:
  - "Theme — Gameshow" — sets the player-facing theme; shows **all 10** themes
  - "Theme — Admin" — sets the admin UI theme; shows only the **curated subset** (`galaxia`, `deepsea`, `enterprise`). The immersive themes only apply their palette in the admin (no atmosphere) and make a poor CMS work surface, so they are excluded from the admin picker
- Each card shows its available themes as clickable cards with gradient preview swatches
- Active theme is highlighted with accent border
- Switching triggers a 600ms CSS transition for smooth visual change
- Theme is per-device/browser, NOT stored in server config

## Architecture

### CSS custom properties

All visual tokens are defined in `src/styles/themes.css` as CSS custom properties on `:root` (default) and `[data-theme="<id>"]` selectors.

**Token categories:**
- **Colors:** `--bg-gradient-*`, `--glass-rgb`, `--text-*`, `--accent-*`, `--primary-*`, `--success-*`, `--error-*`, `--gold-*`, `--admin-accent-*`
- **Structural:** `--radius-sm/md/lg/xl`, `--glass-blur`, `--glass-opacity`, `--glass-border-opacity`
- **Buttons:** `--btn-text-transform`, `--btn-letter-spacing`, `--btn-font-weight`, `--btn-glow`, `--btn-glow-hover`
- **Animation:** `--bg-animate`, `--orb-animate`, `--entrance-animate`, `--hover-lift`
- **Font:** `--font-primary`
- **Surface overrides (opaque-card themes — Retro/Minecraft/Classical/Modern/Filme/Harry Potter):** `--card-bg`, `--card-border`, `--card-shadow`, `--card-backdrop-blur`, `--input-border-color`, `--input-bg`, `--input-focus-border-color`, `--input-focus-bg`, `--input-focus-shadow` — see *Surface variables* above
- **In-card text (light-card themes — Harry Potter):** `--card-text`, `--card-text-rgb`, `--card-text-muted`, `--card-success`(+`-rgb`), `--card-error`(+`-rgb`), `--card-gold`(+`-rgb`), `--card-accent`, `--card-heading-from`/`-to`, plus `--team1-house`/`--team2-house` — see *In-card text variables* above

### Theme application

- Frontend / gamemaster: `document.documentElement.dataset.theme = activeTheme` — sets `data-theme` on `<html>` using the frontend theme (respecting any per-game override)
- Admin: `document.documentElement.dataset.theme = adminTheme` (via `<ThemeProvider rootTheme="admin">`) so the frontend theme's immersive atmosphere (e.g. Minecraft clouds/horizon, Galaxia stars) does not leak into the admin page through `html[data-theme]`. The `.admin-shell` element additionally carries `data-theme={adminTheme}` so the palette cascades through the admin subtree

### Font loading

Google Fonts (Outfit, DM Sans) are preloaded in `index.html` with `display=swap` for non-blocking rendering.

## Files

| File | Role |
|------|------|
| `src/styles/themes.css` | All theme definitions (CSS custom properties) |
| `src/context/ThemeContext.tsx` | React context, provider, `useTheme` hook |
| `src/App.tsx` | `ThemeProvider` wraps the app |
| `src/components/backend/ConfigTab.tsx` | Theme selector UI |
| `src/components/screens/AdminScreen.tsx` | Applies `data-theme` on `.admin-shell` |
| `index.html` | Google Fonts preload |

## Per-game theme override

Any game can temporarily override the frontend theme while it is active by setting a `theme` field in its JSON config:

```json
{
  "type": "simple-quiz",
  "title": "Harry Potter Quiz",
  "theme": "harry-potter",
  "questions": [...]
}
```

- The override is **frontend-only** — it does not affect the admin theme
- The override is **not persisted** to localStorage — when the game ends (user navigates away), the theme reverts to the global frontend theme
- The transition uses the same 600ms animation as manual theme switches
- Multi-instance games can set `theme` at the base level or per-instance (instance overrides base)
- Valid values: any `ThemeId` (`galaxia`, `harry-potter`, `dnd`, `deepsea`, `enterprise`, `retro`, `minecraft`, `classical-music`, `modern-music`, `movie-quiz`)
- The validator checks the `theme` field if present

### Implementation

- `BaseGameConfig.theme?: string` — optional field on all game configs
- `ThemeContext.setGameThemeOverride(id | null)` — temporary override, not persisted
- `ThemeContext.activeTheme` — resolves to `gameThemeOverride ?? theme`
- `GameScreen` applies the override when game data loads, clears it on unmount

## Out of scope

- Server-side theme storage (theme is client-only)
- Light mode / high-contrast mode (could be added as future themes)
- Custom user-defined themes (only predefined themes)
