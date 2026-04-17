# Skill: Add New Theme

You are helping the user add a new visual theme to the gameshow project. A theme styles **both** the player-facing gameshow **and** the admin backend via CSS custom properties on `[data-theme="<slug>"]` selectors — no DOM changes, no per-component styling. Follow the mandatory spec-driven workflow: **spec first, then code, then visual verification with Playwright MCP.**

Existing themes to use as reference: `galaxia` (default, minimal), `harry-potter` (immersive: stars + shimmer), `dnd` (immersive: torches), `arctic` (minimal cool), `enterprise` (minimal professional).

---

## Phase 1 — Gather requirements

Before writing anything, ask the user for:

1. **Theme slug** (kebab-case, e.g. `steampunk`) — becomes the `ThemeId` literal, the `[data-theme="…"]` selector, and the background-music folder name (`local-assets/background-music/<slug>/`).
2. **Display label** — short name shown in admin theme picker (e.g. `Steampunk`).
3. **Description** — one-line German text shown under the label in the picker (matches the `description` field in `THEMES[]`, e.g. `"Mechanisch & viktorianisch"`).
4. **Visual direction** — aesthetic references and whether it should be:
   - **Immersive** — custom atmosphere layer via `::before`/`::after` pseudo-elements (like Harry Potter stars, D&D torches)
   - **Minimal** — colors and typography only, no background FX (like Arctic, Enterprise)
5. **Color palette** — needed to fill the ~60 CSS variables. Agent should collect or propose:
   - Background gradient `from` and `to` (two hex codes)
   - Accent `from`/`to` (used on buttons, highlights)
   - Primary text color (must have **≥4.5:1** contrast against background)
   - Secondary/muted text color (≥3.0:1)
   - Success / error / gold colors (used across game states)
6. **Font family** — serif (e.g. Cinzel for Harry Potter / D&D) vs. sans-serif (e.g. Inter / DM Sans). If new, must be added to [index.html](index.html) preloads.
7. **Button style** — rounded pills vs. sharp rectangles, `text-transform` (uppercase/none), `letter-spacing`, `font-weight`, glow intensity.
8. **Atmosphere effects** (only if immersive) — describe the visual: twinkling stars, torch flicker, rising smoke, animated mist, shimmer drift, etc. Agent must plan the `@keyframes` and decide which layer (`::before` vs `::after`) each effect uses.
9. **Admin accent** — usually a brighter/more legible version of the frontend accent; used on sidebar highlights, inputs, and admin buttons.
10. **Background music** — choose one:
    - **Seed via YouTube** — user provides playlist URLs, `ytsearch10:` queries, or individual `watch` URLs.
    - **Manual drop** — user will drop MP3s into the folder later.
    - **Skip** — no theme-specific music; falls back to the root `background-music/` folder automatically.

Do not proceed to Phase 2 until every field above has a concrete answer.

---

## Phase 2 — Extend the spec (PAUSE for user review)

The theme system already has a spec at [specs/themes.md](specs/themes.md) — **update it, do not create a new one.**

1. Add the new theme to the acceptance-criteria list near the top:
   ```markdown
   - [ ] New theme "<label>" — <one-line intent>
   ```
2. Add a column for the new theme in the "Audit results" contrast table (leave ratios blank — Phase 4 fills them).
3. Add a short description block below the audit table (font choice, atmosphere description, button style, responsive behaviour).
4. If background music is being seeded, mention the source(s) in a sentence.

Show the diff to the user. **STOP HERE.** Wait for explicit confirmation before touching any source file. The spec is the contract — do not diverge from it silently.

---

## Phase 3 — Implement (10 steps, in order)

Only proceed after the user confirms the spec.

### Step 1 — Register the theme ID ([src/context/ThemeContext.tsx](src/context/ThemeContext.tsx))

Two edits in this file:

1. Line 4 — add `'<slug>'` to the `ThemeId` union:
   ```typescript
   export type ThemeId = 'galaxia' | 'harry-potter' | 'dnd' | 'arctic' | 'enterprise' | '<slug>';
   ```
2. Append to the `THEMES` array (lines 6–12):
   ```typescript
   { id: '<slug>', label: '<Label>', description: '<Deutsche Beschreibung>' },
   ```

`VALID_THEMES` at line 15 is derived from `THEMES` — no explicit edit needed there.

### Step 2 — CSS variables ([src/styles/themes.css](src/styles/themes.css))

Append a `[data-theme="<slug>"] { … }` block at the end of the file. **Every** variable defined in the Galaxia block (lines 19–137) must be overridden — missing overrides silently inherit from Galaxia and produce inconsistency.

Mandatory variable categories:
- **Colors** — `--bg-gradient-from/to`, `--glass-rgb`, `--text-primary`, `--text-rgb`, `--text-secondary`, `--text-muted`, `--accent-from/to`, `--accent-rgb`, `--primary-*`, `--success-*`, `--error-*`, `--gold-*`
- **Structural** — `--radius-sm/md/lg/xl`, `--glass-blur`, `--glass-opacity`, `--glass-border-opacity`
- **Buttons** — `--btn-text-transform`, `--btn-letter-spacing`, `--btn-font-weight`, `--btn-glow`, `--btn-glow-hover`
- **Animations** — `--bg-animate`, `--orb-animate`, `--entrance-animate`, `--hover-lift`
- **Font** — `--font-primary`
- **Admin** — `--admin-accent`, `--admin-accent-rgb`, `--admin-accent-deep`, `--admin-sidebar-bg`, `--admin-input-bg`, `--admin-msg-success`, `--admin-msg-error`

Reference blocks:
- Immersive template: `[data-theme="harry-potter"]` at line 143, `[data-theme="dnd"]` at line 295.
- Minimal template: `[data-theme="arctic"]` at line 468, `[data-theme="enterprise"]` at line 563.

**No descendant selectors that cross `[data-theme]` islands.** A rule like `[data-theme="<slug>"] .quiz-container { background: … }` or `[data-theme="<slug>"] h1 { font-size: … }` matches every descendant under an `html[data-theme="<slug>"]` root — **including** descendants inside a nested `[data-theme="galaxia"]` admin shell or ThemeShowcase preview panel. That's a silent leak. Retro's original implementation had this exact bug and needed a rewrite.

Allowed patterns:
- **Variables.** Declare a `--card-bg` / `--input-border-color` / `--card-shadow` / … override in the theme block, consume it at the rule site with `var(--card-bg, <default>)`, and reset it to `initial` in a single `[data-theme]:not([data-theme="<slug>"])` block so nested panels fall back to `<default>`. This is how Retro ships — see [src/styles/themes.css](src/styles/themes.css) `[data-theme="retro"]` block and the `:not` reset directly below it.
- **`::before` / `::after` on the theme element itself.** `[data-theme="<slug>"]::before` only decorates the element carrying the attribute (html or a preview div) — it does not cascade into descendants.
- **`body` selector inside a theme scope.** `[data-theme="<slug>"] body { … }` is safe because `body` is a singleton; no nested panel contains another body.
- **Narrow class chains for icon/button quirks.** Rules like `[data-theme="<slug>"] .music-controls button` are acceptable when the class only appears in the root app and not inside nested preview panels. Prefer vars when possible.

Forbidden patterns (will leak):
- `[data-theme="<slug>"] h1/h2/h3/button` — descendant leak into nested panels. Use vars or accept the base heading scale.
- `[data-theme="<slug>"] input / textarea / .quiz-container / .rules-container / .team / .glass-card / …` — same leak. Use `--input-*` and `--card-*` vars.
- `[data-theme="<slug>"] *` — never.

### Step 3 — Atmosphere layer (only if immersive)

In the same file, after the variable block:

1. Add `[data-theme="<slug>"]::before { … }` and optionally `::after { … }` with gradients, SVG data-URIs, or radial-gradient star fields. Reference: Harry Potter `::before` at line 255, D&D `::after` at line 433.
2. Add new `@keyframes` for any animations (twinkle, drift, flicker).
3. Respect the responsive pattern: hide or simplify atmosphere below 576px (see D&D media queries inside the `::before`/`::after` region for the exact pattern).
4. Keep the DOM untouched — every visual must come from pseudo-elements, never from new markup.

### Step 4 — Font preload (only if using a new font) ([index.html](index.html))

If the chosen `--font-primary` isn't already loaded, add Google Fonts links before the closing `</head>`:
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="preload" as="style" href="https://fonts.googleapis.com/css2?family=<Name>:wght@400;600;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=<Name>:wght@400;600;700&display=swap">
```
Use `display=swap` to avoid blocking rendering.

### Step 5 — Server validation ([server/index.ts](server/index.ts))

Line 1649 — add `'<slug>'` to the literal `VALID_THEMES` array:
```typescript
const VALID_THEMES = ['galaxia', 'harry-potter', 'dnd', 'arctic', 'enterprise', '<slug>'];
```

The background-music folder auto-creation loop at line 4165 iterates over this array, so `local-assets/background-music/<slug>/` is created on next server start — no change needed there.

### Step 6 — Config validator ([validate-config.ts](validate-config.ts))

Line 34 — add `'<slug>'` to the literal `VALID_THEMES` array used by per-game `theme` override validation.

**Three VALID_THEMES locations total** must include the slug: `ThemeContext.tsx` (derived from `THEMES`), `server/index.ts:1649`, `validate-config.ts:34`. Missing any one causes silent validation failures or 400 errors on `POST /api/theme`.

### Step 7 — Picker preview swatches

Add an entry to the `THEME_GRADIENTS` object in **both** files — values must be identical:
- [src/components/backend/ConfigTab.tsx:26-32](src/components/backend/ConfigTab.tsx#L26-L32)
- [src/components/screens/ThemeShowcase.tsx:8-14](src/components/screens/ThemeShowcase.tsx#L8-L14)

```typescript
'<slug>': ['<bg-gradient-from>', '<bg-gradient-to>'],
```

Use the same two hex values written to `--bg-gradient-from` / `--bg-gradient-to` in Step 2. If the objects drift, the admin picker swatch won't match the actual theme.

### Step 8 — Background-music folder

Restart the dev server once so [server/index.ts:4165](server/index.ts#L4165) materializes `local-assets/background-music/<slug>/`. Then, depending on the choice in Phase 1:

- **Seed via YouTube:** append an entry to [scripts/theme-music-urls.json](scripts/theme-music-urls.json) following the Harry Potter / D&D shape (objects with `url` + optional `take`). Then run:
  ```bash
  npm run download-theme-music -- --theme <slug>
  ```
  The script (`scripts/batch-download-theme-music.ts`) enumerates playlists via `yt-dlp` and posts each video to the server endpoint, which handles MP3 extraction, −16 LUFS normalization, and NAS mirroring.

- **Manual drop:** place `.mp3` files directly in `local-assets/background-music/<slug>/`.

- **Skip:** leave the folder empty. [src/hooks/useBackgroundMusic.ts:166-181](src/hooks/useBackgroundMusic.ts#L166-L181) and [server/index.ts:1614-1626](server/index.ts#L1614-L1626) fall back to the root `background-music/` folder automatically.

### Step 9 — Tests

Most theme-aware tests import `THEMES` dynamically, so they pick the new slug up for free. Find hardcoded lists with:
```bash
rg -n "'galaxia'|'harry-potter'|'dnd'|'arctic'|'enterprise'" tests/
```

Common places to update:
- Any test asserting `THEMES.length === 5` — bump to 6.
- Any test mocking `useTheme()` that hardcodes the full theme list.
- Any snapshot test of the admin Config tab or `/theme-showcase`.

Per [AGENTS.md §7](AGENTS.md) Testing convention, edits in this task touch **shared code** ([server/index.ts](server/index.ts), [validate-config.ts](validate-config.ts), [src/context/ThemeContext.tsx](src/context/ThemeContext.tsx)), so escalate to the full suite:
```bash
npm test
```
Never delete or skip a failing test to make the suite green — fix the code or update the test to match the new intended behaviour.

### Step 10 — Theme showcase sanity check

[src/components/screens/ThemeShowcase.tsx](src/components/screens/ThemeShowcase.tsx) reads `THEMES` dynamically, so no code edit is needed. Open `/theme-showcase` in the browser, switch to the new theme in both the frontend and admin selectors, and visually scan every element (buttons, quiz cards, timer, award points, bandle tracks, forms, team cards, color swatches, glass panels). This is the single best place to spot missing CSS variables.

---

## Phase 4 — Playwright MCP visual + contrast verification

**Do not skip this phase — it is the acceptance gate.** WCAG 2.1 AA contrast is a hard requirement per [specs/themes.md:27-36](specs/themes.md#L27-L36).

1. **Start the dev server** via `npm run dev` in the background (if not already running).

2. **Switch to the new theme** using Playwright MCP:
   - `mcp__playwright__browser_navigate` → `http://localhost:5173/theme-showcase`
   - `mcp__playwright__browser_click` → the new theme button in the **Gameshow** selector row
   - `mcp__playwright__browser_click` → the new theme button in the **Admin** selector row

3. **Screenshot at every breakpoint.** For each viewport width in `[375, 768, 1024, 1920]`:
   - `mcp__playwright__browser_resize` to `width × 900`
   - `mcp__playwright__browser_take_screenshot` for each of:
     - `/theme-showcase` (frontend section at top)
     - `/theme-showcase` (admin section, scrolled into view)
     - `/admin` Config tab (both theme pickers visible)
     - `/admin` Games list (or any other content-heavy admin screen)
     - `/` (landing screen)
     - One active game screen (e.g. `/games/0`) to confirm in-game styling

4. **Contrast audit** via `mcp__playwright__browser_evaluate`. Inject a script that reads `getComputedStyle(el).color` and backgrounds for the representative pairs in [specs/themes.md:27-36](specs/themes.md#L27-L36), computes WCAG contrast ratios, and returns them:
   - Primary text on background — **≥4.5:1**
   - Secondary text (70% opacity) on background — **≥3.0:1**
   - Muted text (50% opacity) on background — **≥3.0:1**
   - Button text on accent button — **≥3.0:1**
   - Success text on background — **≥4.5:1**
   - Error text on background — **≥4.5:1**
   - Gold/highlight on background — **≥3.0:1**
   - Primary text on glass card — **≥4.5:1**
   
   **If any pair falls below threshold → block completion, return to Phase 3 Step 2, adjust colors, re-run.** Record the passing ratios in the [specs/themes.md](specs/themes.md) audit table.

5. **Atmosphere sanity** (immersive themes only):
   - At `≥1400px`: confirm the `::before`/`::after` pseudo-elements render and are visible in the screenshot.
   - At `<576px`: confirm atmosphere is hidden or simplified (no torches overflowing mobile, no oversized star fields).

6. **Music verification:** via `mcp__playwright__browser_evaluate`, call:
   ```javascript
   fetch('/api/background-music?theme=<slug>').then(r => r.json())
   ```
   Confirm the response is an array (either with seeded filenames or with the root-folder fallback — never a 500 error).

7. **Cross-theme leak audit** — this is the regression that broke Galaxy when Retro was added, so it is a required check. Two parts:

   a. **Static scan of the new theme's rules.** Grep the new theme block in [src/styles/themes.css](src/styles/themes.css) for forbidden descendant selectors and fail on any hit:
      ```bash
      awk '/\[data-theme="<slug>"\] / && !/::before/ && !/::after/ && !/body/ && !/\.music-controls/ && !/\.audio-ctrl-btn/ && !/\.music-toggle/' src/styles/themes.css
      ```
      Every line the awk prints is a leak candidate. Each one must either be removed, converted to a CSS variable override (see the *No descendant selectors* note in Phase 3 Step 2), or explicitly whitelisted in the awk exclusion list with a one-line comment explaining *why* the narrow selector is safe (typically: the class only appears at app root, not inside nested preview panels).

   b. **Runtime nested-panel test** via `mcp__playwright__browser_evaluate`. Inject a Galaxy-themed wrapper with a glass card inside an `html[data-theme="<slug>"]` root and confirm the wrapper renders Galaxy glass, not the new theme's surface:
      ```javascript
      () => {
        const html = document.documentElement;
        html.setAttribute('data-theme', '<slug>');
        const wrap = document.createElement('div');
        wrap.setAttribute('data-theme', 'galaxia');
        wrap.style.cssText = 'position:fixed; top:0; left:-9999px; width:500px; height:200px;';
        const quiz = document.createElement('div');
        quiz.className = 'quiz-container';
        wrap.appendChild(quiz);
        document.body.appendChild(wrap);
        void quiz.offsetHeight;
        const cs = getComputedStyle(quiz);
        const result = {
          bg: cs.backgroundColor,
          border: cs.border,
          radius: cs.borderRadius,
        };
        wrap.remove();
        return result;
      }
      ```
      Expected (Galaxy values): `bg: "rgba(255, 255, 255, 0.15)"`, `border: "1px solid rgba(255, 255, 255, 0.25)"`, `radius: "25px"`. Any deviation means the new theme leaks its surface styling into nested panels — return to Phase 3 Step 2 and convert the offending descendant rule to a CSS variable override with a `[data-theme]:not([data-theme="<slug>"])` reset.

   Repeat the test with the *new* theme's slug in the inner wrapper and `galaxia` on html, to confirm the new theme's variables apply correctly when IT is the nested one.

Only proceed to Phase 5 after all seven checks pass.

---

## Phase 5 — Finalize spec + close out

1. Flip every acceptance checkbox for the new theme in [specs/themes.md](specs/themes.md) from `- [ ]` to `- [x]`.
2. Fill in the contrast-audit row with measurements from Phase 4 step 4.
3. Per [AGENTS.md §7](AGENTS.md) Docs rule, check whether any of these enumerate the theme list and update them:
   - [README.md](README.md)
   - [MODULAR_SYSTEM.md](MODULAR_SYSTEM.md)
   - [QUICK_START.md](QUICK_START.md)
   - [docs/admin-guide.md](docs/admin-guide.md)
4. Final verification:
   ```bash
   npm run validate
   npm test
   ```
   Both must pass cleanly. Fix any failures before declaring the task complete.

---

## Conventions to never skip

| Rule | Detail |
|------|--------|
| Spec first | Update [specs/themes.md](specs/themes.md) → user confirms → then code. Never the reverse. |
| All CSS variables | Every variable in the Galaxia `:root` block must be overridden. Missing overrides are silent bugs. |
| Three `VALID_THEMES` | `ThemeContext.tsx` (derived), `server/index.ts:1649` (literal), `validate-config.ts:34` (literal). All three must include the slug. |
| `THEME_GRADIENTS` sync | [ConfigTab.tsx](src/components/backend/ConfigTab.tsx) and [ThemeShowcase.tsx](src/components/screens/ThemeShowcase.tsx) must have identical entries. |
| German UI | All player-facing text in German. Labels and descriptions in the picker included. |
| WCAG AA is a gate | Contrast audit in Phase 4 step 4 is blocking. No hand-waving. |
| No cross-theme leaks | Phase 4 step 7 leak audit is blocking. New theme rules may only target itself via vars, `::before`/`::after`, `body`, or narrow whitelisted class chains — never via `[data-theme="<slug>"] h1/button/input/.quiz-container/…`. |
| Independent admin theme | Frontend and admin themes switch independently — verify both in Playwright. |
| No DOM changes | Everything visual comes from CSS variables and pseudo-elements. Never add per-theme markup. |
| Responsive | Verify at 375 / 768 / 1024 / 1920 px per [AGENTS.md §7](AGENTS.md). Atmosphere must degrade gracefully on mobile. |
| Type imports | Use `import type { … }` for type-only imports. |
| Shared-code test run | This task touches shared files — run full `npm test`, not `test:related`. |
| No test skips | Never delete or disable a failing test. Fix the code or update the test. |
