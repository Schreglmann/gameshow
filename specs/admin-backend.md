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
- Table of all `.json` game files from `/games/` (git-crypt-encrypted blobs are skipped)
- When the list is empty, a **"Beispiele erstellen"** button generates example games for every type (`POST /api/backend/games/examples`) — see [example-games.md](example-games.md)
- Each row: filename, type badge, title, instance names, Edit / Delete buttons
- Edit opens `GameEditor`:
  - Base fields: title, type, rules (add/remove/reorder), randomizeQuestions toggle
  - Per-instance tabs for multi-instance games; single unnamed block for single-instance
  - Instance fields: `_players` (metadata), title override, rules override
  - Type-specific question form (see below)
  - Save writes file atomically via `PUT /api/backend/games/:fileName`
  - Deleting an instance flushes any pending auto-save, then calls `DELETE /api/backend/games/:fileName/instances/:instance` — which removes it from the file **and** drops its `gameOrder` ref from every gameshow
- New game button opens modal: choose filename + game type → creates file from template → opens editor
- Delete with confirmation removes the `.json` file **and** cascades: every `gameOrder` reference to the game is removed from all gameshows so the show isn't left with a dangling reference. The success toast reports how many references were cleaned up. See [config-gameorder-cascade.md](config-gameorder-cascade.md)

#### Question forms per game type

| Type | Fields per question |
|------|-------------------|
| simple-quiz | question*, answer*, questionImage, answerImage, questionAudio, answerAudio, replaceImage, timer, answerList |
| guessing-game | question*, answer (number)*, answerImage |
| final-quiz | question*, answer*, answerImage |
| q1 | Frage*, trueStatements[3]*, wrongStatement*, answer |
| four-statements | topic*, statements[1..4]*, answer, answerImage (one of answer/answerImage required) |
| fact-or-fake | statement*, isFact toggle (Fakt/Fake)*, description* |
| quizjagd | question*, answer*, difficulty (3/5/7)*, isExample; plus questionsPerTeam setting |
| audio-guess | Read-only info panel — questions are filesystem-derived; link to Assets tab |
All question forms support Add, Delete, Move Up, Move Down.

### Config
- Global settings: `pointSystemEnabled`, `teamRandomizationEnabled`, `jokersInLastGame` (checkboxes)
- Global rules: add/remove/reorder string list
- Gameshows section: one card per gameshow with:
  - Name field
  - "Set as Active" button (marks `activeGameshow`)
  - Game order list (editable entries, Move Up/Down/Delete, Add new ref)
  - Delete gameshow button (with confirmation)
  - "Verfügbare Joker" checklist — one checkbox per catalog entry from [src/data/jokers.ts](../src/data/jokers.ts); toggling updates `enabledJokers` and is persisted via the same autosave flow. See [jokers.md](jokers.md).
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

**Online suchen** (images category only):
- A **"🌐 Online suchen"** button sits next to "Von URL" in the upload-zone buttons row. Clicking it opens `ImageSearchUploadModal`, which renders the shared `<ImageSearchPanel>` (multi-provider search: DuckDuckGo + Wikimedia Commons) plus a subfolder dropdown.
- Picking a candidate downloads it via the same `POST /api/backend/assets/images/download-url` endpoint used by "Von URL", into the selected subfolder. While downloading the picked candidate is overlaid with "Lade…" and the other candidates are disabled.
- Success closes the modal, fires a German toast (`✅ <fileName> heruntergeladen (in <subfolder>)`), and refreshes the asset list. Error keeps the modal open with an inline banner.
- Reuses the existing replace-modal CSS — same responsive behaviour at 375 / 768 / 1024 / 1920 px. See [dam-image-replace.md](dam-image-replace.md) for the full spec.

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

#### Usage filter (Verwendet / Unbenutzt)

The sort popover hosts a second section, **Verwendung**, with two togglable buttons: **Verwendet** and **Unbenutzt**. Neither active = show all (default). Selecting one filters the folder tree and search results to only files that are referenced by any game JSON (Verwendet) or that are not (Unbenutzt). Clicking the active button again clears the filter; the two buttons are mutually exclusive.

- Backed by `GET /api/backend/asset-category-usages?category=…` (lazy-fetched on first activation per category), which returns `{ usedFiles: string[], imageGuessFiles: string[], truncated: boolean }` — `usedFiles` are category-relative paths (e.g. `audio-2024/song.mp3`); `imageGuessFiles` is the subset referenced by any `image-guess`-typed game and powers the "Niedrige Auflösung" filter below
- When the filter is active the folder tree is filtered: files not matching the predicate are hidden, folders with no surviving descendants are dropped. Surviving folders keep their user-controlled expansion state — the filter never auto-expands. The "Alle" bulk-select still reaches into collapsed surviving folders so it picks up every visible-after-filter file across the tree
- Search and filter compose — when both are active the result set is the intersection
- The cache is invalidated when the active category changes or after mutations that can change game refs (move, rename, delete, merge, undo-delete)
- When the category exceeds the server-side `FOLDER_USAGE_FILE_CAP` (5000 files), the endpoint returns `truncated: true`, the filter reverts to "off", and the user sees the toast `Nutzungsprüfung übersprungen — zu viele Dateien`
- The sort trigger button shows a small dot indicator when any filter is active, so the state is visible without opening the popover

#### Low-resolution filter & resolution sort (Bilder only)

The sort popover gains a third section, **Bilder**, with a single togglable button: **Niedrige Auflösung** — visible only in the `images` category. It flags images that would be upscaled (and therefore blurry) when the frontend renders them.

- **Threshold (per usage):** the frontend renders images via two CSS rules. `.quiz-image` (50vh max-height) bounds nearly every game's image at **1920 × 540 px** on the 1920×1080 projector. `.image-guess-image` (60vh max-height) bounds the `image-guess` game at **1920 × 648 px**. With `object-fit: contain`, an image is upscaled iff **both** dimensions are smaller than the box. The filter flags an image when its natural dimensions trigger that upscale in the game it appears in. If an image is not used by any game, the quiz-image box (1920 × 540) is used as the fallback baseline
- **Image-guess membership** is read from `imageGuessFiles` on the usages call; both filters share the same fetch and cache
- **SVGs are never flagged** — they have no `.dimensions` on their `AssetFileMeta` (vector — scales infinitely)
- The "Auflösung" sort option appears in the same popover (also images-only) and sorts by total pixel area (`width × height`), largest first by default; second click reverses
- Natural pixel dimensions for raster images are extracted server-side via `sharp` and persisted to `local-assets/.image-dimension-cache.json` (mtime-keyed). When the client enters the Bilder tab it eagerly calls `GET /api/backend/assets/images/dimensions`, which synchronously probes every raster image (concurrency-bounded, but instant once warm) and returns the full map. The sort/filter buttons are disabled with a "Lädt Auflösungen…" hint until that one-shot fetch resolves; afterwards both work without any further wait
- Uploads, paste-from-clipboard, and URL downloads each fire a fire-and-forget dimension probe immediately, so a freshly added image shows in the low-res list (or not) without waiting for a refresh
- A flagged image can be upgraded in place via the **Ersetzen** action in its lightbox — see Preview modals → Image replace and [specs/dam-image-replace.md](dam-image-replace.md)

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
- **Usage warning:** the modal probes each selection in parallel. Directly selected files call `GET /api/backend/asset-usages` and render `⚠ Wird in N Spielen verwendet` with a tooltip listing the game titles. Selected folders call `GET /api/backend/asset-folder-usages`, which performs a single server-side recursive scan of every file in the folder against every game JSON, and the modal renders an aggregated `⚠ Enthält N Datei(en), die in M Spiel(en) verwendet werden` line per folder with a tooltip listing each in-use file and its referencing games. Folders above the server-side cap (5000 files) come back as `truncated: true` and degrade to the same generic "Nutzungsprüfung übersprungen" notice that fires when more than 50 items are selected in total.
- **Acknowledgement checkbox:** if any top-level file or any file inside any selected folder is in use — or if the probe was skipped (too many selections, or a folder above the file cap) — the confirm button stays disabled until the user ticks **„Ich weiß, dass die betroffenen Spiele dadurch kaputtgehen können."**
- **Grouping:** on confirm, the client generates a `batchId` (UUID) and passes it as `?batchId=...` on every DELETE in the loop. The server groups all soft-deletes sharing a batchId into one undoable record.
- **Undo toast:** after a successful batch, the success toast includes a "Rückgängig" action button (dismiss extends from ~2.5s to ~8s when an action is present). Clicking it calls `POST /api/backend/assets/undo-delete`, which atomically restores the batch from the server's `.trash/` and reports `{ restored, conflicts }`. Only the *last* batch is recoverable via this toast — older batches stay accessible from the Papierkorb view (see below) for as long as the 24h TTL allows.

#### Papierkorb (trash view)

Each category tab exposes its own `.trash/` directory as a pseudo-folder named **Papierkorb** at the top of the folder list. Clicking it switches `AssetsTab` into a dedicated trash view that surfaces every soft-deleted file/folder across all not-yet-purged batches (TTL: 24h since last modification), arranged by the original folder structure they came from.

- **Entry point:** a folder-style row with a trash-can icon, always rendered for discoverability. The label shows the total entry count (e.g. `Papierkorb (12)`) or `leer` when empty. No drag, no rename, no expand chevron — clicking the row switches the view.
- **Folder-structured layout (mirrors the main DAM):** trashed items are organized client-side into a folder tree synthesized from each entry's `originalPath`. Two kinds of rows result:
  - **Synthetic folder rows** — derived from path segments that appear in one or more entries' paths (e.g. `Logos/` exists because someone trashed `Logos/manchester.png`). They carry no actions; the row is just chevron + folder icon + name + a descendant-count badge. Expanding reveals the in-memory subtree — no network call.
  - **Real entry rows** — every actual `TrashEntry`, file or folder. A row shows mediaType icon, name, `gelöscht vor X`, `läuft ab in X`, size, and per-row actions `Wiederherstellen` / `Endgültig löschen`. Real trashed folders (`isDirectory: true`) have a chevron that lazy-loads their preserved on-disk children via `GET /api/backend/assets/:category/trash/list?batchId=&path=`. Each row's batchId stays attached internally so the batch-scoped restore/purge endpoints get the right target.
- **Sort:** a sort popover next to the search input mirrors the main DAM's `asset-sort-wrapper` pattern. Two fields are exposed — `Name` (default) and `Datum`. Clicking the active field flips the direction; clicking the other field switches and resets to that field's default direction. `Name` keeps the original tree ordering (folders before files within each level, then locale-aware case-insensitive name compare); reversing flips to Z→A within each group while folders still come first. `Datum` sorts by deletion timestamp — newest first by default — using `batch.createdAt` per row; for synthetic folders, the sort key is the most recent `batch.createdAt` of any real entry in the subtree, so a folder containing a freshly deleted file floats above older deletions. Same sort applies to flat search results (`batchCreatedAt` per `TrashDeepEntry`). Switching category resets the sort to `Name ↓`.
- **Search:** an input above the toolbar uses the same `matchesSearch` token matcher as the main DAM (separator-normalized, case-insensitive, every space-separated token must appear). When the field is non-empty the folder tree is bypassed and matching real entries render as a flat list with their full `originalPath` as the row label (no chevron expansion in flat mode); clearing the input restores the tree. The search is fed by `GET /api/backend/assets/:category/trash/all`, a deep-flat listing of every leaf file across every batch — `GET /trash` alone is not enough because it collapses soft-deleted folders into single rows, which would hide files nested inside them.
- **Selection mode (matches the main DAM):** checkboxes are hidden by default. An `Auswählen` toggle in the toolbar enters select mode; the toolbar swaps to show `✕ Auswahl beenden`, a `N ausgewählt` count, `Wiederherstellen (N)`, and `Endgültig löschen (N)`. Escape exits select mode and clears the selection. Outside select mode, clicking a file row opens its preview directly (folder rows toggle expand instead); inside select mode, clicking a row toggles its selection. Bulk operations group selected paths by `batchId` and issue one server call per batch; conflicts and counts are aggregated into a single result toast.
- **Conflict policy on restore:** same as `POST /api/backend/assets/undo-delete` — when a file already exists at the original path, the entry stays in trash and is reported in `conflicts: string[]`. The toast surfaces the count and the conflicting paths.
- **Permanent delete:** confirms via `DeleteConfirmModal` with the variant copy "Permanent löschen — kann nicht rückgängig gemacht werden". On confirm, the server `rm -rf`s the entry, queues the deferred NAS delete, and (for the audio category) cascades to the derived cover at `/images/Audio-Covers/{basename}.jpg` plus its sidecar meta entry — mirroring the existing `purgeDeletionBatch` cleanup. No undo toast is shown for permanent deletes.
- **Interaction with the undo toast:** any trash mutation dismisses any currently visible "Rückgängig" toast and invalidates the server's `lastDeletion` pointer when overlap exists, so the toast can never reference a state that no longer matches disk.
- **Preview modals (read-only):** clicking a trashed file row (outside selection mode) opens the existing image / audio / video preview modal against the bytes served from `GET /api/backend/assets/:category/trash/stream?batchId=&path=` (regular `/images/`, `/audio/`, `/videos/` mounts ignore dotfile paths so a dedicated endpoint is required). In read-only mode the modals hide rename, Verschieben, Merge, "Cover wechseln" / "iTunes-Cover laden", "Filmcover laden", waveform-trim save, and the transcription panel; in their place the modal header shows `Wiederherstellen` and `Endgültig löschen` for the previewed item only.
- **Live updates:** the view reloads on every `assets-changed` WebSocket event for the active category so concurrent admin sessions stay in sync.

#### Preview modals

- Opening an audio file shows the matching cover from `/images/Audio-Covers/{basename}.jpg` next to the waveform (hidden if missing). The bulk audio-cover loader bumps a per-cover cache-bust counter so a newly fetched cover appears without requiring a modal reopen.
- Audio preview also shows a **source pill** (Automatisch / YouTube / iTunes / MusicBrainz / Manuell) beneath the cover, plus two actions: **"Cover überschreiben…"** picks any image from the DAM and copies its bytes to the canonical path; **"iTunes-Cover laden"** runs an iTunes Search API lookup and (on unconfident matches) previews the candidate before writing. Provenance lives in `local-assets/images/.audio-cover-meta.json`. See [specs/audio-cover-override.md](audio-cover-override.md).
- Opening a video file shows the matching poster from `/images/Movie Posters/{slug}.jpg` as a floating thumbnail over the player (hidden if missing). Clicking it opens the existing poster lightbox.
- **Escape** closes the top-most open preview modal (audio → video → image → poster lightbox). Other admin modals (move, folder prompts, fetch dialogs) are unaffected by this handler.
- When downloading from YouTube (single audio, single video, playlist), the YT thumbnail is saved as the cover/poster via yt-dlp `--write-thumbnail --convert-thumbnails jpg`. The thumbnail save respects the alias map (`local-assets/images/.asset-aliases.json`) so merged-away covers aren't resurrected, and never overwrites an existing cover. For audio it lands at the canonical `/images/Audio-Covers/{basename}.jpg` and the sidecar records `{ source: 'youtube' }` so the preview pill reflects it. For videos the IMDb poster auto-fetch runs only as a fallback when no YT thumbnail was saved.
- **Image replace** — the image lightbox header has an **"↻ Ersetzen"** button (between Verschieben and Zusammenführen) that opens `ReplaceImageModal`. Three tabs: **Suchen** (server-side search via DuckDuckGo Images + Wikimedia Commons, no API keys), **URL einfügen** (paste any URL; Google/Bing image-result links are unwrapped server-side), **Datei / Einfügen** (drag-and-drop, file picker, or Strg+V clipboard paste). A `document`-level paste listener is mounted on modal open and removed on close so the global DAM paste-to-upload handler doesn't also fire. Picking a candidate or providing bytes triggers a `dryRun` showing new dimensions, size, format, and an extension-change warning when applicable. If the new image is smaller in both dimensions, the confirm button gains a warning style and the German label `Trotzdem ersetzen — neues Bild ist kleiner`. Confirm calls `POST /api/backend/assets/images/replace`; the server backs up the old bytes to `local-assets/images/.replace-backups/` (last 5 per basename), atomically swaps, and — when the extension changes — rewrites every game-config reference via the same `rewriteGameRefs` helper used by the merge endpoint and registers an alias in `.asset-aliases.json`. SVG ↔ raster swaps and identical-bytes are rejected. See [specs/dam-image-replace.md](dam-image-replace.md).

#### Progress overlays

The bottom-center overlay shows live progress for asset uploads, YouTube single/playlist downloads, and audio-cover fetches. Each panel has a `▬` minimize button in its header that collapses it into a thin clickable bar showing `{done} / {total}` (or `{percent}%` for single-file work) with a progress fill that mirrors the full panel's phase colour; clicking the bar expands it again. Minimize/maximize state is independent per panel — any combination can be expanded or minimized at the same time, and only user clicks ever change that state (new jobs do not displace the state of existing panels). Minimize state is persisted to `localStorage` under `admin-minimized-progress-keys` and keyed by the stable server-assigned job id, so reloading the admin page keeps in-flight YouTube/audio-cover jobs minimized once the WebSocket reconnects them. The pending-cover-confirm dialog cannot be minimized because it requires explicit user input.

#### Static-asset HTTP cache

- `express.static` for `/images/`, `/audio/`, `/background-music/`, `/videos/` sets `Cache-Control: public, max-age=300` for image and audio file extensions (`jpg|jpeg|png|webp|gif|svg|mp3|m4a|wav|ogg`) — eliminates repeated round-trips for DAM poster thumbnails (`/images/movie-posters/{slug}.jpg`) when operators flip between tabs. Raw `/videos/` files are excluded: large, Range-served, and already covered by dedicated `/videos-compressed/` and `/videos-sdr/` cache endpoints with their own `Cache-Control`.
- **Audio covers override** — files under `/images/Audio-Covers/` instead get `Cache-Control: no-cache`, because the override endpoints rewrite bytes in place while keeping the path stable. `express.static` emits `ETag`/`Last-Modified`, so unchanged files still respond `304 Not Modified` (same perf as a cache hit) but any `Cover wechseln` / `iTunes-Cover laden` change is picked up by the next request — including from game editors and the show view, no hard refresh needed. See [specs/audio-cover-override.md](audio-cover-override.md).
- When the user regenerates a video poster via "Filmcover laden", `AssetsTab` bumps a per-slug cache-bust counter and `VideoThumb` appends `?v=<ts>` to the poster URL so the newly generated image replaces the cached one immediately instead of waiting out the 5-minute TTL.

## Server API

All new endpoints under `/api/backend/*`. Added to `server/index.ts` before the SPA fallback.

### Games
```
GET  /api/backend/games                     → { games: GameFileSummary[] }
GET  /api/backend/games/:fileName           → raw game file JSON
PUT  /api/backend/games/:fileName           → write game file (atomic)
POST /api/backend/games                     → create new game file
DELETE /api/backend/games/:fileName         → delete game file + cascade-remove its gameOrder refs from all gameshows
DELETE /api/backend/games/:fileName/instances/:instance → delete one instance + cascade-remove its gameOrder ref
```

Deletion **cascades** into `config.json`: removing a game drops every `gameOrder` reference to
it (bare or instance-qualified) from all gameshows; removing one instance drops only that
instance's ref. This guarantees a deleted game/instance never leaves a dangling reference that
breaks the show. Both return `{ success, removedRefs }`. See
[config-gameorder-cascade.md](config-gameorder-cascade.md).

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
POST   /api/backend/assets/images/search    → { query, limit?, providers? } → { results, partial, errors? } — multi-provider image search (DDG, Wikimedia Commons)
POST   /api/backend/assets/images/replace   → JSON { target, url, force?, dryRun? } or multipart (file, target, force?, dryRun?) → atomic swap; rewrites game refs when extension changes
DELETE /api/backend/assets/:category/*?batchId=<id>  → soft-delete into `.trash/<batchId>/`
POST   /api/backend/assets/undo-delete               → { success, restored, conflicts[] } — restores last batch
GET    /api/backend/assets/:category/trash           → { batches: TrashBatch[] } — list every surviving soft-delete batch (top-level entries only)
GET    /api/backend/assets/:category/trash/all       → { entries: TrashDeepEntry[] } — deep-flat listing of every trashed leaf file across every batch (backs the Papierkorb search)
GET    /api/backend/assets/:category/trash/list      → ?batchId=&path= → { entries: TrashEntry[] } — direct children of a path inside a batch (folder navigation; does NOT collapse single-child folders)
POST   /api/backend/assets/:category/trash/restore   → { batchId, items? } → { success, restored, conflicts[] }; `items` accepts nested paths
POST   /api/backend/assets/:category/trash/purge     → { batchId?, items? } → { success, purged, batches } — permanent delete; `items` accepts nested paths; empties whole category when both are omitted
GET    /api/backend/assets/:category/trash/stream    → ?batchId=&path= → binary stream of a trashed file (Cache-Control: no-store), for preview modals
GET    /api/backend/asset-usages          → ?category=&file= → { games[] } — games referencing this asset
GET    /api/backend/asset-folder-usages   → ?category=&folder= → { truncated, files[] } — per-file usages for delete-confirm
GET    /api/backend/asset-category-usages → ?category= → { truncated, usedFiles[], imageGuessFiles[] } — files referenced by any game; imageGuessFiles is the subset used in image-guess-typed games (backs Verwendet/Unbenutzt + Niedrige Auflösung filters)
```

#### Delete / undo-delete semantics

`DELETE /api/backend/assets/:category/*` does **not** hard-delete. It renames the target into `<categoryDir>/.trash/<batchId>/<original-relpath>` and records the rename in an in-memory `lastDeletion` handle. `.trash` is hidden from all listings (starts with `.`). The NAS `queueNasDelete` is **deferred** — it only runs when the batch is superseded or TTL-swept, so `undo-delete` can reinstate files without a NAS round-trip.

- `?batchId=<id>` (optional): groups several DELETEs under one undoable batch. Accepts `^[a-zA-Z0-9_-]{6,64}$`; invalid/absent ids cause the server to mint a fresh batchId per call. When a batchId arrives that differs from the current `lastDeletion`, the previous batch is purged (real `rm -rf` of its trash subtree + `queueNasDelete` for every original path).
- `POST /api/backend/assets/undo-delete` renames each `trashPath` back to `originalPath`. Originals taken over by a new upload are skipped and returned in `conflicts: string[]`. Response: `{ success: true, restored: number, conflicts: string[] }`. 404 when `lastDeletion` is null.
- Startup TTL sweep: any `.trash/<batchId>` dir whose mtime is older than 24 h is removed on server boot. After a restart `lastDeletion` is null, so surviving trash is no longer undo-able and would only waste disk.
- Path-component safety: DELETE rejects any path whose segments start with `.` to prevent users from targeting `.trash` or other hidden dirs. Every trash endpoint re-validates the same constraints when reading from disk, so the on-disk trash directory cannot become a path-traversal vector even if a hand-edited entry slipped in.

#### Trash endpoints

The Papierkorb view (see above) is served by six sibling endpoints; together they cover top-level listing, deep search listing, folder navigation, restore, permanent delete, and binary preview of items in `<categoryDir>/.trash/`.

- `GET /api/backend/assets/:category/trash` — returns `{ batches: TrashBatch[] }` where each `TrashBatch` is `{ batchId, createdAt, expiresAt, sizeBytes, isCurrent, entries[] }` and each entry is `{ originalPath, isDirectory, sizeBytes, mediaType }`. `createdAt` reads the batch directory's `mtimeMs`; `expiresAt = createdAt + 24h` (matches `TRASH_TTL_MS`); `isCurrent` is `true` for the batch that backs the active undo toast (i.e. `batchId === lastDeletion?.batchId`). `mediaType` is derived from the entry extension (`image | audio | video | other`); folders always return `other`. The top-level listing collapses single-child folders so a soft-deleted folder appears as exactly one row at the depth it was deleted from. The endpoint treats a missing `.trash` directory as `{ batches: [] }`, not 500.
- `GET /api/backend/assets/:category/trash/all` — returns `{ entries: TrashDeepEntry[] }` where each entry is `{ batchId, batchCreatedAt, batchExpiresAt, originalPath, sizeBytes, mediaType }`. Walks every surviving batch recursively and emits every leaf file (no directories). Backs the Papierkorb search input — `/trash` alone is not enough because soft-deleted folders are collapsed into single rows, hiding files nested inside them. Missing `.trash` directory returns `{ entries: [] }`.
- `GET /api/backend/assets/:category/trash/list?batchId=&path=` — returns `{ entries: TrashEntry[] }`, the direct children of `<batchDir>/<path>` inside the batch. Unlike `/trash`, this endpoint does NOT collapse single-child folders — the caller sees the actual on-disk structure, which is what users need when drilling into a trashed folder. `path` may be empty (batch root) or a nested folder path. Same path-safety rules as the other endpoints; returns `{ entries: [] }` when the path is missing or not a directory.
- `POST /api/backend/assets/:category/trash/restore` — body `{ batchId: string; items?: string[] }`. Each `items` value is a path inside the batch — top-level OR nested inside a soft-deleted folder; the only constraint is that `<batchDir>/<item>` exists on disk. Omit `items` to restore every top-level entry. Each entry is renamed back to its original location with `mkdir -p` of the parent. Conflicts (an existing file/folder at the original path, or the trash entry already gone) are skipped and reported in `conflicts: string[]`. Restored entries are removed from `lastDeletion`; when `lastDeletion` ends up empty its pointer is nulled so a stale undo toast cannot 404. Returns `{ success: true, restored, conflicts }`.
- `POST /api/backend/assets/:category/trash/purge` — body `{ batchId?: string; items?: string[] }`. Three modes: (1) `{}` empties every batch for the category; (2) `{ batchId }` permanently deletes the whole batch; (3) `{ batchId, items }` purges those specific paths from the batch (top-level OR nested). For each removed entry the deferred NAS delete is queued via `queueNasDelete(category, originalPath)`. For the audio category, derived covers at `/images/Audio-Covers/{basename}.jpg` and their YouTube-thumbnail siblings are removed and the sidecar `audio-cover-meta` entry is dropped — same code path as `purgeDeletionBatch`. Overlapping `lastDeletion` entries are filtered out; an emptied `lastDeletion` is nulled. Returns `{ success: true, purged, batches }` where `batches` is the number of batches that were fully removed.
- `GET /api/backend/assets/:category/trash/stream?batchId=&path=` — streams the raw bytes of a single trashed file (no listings, no folders). `batchId` must match `^[a-zA-Z0-9_-]{6,64}$`; `path` must not contain `..`, `\0`, or dot-prefixed segments. The handler resolves to `<categoryDir>/.trash/<batchId>/<path>`, `stat()`s it to confirm it's a regular file, and serves it with `Cache-Control: no-store` so a freshly purged trash entry doesn't survive in any browser cache. Content-Type follows the file extension; unknown extensions fall back to `application/octet-stream`. Exists only because `express.static` is configured with `dotfiles: 'ignore'` for `/images/`, `/audio/`, `/background-music/`, `/videos/`, so the trash subtree is not otherwise reachable over HTTP.

All six endpoints validate `category` via the same `isSafeCategory` allowlist used elsewhere, and every mutating endpoint fires `broadcastAssetsChanged(category)` once on success so connected DAM clients (and any open Papierkorb view) refresh without a manual reload. The existing `POST /api/backend/assets/undo-delete` is unchanged on the wire — internally it delegates to the same restore helper as `/trash/restore`, so behaviour stays identical.

#### Merge (deduplication)

`POST /api/backend/assets/:category/merge` takes `{ keep: string; discard: string }` and:
1. Rewrites every `/<category>/<discard>` → `/<category>/<keep>` in every `games/*.json` (atomic `.tmp` + rename, same pattern as `move`)
2. Deletes the discarded file and queues a NAS delete
3. For `images` category: records the discarded basename → kept basename in `local-assets/images/.asset-aliases.json`. The audio-cover and movie-poster auto-downloaders consult this map before computing their expected filenames so a merged-away cover is not re-created on the next fetch.
4. For `audio` and `videos`: when both files have auto-derived covers in `/images/Audio-Covers/` (via `audioCoverFilename`) or `/images/Movie Posters/` (via `videoFilenameToSlug`), performs the same merge on those covers in the same transaction. The response includes `cascadedCover: { keep, discard }` when a cover cascade occurred.

Response: `{ success: true, rewrittenGames: number, cascadedCover?: { keep, discard } }`. Full spec: [asset-merge.md](asset-merge.md).

#### Image replace

`POST /api/backend/assets/images/search` runs the query against two free, no-key providers in parallel: DuckDuckGo Images (HTML GET for the `vqd` token, then `i.js`) and Wikimedia Commons (`action=query&list=search&srnamespace=6` + `prop=imageinfo`). Results are normalised to `{ url, thumbnailUrl?, width?, height?, source, title?, license? }`, deduplicated by URL, sorted by pixel area descending, and capped (default 30). Each `(query, providers)` tuple is cached in memory for 1 hour. If at least one provider succeeds, the endpoint returns `200` with `partial: true` and `errors: { [provider]: reason }` for any that failed; if every provider fails it returns `502`.

`POST /api/backend/assets/images/replace` swaps the bytes of an existing image atomically. Two request variants:
- JSON `{ target, url, force?, dryRun? }` — server fetches the URL using the same `unwrapImageRedirect` + magic-byte validation logic as `POST /api/backend/assets/images/download-url`.
- Multipart `(file, target, force?, dryRun?)` — direct upload (e.g. drag-and-drop or clipboard paste).

The server backs up the old bytes to `local-assets/images/.replace-backups/<basename>.<oldMtimeMs>.<ext>` (last 5 per basename, older ones pruned), writes the new bytes to a `.tmp` sibling, then atomically renames. When the new bytes are a different format than the old file (PNG → JPG etc.), the new filename uses the new extension, every game-config reference is rewritten via the same `rewriteGameRefs` helper used by `merge`, and the old basename is aliased to the new one in `.asset-aliases.json`. Same-format replacement keeps the filename and skips ref-rewriting.

Rejected: SVG ↔ raster swaps (`400 vector_raster_mismatch`); identical bytes (`200 { noChange: true }`, no broadcast); new image smaller in both dimensions without `force: true` (`409 smaller` with old + new dims). Concurrent replaces of the same path are serialised via a per-path async mutex.

Post-swap the server warms `warmImageDimensions(absPath)` and `warmColorProfile(absPath)`, clears `_storageStatsCache`, and fires `broadcastAssetsChanged('images')`. Full spec: [dam-image-replace.md](dam-image-replace.md).

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

#### Reference-only videos

```
GET  /api/backend/assets/videos/reference-roots                 → { roots: [{ path, reachable }] }
GET  /api/backend/assets/videos/reference-browse?path=<abs>     → { path, parent, entries: [{ name, kind, size?, mtime? }] }
POST /api/backend/assets/videos/add-reference                   → { sourcePath, subfolder?, name? } creates symlink + registry entry
```

The upload modal shows a "Lokale Kopie" / "Als Referenz" choice for the `videos` category (YouTube downloads always copy). "Als Referenz" opens a server-side directory browser over the configured allowed roots (env `GAMESHOW_REFERENCE_ROOTS`, default `/Volumes:/mnt:/media`) and picks a source file; the server creates a symlink under `local-assets/videos/` and records it in `local-assets/videos/.video-references.json`. References are delete/rename-able in the DAM; the source file is never touched. Asset listings return `AssetFileMeta.reference = { sourcePath, online }` for reference entries so the UI can render a **Ref** badge (online) or **Offline** badge (dangling symlink). Full spec: [video-references.md](video-references.md).

#### Video-guess instance lock

```
POST /api/backend/games/:name/instances/:instance/unlock-precheck → { missing, offlineReferences }
```

Each video-guess instance has an optional `locked?: boolean`. While locked, the save endpoint refuses any change to questions/markers inside that instance (`409 Locked`) and `expectedCacheFilenames()` preserves the instance's segment caches (treated like archive). Unlock calls the precheck endpoint; if any referenced video is missing or offline, the UI shows a confirmation modal before proceeding. Full spec: [video-guess-lock.md](video-guess-lock.md).

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
src/components/backend/questions/Q1Form.tsx
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
