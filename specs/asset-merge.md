# Spec: DAM Asset Merge (Deduplication)

## Goal
Let a gamemaster merge two duplicate assets in the DAM into one — rewriting every game reference to point at the kept file and registering an alias so that the audio-cover and movie-poster auto-downloaders don't recreate the discarded filename on the next run.

## Acceptance criteria
- [ ] A "Zusammenführen" icon button appears in the header of each asset preview modal (image lightbox, audio preview, video preview) in [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx), next to the existing move/delete buttons.
- [ ] Clicking the button opens a target picker modal that shows the full folder tree of the currently open asset's category (across all folders), single-select, excluding the source asset.
- [ ] After a target is picked, a comparison modal shows both assets side-by-side: preview, filename, size, dimensions (images) or duration (audio/video), and game usages via the existing `GET /api/backend/asset-usages` endpoint — both the count and the list of game titles (with instance suffix when applicable, rendered as tags) so the user can see *which* games each asset is used in before choosing which to keep.
- [ ] The compare modal pre-selects "keep" on the asset with the higher usage count; on a tie, the shorter filename wins. User can override.
- [ ] Confirming the merge calls `POST /api/backend/assets/:category/merge` with `{ keep, discard }`.
- [ ] The server rewrites every occurrence of `/<category>/<discard>` → `/<category>/<keep>` in every non-template `games/*.json` file, atomically via `.tmp` + rename.
- [ ] The server deletes the discarded file from `local-assets/<category>/` and queues a NAS delete.
- [ ] For `images` category: the basename of the discarded file is registered as an alias pointing at the basename of the kept file in `local-assets/images/.asset-aliases.json`.
- [ ] Cascade for audio: when merging two audio files, if both `/images/Audio-Covers/<audioCoverFilename(x)>` files exist, the server merges them too (delete discarded cover, rewrite game refs to the discarded cover path, register alias, delete the discarded cover's entry in `.audio-cover-meta.json`). Response includes `cascadedCover: { keep, discard }`.
- [ ] Cascade for videos: same treatment for `/images/Movie Posters/<videoFilenameToSlug(x)>.jpg`.
- [ ] `fetchAndSaveAudioCover` ([server/audio-covers.ts](../server/audio-covers.ts)) resolves its derived cover filename through the alias map before checking for existence — if the alias target file exists, it returns early without re-downloading.
- [ ] `fetchAndSavePoster` ([server/movie-posters.ts](../server/movie-posters.ts)) does the same for posters.
- [ ] `GET /api/backend/audio-covers/list` returns on-disk cover filenames plus any alias keys whose resolved target still exists — so the "Audio Covers laden" picker in [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx) treats an audio file whose derived cover has been merged away as "already covered" and hides it from the fetch list.
- [ ] Self-heal: when `resolveAlias` returns a target filename that doesn't exist on disk, the alias entry is removed and the downloader falls through to its original derived name.
- [ ] Merging responds with `{ success: true, rewrittenGames: number, cascadedCover?: { keep: string; discard: string } }`; the UI shows this count in the existing toast/message slot.
- [ ] Rejected requests (same path, missing file, directory target, unsafe path, invalid category, same `keep`/`discard`) return a 4xx with `{ error }`.
- [ ] Responsive: the compare modal stacks vertically below 768 px. All new UI verified at 375/768/1024/1920 px.
- [ ] A static example of the compare layout is added to `AdminShowcase` in [ThemeShowcase.tsx](../src/components/screens/ThemeShowcase.tsx).

## State / data changes
- **New API endpoint:** `POST /api/backend/assets/:category/merge` — body `{ keep: string; discard: string }`, response `{ success: true, rewrittenGames: number, cascadedCover?: { keep: string; discard: string } }`.
- **New persistence:** `local-assets/images/.asset-aliases.json` — flat `Record<string, string>` mapping `discardedBasename → keptBasename`. Dotfile, excluded from DAM listings by existing filters.
- **No `AppState` change.** No new localStorage keys.
- **Game file mutations:** every `games/*.json` that referenced the discarded asset path is rewritten to reference the kept path.

## UI behaviour
- Screen / component affected: [AssetsTab.tsx](../src/components/backend/AssetsTab.tsx) (admin DAM), [ThemeShowcase.tsx](../src/components/screens/ThemeShowcase.tsx).
- What the user sees: merge button in each preview modal → picker with the full folder tree and a small search box → compare modal with two panes and a single confirm button → toast confirming merge + rewritten-games count + cascade note.
- Edge cases:
  - Picking the source asset as its own target is prevented in the UI; server rejects same path.
  - Server rejects if either path is missing or a directory.
  - If a game references the discarded asset via both the old and new paths already (rare), the rewrite is idempotent.
  - If the alias target is deleted later, the downloader's self-heal removes the stale alias on next fetch.

## Multi-file merge (from selection mode)
- [x] A "Zusammenführen" button appears in the selection toolbar when ≥ 2 files are selected (no folders).
- [x] Clicking the button fetches MD5 hashes for all selected files via `POST /api/backend/assets/:category/hashes`.
- [x] Files are grouped by hash. If more than 4 unique hashes are present, an error toast is shown and the flow aborts.
- [x] A comparison modal shows each hash group separately; within a group, the user picks which file to keep (defaulting to the file with the most game usages, tie-broken by shorter filename).
- [x] When all selected files share the same hash, a green "Identischer Inhalt" banner is shown instead of group headers.
- [x] Confirming the merge calls `POST /api/backend/assets/:category/merge` for each discard in each group, sequentially.
- [x] After completion, selection mode exits, the asset list reloads, and a toast summarises results.

## Hash comparison for two-file merge
- [x] The existing two-file merge compare modal fetches hashes for both files alongside usages.
- [x] When both files have the same hash, a green "Identischer Inhalt — beide Dateien haben denselben Hash" banner is shown.
- [x] When hashes differ, an amber "Unterschiedlicher Inhalt" warning banner is shown.

## Out of scope
- Folder merges (only files).
- Cross-category merges (e.g. merging an image into audio).
- Undo / audit log.
