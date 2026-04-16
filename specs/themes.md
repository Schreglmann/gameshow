# Spec: Theme System

## Goal

Provide switchable visual themes for the gameshow app, allowing different colors, styles, fonts, border-radius, glass effects, and animations — while the DOM stays identical. Admin and frontend (gameshow) themes are independent.

## Acceptance criteria

- [x] At least 5 themes: Galaxia (default), Harry Potter, D&D, Arctic, Enterprise
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

| Pair | Galaxia | Harry Potter | D&D | Arctic | Enterprise |
|------|---------|-------------|-----|--------|------------|
| Text on bg | 7.4:1 | 14.7:1 | 13.4:1 | 14.3:1 | 14.9:1 |
| Secondary on bg | 4.6:1 | 9.1:1 | 9.1:1 | 7.8:1 | 8.6:1 |
| Button text on accent | 5.1:1 | 4.7:1 | 6.7:1 | 3.7:1 | 5.2:1 |
| Success on bg | 5.3:1 | 8.5:1 | 11.3:1 | 8.2:1 | 9.3:1 |
| Error on bg | 3.9:1 | 6.5:1 | 6.4:1 | 5.3:1 | 5.9:1 |
| Text on glass card | 5.2:1 | 11.4:1 | 10.0:1 | 8.9:1 | 9.3:1 |

**When adding a new theme:** run the contrast audit script and verify all pairs meet the minimums before merging.

## State / data changes

- No changes to `AppState` — theme is client-side only
- New React context: `ThemeContext` with `ThemeProvider`
  - `theme: ThemeId` — frontend theme (applied on `<html data-theme>`)
  - `adminTheme: ThemeId` — admin theme (applied on `.admin-shell data-theme`)
  - `setTheme(id)` / `setAdminTheme(id)` — setters
- Persisted to localStorage:
  - `gameshow-theme` — frontend theme
  - `gameshow-theme-admin` — admin theme
- Cross-tab sync via `storage` event

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

### Theme application

- Frontend: `document.documentElement.dataset.theme = themeId` — sets `data-theme` on `<html>`
- Admin: `.admin-shell` element gets `data-theme={adminTheme}` via React prop — CSS custom properties cascade within the admin subtree, overriding root values

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
- Valid values: any `ThemeId` (`galaxia`, `harry-potter`, `dnd`, `arctic`, `enterprise`)
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
