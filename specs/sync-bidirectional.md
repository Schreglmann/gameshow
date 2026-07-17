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
- [x] **Delete** a file → DAM enqueues a `move-to-trash` NAS op that mirrors the local rename into `<NAS>/<category>/.trash/<batchId>/<rel>`; the snapshot drops the entry once the queue completes the move. Both sides leave the active path together — the sync algorithm never sees an asymmetric window and emits no ops. The previous deferred-NAS-delete model let the rescan generate `delete-nas` ops that hit Layer 3's hard cap for batches >5 files and could (via the silent `rm` failure swallow that has since been removed) drop the entry from prev while NAS still had the file, after which the next sync pulled it back. See "Symmetric trash" below.
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

After the 2026-05-08 incident in which `local-assets/images/` was wiped — most likely by a `pull` or bidirectional `sync` running while the NAS-side `images/` was empty (degraded mount, wrong volume, share permissions broken) — the sync code carries three independent layers of protection. Each layer alone is sufficient to prevent the full-folder-empty scenario; together they form defence in depth.

The 2026-05-14 incident exposed three interacting failure modes:

1. **Unicode normalization mismatch** (root cause). SMB shares on macOS return file names in NFD form (decomposed: `O` + combining diaeresis), while local-assets on APFS holds them in NFC (composed: `Ö`). `computeSyncOps` keyed the local-scan / NAS-scan / prev-state maps with raw filesystem strings — so a file like `Hitradio Ö3.mp3` appeared under one key in the local map and a different key in the NAS map. The algorithm read this as "file is in prev + on local, but missing from NAS" and emitted `delete-local`. Every file with a German/French/Spanish character (≥ 50 entries in the state file) was vulnerable.
2. **Partial NAS data loss + lenient Layer 2.** NAS lost ≈14% of `images/` (not 100%), so the original Layer 2 "entire folder empty" check did not fire. The 174 affected files compounded the NFC mismatches.
3. **Layer 3 too lenient + failed-op state pollution.** Layer 3's `max(50, 5%)` cap admitted up to 1400 deletes for a 28k-file library, so 466 files were trashed across two consecutive sync runs. Separately, `buildNewSyncState` recorded files for ops that had not yet executed — so a failed push left the file marked as "in sync", and the next sync read it as "in prev + missing on NAS" → `delete-local`.

The fixes below close all three holes. The hard invariants are now:

- All filesystem-derived paths and all sync-state keys are NFC-normalized.
- A single sync run can never trash more than 5 files.
- Partial folder loss (≥ 5%) aborts every delete for the affected folder.
- Failed ops do not pollute the next run's prev state.

### Layer 1 — Soft-delete to `.trash/`
Any operation that would remove a file (whether `delete-local`, `delete-nas`, or rsync `--delete` semantics) **moves the file to `<base>/.trash/<runId>/<rel>` instead of unlinking it**. The directory structure under the run-ID folder mirrors the original path so restore is `mv <base>/.trash/<runId>/* <base>/`.

- [x] `runId` is the ISO timestamp of the current sync run (e.g. `2026-05-08T18-45-12-345Z`)
- [x] On both LOCAL_BASE and NAS_BASE, `.trash/` is treated as hidden (already excluded by the `.`-prefix walk filter)
- [x] At the start of every sync run, trash directories whose `runId` folder mtime is older than 30 days are deleted (best-effort GC; failures are logged but don't abort the sync)
- [x] If the trash target already exists (idempotent retry of the same op), append `.1`, `.2`, … to the filename

### Layer 2 — Per-folder loss-ratio veto
Inside `applyDeletionSafety`, for each top-level folder F in `SAFETY_FOLDERS`: if the previous-sync state had ≥ 1 entry in F and **≥ 5% of those entries are missing from one side**, that side is treated as suspect. All `delete-*` ops driven by the suspect side are stripped with a loud warning.

The 5% threshold catches both "entirely empty folder" (the 2026-05-08 mount-degraded case at 100% loss) and partial losses (the 2026-05-14 incident at 14%) under a single rule, while remaining well above the 1–3 deletes a user typically performs at a time.

- [x] Top-level folders covered by veto: `audio`, `images`, `background-music`, `videos`
- [x] Per-folder threshold: `FOLDER_LOSS_RATIO_THRESHOLD = 0.05` (5%)
- [x] Veto applies per folder independently — a low-loss folder F1's legitimate single delete is not blocked when F2 is suspect
- [x] Each veto carries the measured `lossRatio` so the warning can report the actual figure (e.g. `"images/" lost 14.3% of prev-state files on NAS`)
- [x] CLI sync prints a warning per vetoed folder; server sync logs a warning per vetoed folder and continues with the filtered op set
- [x] `pull()` and `push()` (rsync-based) get the same preflight: if the source folder is empty but the destination still has files, refuse to run unless `--force` is passed

### Layer 3 — Bulk-delete hard cap (backstop)
After per-folder veto, if total `delete-local` + `delete-nas` ops exceed **`BULK_DELETE_HARD_CAP = 5`** → abort the entire sync (push and pull included) and report a clear error.

The previous `max(50, 5% of total)` cap scaled with library size and admitted hundreds of deletes per run; a flat hard cap of 5 means library size no longer scales the blast radius. User-initiated bulk deletes (via the admin DAM) go through `queueNasDelete`/`queueNasMove` directly — they do **not** pass through `computeSyncOps` and therefore do not count toward this cap.

- [x] Threshold is a flat constant — not derived from tracked file count
- [x] Override: CLI accepts `--force-bulk-delete`; server-side syncs do not auto-override (the run aborts and surfaces a `bgTaskError`)
- [x] When the cap aborts, no ops execute (the run is fully transactional in this respect)
- [x] The aborted run does not write `.sync-state.json` — the next sync re-evaluates from the same prev state

### Failed-op state hygiene (root-cause fix)
`buildNewSyncState` accepts a `failedOps: Set<string>` of paths whose op failed. Failed-op files are **omitted** from the new state — so the next sync sees them as "not in prev" and retries the push/pull instead of misinterpreting them as a user delete.

- [x] `buildNewSyncState` is called **after** the op loop, with the populated `failedOps` set
- [x] All three call sites (CLI `sync`, server `startupSync`, server `periodicRescan`) wrap each op in `try/catch` and add the rel path to `failedOps` on error
- [x] The previous pattern — building the state up front then mutating it via `delete newState.files[op.rel]` for deletes — is gone; per-op success is the only source of truth

### Queue-pending guard for periodic rescan
`periodicRescan` skips its run when the per-op NAS queue (`nasSyncQueue`) is non-empty or actively running. Admin DAM ops (upload, rename, move, delete) enqueue NAS work and only update the sync-state snapshot after success; rescanning mid-flight would see inconsistent state and could trash a file the DAM is still trying to copy.

- [x] Skip if `nasSyncQueue.length > 0` OR `nasSyncRunning`
- [x] Skip is logged and retried on the next 5-minute interval — does not advance the clock

### Unicode NFC normalization (root-cause fix for 2026-05-14)
Every path that crosses the sync boundary is held in Unicode NFC form. SMB shares can return NFD-encoded names while APFS uses NFC; without normalization the same logical file appears under two different string keys and `computeSyncOps` misreads the mismatch as deletion intent.

- [x] `walkFiles` (server + CLI) `.normalize('NFC')` the relative path before pushing it to the result list
- [x] `parseSyncState` normalizes every state-file key to NFC on load — covers state files written before this fix
- [x] A one-shot migration (`scripts/migrate-sync-state-nfc.cjs`) rewrites the on-disk state file so the next save is byte-clean and doesn't churn the diff
- [x] Admin DAM ops feed `applyOpToSyncSnapshot` with paths derived from `local-assets` writes, which are NFC; no separate normalization layer needed there

### Stripped-op label correctness
The Layer 2 warning labels each vetoed op by its target side, not the suspect (lossy) side. `v.side === 'local'` means a `delete-local` op was stripped — the NAS side is suspect of data loss. The warning prints both: the lossy side appears in the "lost X% of prev-state files on Y" clause, and the stripped op kind appears as "skipping N delete-Y op(s)". The previous code inverted the action label (`v.side === 'local' ? 'delete-nas' : 'delete-local'`), so admins saw misleading messages while triaging the 2026-05-14 incident.

### Symmetric trash (2026-05-14 follow-up: "files restored after delete")

When the DAM moves a file into local `.trash/<batchId>/<rel>`, it now also enqueues a `move-to-trash` NAS op that renames `<NAS>/<category>/<rel>` → `<NAS>/<category>/.trash/<batchId>/<rel>`. Both sides leave the active path at the same moment. Because `.trash/` is dotfile-filtered by every walk (see `shouldSkipDirent`), neither walk sees the file after the move; the snapshot drops the entry via `applyOpToSyncSnapshot` when the queue completes. The sync algorithm and its Layer 2/3 safety nets are never invoked for DAM-driven deletes — matching the long-standing claim that user-initiated deletes bypass `computeSyncOps`.

- [x] `NasSyncOp` gains two variants: `move-to-trash` (snapshot effect: delete `relFrom`) and `restore-from-trash` (snapshot effect: upsert `relTo` from the local file's mtime). Both use `rename` with an `atomicCopyFile + unlink` cross-fs fallback; ENOENT on the source is treated as idempotent success.
- [x] DAM DELETE handler (`server/index.ts` `DELETE /api/backend/assets/:category/*splat`) enqueues `queueNasMoveToTrash` immediately after the local rename.
- [x] `restoreTrashEntries` (covers `/undo-delete` and `/trash/restore`) enqueues `queueNasRestoreFromTrash` after the local rename back to the active path; the snapshot is upserted from the local file's mtime so the next sync sees both sides aligned.
- [x] `purgeTrashEntries` enqueues `queueNasPurgeTrashEntry(category, batchId, relPath)` (targeting the NAS-side `.trash/` mirror, not the now-empty active path). When the batch dir empties, `queueNasPurgeTrashBatch` drops the empty NAS batch dir.
- [x] Stale-trash GC mirrors `purgeStaleTrash` for the NAS side: `purgeStaleNasTrash` sweeps `<NAS>/<category>/.trash/*` batches older than `TRASH_TTL_MS` at startup and on every periodic rescan.
- [x] Legacy migration: local-only `.trash/<batchId>/` batches created before this fix have no NAS counterpart. `queueNasPurgeTrashEntry` and `queueNasRestoreFromTrash` both tolerate ENOENT on the NAS source, so these legacy batches purge/restore cleanly without code-side migration. The 24h `TRASH_TTL_MS` removes them within a day.
- [x] NAS-offline edge: `queueNasSync` short-circuits when the NAS is unmounted, so the move-to-trash op is dropped. The local file is still in `.trash/`, the NAS file is still active, the snapshot still tracks it. On the next rescan, `computeSyncOps` falls back to emitting `delete-nas` for the affected files; for ≤5 files this clears via the queue, and for >5 files Layer 3 aborts the sync. The user can either purge the trash (which re-enqueues NAS-side deletes against the now-empty active path; the queue tolerates ENOENT) or wait for the NAS to come back online before deleting larger batches.

### Silent rm failure removed (2026-05-14 root cause #2)

`processNasSyncQueue`'s `delete` branch previously wrapped `rm(...)` in `.catch(() => {})`. Any NAS-side rm failure (EBUSY, EACCES, transient SMB glitch, …) was silently swallowed and the surrounding `try` block treated the op as successful — which then called `applyOpToSyncSnapshot` and dropped the entry from the in-memory snapshot. NAS still had the file, but `prevFiles` no longer did. The next rescan read this as "on NAS, not in prev, not in local" → `pull` op → file restored to local DAM.

- [x] The `.catch(() => {})` is gone; rm errors propagate to the outer `try/catch`, which shifts the op off the queue without applying the snapshot mutation.
- [x] ENOENT is the only tolerated error (idempotency: the file is already gone, which is success).
- [x] The same idempotent ENOENT handling applies to the `move-to-trash` / `restore-from-trash` source path so legacy local-only batches don't error out at purge time.

### Audit follow-ups (2026-05-15)

After the NFC fix landed, a follow-up audit found additional sync-safety holes. Each was fixed in the same session:

**Atomic state writes** — `writeSyncState` (server) and `writeSyncStateFile` (CLI) now write to `<path>.tmp` then `rename`. A crash mid-write previously left a truncated JSON that `parseSyncState` silently dropped to `{}` — and an empty prev state disables Layer 2 (no denominator → no veto fires), re-exposing the mass-delete scenario after any post-write crash.

- [x] Both writers use `.tmp + rename` and clean up the tmp on error

**Atomic pulls / copy-to-local** — `atomicCopyFile(src, dest)` (server) and the CLI `copyFile` helper now write to `<dest>.tmp` then `rename`. Pre-fix, an interrupted pull left a half-written JPEG/MP3 the DAM and streamer could serve. The push path already had this protection via `throttledCopyFile`; pulls now match.

- [x] Both `startupSync` and `periodicRescan` pull branches use `atomicCopyFile`
- [x] The queue `copy-to-local` op uses `atomicCopyFile`
- [x] The cross-filesystem branch of the queue `move` op uses `atomicCopyFile`
- [x] CLI `copyFile` helper uses `.tmp + rename`

**NFC normalization at the queue chokepoint** — `queueNasSync` normalizes `op.rel`, `op.relFrom`, `op.relTo` to NFC before pushing to the queue. Pre-fix, admin DAM helpers (`queueNasCopy/Delete/Move/MoveCross`) built `rel = path.join(category, relPath)` from request-supplied strings without normalizing; a multipart upload or a route param carrying NFD bytes would seed the snapshot with an NFD key, and the next filesystem walk's NFC key would not match → false delete.

- [x] `queueNasSync` is the single chokepoint — every admin DAM op goes through it
- [x] `setSyncStateSnapshot` also re-normalizes keys defensively, so a wholesale replace by `startupSync` / `periodicRescan` cannot reintroduce NFD

**Harmonized filesystem-walk filters** — `shouldSkipDirent(name)` is exported from `nas-sync.ts` and used by **both** the server `walkFiles` and the CLI `walkFiles`. Pre-fix, the CLI walk was much narrower (only `.smbdelete*`, `.smbtemp*`, `.trash`) while the server walk skipped all dotfiles, `*.transcoding.*`, and the `backup/` folder. Running `npm run sync` after the server had run added internal-state files and `backup/` contents to the shared `.sync-state.json`, and the next server periodic-rescan saw those as "in prev + missing locally" → false `delete-nas`.

- [x] Both walks call `shouldSkipDirent` — no other filtering logic at the call sites
- [x] Skipped categories: all dotfiles, `*.transcoding.*`, `backup/`

**Trash GC tolerates a stray `.trash` file** — `pruneTrash` now checks `statSync(trashDir).isDirectory()` before calling `readdirSync`. Pre-fix, an accidental file at `<base>/.trash` made `readdirSync` throw ENOTDIR; the generic `cannot read` warning masked the cause, and GC silently disabled itself.

**Unique `runId` per run** — `makeRunId` appends a 4-character random suffix to the ISO timestamp (`2026-05-08T18-45-12-345Z-abcd`). Two sync runs starting in the same millisecond (e.g. the queue retry interval firing during a manual CLI sync) now get distinct trash folders, preserving the forensic mapping of "what was trashed by which run".

### Trash-intent override (2026-05-18 follow-up)

Layer 2 and Layer 3 were originally tuned on the assumption that **every** legitimate user-driven delete goes through the DAM's fast path (local rename → `queueNasMoveToTrash`) and therefore bypasses `computeSyncOps`. That assumption breaks whenever the NAS-side queue op fails or is dropped:

- `queueNasSync` silently returns when the NAS is unmounted (see [server/index.ts](../server/index.ts) — the `!isNasMounted()` early-return).
- The queue tolerates `ENOENT`/`EXDEV` for `move-to-trash` but throws on `EBUSY`, `EACCES`, and other unexpected errors, dropping the op without applying the snapshot mutation.

When either happens, the local file is in `.trash/<batchId>/<rel>` but the NAS file is still at its active path and the snapshot still tracks the entry. The next sync run sees this as `delete-nas` (recovery), which is **correct** — but for any DAM bulk-delete of more than 5 files, Layer 3's cap aborted the entire run, and a ≥5% local "loss" tripped Layer 2's symmetric local-suspect branch and stripped the recovery ops outright.

The fix is a fourth signal: the **trash-intent set**, a set of `<folder>/<rel>` paths currently sitting under any local `<base>/<folder>/.trash/<batchId>/` batch. A file's presence in this set is direct on-disk evidence that the DAM intentionally trashed it, and the corresponding `delete-nas` op is recovery, not unexplained drift.

- [x] [server/nas-walk.ts](../server/nas-walk.ts) exports `collectTrashedRelPaths(baseDir, folders)`. The walk descends into `<base>/<folder>/.trash/<batchId>/` (Layer 1 dotfile filter normally skips it). Paths are NFC-normalized and keyed as `<folder>/<rel>` to match `computeSyncOps` keys.
- [x] `applyDeletionSafety` takes an optional `intentBackedDeleteNasRels: ReadonlySet<string>` parameter. Files in the set are **excluded from the local-loss-per-folder count**, so a ≥5% DAM bulk-delete no longer trips the symmetric local-suspect branch. NAS-loss accounting is unchanged — trash-intent only describes the local side.
- [x] `checkBulkDelete` takes the same optional parameter. Trash-backed `delete-nas` ops are excluded from `totalDeletes` so they do not count toward the 5-file cap. `delete-local` always counts regardless (it is exactly the NAS-data-loss scenario the cap protects against, and a coincidental local-trash entry must not mask it).
- [x] Both [`startupSync`](../server/index.ts) and [`periodicRescan`](../server/index.ts) build the trash-intent set in parallel with the local + NAS walks and pass it through both layers.
- [x] The CLI [`sync`](../sync-assets.ts) path (`applySafetyLayers`) does the same with a sync-style trash walker mirroring the server's async version.
- [x] When local trash is purged (TTL or batch-replacement), the intent set shrinks naturally — recovery ops for files whose trash expired fall back to the original Layer 3 cap behavior. Purging trash is itself a "yes, really delete" signal.

The fix is additive: omitting the new parameter preserves the pre-fix behavior, so existing tests and external callers continue to work unchanged.

## Operational: diagnostics

When `startup-sync` keeps logging the Layer 2 / Layer 3 messages on every restart, drift between `.sync-state.json` and the NAS scan is the cause. Run `npm run diagnose:sync` (read-only) to attribute the drift:

- Loads both `.sync-state.json` files and picks the more recent prev via `resolvePrevFiles`.
- Walks `local-assets/` and the NAS share via the shared `collectFileMetadata` ([server/nas-walk.ts](../server/nas-walk.ts)) — same filter the server uses.
- Per folder, prints the four sync-op populations: `delete-local`, `delete-nas`, `push`, `pull`.
- For every would-be `delete-local`, re-stats the NAS path directly (concurrency 8) and buckets the result: `OK` (walk missed it → SMB enumeration truncation), `ENOENT` (file truly absent), `other` (permission / EBUSY / …).
- Runs the NAS walk a second time and diffs — non-deterministic results are an independent signal of SMB truncation.

The output tells you which root cause dominates (walk-side or NAS-side) before you take any destructive action. The script never writes to `.sync-state.json` and exits 0.

The shared `walkFiles` / `collectFileMetadata` in [server/nas-walk.ts](../server/nas-walk.ts) and the `NAS_BASE` / `LOCAL_ASSETS_BASE` constants in [server/asset-paths.ts](../server/asset-paths.ts) are the single source of truth for both the server's startup/periodic sync and the diagnostic — keep them in sync if either path changes.

## Surfacing & resolving refused deletions

Layer 2 vetoes and Layer 3 aborts *withhold* deletions but, before [nas-sync-conflicts.md](nas-sync-conflicts.md), left no durable record — so the same warning recurred on every boot and rescan with no way to act. That spec adds a persisted conflict sidecar (`local-assets/.nas-sync-conflicts.json`), an admin **System**-tab card listing the refused deletions, and per-file / per-folder resolution (restore the surviving copy, or confirm the deletion). Resolution reconciles `.sync-state.json` via the existing snapshot mutators and never re-runs `computeSyncOps`, so it cannot re-trigger the incidents these layers protect against. See [nas-sync-conflicts.md](nas-sync-conflicts.md) for the full contract.

## Out of scope
- Three-way merge for text files
- Interactive conflict resolution prompts
- Dry-run mode
- Syncing files outside FOLDERS
- An admin UI for reviewing arbitrary trash contents and triggering restores (the CLI move is sufficient for v1; note [nas-sync-conflicts.md](nas-sync-conflicts.md) does add a UI for resolving *refused deletions*, which is a distinct, narrower surface)
