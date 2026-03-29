# Spec: NAS Asset Mount — Auto-Detection + Offline Sync

## Goal
The server auto-detects whether the NAS is mounted at startup and serves assets from the NAS or a separate local fallback directory. Sync scripts allow copying assets NAS→local (for offline use away from home) and pushing local changes back to the NAS.

## Acceptance criteria
- [x] Server detects NAS mount at startup by checking if `/Volumes/Georg/Gameshow/Assets` is accessible as a directory
- [x] When NAS is mounted: assets are served from `/Volumes/Georg/Gameshow/Assets/<folder>`
- [x] When NAS is not mounted: assets are served from `./local-assets/<folder>`
- [x] Server logs which mode it is using at startup (NAS path or local-assets path)
- [x] `categoryDir()` in the server respects the detected asset base — uploads go to the right place
- [x] `npm run sync:pull` copies all 4 asset folders from NAS → `./local-assets/` using rsync
- [x] `npm run sync:pull` exits with a clear error if NAS is not mounted
- [x] `npm run sync:push` syncs `./local-assets/` → NAS (add/update only, no deletions — safe default)
- [x] `npm run sync:push:force` / `tsx sync-assets.ts push --force` mirrors NAS to local exactly (deletes NAS files not present locally)
- [x] `npm run sync:push` exits with a clear error if NAS is not mounted
- [x] Both sync scripts print per-folder progress
- [x] NAS folders and local-assets folders are always separate — no symlinks needed

## State / data changes
- No app state changes — asset path resolution is entirely server-side
- New local asset directory: `./local-assets/{audio,audio-guess,images,background-music}/`
- Server resolves `ASSET_BASE` once at startup: NAS path if mounted, `./local-assets` otherwise

## UI behaviour
- CLI only for sync scripts (`sync-assets.ts`)
- Server logs `[assets] NAS mounted — serving from /Volumes/Georg/Gameshow/Assets` or `[assets] NAS not mounted — serving from ./local-assets`
- Sync scripts print per-folder rsync progress and a summary

## Replaced behaviour
- The symlink-based `mount-assets.ts` / `unmount-assets.ts` approach is superseded — symlinks in the project root are no longer used by the server. Those scripts still exist but are no longer needed for normal operation.

## Out of scope
- Hot-reload of NAS mount status without server restart
- Partial sync of individual subfolders
- Conflict resolution between local and NAS versions
- Automounting on system startup
