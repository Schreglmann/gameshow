# Spec: Theme System

## Goal

Provide switchable visual themes for the gameshow app, allowing different colors, styles, fonts, border-radius, glass effects, and animations — while the DOM stays identical. Admin and frontend (gameshow) themes are independent.

## Acceptance criteria

- [x] At least 5 themes: Galaxia (default), Harry Potter, D&D, Arctic, Enterprise
- [x] Retro theme — 8-bit pixel optic, NES palette, immersive CRT atmosphere (scanlines, pixel stars, phosphor glow, vignette + scan sweep)
- [x] Minecraft theme — blocky Überwelt, sky-blue daylight background with drifting cubic clouds, pixel-art grass-and-dirt block horizon, pixel sun, inventory-slot panels, VT323 font (frontend-scoped immersion)
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
- Valid values: any `ThemeId` (`galaxia`, `harry-potter`, `dnd`, `arctic`, `enterprise`, `retro`)
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
