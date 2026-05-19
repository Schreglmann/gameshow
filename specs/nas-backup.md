# Spec: NAS Backup Retention

## Goal
`npm run backup` zips the repo's game definitions and the three DAM asset folders (`audio`, `background-music`, `images`) to the NAS at `/Volumes/Georg/Gameshow/Backups/`. The NAS must always retain the **two most recent backup sets** — the freshly created one plus the immediately previous one — so a corrupted or incomplete current run can never destroy the only restore point.

## Acceptance criteria
- [x] Each `npm run backup` run writes one `.zip` per category to `/Volumes/Georg/Gameshow/Backups/` named `{category}-{YYYY-MM-DD_HH-mm-ss}.zip`, where the timestamp suffix is shared across the run's zips (a single "backup set")
- [x] After zips are uploaded, the pruning step keeps the **`BACKUPS_TO_KEEP` (= 2)** most-recent timestamp groups and deletes every zip belonging to older timestamps
- [x] Pruning operates on whole sets — files sharing one timestamp are kept or deleted together; no partial-set retention
- [x] Pruning ignores files that don't match `^(?:games|audio|background-music|images|dam)-(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})\.zip$` (unrelated files on the NAS are untouched)
- [x] First-ever backup (only one timestamp present) prunes nothing
- [x] An interrupted previous run that produced a partial set still counts as one timestamp group; it is retained as the "previous" set until a subsequent successful run promotes the next one in
- [x] The retention count lives in a single named constant (`BACKUPS_TO_KEEP`) at the top of [backup-assets.ts](../backup-assets.ts)

## State / data changes
- No app state. Disk-only behaviour on the NAS volume.
- No new files; existing behaviour of `cleanupStaleArtifacts()` (orphan temp dirs and `.partial` files) is unchanged.

## UI behaviour
- CLI only (`npm run backup`).
- Each deleted older zip is logged as `  ✗ removed old backup: {filename}`.

## Replaced behaviour
- **Keep-one policy** — previously, `pruneOldBackups(keepFilenames)` deleted everything not in the current run's set. That left a single backup on the NAS, so a failed/corrupted run had no fallback. Now replaced by "keep the N most-recent timestamp groups".

## Out of scope
- Configurable retention count via CLI or env (hard-coded constant by design)
- Off-NAS backup destinations
- Restoring from a backup (manual `unzip`)
- Verifying integrity of retained zips
