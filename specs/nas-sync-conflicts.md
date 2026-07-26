# Spec: NAS sync conflicts (surface + resolve refused deletions)

## Goal
Persist the deletions the NAS sync's safety layers *refuse* to perform (Layer 2 loss-ratio vetoes and Layer 3 bulk-delete aborts), show them in the admin **System** tab, and let the operator resolve each one — restore the surviving copy, or confirm the deletion — so the recurring "soft-delete" warning stops firing.

## Background
The bidirectional sync ([sync-bidirectional.md](sync-bidirectional.md)) has three safety layers. Two of them *withhold* deletions when they look like accidental data loss:

- **Layer 2 — per-folder loss-ratio veto** (`applyDeletionSafety`): when a top-level folder (`audio`/`images`/`background-music`/`videos`) has lost ≥5% of its previously-tracked files on one side, that side is treated as suspect and all matching `delete-*` ops are stripped.
- **Layer 3 — bulk-delete hard cap** (`checkBulkDelete`): when the surviving delete ops exceed 5, the entire sync run aborts.

Before this feature both were **fire-and-forget**: Layer 2 emitted a `console.warn` and discarded `safe.vetoes`; Layer 3 emitted a `console.error` + a `bgTaskError`. Because nothing ever resolved the underlying local↔NAS drift, the same warning recurred on every boot and every 5-minute rescan, and the operator had no visibility into *which* files were affected or any way to act.

## Key mechanism
`computeSyncOps` decides delete-vs-copy purely by presence in `prevFiles` (`.sync-state.json`): a one-sided file **in** prev → delete candidate; **not in** prev → new file → push/pull. So a conflict is resolved by acting on the surviving copy and reconciling the sync snapshot:

- **Restore** (default): copy the surviving file to the side that lost it, then upsert the snapshot. The next sync sees it on both sides → in sync.
- **Confirm-delete**: soft-delete the surviving copy (recoverable in `.trash/` for 30 days), then drop it from the snapshot. The next sync sees nothing on either side → no-op.

Either way the drift is gone, so the veto/abort stops recurring. Both reuse existing, incident-hardened helpers (`atomicCopyFile`, `throttledCopyFile`, `softDelete`, `applySnapshotOp`, `makeRunId`) — the resolution never re-runs `computeSyncOps` and so cannot re-trigger the mass-delete scenario the safety layers were built to prevent.

## Acceptance criteria

### Detection & persistence
- [ ] `applyDeletionSafety` returns the exact per-file delete ops it stripped (`strippedOps: SyncOp[]`), in addition to the aggregated `vetoes`. Pure, additive change — existing callers unaffected.
- [ ] `startupSync` and `periodicRescan` reconcile the conflict sidecar on every run: Layer 2 stripped ops → `reason: 'loss-ratio-veto'` (carrying the folder's `lossRatio`); when Layer 3 aborts, the surviving delete ops (`safe.ops`) → `reason: 'bulk-cap'`.
- [ ] Conflicts are stored in `local-assets/.nas-sync-conflicts.json`, a dotfile at the assets-tree root (next to `.sync-state.json`) — **outside** the walked category folders, so it never affects sync.
- [ ] Reconcile is self-healing: a rel already in the sidecar keeps its original `detectedAt` and refreshes `lastSeenAt`; a rel no longer refused this run is dropped automatically (drift healed externally → conflict disappears).
- [ ] The existing `console.warn` / `console.error` / `bgTaskError` messages are unchanged.
- [ ] `nasSyncStats.conflictCount` (in-memory) is seeded from the sidecar at boot and kept current by reconcile + resolve.

### API
- [ ] `GET /api/backend/nas-sync-conflicts` → `{ conflicts: NasSyncConflictEntry[] }`, sorted by folder then rel.
- [ ] `POST /api/backend/nas-sync-conflicts/resolve` with `{ rels: string[], resolution: 'restore' | 'delete' }` resolves a batch in one call (a folder-wide veto can be hundreds of files).
- [ ] Resolve requires the NAS to be reachable (`isNasMounted()`); otherwise `503`.
- [ ] Every `rel` is validated with `isSafePath`; the handler re-verifies current on-disk presence before acting (state may have healed since detection).
- [ ] `restore` copies the surviving file to the missing side (`throttledCopyFile` local→NAS / `atomicCopyFile` NAS→local) and upserts the snapshot; `delete` soft-deletes the surviving copy and drops it from the snapshot. Both then `removeConflict` and decrement `conflictCount`, and persist via `debouncedSaveSyncState()`.
- [ ] Response: `{ resolved: number, failed: { rel: string; error: string }[] }`. A per-file failure never aborts the batch.
- [ ] `conflictCount` is added to the `nasSync` block of the `system-status` WebSocket payload + `GET /api/backend/system-status`.

### UI (admin System tab)
- [ ] A **"NAS-Sync-Konflikte"** card renders after the "NAS-Synchronisation" card.
- [ ] The full list is fetched on mount, refetched whenever `nasSync.conflictCount` changes (live via the existing `system-status` push) and after any resolve.
- [ ] Conflicts are grouped by `folder` + `reason`; each group header shows the folder, file count, and (for `loss-ratio-veto`) the loss %, plus batch buttons **"Alle wiederherstellen"** and **"Alle löschen"**.
- [ ] Each group expands to per-file rows with individual restore (`↻`) / delete (`🗑`) actions.
- [ ] All delete actions (batch + per-file) go through the shared `useConfirm()` dialog.
- [ ] When there are no conflicts, the card shows a subtle "✓ Keine Konflikte".
- [ ] A representative instance appears in `AdminShowcase` (`/theme-showcase`).
- [ ] Responsive at 375 / 768 / 1024 / 1920px.

## State / data changes
- New sidecar: `local-assets/.nas-sync-conflicts.json`, a `Record<string, NasSyncConflictEntry>` keyed by `rel`.
- New in-memory field: `nasSyncStats.conflictCount: number`.
- `system-status` payload / `SystemStatusResponse['nasSync']` gains `conflictCount: number`.
- New API: `GET /api/backend/nas-sync-conflicts`, `POST /api/backend/nas-sync-conflicts/resolve`.
- No AppState / localStorage changes (admin-only, server-side state).

### `NasSyncConflictEntry`
```ts
interface NasSyncConflictEntry {
  rel: string;                              // e.g. "images/Tiere/Fuchs.jpg" (map key)
  action: 'delete-local' | 'delete-nas';   // the refused op; presentSide = delete-local → local, delete-nas → nas
  folder: string;                           // top-level safety folder
  reason: 'loss-ratio-veto' | 'bulk-cap';   // Layer 2 vs Layer 3
  lossRatio?: number;                       // present for loss-ratio-veto (0..1)
  runId: string;                            // sync run that last refused it
  detectedAt: number;                       // first seen (epoch ms) — preserved across rescans
  lastSeenAt: number;                       // most recent rescan that still refused it
}
```

## UI behaviour
- Component: `SystemTab` (new card) + `NasSyncConflictsCard` sub-component; `AdminShowcase` example.
- Restore is the safe default (accidental loss is the common case); delete is styled as the destructive action.
- Edge cases: NAS unreachable → resolve disabled with a hint; a conflict that healed between list-fetch and resolve → handler no-ops on that rel and still clears the record.

## Out of scope
- Reviewing / restoring arbitrary `.trash/` contents (that remains out of scope per [sync-bidirectional.md](sync-bidirectional.md); this feature only resolves *refused deletions*, and confirm-delete's trash is recovered via the existing CLI).
- A manual "re-run sync now" trigger.
- An ignore-list that suppresses a conflict without resolving the drift.
- Conflict handling for the CLI `sync-assets.ts` path (server-only for v1).
