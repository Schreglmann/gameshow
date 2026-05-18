# Spec: DAM Image Replace

## Goal
Let a gamemaster replace a low-resolution or wrong image in the DAM with a higher-resolution or better-fitting one — sourced via server-side image search (DuckDuckGo + Wikimedia Commons + GitHub SVG logos), a pasted URL, a dragged file, or a clipboard paste — without leaving the DAM. The replacement atomically swaps the bytes, rewrites every game reference if the file extension changes, and invalidates the dimensions + color-profile caches.

## Acceptance criteria
- [ ] An "Ersetzen" icon button appears in the image lightbox header in [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx), between "Verschieben" and "Zusammenführen".
- [ ] Clicking the button opens `ReplaceImageModal` with three tabs: "Suchen", "URL einfügen", "Datei / Einfügen".
- [ ] **Suchen tab**: search input pre-filled with a query derived from the filename (extension stripped, hyphens/underscores → spaces). Submitting calls `POST /api/backend/assets/images/search` and renders a candidate grid showing thumbnail, dimensions, source badge (DDG / Commons / GH), and title.
- [ ] **Resolution filter**: a "Nur ≥ {w} × {h}px" checkbox above the candidate grid (default: on when `currentDims` is known) hides candidates smaller than the current image's natural dimensions. A candidate with unknown dims always passes. When the filter is on, the empty state reads "Keine Treffer ≥ aktueller Auflösung — Filter deaktivieren um alle Ergebnisse zu sehen." A counter shows how many results are currently hidden.
- [ ] **"Mehr laden" pagination**: when the server's response sets `hasMore: true`, a full-width "Mehr laden (Seite N+1)" button appears below the grid. Clicking it calls the search endpoint with the next `page` and appends the new results (deduplicated by URL) to the existing list. The button is disabled while loading and hides when `hasMore` is false.
- [ ] **URL einfügen tab**: input accepts any URL; pasting a Google or Bing image-result link is unwrapped server-side via the existing `unwrapImageRedirect` logic before download.
- [ ] **Datei / Einfügen tab**: drag-and-drop and click-to-pick, plus a hint that Strg+V works on every tab.
- [ ] A `document`-level `paste` listener is mounted on modal open and removed on close. While the modal is open, the existing global DAM paste-to-upload listener (registered in [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx)) MUST NOT also fire.
- [ ] Selecting a candidate or providing bytes triggers a `dryRun` call that shows the new image's dimensions, size, format, and — if the extension changes — a list of game configs that will be rewritten.
- [ ] If the new image is smaller in both dimensions than the current one, the confirm button gains a warning style and prepended German label "Trotzdem ersetzen — neues Bild ist kleiner".
- [ ] Confirming calls `POST /api/backend/assets/images/replace`. On success: the modal closes, a toast shows new dims + rewritten-games count, the lightbox image gets `?v=${response.version}` appended so the browser fetches new bytes, and `broadcastAssetsChanged('images')` refreshes other DAM tabs.
- [ ] Server backs up the old bytes to `local-assets/images/.replace-backups/<basename>.<oldMtimeMs>.<ext>` before swapping. Last 5 backups per basename are kept; older ones pruned.
- [ ] Server-side swap is atomic: writes to a `.tmp` sibling, then renames. On failure, `.tmp` is unlinked.
- [ ] When the new image is a different format than the old one, the new filename uses the new extension, every game-config reference is rewritten via the same `rewriteGameRefs` helper used by the merge endpoint, and the old basename is aliased to the new basename in `local-assets/images/.asset-aliases.json`.
- [ ] SVG ↔ raster swaps are rejected with `400 vector_raster_mismatch`.
- [ ] Identical bytes (MD5 match against current file) return `200 { noChange: true }` without write or broadcast.
- [ ] Concurrent replaces of the same path are serialised via a per-path async mutex.
- [ ] Dimensions cache is warmed post-swap via `warmImageDimensions`; color-profile cache via `warmColorProfile`. `_storageStatsCache` is cleared.
- [ ] Responsive: candidate grid uses `repeat(auto-fill, minmax(160px, 1fr))`; tabs stack vertically below 480 px; preview row stacks below 768 px. Verified at 375/768/1024/1920 px.
- [ ] A static example of `ReplaceImageModal` is added to `AdminShowcase` in [ThemeShowcase.tsx](../src/components/screens/ThemeShowcase.tsx).

## State / data changes
- **New API endpoint:** `POST /api/backend/assets/images/search` — body `{ query: string; limit?: number; providers?: ('ddg'|'commons'|'github-svg')[] }`, response `{ results: Array<{ url, thumbnailUrl?, width?, height?, source, title?, license? }>; partial: boolean; errors?: Record<string,string> }`.
- **`github-svg` provider:** searches public-repo logo manifests (gilbarbara/logos, detain/svg-logos, simple-icons). Manifests live at `local-assets/.svg-manifests/<id>.json`, auto-refresh in the background at startup when missing or >30 days old, and are inspectable/manageable via `GET|POST|DELETE /api/backend/system/svg-manifests` (admin System tab). Results return `raw.githubusercontent.com` URLs; `fetchImageBytesFromUrl` already handles SVG via magic-byte sniffing so the download path is unchanged.
- **New API endpoint:** `POST /api/backend/assets/images/replace` — JSON `{ target, url, force?, dryRun? }` or multipart `(file, target, force?, dryRun?)`. Response `{ success, target, newFilename, oldDims?, newDims, oldSize, newSize, extensionChanged, rewrittenGames, backupPath, version }` or `{ noChange: true }`.
- **New persistence:** `local-assets/images/.replace-backups/` — folder containing up to 5 backups per basename, named `<basename>.<oldMtimeMs>.<ext>`. Dotfile-folder, excluded from DAM listings.
- **Reuses:** `local-assets/images/.asset-aliases.json` (existing — adds entries on extension change), `local-assets/.image-dimension-cache.json` (existing — auto-invalidates on mtime change).
- **No `AppState` change.** No new localStorage keys.
- **Game file mutations:** when the file extension changes, every `games/*.json` that referenced the old filename is rewritten to reference the new one.

## UI behaviour
- Screen / component affected: [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx) (admin DAM), new component [ReplaceImageModal.tsx](../src/components/backend/ReplaceImageModal.tsx), [ThemeShowcase.tsx](../src/components/screens/ThemeShowcase.tsx).
- What the user sees: "↻ Ersetzen" button in the lightbox header → modal opens → user picks one of three input methods → dry-run preview shows new dims and any extension-change warning → confirm → toast.
- Edge cases:
  - Smaller image: 409 from server, UI shows warning and "Trotzdem ersetzen" → retry with `force: true`.
  - URL that returns HTML (hotlink protection): magic-byte rejection → German error toast.
  - DDG provider failure: orchestrator returns `partial: true`; UI shows a discreet "DuckDuckGo nicht verfügbar" note above the grid; other providers' results still display.
  - All three providers fail: 502; UI shows German error toast.
  - Identical bytes: success path, toast "Keine Änderung — Bytes identisch".
  - Image used in 0 games: replace still works; `rewrittenGames: 0`.
  - Cross-category replacement (audio, video) is NOT supported by this endpoint — audio covers have their own override flow at `/api/backend/audio-cover/override`.

## Online-Suche upload (DAM upload zone)

The same multi-provider search powers an **"Online suchen"** button next to the existing "Von URL" button in the DAM's image upload zone. This is the *add new image* flow (not replace) and only includes the web-search input — URL paste, drag-drop, file picker, and clipboard paste are deliberately omitted because they are already covered by the existing "Von URL" button and the upload zone itself.

- [ ] A **"🌐 Online suchen"** button appears next to **"🔗 Von URL"** in the upload zone, only when the active category is `images`.
- [ ] Clicking opens `ImageSearchUploadModal` which renders the shared `<ImageSearchPanel>` plus an optional subfolder dropdown (mirrors the `imgUrlModal` subfolder picker). Subfolder defaults to the last `imgUrlSubfolder` choice when still valid.
- [ ] The panel uses `RENDER_BOX_IMAGE_GUESS` (1920 × 648, the larger of the two render boxes) as the render box for its low-resolution filter. Rationale: a new upload's future usage is unknown, so the filter requires resolution sufficient for *any* game it might end up in. (The replace flow, by contrast, uses the per-image box that matches its current `imageGuessFiles` membership.)
- [ ] When the resolution filter is on and the visible-candidate count drops below ~12, `<ImageSearchPanel>` automatically fetches the next page (up to a hard cap of 5 pages) so the grid stays populated. Auto-paginate halts on error, when `hasMore` is false, or when a fetch is in flight.
- [ ] Clicking a candidate marks it busy (`is-busy` class, "Lade…" overlay, other candidates disabled while in flight) and calls the existing `POST /api/backend/assets/images/download-url` endpoint via `downloadImageFromUrl('images', url, subfolder, desiredName)`.
- [ ] On success: the modal closes, a German success toast fires (`✅ <fileName> heruntergeladen (in <subfolder>)`), and the asset list reloads via `load({ showLoading: false, preserveScroll: true })`.
- [ ] On error: the modal stays open, an inline `.replace-error` banner shows the message, the candidate becomes interactive again.
- [ ] Reuses every existing CSS class (`.replace-modal`, `.replace-search-*`, `.replace-candidate*`) — same responsive behaviour at 375 / 768 / 1024 / 1920 px.

## Online-Suche in Frage-Bildern (Asset-Picker)

The same multi-provider search is also reachable directly from the question-image asset picker: every `<AssetField category="images">` opens a `<PickerModal>` that now exposes a **"DAM / 🌐 Online"** toggle in the header. Switching to Online replaces the DAM file grid with the shared `<ImageSearchPanel>` plus a subfolder dropdown. On selection the image is downloaded into the DAM and immediately selected as the question's image — no round trip through the DAM tab.

- [ ] The mode toggle appears only when `category === 'images'` and `!multiSelect`. The audio-cover-loading flow (`multiSelect`) never shows it.
- [ ] Default mode is `'dam'`. Switching to `'online'` hides the DAM-only header controls (upload, create-folder, sort) and the DAM breadcrumb.
- [ ] The subfolder dropdown is preselected to the folder the user was browsing (`currentPath`). While the user is still in DAM mode, switching folders keeps the dropdown in sync; once in Online mode, the user's manual choice is preserved.
- [ ] When no subfolders exist, the dropdown is omitted (downloads land at the images root).
- [ ] The render box for the low-resolution filter is forwarded from `<AssetField>`. `ImageGuessForm` passes `RENDER_BOX_IMAGE_GUESS` (1920 × 648); every other form gets the default `RENDER_BOX_QUIZ` (1920 × 540).
- [ ] Clicking a candidate marks it busy, calls `downloadImageFromUrl('images', url, subfolder, desiredName)`, and on success closes the picker via the existing `onSelect` contract (i.e. the path is written to the question via the `AssetField.onChange`). On error the modal stays open with a `.replace-error` banner.
- [ ] Reuses the same `<ImageSearchPanel>` / `<ImageSearchFilterToggle>` / CSS classes as the DAM upload modal — responsive at 375 / 768 / 1024 / 1920 px.

## Dateinamen (Online-Suche flows)

The DAM "Online suchen" upload modal and the question-image "🌐 Online" picker both send a `desiredName` to `POST /api/backend/assets/{category}/download-url`:

- The client normalises the submitted search query via `toTitleCaseName(query)` in [src/utils/filename.ts](../src/utils/filename.ts): trim, collapse runs of whitespace, lowercase everything, then uppercase the first character of every word. Example: `matthew  mercer` → `Matthew Mercer`.
- The server appends the sniffed extension (`.jpg`, `.png`, `.svg`, …) and writes `Matthew Mercer.jpg`. On collision in the target folder it appends a numeric suffix: `Matthew Mercer 2.jpg`, `Matthew Mercer 3.jpg`, … (helper `findFreeBasename`).
- Empty / whitespace-only queries fall back to the URL-derived filename (the pre-existing behaviour). Invalid `desiredName` (containing `/`, `\`, or control characters; longer than 200 chars) returns HTTP 400.
- The replace flow (`POST /api/backend/assets/images/replace`) keeps the target's existing basename — it does NOT send `desiredName`. Replacing `Foo Bar.png` with a JPG yields `Foo Bar.jpg`.
- Aligned with the AGENTS.md rule for image filenames of people (`Vorname Nachname.<ext>`).

## Out of scope
- Reverse image search (sending the current image to find larger versions of the same image elsewhere). True reverse search requires paid APIs (SerpAPI Google Lens, Bing Visual Search). Future work; the search endpoint contract leaves room for a `reverseImageOf` parameter.
- Replacing audio covers or movie posters via this endpoint — those have their own override flows.
- Undo / restore from `.replace-backups/`. Backups exist for forensic / manual recovery only; no UI surfaces them.
- Bulk replace (replacing many low-res images in one operation).
- Detecting near-duplicate candidates across providers (only exact URL deduplication is performed).
- URL / file / clipboard input in the "Online suchen" modal — those flows are kept on the existing "Von URL" button + upload zone.
