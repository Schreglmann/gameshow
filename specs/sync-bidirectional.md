# Spec: Bidirectional Asset Sync

## Goal
Add a `sync` command that intelligently syncs NAS ↔ local-assets in both directions, using a timestamp state file to detect new files, updates, and deletions on either side.

## Acceptance criteria
- [x] `npm run sync` (or `tsx sync-assets.ts sync`) performs a bidirectional sync
- [x] New file on NAS only (not in last sync state) → copied to local
- [x] New file locally only (not in last sync state) → copied to NAS
- [x] File on both sides, local newer → copied to NAS
- [x] File on both sides, NAS newer → copied to local
- [x] File on both sides, identical mtime → skipped (no copy)
- [x] File was in last sync state, now only on NAS (deleted locally) → deleted from NAS
- [x] File was in last sync state, now only on local (deleted from NAS) → deleted from local
- [x] After every successful sync, `.sync-state.json` is written to both LOCAL_BASE and NAS_BASE
- [x] `.sync-state.json` is excluded from the synced file set (never treated as an asset)
- [x] First-ever sync (no state file on either side) treats all files as "new" — no deletions
- [x] If both state files exist, the more recent one is used as the authoritative previous state
- [x] Covers all 4 folders: audio, images, background-music, videos
- [x] NAS not mounted → error and exit 1
- [x] Summary line at end: "X copied, Y deleted, Z up to date"

## State / data changes
- New file: `LOCAL_BASE/.sync-state.json` and `NAS_BASE/.sync-state.json`
  - Shape: `{ lastSync: string (ISO), files: Record<string, string> }` (relative path → ISO mtime at last sync)
- No changes to AppState, localStorage, or API

## Conflict resolution rules (in priority order)
1. File missing from both state files → treat as new on whichever side it exists; if on both, mtime wins
2. File in state, missing from one side → was deleted on that side; delete from the other side
3. File in state, exists on both → mtime wins (newer overwrites older)
4. File in state, exists on both, identical mtime → skip

## Out of scope
- Three-way merge for text files
- Interactive conflict resolution prompts
- Dry-run mode
- Syncing files outside FOLDERS
