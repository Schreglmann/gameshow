import { execSync } from 'child_process';
import {
  existsSync,
  mkdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
} from 'fs';
import path from 'path';

const NAS_BASE = '/Volumes/Georg/Gameshow/Assets';
const LOCAL_BASE = path.join(process.cwd(), 'local-assets');
const FOLDERS = ['audio', 'images', 'background-music', 'videos'] as const;
const SYNC_STATE_FILE = '.sync-state.json';

const args = process.argv.slice(2);
const command = args[0];
const force = args.includes('--force');

function isNasMounted(): boolean {
  try {
    return statSync(NAS_BASE).isDirectory();
  } catch {
    return false;
  }
}

function ensureLocalDir(folder: string): void {
  const dir = path.join(LOCAL_BASE, folder);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// --- Bidirectional sync helpers ---

interface SyncState {
  lastSync: string;
  files: Record<string, string>; // relative path from base → ISO mtime at last sync
}

function readSyncState(baseDir: string): SyncState {
  const p = path.join(baseDir, SYNC_STATE_FILE);
  if (!existsSync(p)) return { lastSync: '', files: {} };
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as SyncState;
  } catch {
    return { lastSync: '', files: {} };
  }
}

function writeSyncState(baseDir: string, state: SyncState): void {
  writeFileSync(path.join(baseDir, SYNC_STATE_FILE), JSON.stringify(state, null, 2) + '\n');
}

function walkFiles(baseDir: string, folder: string): string[] {
  const results: string[] = [];
  const dir = path.join(baseDir, folder);
  if (!existsSync(dir)) return results;

  function walk(current: string) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
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

function copyFile(src: string, dest: string): void {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

// ---

/**
 * Pull: copy NAS → local-assets (mirror, NAS is authoritative)
 * Deletes local files that no longer exist on NAS.
 */
function pull(): void {
  if (!isNasMounted()) {
    console.error(`✗ NAS not reachable: ${NAS_BASE}`);
    console.error('  Mount the NAS before running sync:pull.');
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

    console.log(`▶ ${folder}`);
    try {
      execSync(`rsync -av --delete "${src}" "${dest}/"`, { stdio: 'inherit' });
      console.log(`✓ ${folder}: done\n`);
    } catch {
      console.error(`✗ ${folder}: rsync failed\n`);
      process.exit(1);
    }
  }

  console.log('Pull complete. Local-assets now mirrors NAS.');
}

/**
 * Push: sync local-assets → NAS.
 * Default: copies new/updated files only (safe, no deletions on NAS).
 * --force: mirrors exactly — NAS files not present locally are deleted.
 */
function push(): void {
  if (!isNasMounted()) {
    console.error(`✗ NAS not reachable: ${NAS_BASE}`);
    console.error('  Mount the NAS before running sync:push.');
    process.exit(1);
  }

  if (force) {
    console.log(`Pushing ${LOCAL_BASE} → NAS (--force: NAS will mirror local exactly)\n`);
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
      const deleteFlag = force ? ' --delete' : '';
      execSync(`rsync -av${deleteFlag} "${src}" "${dest}/"`, { stdio: 'inherit' });
      console.log(`✓ ${folder}: done\n`);
    } catch {
      console.error(`✗ ${folder}: rsync failed\n`);
      process.exit(1);
    }
  }

  console.log(
    force
      ? 'Push complete. NAS now mirrors local-assets exactly.'
      : 'Push complete. Local changes synced to NAS.'
  );
}

/**
 * Sync: bidirectional NAS ↔ local-assets.
 *
 * Uses .sync-state.json on both sides to detect additions, updates, and deletions.
 * Newer file wins for updates. If a file was present at last sync but is now
 * missing from one side, it is deleted from the other side too.
 */
function sync(): void {
  if (!isNasMounted()) {
    console.error(`✗ NAS not reachable: ${NAS_BASE}`);
    console.error('  Mount the NAS before running sync.');
    process.exit(1);
  }

  console.log(`Syncing ${LOCAL_BASE} ↔ NAS\n`);

  const localState = readSyncState(LOCAL_BASE);
  const nasState = readSyncState(NAS_BASE);

  // Use the more recent state file as authoritative previous-sync record.
  // On first run both are empty, so prevFiles = {}.
  const prevFiles: Record<string, string> =
    localState.lastSync >= nasState.lastSync ? localState.files : nasState.files;

  // Collect all file paths and their mtimes on each side
  const localFiles = new Map<string, Date>();
  const nasFiles = new Map<string, Date>();

  for (const folder of FOLDERS) {
    for (const rel of walkFiles(LOCAL_BASE, folder)) {
      localFiles.set(rel, statSync(path.join(LOCAL_BASE, rel)).mtime);
    }
    for (const rel of walkFiles(NAS_BASE, folder)) {
      nasFiles.set(rel, statSync(path.join(NAS_BASE, rel)).mtime);
    }
  }

  const allPaths = new Set([...localFiles.keys(), ...nasFiles.keys()]);

  type FolderStats = { copied: number; deleted: number; skipped: number };
  const stats = Object.fromEntries(
    FOLDERS.map((f) => [f, { copied: 0, deleted: 0, skipped: 0 } as FolderStats])
  ) as Record<string, FolderStats>;

  const newState: SyncState = { lastSync: new Date().toISOString(), files: {} };

  for (const rel of allPaths) {
    const folder = rel.split('/')[0];
    const s = stats[folder] ?? { copied: 0, deleted: 0, skipped: 0 };
    const inPrev = Object.prototype.hasOwnProperty.call(prevFiles, rel);
    const localMtime = localFiles.get(rel);
    const nasMtime = nasFiles.get(rel);

    if (localMtime && nasMtime) {
      // File exists on both sides — newer wins
      if (localMtime > nasMtime) {
        console.log(`  → NAS   ${rel}  (local newer)`);
        copyFile(path.join(LOCAL_BASE, rel), path.join(NAS_BASE, rel));
        s.copied++;
        newState.files[rel] = localMtime.toISOString();
      } else if (nasMtime > localMtime) {
        console.log(`  ← local ${rel}  (NAS newer)`);
        copyFile(path.join(NAS_BASE, rel), path.join(LOCAL_BASE, rel));
        s.copied++;
        newState.files[rel] = nasMtime.toISOString();
      } else {
        // Identical mtime — already in sync
        s.skipped++;
        newState.files[rel] = localMtime.toISOString();
      }
    } else if (localMtime && !nasMtime) {
      if (inPrev) {
        // Was on NAS at last sync, now gone from NAS → deleted from NAS → remove locally
        console.log(`  ✗ delete local ${rel}  (deleted from NAS)`);
        unlinkSync(path.join(LOCAL_BASE, rel));
        s.deleted++;
      } else {
        // New local file → push to NAS
        console.log(`  → NAS   ${rel}  (new)`);
        copyFile(path.join(LOCAL_BASE, rel), path.join(NAS_BASE, rel));
        s.copied++;
        newState.files[rel] = localMtime.toISOString();
      }
    } else if (!localMtime && nasMtime) {
      if (inPrev) {
        // Was local at last sync, now gone locally → deleted locally → remove from NAS
        console.log(`  ✗ delete NAS   ${rel}  (deleted locally)`);
        unlinkSync(path.join(NAS_BASE, rel));
        s.deleted++;
      } else {
        // New NAS file → pull locally
        console.log(`  ← local ${rel}  (new)`);
        copyFile(path.join(NAS_BASE, rel), path.join(LOCAL_BASE, rel));
        s.copied++;
        newState.files[rel] = nasMtime.toISOString();
      }
    }
  }

  writeSyncState(LOCAL_BASE, newState);
  writeSyncState(NAS_BASE, newState);

  const labelWidth = Math.max(...FOLDERS.map((f) => f.length));
  console.log('\nSync complete:');
  for (const folder of FOLDERS) {
    const { copied, deleted, skipped } = stats[folder];
    const label = folder.padEnd(labelWidth);
    console.log(`  ${label}  ${copied} copied, ${deleted} deleted, ${skipped} up to date`);
  }
}

if (command === 'pull') {
  pull();
} else if (command === 'push') {
  push();
} else if (command === 'sync') {
  sync();
} else {
  console.error('Usage: tsx sync-assets.ts <pull|push|sync>');
  console.error('');
  console.error('  pull         Copy NAS → local-assets (NAS is authoritative, deletes local extras)');
  console.error('  push         Sync local-assets → NAS, add/update only (safe)');
  console.error('  push --force Sync local-assets → NAS, mirror exactly (deletes NAS-only files)');
  console.error('  sync         Bidirectional sync — newer file wins, deletions propagate via state file');
  process.exit(1);
}
