import { execSync } from 'child_process';
import { existsSync, mkdirSync, statSync } from 'fs';
import path from 'path';

const NAS_BASE = '/Volumes/Georg/Gameshow/Assets';
const LOCAL_BASE = path.join(process.cwd(), 'local-assets');
const FOLDERS = ['audio', 'images', 'background-music', 'videos'] as const;

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

if (command === 'pull') {
  pull();
} else if (command === 'push') {
  push();
} else {
  console.error('Usage: tsx sync-assets.ts <pull|push>');
  console.error('');
  console.error('  pull         Copy NAS → local-assets (for offline use away from home network)');
  console.error('  push         Sync local-assets → NAS, add/update only (safe)');
  console.error('  push --force Sync local-assets → NAS, mirror exactly (deletes NAS-only files)');
  process.exit(1);
}
