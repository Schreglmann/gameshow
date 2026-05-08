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

### DAM action durability across sync (no revert)

A user action performed in the admin DAM (upload, move, rename, delete) must survive every subsequent bidirectional sync, even if the queued NAS-side op fails, is dropped because the NAS is unmounted, or is lost to a server restart before it ran. Concretely:

- [x] `.sync-state.json` is updated **only** after the individual NAS op in the queue succeeds — never from a one-sided walk of the local filesystem. A failed/lost op leaves the state reflecting the last known in-sync state, so the next sync has correct `prevFiles` to drive recovery.
- [x] **Upload** a new file → on next sync, algorithm sees "local only, not in prev" → `push`. File is not deleted locally.
- [x] **Rename** a file or folder → on next sync, algorithm sees old paths "NAS only, in prev" → `delete-nas`, and new paths "local only, not in prev" → `push`. Folder/file is not renamed back.
- [x] **Move** a file (same category, or across `audio`↔`background-music`) → same recovery as rename.
- [x] **Delete** a file → on next sync, algorithm sees "NAS only, in prev" → `delete-nas`. File does not reappear locally.
- [x] Recursive folder delete: deleting a folder via the DAM also removes every file under it from the in-memory sync-state snapshot, so a later sync does not re-pull the folder's children from NAS.
- [x] Folder move: all snapshot entries under the old folder prefix are rewritten to the new folder prefix when the NAS move op succeeds.

## State / data changes
- New file: `LOCAL_BASE/.sync-state.json` and `NAS_BASE/.sync-state.json`
  - Shape: `{ lastSync: string (ISO), files: Record<string, string> }` (relative path → ISO mtime at last sync)
- No changes to AppState, localStorage, or API

## Conflict resolution rules (in priority order)
1. File missing from both state files → treat as new on whichever side it exists; if on both, mtime wins
2. File in state, missing from one side → was deleted on that side; delete from the other side
3. File in state, exists on both → mtime wins (newer overwrites older)
4. File in state, exists on both, identical mtime → skip

## Safety guarantees

After the 2026-05 incident in which `local-assets/images/` was wiped — most likely by a `pull` or bidirectional `sync` running while the NAS-side `images/` was empty (degraded mount, wrong volume, share permissions broken) — the sync code carries three independent layers of protection. Each layer alone is sufficient to prevent that scenario from repeating; together they form defence in depth.

### Layer 1 — Soft-delete to `.trash/`
Any operation that would remove a file (whether `delete-local`, `delete-nas`, or rsync `--delete` semantics) **moves the file to `<base>/.trash/<runId>/<rel>` instead of unlinking it**. The directory structure under the run-ID folder mirrors the original path so restore is `mv <base>/.trash/<runId>/* <base>/`.

- [x] `runId` is the ISO timestamp of the current sync run (e.g. `2026-05-08T18-45-12-345Z`)
- [x] On both LOCAL_BASE and NAS_BASE, `.trash/` is treated as hidden (already excluded by the `.`-prefix walk filter)
- [x] At the start of every sync run, trash directories whose `runId` folder mtime is older than 30 days are deleted (best-effort GC; failures are logged but don't abort the sync)
- [x] If the trash target already exists (idempotent retry of the same op), append `.1`, `.2`, … to the filename

### Layer 2 — Per-folder empty-side veto
Inside `computeSyncOps`, before producing any `delete-local` op for files in a top-level folder F, check: if the previous-sync state had ≥ 1 entry in F, the NAS scan returned **zero** files for F, and local still has ≥ 1 file in F → assume a mount/permission failure and **strip every `delete-local` op for F** with a loud warning. Symmetric rule for `delete-nas` (zero local files in F + prev had ≥ 1 in F + NAS still has ≥ 1).

- [x] Top-level folders covered by veto: `audio`, `images`, `background-music`, `videos`
- [x] Veto applies per folder independently — a non-empty folder F1 with a partial deletion does not block its deletes when F2 is suspect
- [x] CLI sync prints a warning per vetoed folder; server sync logs a warning per vetoed folder and continues with the filtered op set
- [x] `pull()` and `push()` (rsync-based) get the same preflight: if the source folder is empty but the destination still has files, refuse to run unless `--force` is passed

### Layer 3 — Bulk-delete cap (backstop)
After per-folder veto, if total `delete-local` + `delete-nas` ops exceed `max(50, 5% of total tracked files)` → abort the entire sync (push and pull included) and report a clear error.

- [x] Threshold is computed from `(localFiles.size + nasFiles.size)` at scan time
- [x] Override: CLI accepts `--force-bulk-delete`; server-side syncs do not auto-override (the run aborts and surfaces a `bgTaskError`)
- [x] When the cap aborts, no ops execute (the run is fully transactional in this respect)
- [x] The aborted run does not write `.sync-state.json` — the next sync re-evaluates from the same prev state

## Out of scope
- Three-way merge for text files
- Interactive conflict resolution prompts
- Dry-run mode
- Syncing files outside FOLDERS
- An admin UI for reviewing trash contents and triggering restores (the CLI move is sufficient for v1)
