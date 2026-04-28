# Spec: Reference-Only Videos in DAM

## Goal
Allow large video source files to live on external volumes (NAS, external drives) instead of being copied into `local-assets/videos/`. A reference appears in the DAM like any copied video — same card, preview, metadata, game usage — but is marked with a badge. When the source volume is disconnected, the reference is shown as "Offline" (never auto-removed). YouTube downloads are unchanged (always copied locally).

## Acceptance criteria

### Storage
- [ ] Reference videos are stored as symlinks at `local-assets/videos/<relpath>` pointing at the absolute source path
- [ ] A new sidecar registry `local-assets/videos/.video-references.json` records each reference as `{ [relPath]: { sourcePath: string, addedAt: number } }`
- [ ] The registry is dotfile-excluded from DAM listings (existing `startsWith('.')` filter)
- [ ] When a reference is added, moved, or removed, the registry is updated atomically (write tmp → rename)
- [ ] Deleting a reference removes the symlink and registry entry only — the source file is never touched
- [ ] Renaming or moving a reference inside `local-assets/videos/` is allowed; the symlink moves and the registry key is updated to the new relative path

### Upload flow
- [ ] The video upload modal shows two choices: **"Lokale Kopie"** (default, current behavior) and **"Als Referenz"**
- [ ] YouTube downloads (`POST /api/backend/assets/videos/youtube-download`) ignore this choice and always copy locally
- [ ] Picking "Als Referenz" opens a server-side directory browser component
- [ ] Picking a file in the browser calls `POST /api/backend/assets/videos/add-reference` and closes the modal on success
- [ ] After reference add, the card immediately shows up in the DAM with the **Ref** badge; duration, HDR metadata, and movie poster populate via the same background pipeline as a regular upload
- [ ] Attempting to add a reference whose target name already exists in the DAM is rejected with a clear error message

### Reference browser
- [ ] `GET /api/backend/assets/videos/reference-roots` returns `{ roots: [{ path, reachable }] }` — the configured allowed roots (env var `GAMESHOW_REFERENCE_ROOTS`, defaults: `/Volumes`, `/mnt`, `/media`); `reachable` is `true` iff the directory currently exists
- [ ] `GET /api/backend/assets/videos/reference-browse?path=<abs>` returns `{ path, parent, entries }` where `entries` are directories and video files (filtered by extension) at that path; dirs first, then files, each sorted by name
- [ ] The browse endpoint rejects any path outside the allowed roots with `403`
- [ ] The browse endpoint returns `404` if the path does not exist or is not reachable (NAS unmounted)
- [ ] The browser UI shows breadcrumb navigation, dir/file rows, a root picker (if at root level), and a "Referenz hinzufügen" action on file rows
- [ ] The browser UI shows an error state when a previously-reachable root is currently unreachable

### Presence indicator
- [ ] `AssetFileMeta.reference?: { sourcePath: string; online: boolean }` is populated in the `GET /api/backend/assets/videos` response for every file that appears in the registry
- [ ] `online` is `true` iff `existsSync(symlinkPath)` returns true (i.e. the symlink is not dangling)
- [ ] DAM card shows a purple **"Ref"** badge for online references (tooltip: source path)
- [ ] DAM card shows a red **"Offline"** badge with warning icon for references whose source is currently unreachable
- [ ] Metadata already probed earlier (duration, poster, HDR) is still shown for offline references
- [ ] Preview playback is disabled for offline references (attempting to play shows a brief status line "Quelldatei nicht erreichbar")
- [ ] Delete confirmation copy for references reads "Nur die Referenz wird entfernt. Die Quelldatei bleibt unangetastet."

### NAS sync
- [ ] The NAS-sync queue skips reference files (checked against the registry before enqueueing)
- [ ] Log line `[nas-sync] skipping reference <relPath>` is emitted for each skipped file

### Data integrity
- [ ] On server startup, the registry is loaded once. If a registry entry exists but no symlink is present at the expected path (e.g. a user manually deleted the symlink), the stale entry is pruned and logged
- [ ] If a symlink exists but no registry entry is found, it is treated as a regular file (not a reference) — the registry is the source of truth for "is-a-reference"

## State / data changes

**Server**
- New module: `server/video-reference-map.ts` — mirrors `server/asset-alias-map.ts` (read/add/remove/list, atomic write)
- New endpoints:
  - `POST /api/backend/assets/videos/add-reference` body `{ sourcePath, subfolder?, name? }` → creates symlink + registry entry + triggers post-upload pipeline
  - `GET /api/backend/assets/videos/reference-roots` → configured + reachable roots
  - `GET /api/backend/assets/videos/reference-browse?path=<abs>` → directory listing
- Extended endpoints:
  - `GET /api/backend/assets/videos` populates `AssetFileMeta.reference` for matching files
  - `DELETE /api/backend/assets/:category/:path` (videos only): if `path` is a reference, remove symlink + registry entry only
  - `PATCH /api/backend/assets/:category/:path` (rename/move, videos only): update registry key when a reference is moved

**Types (`src/types/config.ts`)**
- `AssetFileMeta.reference?: { sourcePath: string; online: boolean }`

**Frontend**
- New component: `src/components/backend/ReferenceBrowser.tsx`
- `src/services/backendApi.ts`: `addVideoReference()`, `browseReferencePaths()`, `listReferenceRoots()`
- `src/components/backend/UploadContext.tsx` (or dedicated upload modal): adds "Kopie/Referenz" choice for videos, opens ReferenceBrowser for "Referenz"
- `src/components/backend/AssetsTab.tsx`: renders Ref/Offline badges and adjusts delete confirmation copy

**Configuration**
- Env var `GAMESHOW_REFERENCE_ROOTS` (colon-separated absolute paths, default: `/Volumes:/mnt:/media`)

## UI behaviour

**Upload modal (videos)**
- Two-button row before the drop zone: `[Lokale Kopie]` (pre-selected) · `[Als Referenz]`
- "Lokale Kopie" shows the existing drop/pick UI unchanged
- "Als Referenz" replaces the drop zone with a "Quelle wählen…" button that opens the ReferenceBrowser modal

**ReferenceBrowser modal**
- Title: "Videoquelle auswählen"
- Root picker (only at top level): shows each reachable root as a large button; unreachable roots are dimmed with a subtitle "Nicht verbunden"
- Inside a folder: breadcrumb trail at the top (clickable segments), "Übergeordneter Ordner" row (unless already at root), then folders (📁) above files (🎬). Files show filename + size; folders show name only
- File row has a "Referenz hinzufügen" button; clicking it triggers add-reference and closes the modal on success
- Target subfolder selector inside the modal (default: currently-open DAM folder)

**DAM card**
- Ref badge: small purple pill, positioned top-right of the card
- Offline badge: red pill with warning icon; replaces the Ref badge when offline
- Tooltip on hover: full source path

## Out of scope
- Reference-only for audio or background-music (videos only for now)
- Automatic "reconnection" attempts (the user physically reconnects the NAS; no polling)
- Editing a reference's source path via UI (workaround: remove + re-add)
- Symlink support on Windows (project is darwin/linux only)
- Copying a reference file to local after the fact (workaround: remove reference, then re-upload as copy)

## Edge cases
- If a user removes a symlink manually but leaves the registry entry: server self-heals on listing (prunes stale entry, logs `[video-refs] pruned stale entry <relPath>`)
- If the symlink target is unreachable during cache generation (ffmpeg): fail with the existing ffmpeg error path; user should reconnect and retry
- If a reference is deleted while its cache segments exist: existing `pruneUnusedCaches()` will remove them on the next save (unless a locked instance still references them — see [video-guess-lock.md](video-guess-lock.md))
