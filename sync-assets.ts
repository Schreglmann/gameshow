import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  readdirSync,
} from 'fs';
import path from 'path';
import {
  applyDeletionSafety,
  buildNewSyncState,
  checkBulkDelete,
  computeSyncOps,
  makeRunId,
  parseSyncState,
  resolvePrevFiles,
  SAFETY_FOLDERS,
  type FileMeta,
  type SyncOp,
  type SyncState,
} from './server/nas-sync.js';
import { pruneTrash, softDelete } from './server/sync-safety.js';

const NAS_BASE = '/Volumes/Georg/Gameshow/Assets';
const LOCAL_BASE = path.join(process.cwd(), 'local-assets');
const FOLDERS = SAFETY_FOLDERS;
const SYNC_STATE_FILE = '.sync-state.json';

const args = process.argv.slice(2);
const command = args[0];
const force = args.includes('--force');
const forceBulkDelete = args.includes('--force-bulk-delete');

function isNasMounted(): boolean {
  try {
    return statSync(NAS_BASE).isDirectory();
  } catch {
    return false;
  }
}

/** Build the list of rsync --exclude flags for the videos folder.
 *  Reference-only videos (local symlinks to external sources) and the registry file
 *  are excluded from NAS sync — syncing them would either create dangling symlinks on
 *  the NAS or prune local references that aren't on the NAS. See specs/video-references.md. */
function videoReferenceExcludes(): string[] {
  const mapFile = path.join(LOCAL_BASE, 'videos', '.video-references.json');
  const flags = ["--exclude='.video-references.json'"];
  if (!existsSync(mapFile)) return flags;
  try {
    const parsed = JSON.parse(readFileSync(mapFile, 'utf8')) as Record<string, unknown>;
    for (const relPath of Object.keys(parsed)) {
      // relPath is inside `videos/`, sync src is `videos/`, so pattern is `/${relPath}` anchored to sync root.
      const sanitized = relPath.replace(/'/g, "'\\''");
      flags.push(`--exclude='/${sanitized}'`);
      console.log(`[nas-sync] skipping reference ${relPath}`);
    }
  } catch { /* malformed registry — treat as no excludes */ }
  return flags;
}

function ensureLocalDir(folder: string): void {
  const dir = path.join(LOCAL_BASE, folder);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// --- Bidirectional sync helpers ---

function readSyncState(baseDir: string): SyncState {
  const p = path.join(baseDir, SYNC_STATE_FILE);
  if (!existsSync(p)) return { lastSync: '', files: {} };
  try {
    return parseSyncState(readFileSync(p, 'utf8'));
  } catch {
    return { lastSync: '', files: {} };
  }
}

function writeSyncStateFile(baseDir: string, state: SyncState): void {
  writeFileSync(path.join(baseDir, SYNC_STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

function walkFiles(baseDir: string, folder: string): string[] {
  const results: string[] = [];
  const dir = path.join(baseDir, folder);
  if (!existsSync(dir)) return results;

  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      // Skip macOS SMB temporary files (created/deleted transiently during SMB operations)
      if (entry.name.startsWith('.smbdelete') || entry.name.startsWith('.smbtemp')) continue;
      // Skip the trash directory itself — it is a sibling of the asset folders, but
      // we belt-and-brace this here in case a user moves the trash inside an asset folder.
      if (entry.name === '.trash') continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        results.push(path.relative(baseDir, full));
      }
    }
  }
  walk(dir);
  return results;
}

function collectFileMeta(baseDir: string): Map<string, FileMeta> {
  const out = new Map<string, FileMeta>();
  for (const folder of FOLDERS) {
    for (const rel of walkFiles(baseDir, folder)) {
      try {
        const st = statSync(path.join(baseDir, rel));
        out.set(rel, { mtime: st.mtime, size: st.size });
      } catch { /* skip vanished files */ }
    }
  }
  return out;
}

function copyFile(src: string, dest: string): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

/**
 * Apply safety layers (per-folder empty-side veto + bulk-delete cap) and
 * print a clear report. Returns the filtered ops, or null if the bulk-delete
 * cap aborts the run.
 */
function applySafetyLayers(
  ops: SyncOp[],
  localFiles: Map<string, FileMeta>,
  nasFiles: Map<string, FileMeta>,
  prevFiles: Record<string, string>,
): SyncOp[] | null {
  const safe = applyDeletionSafety(ops, localFiles, nasFiles, prevFiles);
  for (const v of safe.vetoes) {
    const suspectSide = v.side === 'local' ? 'NAS-side scan' : 'local-side scan';
    const skipped = v.side === 'local' ? 'delete-nas' : 'delete-local';
    console.warn(
      `[safety] ${suspectSide} for "${v.folder}/" lost ${(v.lossRatio * 100).toFixed(1)}% of prev-state files — ` +
      `skipping ${v.count} ${skipped} op(s) for "${v.folder}/". ` +
      `Probable cause: data loss / partial mount. If this is intentional, verify and re-run with --force.`,
    );
  }

  const bulk = checkBulkDelete(safe.ops, localFiles, nasFiles);
  if (!bulk.ok && !forceBulkDelete) {
    console.error(`✗ ${bulk.reason}`);
    console.error(`  Tracked files: ${bulk.trackedFiles}, threshold: ${bulk.threshold}`);
    return null;
  }
  if (!bulk.ok && forceBulkDelete) {
    console.warn(
      `[safety] --force-bulk-delete: proceeding with ${bulk.totalDeletes} deletes ` +
      `(threshold was ${bulk.threshold}).`,
    );
  }

  return safe.ops;
}

// ---

/**
 * Pull: copy NAS → local-assets (mirror, NAS is authoritative).
 *
 * Deletes local files that no longer exist on NAS — but soft-deletes them via
 * rsync `--backup --backup-dir=.trash/<runId>/` so they are recoverable. Refuses
 * to run if a folder is empty on NAS but populated locally (likely mount issue)
 * unless `--force` is passed, and refuses bulk deletes above the safety
 * threshold unless `--force-bulk-delete` is passed.
 */
function pull(): void {
  if (!isNasMounted()) {
    console.error(`✗ NAS not reachable: ${NAS_BASE}`);
    console.error('  Mount the NAS before running sync:pull.');
    process.exit(1);
  }

  pruneTrash(LOCAL_BASE);
  const runId = makeRunId();

  // Pre-flight: walk both sides, check for empty-NAS folders that have files locally.
  const localFiles = collectFileMeta(LOCAL_BASE);
  const nasFiles = collectFileMeta(NAS_BASE);

  const localCounts = countByFolder(localFiles);
  const nasCounts = countByFolder(nasFiles);
  const suspectFolders: string[] = [];
  for (const folder of FOLDERS) {
    if ((localCounts[folder] ?? 0) > 0 && (nasCounts[folder] ?? 0) === 0) {
      suspectFolders.push(folder);
    }
  }
  if (suspectFolders.length > 0 && !force) {
    console.error(
      `✗ Refusing to pull: NAS-side folder(s) [${suspectFolders.join(', ')}] are empty ` +
      `but local copies exist. This usually means the NAS is mounted in a degraded state ` +
      `(wrong volume, broken share, missing permissions).`,
    );
    console.error('  Verify the NAS, then re-run with --force if the empty NAS folders are intentional.');
    process.exit(1);
  }

  // Bulk-delete cap: count proposed deletes (files on local but not on NAS).
  const proposedDeletes = [...localFiles.keys()].filter((rel) => !nasFiles.has(rel)).length;
  const trackedFiles = localFiles.size + nasFiles.size;
  const threshold = Math.max(50, Math.ceil(trackedFiles * 0.05));
  if (proposedDeletes > threshold && !forceBulkDelete) {
    console.error(
      `✗ Refusing to pull: ${proposedDeletes} files would be deleted locally ` +
      `(threshold ${threshold}). Verify NAS state and re-run with --force-bulk-delete to override.`,
    );
    process.exit(1);
  }

  console.log(`Pulling NAS → ${LOCAL_BASE}\n`);

  for (const folder of FOLDERS) {
    const nasDir = path.join(NAS_BASE, folder);
    if (!existsSync(nasDir)) {
      console.log(`– ${folder}: no NAS directory, skipped`);
      continue;
    }

    const src = `${nasDir}/`;
    const dest = path.join(LOCAL_BASE, folder);
    ensureLocalDir(folder);

    // Layer 1: route deletions/overwrites to .trash/<runId>/<folder>/ instead of unlinking.
    // --backup applies to both --delete and replace-on-update operations.
    const backupDir = path.join(LOCAL_BASE, '.trash', runId, folder);
    mkdirSync(backupDir, { recursive: true });

    console.log(`▶ ${folder}`);
    try {
      const extra = folder === 'videos' ? ' ' + videoReferenceExcludes().join(' ') : '';
      const deleteFlag = suspectFolders.includes(folder) ? '' : ' --delete';
      execSync(
        `rsync -av${deleteFlag} --backup --backup-dir="${backupDir}"${extra} "${src}" "${dest}/"`,
        { stdio: 'inherit' },
      );
      console.log(`✓ ${folder}: done\n`);
    } catch {
      console.error(`✗ ${folder}: rsync failed\n`);
      process.exit(1);
    }
  }

  console.log('Pull complete. Local-assets now mirrors NAS.');
  console.log(`Soft-deleted files (if any) moved to ${path.join(LOCAL_BASE, '.trash', runId)}.`);
}

/**
 * Push: sync local-assets → NAS.
 *
 * Default: copies new/updated files only (safe, no deletions on NAS).
 * --force: mirrors exactly — NAS files not present locally are moved to NAS-side trash.
 */
function push(): void {
  if (!isNasMounted()) {
    console.error(`✗ NAS not reachable: ${NAS_BASE}`);
    console.error('  Mount the NAS before running sync:push.');
    process.exit(1);
  }

  pruneTrash(NAS_BASE);
  const runId = makeRunId();

  if (force) {
    console.log(`Pushing ${LOCAL_BASE} → NAS (--force: NAS will mirror local exactly)\n`);

    // Pre-flight: refuse to mirror if local-side folder is empty but NAS has files.
    const localFiles = collectFileMeta(LOCAL_BASE);
    const nasFiles = collectFileMeta(NAS_BASE);
    const localCounts = countByFolder(localFiles);
    const nasCounts = countByFolder(nasFiles);
    const suspectFolders: string[] = [];
    for (const folder of FOLDERS) {
      if ((nasCounts[folder] ?? 0) > 0 && (localCounts[folder] ?? 0) === 0) {
        suspectFolders.push(folder);
      }
    }
    if (suspectFolders.length > 0 && !forceBulkDelete) {
      console.error(
        `✗ Refusing to mirror push: local folder(s) [${suspectFolders.join(', ')}] are empty ` +
        `but NAS has files. This would wipe NAS content.`,
      );
      console.error('  If intentional, re-run with --force-bulk-delete.');
      process.exit(1);
    }

    const proposedDeletes = [...nasFiles.keys()].filter((rel) => !localFiles.has(rel)).length;
    const trackedFiles = localFiles.size + nasFiles.size;
    const threshold = Math.max(50, Math.ceil(trackedFiles * 0.05));
    if (proposedDeletes > threshold && !forceBulkDelete) {
      console.error(
        `✗ Refusing to mirror push: ${proposedDeletes} NAS files would be removed ` +
        `(threshold ${threshold}). Re-run with --force-bulk-delete to override.`,
      );
      process.exit(1);
    }
  } else {
    console.log(`Pushing ${LOCAL_BASE} → NAS\n`);
  }

  for (const folder of FOLDERS) {
    const src = `${path.join(LOCAL_BASE, folder)}/`;
    const dest = path.join(NAS_BASE, folder);

    if (!existsSync(src)) {
      console.log(`– ${folder}: no local-assets directory, skipped`);
      continue;
    }

    console.log(`▶ ${folder}`);
    try {
      const extra = folder === 'videos' ? ' ' + videoReferenceExcludes().join(' ') : '';
      let backupArgs = '';
      let deleteFlag = '';
      if (force) {
        const backupDir = path.join(NAS_BASE, '.trash', runId, folder);
        mkdirSync(backupDir, { recursive: true });
        backupArgs = ` --backup --backup-dir="${backupDir}"`;
        deleteFlag = ' --delete';
      }
      execSync(
        `rsync -av${deleteFlag}${backupArgs}${extra} "${src}" "${dest}/"`,
        { stdio: 'inherit' },
      );
      console.log(`✓ ${folder}: done\n`);
    } catch {
      console.error(`✗ ${folder}: rsync failed\n`);
      process.exit(1);
    }
  }

  console.log(
    force
      ? `Push complete. NAS now mirrors local-assets exactly. Soft-deleted files (if any) moved to ${path.join(NAS_BASE, '.trash', runId)}.`
      : 'Push complete. Local changes synced to NAS.'
  );
}

/**
 * Sync: bidirectional NAS ↔ local-assets.
 *
 * Uses .sync-state.json on both sides to detect additions, updates, and deletions.
 * Newer file wins for updates. If a file was present at last sync but is now
 * missing from one side, it is moved to the other side's `.trash/<runId>/`
 * (Layer 1 soft-delete) instead of being unlinked.
 */
function sync(): void {
  if (!isNasMounted()) {
    console.error(`✗ NAS not reachable: ${NAS_BASE}`);
    console.error('  Mount the NAS before running sync.');
    process.exit(1);
  }

  pruneTrash(LOCAL_BASE);
  pruneTrash(NAS_BASE);
  const runId = makeRunId();

  console.log(`Syncing ${LOCAL_BASE} ↔ NAS\n`);

  const localState = readSyncState(LOCAL_BASE);
  const nasState = readSyncState(NAS_BASE);
  const prevFiles = resolvePrevFiles(localState, nasState);

  const localFiles = collectFileMeta(LOCAL_BASE);
  const nasFiles = collectFileMeta(NAS_BASE);

  const rawOps = computeSyncOps(localFiles, nasFiles, prevFiles);
  const ops = applySafetyLayers(rawOps, localFiles, nasFiles, prevFiles);
  if (ops === null) process.exit(1);

  type FolderStats = { copied: number; deleted: number; skipped: number };
  const labelWidth = Math.max(...FOLDERS.map((f) => f.length));
  const stats: Record<string, FolderStats> = Object.fromEntries(
    FOLDERS.map((f) => [f, { copied: 0, deleted: 0, skipped: 0 }]),
  );
  // Skipped (= already in sync) — count by walking allPaths and seeing which weren't in ops.
  const opsByRel = new Map(ops.map((o) => [o.rel, o]));
  for (const rel of new Set([...localFiles.keys(), ...nasFiles.keys()])) {
    if (opsByRel.has(rel)) continue;
    const folder = rel.split('/')[0];
    const s = stats[folder];
    if (s) s.skipped++;
  }

  // Track failed ops so the new state omits them. A failed push/pull must
  // NOT be recorded as "in sync" — otherwise the next run reads the file as
  // "in prev + missing on one side" and trashes it (root cause of the
  // 2026-05-14 incident).
  const failedOps = new Set<string>();

  for (const op of ops) {
    const folder = op.rel.split('/')[0];
    const s = stats[folder] ?? { copied: 0, deleted: 0, skipped: 0 };
    const localPath = path.join(LOCAL_BASE, op.rel);
    const nasPath = path.join(NAS_BASE, op.rel);

    try {
      switch (op.action) {
        case 'push':
          console.log(`  → NAS   ${op.rel}`);
          copyFile(localPath, nasPath);
          s.copied++;
          break;
        case 'pull':
          console.log(`  ← local ${op.rel}`);
          copyFile(nasPath, localPath);
          s.copied++;
          break;
        case 'delete-local':
          console.log(`  ✗ trash local ${op.rel}`);
          softDelete(LOCAL_BASE, op.rel, runId);
          s.deleted++;
          break;
        case 'delete-nas':
          console.log(`  ✗ trash NAS   ${op.rel}`);
          softDelete(NAS_BASE, op.rel, runId);
          s.deleted++;
          break;
      }
    } catch (err) {
      console.warn(`  ✗ failed: ${op.action} ${op.rel} — ${(err as Error).message}`);
      failedOps.add(op.rel);
    }
  }

  const newState = buildNewSyncState(localFiles, nasFiles, ops, failedOps);
  writeSyncStateFile(LOCAL_BASE, newState);
  writeSyncStateFile(NAS_BASE, newState);

  console.log('\nSync complete:');
  for (const folder of FOLDERS) {
    const { copied, deleted, skipped } = stats[folder];
    const label = folder.padEnd(labelWidth);
    console.log(`  ${label}  ${copied} copied, ${deleted} deleted, ${skipped} up to date`);
  }
  const totalDeleted = Object.values(stats).reduce((n, s) => n + s.deleted, 0);
  if (totalDeleted > 0) {
    console.log(`\nSoft-deleted files moved to .trash/${runId}/ on both sides.`);
  }
}

function countByFolder(files: Map<string, FileMeta>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const rel of files.keys()) {
    const folder = rel.split('/')[0];
    counts[folder] = (counts[folder] ?? 0) + 1;
  }
  return counts;
}

if (command === 'pull') {
  pull();
} else if (command === 'push') {
  push();
} else if (command === 'sync') {
  sync();
} else {
  console.error('Usage: tsx sync-assets.ts <pull|push|sync> [--force] [--force-bulk-delete]');
  console.error('');
  console.error('  pull         Copy NAS → local-assets (NAS is authoritative). Soft-deletes via .trash/<runId>/.');
  console.error('  push         Sync local-assets → NAS, add/update only (safe).');
  console.error('  push --force Sync local-assets → NAS, mirror exactly (soft-deletes NAS-only files).');
  console.error('  sync         Bidirectional sync — newer file wins, deletions soft-deleted via .trash/.');
  console.error('');
  console.error('Safety flags:');
  console.error('  --force                Override per-folder empty-side veto (Layer 2). Use only when an empty');
  console.error('                         folder is genuinely intentional.');
  console.error('  --force-bulk-delete    Override the bulk-delete cap (Layer 3, max 50 or 5%% of tracked files).');
  process.exit(1);
}
