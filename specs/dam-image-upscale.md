# Spec: DAM Image AI-Upscale

## Goal
Let a gamemaster upscale a low-resolution image directly in the DAM using a local AI model (Real-ESRGAN via the `upscayl-ncnn` engine), preview the result side-by-side, and atomically replace the original — without leaving the admin and without an internet round-trip. Closes the gap of the existing replace flow, which can only swap one set of bytes for another set of pre-existing bytes; AI-upscale synthesises a new, larger set of bytes from the original.

## Acceptance criteria

### Trigger & modal integration
- [ ] A 4th tab **"AI hochskalieren"** is added to `ReplaceImageModal` in [src/components/backend/ReplaceImageModal.tsx](../src/components/backend/ReplaceImageModal.tsx), next to the existing "Suchen / URL einfügen / Datei / Einfügen" tabs (see [dam-image-replace.md](dam-image-replace.md)).
- [ ] Tab is reachable from the same "↻ Ersetzen" entry-point in the image lightbox — no separate button required.
- [ ] When the upscaler binary is not installed for the current server platform, the tab still renders but the "Vorschau erstellen" button is disabled and a German hint reads `AI-Upscaler nicht installiert. \`npm run upscaler:install\` ausführen.`

### Inputs
- [ ] **Model dropdown** with three options, default to **Ultramix Balanced**. Each option's label includes a use-case hint so the gamemaster doesn't have to memorise which model fits which content:
  - `ultramix_balanced` — labelled "Ultramix Balanced — Fotos, Personen, gemischt (empfohlen)" — best for mixed content.
  - `ultrasharp` — labelled "Ultrasharp — sehr scharf, schlecht bei Text & Logos" — sharper, worse on text.
  - `digital_art` — labelled "Digital Art — Illustrationen, Cover, Comics" — illustrations, drawings, video-game cover art.
- [ ] **Scale dropdown** with five options. Default is `Auto`:
  - `Auto — optimal für alle Spiele (empfohlen)` — picks the smallest scale from the catalog `[1.5, 2, 3, 4]` that lifts the source above the largest render box across all games (1920 × 648 px — image-guess; quiz games use 1920 × 540 px which is the smaller constraint). Predicate: pick the smallest `s` such that `source.w × s >= 1920 OR source.h × s >= 648`; falls back to 4× when `currentDims` is unknown. The prediction line surfaces the resolved scale, e.g. `Aktuell: 480×360px → vorhergesagt: 720×540px (Auto → 1,5×)`.
  - `1,5×`
  - `2×`
  - `3×`
  - `4× — volle AI-Auflösung` — native model output, no downscale.

  **Important:** the curated models (Ultramix Balanced / Ultrasharp / Digital Art) are 4× models. The server always runs the AI at native 4× and Sharp-resizes the result to the requested scale. Scales beyond 4× are deliberately not offered — that would be a bicubic upscale of the AI output with no additional sharpness.
- [ ] The current image's dimensions and the predicted output dimensions (`current.w × scale` for both axes — no envelope clamp; `2×` doubles every dimension, `4×` quadruples them) are shown above the model dropdown.

### Preview
- [ ] Clicking "Vorschau erstellen" calls `POST /api/backend/assets/images/upscale` with `{ target, model, scale, dryRun: true, progressId }`. While in flight, the button shows a "Wird hochskaliert..." label and the rest of the modal is non-interactive.
- [ ] A determinate progress bar (`<progress>`) is shown below the run button while `aiBusy`. The client generates a UUID `progressId` before the POST, opens an `EventSource` on `GET /api/backend/assets/images/upscale/progress/:progressId`, and updates the bar from `data: {"percent":N}` events parsed off the AI's stderr (`(\d+\.\d+)%`). Bar reads "Starte…" until the first event; after the POST returns the EventSource is closed and the bar is hidden. Cache-hit runs may complete without ever emitting an event (bar stays in "Starte…" briefly then disappears).
- [ ] On success, the existing two-pane `<ReplaceCompare>` component renders the original on the left and the upscaled preview (from the returned `previewUrl`) on the right, with dimensions and file-size labels under each.
- [ ] Clicking either pane's thumbnail opens a comparison lightbox that renders **both images in the same display box** (max 90 vw × 80 vh, `object-fit: contain`) — only the image content differs, so a low-res original next to its high-res upscale shows the perceived quality gap rather than a size gap. Floating `‹` / `›` buttons (positioned over the left/right edges of the image) plus the keyboard `ArrowLeft` / `ArrowRight` keys flip between "Aktuell" and "Neu". Escape closes the lightbox. The header label updates to `🖼 Aktuell — <name>` / `🖼 Neu — <name>` and a footer pill highlights the active view.
- [ ] If the upscale fails (timeout, non-zero exit, decode error), an inline `.replace-error` banner shows the German error message returned by the server. For Vulkan-loader failures on Linux, the message includes the install hint `Vulkan-Treiber fehlen — sudo apt install libvulkan1 mesa-vulkan-drivers`.
- [ ] If the same image is upscaled twice with the same model+scale within the same Node process lifetime, the second call returns instantly (cache hit, served from an in-memory `Map<cacheKey, Buffer>`). The cache is cleared on Node restart.
- [ ] When the current candidate is already an AI upscale at the exact selected model+scale, the "Vorschau erstellen" button is **hidden** — the preview already shows what that combination produces, and a re-click would only return the cached bytes. Changing either dropdown to a different combo brings the button back so the user can run a new upscale.
- [ ] The modal remembers every successful AI run for the lifetime of the open modal, keyed by `${model}-${scale}`. Switching the dropdown back to a combo the user has already generated **auto-restores** that candidate: the right-hand preview updates to the cached result and the run button hides automatically. No re-click needed — the AI tab acts like a small gallery of every combo the user has tried, with the dropdowns acting as the selector. The cache is in-memory and discarded when the modal closes.

### Confirm
- [ ] The "✓ Ersetzen" confirm button calls `POST /api/backend/assets/images/upscale` with `dryRun: false`. The server reuses the already-cached preview bytes from the in-memory cache if present, otherwise re-runs the upscale, then runs the bytes through the same `performReplace()` helper as the existing replace endpoint — atomic write, backup to `.replace-backups/`, dimension/color-profile cache invalidation, NAS sync, `broadcastAssetsChanged('images')`.
- [ ] On success, the modal closes and a toast shows new dims + the time taken.
- [ ] The lightbox image's `?v=...` query-param updates to the new mtime so the browser re-fetches the upscaled bytes.

### Guardrails (client-side)
- [ ] **SVG block:** when the target is `.svg`, the AI tab is rendered but disabled, with the hint `Vektorgrafiken werden nicht hochskaliert — kein AI nötig.`
- [ ] **Already-large warning:** when the source meets or exceeds the render-box target in both dimensions, the tab shows a non-blocking warning above the run button: `Das Bild ist bereits hoch genug aufgelöst. Upscaling wahrscheinlich unnötig.`
- [ ] **Text/logo warning:** when the target's category path starts with `Logos/` or `Computerspiele/`, the tab shows a non-blocking warning above the run button: `Text und Logos können durch AI-Upscaling verschlechtert werden. Vorschau prüfen.`

### Theme showcase
- [ ] A static snapshot of `ReplaceImageModal` with the AI tab active is added to `AdminShowcase` in [src/components/screens/ThemeShowcase.tsx](../src/components/screens/ThemeShowcase.tsx).

### Responsive
- [ ] Verified at 375 / 768 / 1024 / 1920 px with Playwright MCP screenshots. Tabs stack vertically below 480 px (inherited from existing modal); preview compare stacks below 768 px (inherited).

## State / data changes

### New API endpoints (admin zone)
- `GET /api/backend/assets/images/upscale/info` — `{ available: boolean; models: UpscaleModel[]; supportedExts: ['.jpg', '.jpeg', '.png', '.webp'] }`. `available: false` when the per-platform binary is missing.
- `POST /api/backend/assets/images/upscale` — body `{ target: string; model: 'ultramix_balanced'|'ultrasharp'|'digital_art'; scale: 2|4; dryRun?: boolean }`.
  - Dry-run response: `{ success, newDims: {w,h}, newSize, previewUrl: '/api/backend/assets/images/upscale/preview/<cacheKey>', durationMs }`.
  - Confirm response: same shape as the existing `POST /api/backend/assets/images/replace` (`success, target, newFilename, oldDims?, newDims, oldSize, newSize, extensionChanged: false, rewrittenGames: 0, backupPath, version`). Extension never changes; `rewrittenGames` is always 0 since the filename is preserved.
- `GET /api/backend/assets/images/upscale/preview/:cacheKey` — streams the cached preview from the in-memory cache (`Map<cacheKey, { buffer: Buffer; contentType: string; lastUsed: number }>`). 5-min `Cache-Control: max-age=300, immutable` (the cache key itself is content-addressed, so the URL is stable as long as the entry lives). 404 if absent — the client must re-run the dry-run to repopulate.

### New persistence
- **In-memory only** preview cache. Key = `sha1(input bytes) + '-' + model + '-' + scale + 'x'`. Stored as `Map<string, { buffer: Buffer; contentType: string; lastUsed: number }>` in `server/upscale.ts`. LRU prune by `lastUsed` to a hard cap of **50 entries** on every write (estimated peak memory ~100 MB at 2 MB per upscaled image). Cleared on Node restart.
- `local-assets/.upscaler/<platform>-<arch>/upscayl-bin` — the platform-specific binary, installed by `npm run upscaler:install`. Mirrors the `local-assets/.whisper-build/` convention; already covered by the existing `local-assets` entry in `.gitignore`.
- `local-assets/.upscaler/models/` — three pairs of `.bin` + `.param` files, platform-agnostic.
- `scripts/upscaler-manifest.json` — declares the upstream release version, per-platform asset URLs, and pinned SHA256 hashes. Updating the upscaler version = one PR editing this file.

### Reuses
- `withReplaceMutex`, `pruneReplaceBackups`, `probeImageDimensions`, `warmColorProfile`, `queueNasCopy`, `broadcastAssetsChanged('images')`, `_storageStatsCache` — all from [server/index.ts](../server/index.ts). The "swap bytes" tail of the existing replace endpoint (lines ~4333-4401) is refactored into a `performReplace(targetFull, newBytes, opts)` helper called by both endpoints.
- `sharp` (already a dependency at `^0.34.5`).
- `<ReplaceCompare>` two-pane preview UI in [src/components/backend/ReplaceImageModal.tsx](../src/components/backend/ReplaceImageModal.tsx).

### No `AppState` change. No localStorage keys. No `games/*.json` mutations.

## UI behaviour

### Screen / component affected
- [src/components/backend/ReplaceImageModal.tsx](../src/components/backend/ReplaceImageModal.tsx) — adds the AI tab.
- [src/components/screens/ThemeShowcase.tsx](../src/components/screens/ThemeShowcase.tsx) — adds the snapshot.
- [src/services/api.ts](../src/services/api.ts) — adds typed wrappers `getUpscalerInfo()` and `upscaleImage()`.

### What the user sees
1. Opens "↻ Ersetzen" on a low-res image (already flagged by the "Niedrige Auflösung" filter).
2. Clicks the "AI hochskalieren" tab.
3. Picks a model + scale (defaults are usually right).
4. Clicks "Vorschau erstellen" — sees a "Wird hochskaliert..." spinner for ~3-8 s.
5. The compare pane shows old vs. new side-by-side with dimensions.
6. Clicks "✓ Ersetzen" — toast, modal closes, image refreshes in the DAM grid and lightbox.

### Edge cases
- **Binary missing:** info endpoint returns `available: false`; tab disabled with install hint. The check happens on modal mount and is cached for the modal's lifetime.
- **Vulkan missing (Linux only):** server runs the binary anyway and surfaces its stderr; the client renders the German install hint when the error string contains `Vulkan` / `vk_` / `libvulkan`.
- **Concurrent upscales:** the server-side `PQueue({ concurrency: 1 })` serialises them. A second client request while one is in flight sees its progress callback simply take longer; no explicit "queued" UI is added.
- **Cache hit (same Node process):** dry-run returns < 100 ms, no spinner needed beyond the existing button-busy state.
- **Cache miss after server restart:** preview URL from an earlier session 404s. The client doesn't persist preview URLs across reloads, so this is invisible to the user — they re-click "Vorschau erstellen" if they reopened the modal after a restart.
- **Source equals or exceeds render-box target:** warning shown, but not blocked — the user may still want to upscale for projection at greater-than-render-box source resolution.
- **Identical bytes after re-encode:** Sharp's JPEG quality 88 will normally produce different bytes than the original even with no real visual gain on an already-large image; the existing replace endpoint's MD5-identical short-circuit catches the rare equal case and returns `noChange: true`.
- **Animated GIF:** AI upscale loses animation. Pre-flight client-side check: if the original extension is `.gif`, tab is disabled with hint `Animierte Bilder werden nicht unterstützt.`

## Out of scope

- **Bulk upscaling** — selecting multiple low-res images at once. Easy follow-up once per-image flow is stable.
- **Auto-upscale on internet-image-search download** — silent quality change risks. Manual trigger only.
- **Face restoration via GFPGAN** — separate pass, not in v1.
- **Persistent (disk-backed) preview cache** — chosen against in v1 for simplicity. The in-memory cache covers the only use that mattered: same-modal-session re-runs and the dry-run → confirm round-trip. Re-add later only if real usage shows repeat upscales across restarts.
- **Undo via `.replace-backups/`** — already out of scope for the existing replace flow; no reason to add it here.
- **Windows support** — Mac + Linux only. Upscayl-ncnn ships a Windows build but the project doesn't deploy there.
- **`linux-arm64` support** — no upstream prebuilt at the time of writing. Could be added later if needed.
- **Bench/timing instrumentation beyond `durationMs` in the response** — add only if real usage shows the queue stalling.
- **Custom / user-uploaded models** — fixed catalog of three. Adding a model requires a code change.
