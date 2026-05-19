/**
 * Targeted recovery: copy the `prevOnly_on_NAS` set to NAS one file at a time.
 *
 * Companion to `scripts/diagnose-sync-drift.ts`. The diagnostic identifies
 * files that the sync-state tracks and the local tree still has, but the NAS
 * scan does not return. This script pushes exactly that set back to NAS so
 * Layer 2's "lost X% of prev-state files on NAS" warning clears.
 *
 * Why not rsync? `npm run sync:push` runs rsync on every folder, and `rsync -a`
 * on an APFS→SMB transfer churns through tens of thousands of files because
 * APFS mtimes are nanosecond-precision and SMB mtimes are second-precision.
 * Then it hits EBUSY on macOS oplocks because the dev server holds audio
 * files open. Per-file `fs.copyFile` over Node is far more predictable.
 *
 * Behaviour:
 *   - Read-only on local; writes only to NAS, only for paths in the drift set.
 *   - Per-file errors are logged and counted — they do not abort the run.
 *   - Existing NAS-side directories are mkdir'd as needed.
 *   - No state file mutation. The next bidirectional sync (server startup or
 *     `npm run sync`) updates `.sync-state.json` once the files are visible
 *     on both sides.
 *   - Exit code: 0 if every drifted file copied; 1 if at least one failed.
 */

import path from 'path';
import { existsSync, readFileSync, statSync } from 'fs';
import { copyFile, mkdir } from 'fs/promises';
import {
  parseSyncState,
  resolvePrevFiles,
  type SyncState,
} from '../server/nas-sync.js';
import { collectFileMetadata } from '../server/nas-walk.js';
import { LOCAL_ASSETS_BASE, NAS_BASE } from '../server/asset-paths.js';

const ASSET_FOLDERS = ['audio', 'images', 'background-music', 'videos'] as const;

function readSyncState(baseDir: string): SyncState {
  const p = path.join(baseDir, '.sync-state.json');
  if (!existsSync(p)) return { lastSync: '', files: {} };
  return parseSyncState(readFileSync(p, 'utf8'));
}

function isNasMounted(): boolean {
  try { return statSync(NAS_BASE).isDirectory(); } catch { return false; }
}

async function main(): Promise<void> {
  console.log('=== Push drifted files (local → NAS) ===\n');
  console.log(`LOCAL_ASSETS_BASE: ${LOCAL_ASSETS_BASE}`);
  console.log(`NAS_BASE:          ${NAS_BASE}\n`);

  if (!isNasMounted()) {
    console.error('NAS is not mounted. Mount the share and retry.');
    process.exit(1);
  }

  const localState = readSyncState(LOCAL_ASSETS_BASE);
  const nasState = readSyncState(NAS_BASE);
  const prevFiles = resolvePrevFiles(localState, nasState);
  console.log(`prev-state entries: ${Object.keys(prevFiles).length}`);

  console.log('Scanning local + NAS…');
  const t0 = Date.now();
  const [localFiles, nasFiles] = await Promise.all([
    collectFileMetadata(LOCAL_ASSETS_BASE, ASSET_FOLDERS),
    collectFileMetadata(NAS_BASE, ASSET_FOLDERS),
  ]);
  console.log(`  scanned in ${((Date.now() - t0) / 1000).toFixed(1)}s — local ${localFiles.size}, NAS ${nasFiles.size}\n`);

  const drift: string[] = [];
  for (const rel of Object.keys(prevFiles)) {
    if (localFiles.has(rel) && !nasFiles.has(rel)) drift.push(rel);
  }
  drift.sort();

  if (drift.length === 0) {
    console.log('No drifted files to push. Nothing to do.');
    return;
  }

  console.log(`Drift set: ${drift.length} file(s) to push.\n`);

  let copied = 0;
  let failed = 0;
  const failures: { rel: string; reason: string }[] = [];

  for (let i = 0; i < drift.length; i++) {
    const rel = drift[i];
    const src = path.join(LOCAL_ASSETS_BASE, rel);
    const dest = path.join(NAS_BASE, rel);
    const prefix = `[${(i + 1).toString().padStart(drift.length.toString().length)}/${drift.length}]`;

    if (!existsSync(src)) {
      console.warn(`${prefix} SKIP (local gone): ${rel}`);
      failed++;
      failures.push({ rel, reason: 'local source missing' });
      continue;
    }

    try {
      await mkdir(path.dirname(dest), { recursive: true });
      await copyFile(src, dest);
      copied++;
      console.log(`${prefix} ✓ ${rel}`);
    } catch (err) {
      failed++;
      const reason = (err as NodeJS.ErrnoException).code || (err as Error).message;
      failures.push({ rel, reason });
      console.warn(`${prefix} ✗ ${rel} — ${reason}`);
    }
  }

  console.log(`\nResult: ${copied} copied, ${failed} failed (of ${drift.length}).`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f.reason.padEnd(16)} ${f.rel}`);
    console.log('\nRe-run to retry. Files that succeed remain on NAS; only failures will be retried.');
    process.exit(1);
  }
  console.log('\nDone. Run `npm run diagnose:sync` to confirm the drift cleared.');
}

main().catch(err => {
  console.error('push-drifted-to-nas failed:', err);
  process.exit(1);
});
