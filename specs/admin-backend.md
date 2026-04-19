# Spec: Admin Backend

## Goal

A full content management system accessible at `/admin` that allows the gameshow operator to manage game content, media assets, and gameshow configuration — all persisted directly to JSON files and the filesystem. The existing session management functionality (teams, points, localStorage) is preserved as the "Session" tab.

## Route

`/admin` — replaces the previous single-purpose admin screen. No `PageLayout` or additional context wrapper needed beyond the existing `GameProvider`.

## Tabs

### Session (existing functionality, unchanged)
- Edit team 1 and team 2 member lists (comma-separated)
- Edit team points
- Dispatch `SET_TEAM_STATE` to save
- Reset points (`RESET_POINTS`)
- View / clear localStorage (double confirmation for clear-all)

### Games
- Table of all `.json` game files from `/games/` (excluding `_template-*`)
- Each row: filename, type badge, title, instance names, Edit / Delete buttons
- Edit opens `GameEditor`:
  - Base fields: title, type, rules (add/remove/reorder), randomizeQuestions toggle
  - Per-instance tabs for multi-instance games; single unnamed block for single-instance
  - Instance fields: `_players` (metadata), title override, rules override
  - Type-specific question form (see below)
  - Save writes file atomically via `PUT /api/backend/games/:fileName`
- New game button opens modal: choose filename + game type → creates file from template → opens editor
- Delete with confirmation removes the `.json` file

#### Question forms per game type

| Type | Fields per question |
|------|-------------------|
| simple-quiz | question*, answer*, questionImage, answerImage, questionAudio, answerAudio, replaceImage, timer, answerList |
| guessing-game | question*, answer (number)*, answerImage |
| final-quiz | question*, answer*, answerImage |
| four-statements | Frage*, trueStatements[3]*, wrongStatement*, answer |
| fact-or-fake | statement*, isFact toggle (Fakt/Fake)*, description* |
| quizjagd | question*, answer*, difficulty (3/5/7)*, isExample; plus questionsPerTeam setting |
| audio-guess | Read-only info panel — questions are filesystem-derived; link to Assets tab |
All question forms support Add, Delete, Move Up, Move Down.

### Config
- Global settings: `pointSystemEnabled`, `teamRandomizationEnabled` (checkboxes)
- Global rules: add/remove/reorder string list
- Gameshows section: one card per gameshow with:
  - Name field
  - "Set as Active" button (marks `activeGameshow`)
  - Game order list (editable entries, Move Up/Down/Delete, Add new ref)
  - Delete gameshow button (with confirmation)
- Add new gameshow button
- Save writes `config.json` atomically via `PUT /api/backend/config`

### Assets (DAM)
Category tabs: **Bilder** (`/images/`), **Audio** (`/audio/`), **Hintergrundmusik** (`/background-music/`), **Videos** (`/videos/`)

All categories share the same browser UI:
- Grid of filenames with Delete buttons
- File upload via file picker or drag & drop
- Nested subfolder support (create, browse, move files between folders)
- Inline rename: clicking a folder name or a file name swaps it for an input; Enter/Blur commits via `moveAsset`, Escape cancels. File rename preserves the original extension (user edits the base name only) and keeps the file in its current folder. If the target name is already taken by another file, the server rejects the move with 409 and the existing file is left untouched (no silent overwrite)
- Search is token-based: the query is split on whitespace and each token must appear in the filename with `-`/`_`/`.` normalized to spaces, so "my video" matches `my-video.mp4` and `my_video.mp4`

Note: the `local-assets/audio-guess/` directory on disk is not exposed as a DAM tab or HTTP route. The audio-guess game type references its clips via normal `/audio/…` paths on the question objects; disk-usage stats for the folder are still reported under System → Storage.

#### Drag & Drop

**Upload from OS** — Drop zones accept OS file drops via HTML5 drag & drop (e.g. from Finder or Explorer):
- **Root upload zone** (top of page): dropping OS files uploads to the category root (no subfolder)
- **Folder row** (any `asset-folder` div): dropping OS files uploads to that folder's path as subfolder
- On drop: `uploadAsset(category, file, subfolder?)` is called for each file; multiple files upload sequentially
- After successful upload: success message shown, asset list reloaded

**Move existing assets** — Asset cards can be dragged within the browser to move them:
- Image and audio cards are draggable (cursor: grab)
- Drop an asset card onto a **folder row** → moves the file into that folder (`moveAsset`)
- Drop an asset card onto the **root upload zone** → moves the file to the category root
- Files are not moved when dropped on their current location
- After successful move: success message shown, asset list reloaded

**Move folders** — Folder rows are themselves draggable to re-parent the folder hierarchy:
- Folder headers are draggable (cursor: grab). Drag is disabled while the folder name is in inline-rename mode
- Drop onto another folder row → moves the folder (and all its contents) into that folder
- Drop anywhere in the DAM panel that isn't a specific inner drop target — the root upload zone, the "Stammordner" zone, the `asset-folders-root-zone` gutter around the folder list, or (as a catch-all) the outer DAM container itself — moves the folder to the category root. This includes the left or right whitespace beside the folder rows, the category-tabs row, and the space below the list. Folders that already live at the category root are a no-op (same-parent), so the catch-all only acts on nested folders.
- Client blocks invalid drops immediately — the drop target shows no `dragover` hover state and the OS cursor shows "not allowed":
  - Dropping a folder onto itself
  - Dropping a folder into any descendant of itself
  - Dropping a folder into its current parent (no-op)
- Server rejects the same conditions with HTTP 400 as a defense-in-depth check (`Ordner kann nicht in sich selbst verschoben werden`)
- Folder moves reuse the existing `POST /api/backend/assets/:category/move` endpoint — game-file URL rewrites (`/category/from` → `/category/to`) apply automatically, so references inside the moved subtree stay valid

**Drop image URL from another browser window** (images category only):
- Dragging an `<img>` from another tab/window and dropping on any DAM drop zone (root upload zone, root-with-subfolders, or a folder row) fetches the image server-side and saves it
- Subfolder drop targets save the image into that folder; root drops save to the category root
- URL extraction order: `text/uri-list` → `text/html` `<img src>` → `text/plain`. uri-list is preferred because Google Images puts its `/imgres?imgurl=<real>` redirect URL there (which the server unwraps to the full-resolution image), while the HTML fragment on Google's results page only contains the low-res `encrypted-tbn0.gstatic.com` thumbnail
- Backend endpoint: `POST /api/backend/assets/images/download-url` with `{ url, subfolder? }` — reuses the same flow as the "Von URL" button
- Server unwraps known search-engine redirect wrappers before fetching: `google.com/imgres?imgurl=…` → real image URL; `google.com/url?url=…` → redirect target; `bing.com/…?mediaurl=…` → real image URL
- Server sends `Referer: <origin>/` and a modern browser User-Agent to bypass hotlink protection on common CDNs
- Server validates the response is an actual image: checks `Content-Type: image/*` and/or magic bytes (JPEG/PNG/GIF/WebP/AVIF/SVG). HTML or other non-image responses are rejected with a German error message — this prevents HTML pages being saved with a fake `.jpg` extension
- URL drops are ignored on non-image categories (audio/video cannot be downloaded this way)
- Progress feedback: a "Lade N Bild(er)…" message appears, followed by a success or partial-failure summary once all URLs are fetched

**Shared behavior:**
- Drop zones show `dragover` CSS class while dragging over them (OS files, asset cards, and cross-browser URL drags) — suppressed when the current drag would be an invalid folder move
- Drop handler priority (within a single drop, folder-level and asset-level handlers can both fire for mixed drags):
  1. `dataTransfer.files` → OS file upload (short-circuits everything else)
  2. Folder payload — `text/asset-folder-paths` (JSON array, multi) or `text/asset-folder-path` (single) → folder move
  3. Asset payload — `text/asset-paths` (JSON array, multi) or `text/asset-path` (single) → file move
  4. URL extraction (see above) → download from URL (images only)
- Mixed drag: when the selection includes both folders and files, both `text/asset-folder-paths` and `text/asset-paths` are set on the drag and both handlers fire on drop
- Every in-DAM drag also sets `text/asset-source-category` (the active `AssetCategory`) so the category-tab drop handler can identify where the drag originated. Intra-category drop zones ignore it
- Clicking an asset card still opens the lightbox/detail view (click vs drag are mutually exclusive in the browser)
- Folder header has a dedicated "↑ Upload" button for click-to-upload into that folder

**Cross-category move (audio ↔ background-music):**
- The move modal (single and bulk) shows a "Zielkategorie" selector with two radio buttons on the `audio` and `background-music` tabs. Picking the opposite category moves the file/folder there on confirm; picking the active category keeps the current behaviour
- Dragging any file or folder onto the opposite **category tab** button at the top of the DAM moves it to that category's root. The tab highlights while a valid drag hovers
- Only the `audio` ↔ `background-music` pair participates. `images` and `videos` tabs are never drop targets for cross-category moves; the server rejects any other pair with 400
- `audio/bandle/*` and `audio/backup/*` are hidden from the DAM and rejected server-side as sources
- Game references are rewritten from `/<fromCategory>/<from>` → `/<toCategory>/<to>` by the same code path used for intra-category moves. Audio covers (`/images/Audio-Covers/<basename>.jpg`) are filename-keyed and remain valid

#### Selection mode

An "Auswählen" toggle in the search row puts the DAM into multi-select:
- Clicking an asset card toggles its selection instead of opening the preview. Shift+click extends a range; Cmd/Ctrl+click toggles a single item. Clicking a file or folder outside select mode with Shift or Cmd also enters select mode with that item selected
- In select mode, clicking anywhere on a **folder header** — the name, the file count, the empty space — toggles the folder's selection. The only exception is the **chevron** (▶) on the left, which expands/collapses the folder. The chevron has an enlarged 28 × 28 px hitbox (with hover affordance) so it's easy to hit without accidentally deselecting. Outside select mode, clicking a folder name still starts inline rename and clicking anywhere else on the header expands/collapses
- Files and folders have independent selection sets (`selectedFiles`, `selectedFolders`); the toolbar count shows the combined total
- The bulk **Verschieben** and **Löschen** buttons operate on the union. Bulk delete of nested selections skips descendants of a selected parent (deleting the parent already wipes them); the same pruning applies to bulk folder moves
- Escape or the "✕" button exits select mode and clears both sets

#### Delete confirmation & undo

All deletes — single file, single folder, bulk — go through a custom modal (`DeleteConfirmModal`) that lists every affected path before confirming. Browser-native `confirm()` is not used.

- **Preview:** files show their size; folders show recursive file count, recursive subfolder count, total size, and up to 5 sample filenames. Folder content is read from the already-loaded in-memory subfolder tree — no extra fetch.
- **Usage warning:** for each selected top-level file, the modal calls `GET /api/backend/asset-usages` in parallel and shows `⚠ Wird in N Spielen verwendet` with a tooltip listing the game titles. Files *inside* selected folders are not probed (would require recursive probes over potentially thousands of files). When more than 50 files are selected, per-file probing is skipped and a generic info line is shown instead.
- **Acknowledgement checkbox:** if any top-level file is in use by at least one game — or if per-file probing was skipped — the confirm button stays disabled until the user ticks **„Ich weiß, dass die betroffenen Spiele dadurch kaputtgehen können."**
- **Grouping:** on confirm, the client generates a `batchId` (UUID) and passes it as `?batchId=...` on every DELETE in the loop. The server groups all soft-deletes sharing a batchId into one undoable record.
- **Undo toast:** after a successful batch, the success toast includes a "Rückgängig" action button (dismiss extends from ~2.5s to ~8s when an action is present). Clicking it calls `POST /api/backend/assets/undo-delete`, which atomically restores the batch from the server's `.trash/` and reports `{ restored, conflicts }`. Only the *last* batch is recoverable — a subsequent delete purges the previous batch from `.trash/` and queues its NAS deletes at that point.

#### Preview modals

- Opening an audio file shows the matching cover from `/images/Audio-Covers/{basename}.jpg` next to the waveform (hidden if missing). The bulk audio-cover loader bumps a per-cover cache-bust counter so a newly fetched cover appears without requiring a modal reopen.
- Opening a video file shows the matching poster from `/images/Movie Posters/{slug}.jpg` as a floating thumbnail over the player (hidden if missing). Clicking it opens the existing poster lightbox.
- **Escape** closes the top-most open preview modal (audio → video → image → poster lightbox). Other admin modals (move, folder prompts, fetch dialogs) are unaffected by this handler.
- When downloading from YouTube (single audio, single video, playlist), the YT thumbnail is saved as the cover/poster via yt-dlp `--write-thumbnail --convert-thumbnails jpg`. The thumbnail save respects the alias map (`local-assets/images/.asset-aliases.json`) so merged-away covers aren't resurrected, and never overwrites an existing cover. For videos the IMDb poster auto-fetch runs only as a fallback when no YT thumbnail was saved.

#### Progress overlays

The bottom-center overlay shows live progress for asset uploads, YouTube single/playlist downloads, and audio-cover fetches. Each panel has a `▬` minimize button in its header that collapses it into a thin clickable bar showing `{done} / {total}` (or `{percent}%` for single-file work) with a progress fill that mirrors the full panel's phase colour; clicking the bar expands it again. Minimize/maximize state is independent per panel — any combination can be expanded or minimized at the same time, and only user clicks ever change that state (new jobs do not displace the state of existing panels). Minimize state is persisted to `localStorage` under `admin-minimized-progress-keys` and keyed by the stable server-assigned job id, so reloading the admin page keeps in-flight YouTube/audio-cover jobs minimized once the WebSocket reconnects them. The pending-cover-confirm dialog cannot be minimized because it requires explicit user input.

#### Static-asset HTTP cache

- `express.static` for `/images/`, `/audio/`, `/background-music/`, `/videos/` sets `Cache-Control: public, max-age=300` for image and audio file extensions (`jpg|jpeg|png|webp|gif|svg|mp3|m4a|wav|ogg`) — eliminates repeated round-trips for DAM poster thumbnails (`/images/movie-posters/{slug}.jpg`) when operators flip between tabs. Raw `/videos/` files are excluded: large, Range-served, and already covered by dedicated `/videos-compressed/` and `/videos-sdr/` cache endpoints with their own `Cache-Control`.
- When the user regenerates a video poster via "Filmcover laden", `AssetsTab` bumps a per-slug cache-bust counter and `VideoThumb` appends `?v=<ts>` to the poster URL so the newly generated image replaces the cached one immediately instead of waiting out the 5-minute TTL.

## Server API

All new endpoints under `/api/backend/*`. Added to `server/index.ts` before the SPA fallback.

### Games
```
GET  /api/backend/games                     → { games: GameFileSummary[] }
GET  /api/backend/games/:fileName           → raw game file JSON
PUT  /api/backend/games/:fileName           → write game file (atomic)
POST /api/backend/games                     → create new game file
DELETE /api/backend/games/:fileName         → delete game file
```

### Config
```
GET  /api/backend/config                    → full config.json
PUT  /api/backend/config                    → write config.json (atomic)
```

### Assets
```
GET    /api/backend/assets/:category        → { files } or { subfolders }
POST   /api/backend/assets/:category/upload → multer upload; ?subfolder= for audio-guess
POST   /api/backend/assets/:category/move   → { from, to, toCategory? } rename/move; when `toCategory` is set and differs from `:category`, moves across categories (audio ↔ background-music only); rewrites game refs
POST   /api/backend/assets/:category/merge  → { keep, discard } merge duplicate assets
DELETE /api/backend/assets/:category/*?batchId=<id>  → soft-delete into `.trash/<batchId>/`
POST   /api/backend/assets/undo-delete               → { success, restored, conflicts[] } — restores last batch
```

#### Delete / undo-delete semantics

`DELETE /api/backend/assets/:category/*` does **not** hard-delete. It renames the target into `<categoryDir>/.trash/<batchId>/<original-relpath>` and records the rename in an in-memory `lastDeletion` handle. `.trash` is hidden from all listings (starts with `.`). The NAS `queueNasDelete` is **deferred** — it only runs when the batch is superseded or TTL-swept, so `undo-delete` can reinstate files without a NAS round-trip.

- `?batchId=<id>` (optional): groups several DELETEs under one undoable batch. Accepts `^[a-zA-Z0-9_-]{6,64}$`; invalid/absent ids cause the server to mint a fresh batchId per call. When a batchId arrives that differs from the current `lastDeletion`, the previous batch is purged (real `rm -rf` of its trash subtree + `queueNasDelete` for every original path).
- `POST /api/backend/assets/undo-delete` renames each `trashPath` back to `originalPath`. Originals taken over by a new upload are skipped and returned in `conflicts: string[]`. Response: `{ success: true, restored: number, conflicts: string[] }`. 404 when `lastDeletion` is null.
- Startup TTL sweep: any `.trash/<batchId>` dir whose mtime is older than 24 h is removed on server boot. After a restart `lastDeletion` is null, so surviving trash is no longer undo-able and would only waste disk.
- Path-component safety: DELETE rejects any path whose segments start with `.` to prevent users from targeting `.trash` or other hidden dirs.

#### Merge (deduplication)

`POST /api/backend/assets/:category/merge` takes `{ keep: string; discard: string }` and:
1. Rewrites every `/<category>/<discard>` → `/<category>/<keep>` in every `games/*.json` (atomic `.tmp` + rename, same pattern as `move`)
2. Deletes the discarded file and queues a NAS delete
3. For `images` category: records the discarded basename → kept basename in `local-assets/images/.asset-aliases.json`. The audio-cover and movie-poster auto-downloaders consult this map before computing their expected filenames so a merged-away cover is not re-created on the next fetch.
4. For `audio` and `videos`: when both files have auto-derived covers in `/images/Audio-Covers/` (via `audioCoverFilename`) or `/images/Movie Posters/` (via `videoFilenameToSlug`), performs the same merge on those covers in the same transaction. The response includes `cascadedCover: { keep, discard }` when a cover cascade occurred.

Response: `{ success: true, rewrittenGames: number, cascadedCover?: { keep, discard } }`. Full spec: [asset-merge.md](asset-merge.md).

#### Whisper transcription jobs (per-video)

```
GET  /api/backend/assets/videos/whisper/health                → { ok, binPath, modelPath, reason? }
GET  /api/backend/assets/videos/whisper/jobs                  → { jobs: WhisperJob[] }
GET  /api/backend/assets/videos/whisper/status?path=<rel>     → { job: WhisperJob | null }
GET  /api/backend/assets/videos/whisper/transcript?path=<rel> → raw JSON transcript (404 if absent)
POST /api/backend/assets/videos/whisper/start  { path, language }
POST /api/backend/assets/videos/whisper/pause  { path }
POST /api/backend/assets/videos/whisper/resume { path }
POST /api/backend/assets/videos/whisper/stop   { path }
```

Persistent across Node restarts via detached child processes + `local-assets/videos/.whisper-cache/jobs.json`. Live progress flows over the existing `system-status` WebSocket channel as `backgroundTask` entries with `type: 'whisper-asr'`. Full spec: [whisper-transcription.md](whisper-transcription.md).

#### Live DAM refresh (`assets-changed` WS channel)

Mutations to the DAM filesystem push `{ category: AssetCategory }` on the `assets-changed` WebSocket channel so open DAM tabs auto-refresh without a manual reload. Emitted by: upload (regular + chunked finalize), `download-url`, `youtube-download` (per-track for playlists, plus `images` for every saved YT thumbnail cover/poster), `fetch-cover`, `audio-cover-fetch`, `mkdir`, `move` (source + destination), `merge` (plus `images` when the cover cascade fires), `DELETE`, `undo-delete`, and async IMDb poster fallbacks. Cross-category side effects (e.g. a video upload that later lands a poster in `images`) emit a second event for the affected category. The client in `AssetsTab.tsx` debounces 300 ms and only reloads when `data.category === activeCategory`.

Atomic writes: write to `.tmp` then `rename()` to prevent corruption on crash.

Security: `fileName` and `subfolder` params are validated to reject `..`, `/`, null bytes. `category` is validated against an allowlist.

## Data storage

All changes go directly to:
- `/games/*.json` — game data files
- `/config.json` — app configuration
- `/audio/`, `/images/`, `/background-music/`, `/videos/` — media files (served from `local-assets/`). The `local-assets/audio-guess/` folder exists on disk and contributes to System → Storage stats, but is not exposed via an HTTP route or DAM tab

No database. No authentication (local network only).

## Types added

In `src/types/config.ts`:
- `GameFileSummary` — summary returned by the games list endpoint
- `QuizjagdFlatQuestion` — documents the actual flat array format used in quizjagd JSON files
- `AssetCategory` — union type for the four asset categories (`audio`, `images`, `background-music`, `videos`)
- `AudioGuessSubfolder` — folder + files structure for audio-guess DAM view
- `AssetListResponse` — union response for the assets endpoint

## New files

```
src/components/screens/AdminScreen.tsx         (replaced — now tab shell)
src/components/backend/SessionTab.tsx
src/components/backend/GamesTab.tsx
src/components/backend/GameEditor.tsx
src/components/backend/InstanceEditor.tsx
src/components/backend/ConfigTab.tsx
src/components/backend/GameshowEditor.tsx
src/components/backend/AssetsTab.tsx
src/components/backend/RulesEditor.tsx
src/components/backend/StatusMessage.tsx
src/components/backend/questions/SimpleQuizForm.tsx
src/components/backend/questions/GuessingGameForm.tsx
src/components/backend/questions/FinalQuizForm.tsx
src/components/backend/questions/FourStatementsForm.tsx
src/components/backend/questions/FactOrFakeForm.tsx
src/components/backend/questions/QuizjagdForm.tsx
src/components/backend/questions/AudioGuessInfo.tsx
src/services/backendApi.ts
src/backend.css
```

## Out of scope
- Authentication / access control
- Undo/redo for content edits
- Preview of how a game will look in-game
- Image thumbnails in the flat asset grid
