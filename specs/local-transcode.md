# Spec: Local-First Asset Storage with Async NAS Sync

## Goal
All file operations (uploads, deletes, moves, serving) use local-assets for maximum performance. NAS is synced asynchronously in the background. Multiple machines sharing the same NAS converge to the same state, including deletion propagation.

## Acceptance criteria
- [x] `categoryDir()` always returns `LOCAL_ASSETS_BASE/{category}` regardless of NAS mount state
- [x] All uploads write to local-assets first, then sync to NAS in background
- [x] All deletes operate on local-assets first, then queue NAS deletion
- [x] All moves/renames operate on local-assets first, then queue NAS move
- [x] Static file serving uses only local-assets (no NAS comparison middleware)
- [x] `resolveVideoPath()` returns local path only
- [x] NAS sync uses bandwidth throttling (2 MB/s) when video is playing
- [x] Server-side stream detection via `POST /api/backend/stream-notify`
- [x] Frontend `notifyStreamStart()`/`notifyStreamEnd()` notify server
- [x] Startup bidirectional sync using `.sync-state.json` on both sides
- [x] Deletion propagation: file deleted on machine A → NAS sync → machine B startup sync → deleted on B
- [x] Sync queue retries every 30s when NAS disconnects mid-sync
- [x] Atomic NAS writes using `.tmp` + rename
- [x] NAS-Sync status visible in System tab (status, queue, current op, progress, bytes synced)
- [x] Startup sync progress shown as background task
- [x] `mirrorCacheToNas` and `mirrorHdrCacheToNas` route through sync queue
- [x] Stale `.transcoding.*` temp files cleaned up on startup
- [x] Existing tests still pass

## State / data changes
- `categoryDir()` no longer checks `isNasMounted()`
- `mirrorToLocal()`, `localCategoryDir()`, `ensureLocalVideo()`, `mirrorVideoToNas()` removed
- New: `NasSyncOp` type, `nasSyncQueue`, `nasSyncStats`, `queueNasSync()`, `processNasSyncQueue()`
- New: `throttledCopyFile()` — chunked streaming with bandwidth throttling
- New: `startupSync()` — bidirectional sync using `.sync-state.json`
- New: `SyncState` interface, `readSyncState()`, `writeSyncState()`, `walkFilesSync()`
- New: `POST /api/backend/stream-notify` endpoint
- `BackgroundTask.type` extended with `'nas-sync' | 'startup-sync'`
- `SystemStatusResponse` extended with `nasSync` field
- System tab shows NAS-Synchronisation card

## Out of scope
- Resuming interrupted transcodes from where they left off
- Real-time file watching (inotify/fsevents) for instant sync
- Conflict resolution UI (last-writer-wins by mtime is sufficient)
