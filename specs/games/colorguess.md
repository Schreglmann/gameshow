# Spec: Color Guess

## Goal
Teams guess what an image (photo or logo, including SVG) shows by looking only at a pie chart of its dominant colors; the host reveals the original image + answer when ready. Replaces the retired "Logo Farbenspiel" whose flat color blocks did not convey dominance.

## Acceptance criteria
- [ ] Questions are defined in the game JSON with `image` (path) and `answer` (string), plus optional `disabled`
- [ ] Authoring requirement is "upload the image" only — colors are never entered manually
- [ ] Server extracts a stable color profile from the referenced image at upload time (fire-and-forget) and caches it in a sidecar file; on-demand extraction runs as a fallback when the cache is cold
- [ ] SVG, PNG, JPG, JPEG and WEBP inputs all produce an equivalent color profile (SVGs are rasterized before sampling)
- [ ] Color profile is a list of `{ hex, percent }` slices sorted by `percent` descending
- [ ] Slice percentages sum to `100 ± 1` (floating-point rounding tolerance)
- [ ] The pie chart shows each slice as a wedge in its color, with the percentage (integer) drawn on the wedge
- [ ] Wedges below a minimum angle do not draw a percentage label (to avoid overlap)
- [ ] Hovering or tapping a wedge shows a tooltip with the hex code
- [ ] First question (or `isExample: true` in the future) is the example; remaining questions are played for points
- [ ] Forward nav on an unrevealed question → reveal the answer
- [ ] Forward nav on a revealed question → advance to next question; last question + revealed → `onGameComplete()`
- [ ] Reveal view shows the pie chart next to the original image and the answer label
- [ ] Back nav on a revealed question → un-reveal (keep the question)
- [ ] Back nav on an unrevealed question (idx > 0) → previous question, revealed
- [ ] Back nav on the first unrevealed question → bubble to `BaseGameWrapper` (exit to rules/landing)
- [ ] Validator rejects questions missing `image` or `answer`, and rejects unsupported extensions (`png`/`jpg`/`jpeg`/`webp`/`svg` only)
- [ ] Background music fades out at rules (`onRulesShow`), fades back in at `onNextShow`
- [ ] Gamemaster screen receives answer data via `setGamemasterData`
- [ ] Cold cache: a never-seen image produces a profile on first request and persists it; subsequent requests return the cached value without re-running sharp
- [ ] Cache invalidates on image `mtime` change

## State / data changes
- No `AppState` changes — per-question view state is local
- New `GameType`: `'colorguess'`
- Config types in `src/types/config.ts`:
  - `ColorSlice = { hex: string; percent: number }`
  - `ColorGuessQuestion = { image: string; answer: string; disabled?: boolean; colors?: ColorSlice[] }`
  - `ColorGuessConfig extends BaseGameConfig { type: 'colorguess'; questions: ColorGuessQuestion[] }`
  - Added to the `GameConfig` discriminated union
- Authoring JSON never contains `colors`; the server populates it in the `/api/game/:index` response only for `type: 'colorguess'`
- Sidecar cache file: `local-assets/images/.color-profiles.json`
  - Shape: `{ [relPathUnderImages]: { mtime: number; colors: ColorSlice[] } }`
  - Atomic write (`.tmp` then `rename`), same pattern as [server/asset-alias-map.ts](../../server/asset-alias-map.ts)
- Images continue to be served from the existing `/images/` static mount

## UI behaviour
- Component: [src/components/games/ColorGuess.tsx](../../src/components/games/ColorGuess.tsx), mirrors [src/components/games/ImageGuess.tsx](../../src/components/games/ImageGuess.tsx) structure
- `<ColorPie>` sub-component:
  - Pure SVG, one `<path d="M..A..L..Z">` per wedge, colors from slice `hex`
  - Percentage labels placed at each wedge centroid via trigonometry; omitted when wedge angle < 18° (≈5%)
  - `onMouseEnter` / `onMouseLeave` / `onClick` set a `hoverIdx` to surface a tooltip (`#RRGGBB · 70 %`)
  - Responsive via `clamp()` on width (320–560px) and `aspect-ratio: 1`
- Guess view (pre-reveal): only the pie chart, centered
- Reveal view: two-column layout — pie chart left, original image right, answer text below (stacked vertically <768px)
- Lightbox-on-click for the revealed image is inherited from the existing `Lightbox` component used by ImageGuess

## Server behaviour
- New module [server/color-profile.ts](../../server/color-profile.ts):
  - `extractColors(absPath, mime?)`: rasters SVG via `sharp`, resizes to 256×256 inside, flattens onto white for transparency, samples raw RGB, quantizes pixels to 4-bins-per-channel buckets (64 buckets), returns top-6 slices; combines remainder into a `"Sonstige"` slice when remainder > 2%; otherwise renormalizes to 100
  - `getColorProfile(relPath)`: cached read; on mtime mismatch or missing entry, run extraction and persist
  - `warmColorProfile(relPath)`: fire-and-forget variant wired into the upload endpoint
- Upload endpoint ([server/index.ts](../../server/index.ts) `POST /api/backend/assets/:category/upload`): after the existing audio-normalize block, when `category === 'images'` and the extension is supported, calls `warmColorProfile` without awaiting
- `/api/game/:index` handler: when the resolved game's `type === 'colorguess'`, awaits `getColorProfile` for each question and attaches `colors` to the response
- No new HTTP route is added

## API contract
- `specs/api/openapi.yaml`:
  - New `ColorSlice`, `ColorGuessQuestion`, `ColorGuessConfig` schemas
  - `'colorguess'` appended to the `GameType` enum
  - `ColorGuessConfig` added to the `GameConfig` discriminator
  - No change to the `GameDataResponse` envelope shape
- `npm run contracts:lint` must pass with zero errors

## Out of scope
- Timer-based obfuscation reveal (no step-down animation — the pie chart is the puzzle, fully present from the start)
- Admin form for editing colorguess questions (deferred to a separate task; the existing generic "image + answer" form pattern can be reused)
- Custom palettes or named-color labels (German color names)
- Color profile pre-warming script for existing images at deploy time (lazy extraction on first play is acceptable; ~200–500 ms per SVG)
- Client-side fallback extraction (server is the single source of truth for profiles)
