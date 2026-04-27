# Spec: Local-First Assets + NAS Sync

## Goal
The server always reads and writes assets from `./local-assets/`. The NAS (`/Volumes/Georg/Gameshow/Assets`) is never used as a live source — it is a backup/sync target only. Sync scripts copy between NAS and local in both directions so the local DAM stays authoritative while the NAS retains an up-to-date mirror.

## Acceptance criteria
- [x] Server always serves assets from `./local-assets/<folder>` — NAS mount status does not affect read paths
- [x] `GET /api/background-music` scans `./local-assets/background-music/`
- [x] Static asset routes (`/images`, `/audio`, `/background-music`, `/videos`) are served from `./local-assets/<folder>` unconditionally
- [x] Uploads (`POST /api/backend/assets/:category/upload`) write to `./local-assets/<category>/`
- [x] `categoryDir()` returns a path under `./local-assets/` — never a NAS path
- [x] Server does not log a "NAS mounted — serving from NAS" message at startup (no such behavior exists)
- [x] `npm run sync:pull` copies all 4 asset folders from NAS → `./local-assets/` using rsync
- [x] `npm run sync:pull` exits with a clear error if NAS is not mounted
- [x] `npm run sync:push` syncs `./local-assets/` → NAS (add/update only, no deletions — safe default)
- [x] `npm run sync:push:force` / `tsx sync-assets.ts push --force` mirrors local to NAS exactly (deletes NAS files not present locally)
- [ ] Reference-only video entries (listed in `local-assets/videos/.video-references.json`) are excluded from `sync:push` / `sync:push:force`. They would either point at the NAS (round-trip) or at a non-NAS volume the NAS shouldn't mirror. Log `[nas-sync] skipping reference <relPath>`. See [video-references.md](video-references.md).
- [x] `npm run sync:push` exits with a clear error if NAS is not mounted
- [x] Both sync scripts print per-folder progress
- [x] NAS folders and local-assets folders are always separate — no symlinks needed; any remaining root-level symlinks (`./background-music`, `./images`) are vestigial and not read by the server

## State / data changes
- No app state changes — asset path resolution is entirely server-side
- Local asset directory: `./local-assets/{audio,audio-guess,images,background-music,videos}/`
- `LOCAL_ASSETS_BASE = path.join(ROOT_DIR, 'local-assets')` — the sole asset root used by the server

## UI behaviour
- CLI only for sync scripts (`sync-assets.ts`)
- Storage state (`{ mode: 'local', path: LOCAL_ASSETS_BASE, nasMounted: boolean }`) is broadcast via the WebSocket `asset-storage` channel — the `nasMounted` flag is informational only (used by the admin System tab) and does not change server behavior
- Sync scripts print per-folder rsync progress and a summary

## Replaced behaviour
- **Conditional NAS serving** — earlier versions detected the NAS at startup and served from `/Volumes/Georg/Gameshow/Assets` when mounted, falling back to `./local-assets` otherwise. This is gone: the server is now unconditionally local-first. NAS is written to only by the sync scripts.
- **Root-level symlinks** (`./background-music`, `./images` → `/Volumes/Georg/...`) from the older `mount-assets.ts` / `unmount-assets.ts` approach are no longer read by the server. Those symlinks and scripts can be removed without affecting runtime.

## Out of scope
- Automatic background sync on file change (sync is manual via CLI)
- Conflict resolution between local and NAS versions beyond the mtime-wins rule in `specs/sync-bidirectional.md`
- Partial sync of individual subfolders
- Automounting the NAS volume on system startup
