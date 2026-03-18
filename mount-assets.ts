import fs from 'fs';
import path from 'path';

const NAS_BASE = '/Volumes/Georg-1/Gameshow/Assets';
const PROJECT_ROOT = process.cwd();

const FOLDERS = ['audio', 'audio-guess', 'images', 'image-guess', 'background-music'];

const args = process.argv.slice(2);
const command = args[0];
const force = args.includes('--force');

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function exists(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

function mount() {
  if (!fs.existsSync(NAS_BASE)) {
    console.error(`✗ NAS not reachable: ${NAS_BASE}`);
    console.error('  Make sure the NAS volume is mounted before running this command.');
    process.exit(1);
  }

  let mounted = 0;
  let skipped = 0;

  for (const folder of FOLDERS) {
    const target = path.join(PROJECT_ROOT, folder);
    const source = path.join(NAS_BASE, folder);

    if (isSymlink(target)) {
      console.log(`→ ${folder}: already mounted`);
      skipped++;
      continue;
    }

    if (exists(target)) {
      if (!force) {
        console.warn(`⚠ ${folder}: real directory exists — use --force to replace with symlink`);
        skipped++;
        continue;
      }
      const bak = `${target}.bak`;
      fs.renameSync(target, bak);
      console.log(`  ${folder}: renamed existing directory to ${folder}.bak`);
    }

    fs.symlinkSync(source, target);
    console.log(`✓ ${folder}: mounted → ${source}`);
    mounted++;
  }

  console.log(`\nDone: ${mounted} mounted, ${skipped} skipped.`);
}

function unmount() {
  let removed = 0;
  let skipped = 0;

  for (const folder of FOLDERS) {
    const target = path.join(PROJECT_ROOT, folder);

    if (!isSymlink(target)) {
      console.log(`– ${folder}: not a symlink, skipped`);
      skipped++;
      continue;
    }

    fs.unlinkSync(target);
    console.log(`✓ ${folder}: unmounted`);
    removed++;
  }

  console.log(`\nDone: ${removed} unmounted, ${skipped} skipped.`);
}

if (command === 'mount') {
  mount();
} else if (command === 'unmount') {
  unmount();
} else {
  console.error('Usage: tsx mount-assets.ts <mount|unmount> [--force]');
  process.exit(1);
}
