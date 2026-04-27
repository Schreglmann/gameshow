# Spec: Theme System

## Goal

Provide switchable visual themes for the gameshow app, allowing different colors, styles, fonts, border-radius, glass effects, and animations — while the DOM stays identical. Admin and frontend (gameshow) themes are independent.

## Acceptance criteria

- [x] At least 5 themes: Galaxia (default), Harry Potter, D&D, Arctic, Enterprise
- [x] Retro theme — 8-bit pixel optic, NES palette, immersive CRT atmosphere (scanlines, pixel stars, phosphor glow, vignette + scan sweep)
- [x] Minecraft theme — blocky Überwelt, sky-blue daylight background with drifting cubic clouds, pixel-art grass-and-dirt block horizon, pixel sun, inventory-slot panels, VT323 font (frontend-scoped immersion)
- [x] Classical Music theme — Notenblatt & Konzertsaal, warm parchment background with faint repeating five-line musical staff, large treble-clef watermark, soft aged-paper vignette, parchment-sheet panels, Cinzel serif (frontend-scoped immersion, fully static)
- [x] Modern Music theme — Neon & DJ-Booth, near-black background with neon-pink + cyan + lime accents, animated equalizer bar silhouette at the floor, concentric sound-wave rings + corner glow, dark-club glass panels, DM Sans 800 uppercase (frontend-scoped immersion)
- [x] Themes change colors, gradients, fonts, border-radius, glass opacity, button styles, and animations
- [x] Immersive themes (Harry Potter, D&D) have unique background effects: twinkling stars, golden shimmer, torch flicker, stone texture
- [x] DOM structure is unchanged — only CSS custom properties differ
- [x] Frontend and admin themes are independent (separate selectors, separate localStorage keys)
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

| Pair | Galaxia | Harry Potter | D&D | Arctic | Enterprise | Retro |
|------|---------|-------------|-----|--------|------------|-------|
| Text on bg | 7.4:1 | 14.7:1 | 13.4:1 | 14.3:1 | 14.9:1 | 17.1:1 |
| Secondary on bg | 4.6:1 | 9.1:1 | 9.1:1 | 7.8:1 | 8.6:1 | 8.8:1 |
| Button text on accent | 5.1:1 | 4.7:1 | 6.7:1 | 3.7:1 | 5.2:1 | 4.2:1 |
| Success on bg | 5.3:1 | 8.5:1 | 11.3:1 | 8.2:1 | 9.3:1 | 7.3:1 |
| Error on bg | 3.9:1 | 6.5:1 | 6.4:1 | 5.3:1 | 5.9:1 | 4.8:1 |
| Text on glass card | 5.2:1 | 11.4:1 | 10.0:1 | 8.9:1 | 9.3:1 | 19.3:1 |

**When adding a new theme:** run the contrast audit script and verify all pairs meet the minimums before merging.

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

## State / data changes

- No changes to `AppState` — theme is client-side only
- New React context: `ThemeContext` with `ThemeProvider`
  - `theme: ThemeId` — frontend theme (applied on `<html data-theme>`)
  - `adminTheme: ThemeId` — admin theme (applied on `.admin-shell data-theme`)
  - `setTheme(id)` / `setAdminTheme(id)` — setters
- Persisted on the server at `theme-settings.json` (authoritative, shared across devices)
- Cached in localStorage for instant initial render (avoids theme flash on reload):
  - `gameshow-theme` — frontend theme
  - `gameshow-theme-admin` — admin theme
  - Cache is written on every successful fetch/save and read synchronously at mount

## UI behaviour

- **Config tab** in admin shows two theme selector cards:
  - "Theme — Gameshow" — sets the player-facing theme
  - "Theme — Admin" — sets the admin UI theme
- Each card shows all available themes as clickable cards with gradient preview swatches
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
- **Surface overrides (Retro-only by default):** `--card-bg`, `--card-border`, `--card-shadow`, `--card-backdrop-blur`, `--input-border-color`, `--input-bg`, `--input-focus-border-color`, `--input-focus-bg`, `--input-focus-shadow` — see *Surface variables* above

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
- Valid values: any `ThemeId` (`galaxia`, `harry-potter`, `dnd`, `arctic`, `enterprise`, `retro`, `minecraft`, `classical-music`, `modern-music`)
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
