import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'fs';
import os from 'os';
import path from 'path';
import readline from 'readline';

const NAS_MOUNT = '/Volumes/Georg/Gameshow';
const NAS_BACKUP_DIR = path.join(NAS_MOUNT, 'Backups');
const REPO_ROOT = process.cwd();
const LOCAL_ASSETS = path.join(REPO_ROOT, 'local-assets');

const ROOT_JSON_FILES = ['config.json', 'config.template.json', 'theme-settings.json'];

const DAM_SUBFOLDERS = ['audio', 'background-music', 'images'] as const;
const HIDDEN_EXCLUDES = ['.*', '*/.*'];
const LABEL_WIDTH = 16;

const BAR_WIDTH = 30;
const TMP_PREFIX = 'gameshow-backup-';
const PARTIAL_SUFFIX = '.partial';

let currentTmpDir: string | null = null;
const inFlightNasTargets = new Set<string>();

function isNasMounted(): boolean {
  try {
    return statSync(NAS_MOUNT).isDirectory();
  } catch {
    return false;
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function truncateLeft(value: string, max: number): string {
  if (value.length <= max) return value;
  return '…' + value.slice(value.length - max + 1);
}

let barLinesDrawn = 0;

function clearDrawnBar(): void {
  if (barLinesDrawn === 0) return;
  process.stdout.write('\r\x1b[K');
  for (let i = 1; i < barLinesDrawn; i++) {
    process.stdout.write('\x1b[A\r\x1b[K');
  }
  barLinesDrawn = 0;
}

function renderBar(label: string, current: number, total: number, file: string = ''): void {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.min(current / safeTotal, 1);
  const pct = Math.round(ratio * 100).toString().padStart(3, ' ');
  const cols = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  const shown = Math.min(current, total);
  const fixedPart = `  ${label} [] ${pct}% (${shown}/${total})`.length;
  const barWidth = Math.max(5, Math.min(BAR_WIDTH, cols - 1 - fixedPart));
  const filled = Math.round(ratio * barWidth);
  const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
  const head = `  ${label} [${bar}] ${pct}% (${shown}/${total})`;
  const maxLine = Math.max(20, cols - 1);
  const fileLine = file ? `    ${truncateLeft(file, Math.max(10, maxLine - 4))}` : '';

  clearDrawnBar();
  if (fileLine) {
    process.stdout.write(`${head}\n${fileLine}`);
    barLinesDrawn = 2;
  } else {
    process.stdout.write(head);
    barLinesDrawn = 1;
  }
}

function finalizeBar(): void {
  process.stdout.write('\n');
  barLinesDrawn = 0;
}

function countGamesEntries(): number {
  let count = 1; // games/ directory entry itself
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      count++;
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  walk(path.join(REPO_ROOT, 'games'));
  for (const f of ROOT_JSON_FILES) {
    if (existsSync(path.join(REPO_ROOT, f))) count++;
  }
  return count;
}

function countFolderEntries(root: string): number {
  let count = 0;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // matches -x '.*' and '*/.*' — any hidden entry at any depth
      if (entry.name.startsWith('.')) continue;
      count++;
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
    }
  };
  walk(root);
  return count;
}

function runZipWithProgress(args: string[], cwd: string, total: number, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('zip', args, { cwd });
    const rl = readline.createInterface({ input: proc.stdout });
    let count = 0;
    let stderrBuf = '';
    renderBar(label, 0, total);

    rl.on('line', (line) => {
      const match = line.match(/^\s*(?:adding|updating):\s+(.+?)(?:\s+\([^)]+\))?\s*$/);
      if (match) {
        count++;
        renderBar(label, count, total, match[1]);
      }
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrBuf += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      renderBar(label, total, total);
      finalizeBar();
      if (code === 0) {
        resolve();
      } else {
        if (stderrBuf.trim()) process.stderr.write(stderrBuf);
        reject(new Error(`zip exited with code ${code}`));
      }
    });
  });
}

function moveToNas(src: string, dest: string): void {
  // Stage through a .partial file so a cancelled copy never leaves a
  // legitimately-named zip on the NAS. Final rename is atomic (same filesystem).
  const partial = dest + PARTIAL_SUFFIX;
  inFlightNasTargets.add(partial);
  try {
    renameSync(src, partial);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EXDEV') {
      execSync(`mv ${shellQuote(src)} ${shellQuote(partial)}`, { stdio: 'inherit' });
    } else {
      inFlightNasTargets.delete(partial);
      throw err;
    }
  }
  renameSync(partial, dest);
  inFlightNasTargets.delete(partial);
}

function cleanupTmpDir(dir: string | null): void {
  if (!dir) return;
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

function cleanupInFlight(): void {
  for (const p of inFlightNasTargets) {
    try {
      unlinkSync(p);
    } catch {
      // ignore — file may not yet exist or may already be gone
    }
  }
  inFlightNasTargets.clear();
}

function cleanupStaleArtifacts(): void {
  // Stale temp dirs from previously cancelled runs.
  const tmpBase = os.tmpdir();
  try {
    for (const name of readdirSync(tmpBase)) {
      if (!name.startsWith(TMP_PREFIX)) continue;
      const full = path.join(tmpBase, name);
      try {
        rmSync(full, { recursive: true, force: true });
        console.log(`  ✗ removed stale temp: ${full}`);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  // Orphan .partial files on the NAS from previously cancelled moves.
  try {
    for (const name of readdirSync(NAS_BACKUP_DIR)) {
      if (!name.endsWith(PARTIAL_SUFFIX)) continue;
      const full = path.join(NAS_BACKUP_DIR, name);
      try {
        unlinkSync(full);
        console.log(`  ✗ removed stale partial: ${name}`);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore — dir may not exist yet
  }
}

function pruneOldBackups(keepFilenames: Set<string>): void {
  try {
    const entries = readdirSync(NAS_BACKUP_DIR);
    for (const name of entries) {
      if (keepFilenames.has(name)) continue;
      if (!/^(games|audio|background-music|images|dam)-.*\.zip$/.test(name)) continue;
      const full = path.join(NAS_BACKUP_DIR, name);
      try {
        unlinkSync(full);
        console.log(`  ✗ removed old backup: ${name}`);
      } catch (err) {
        console.warn(`  ! failed to remove ${name}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    console.warn(`  ! prune step skipped: ${(err as Error).message}`);
  }
}

async function run(): Promise<void> {
  if (!isNasMounted()) {
    console.error(`✗ NAS not reachable: ${NAS_MOUNT}`);
    console.error('  Mount the NAS before running npm run backup.');
    process.exit(1);
  }

  if (!existsSync(LOCAL_ASSETS)) {
    console.error(`✗ local-assets not found: ${LOCAL_ASSETS}`);
    process.exit(1);
  }

  mkdirSync(NAS_BACKUP_DIR, { recursive: true });
  cleanupStaleArtifacts();

  const ts = timestamp();
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), TMP_PREFIX));
  currentTmpDir = tmpDir;

  console.log(`Backup → ${NAS_BACKUP_DIR}\n`);

  const createdNames = new Set<string>();
  const nasPaths: string[] = [];

  const runStep = async (
    name: string,
    label: string,
    cwd: string,
    zipArgs: (tmp: string) => string[],
    total: number,
  ): Promise<void> => {
    const zipName = `${name}-${ts}.zip`;
    const tmp = path.join(tmpDir, zipName);
    const nas = path.join(NAS_BACKUP_DIR, zipName);
    await runZipWithProgress(zipArgs(tmp), cwd, total, label.padEnd(LABEL_WIDTH));
    process.stdout.write(`  moving ${zipName} to NAS...`);
    moveToNas(tmp, nas);
    process.stdout.write(' done\n');
    createdNames.add(zipName);
    nasPaths.push(nas);
  };

  try {
    const gamesInputs = ['games', ...ROOT_JSON_FILES.filter((f) => existsSync(path.join(REPO_ROOT, f)))];
    await runStep('games', 'games', REPO_ROOT, (tmp) => ['-r', tmp, ...gamesInputs], countGamesEntries());

    for (const sub of DAM_SUBFOLDERS) {
      const subPath = path.join(LOCAL_ASSETS, sub);
      if (!existsSync(subPath)) continue;
      const total = countFolderEntries(subPath);
      await runStep(
        sub,
        sub,
        subPath,
        (tmp) => ['-r', tmp, '.', ...HIDDEN_EXCLUDES.flatMap((p) => ['-x', p])],
        total,
      );
    }

    pruneOldBackups(createdNames);

    console.log('\nBackup complete.');
    for (const p of nasPaths) console.log(`  ${p}`);
  } finally {
    cleanupTmpDir(tmpDir);
    currentTmpDir = null;
  }
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(sig, () => {
    finalizeBar();
    process.stdout.write(`${sig} received — cleaning up\n`);
    cleanupInFlight();
    cleanupTmpDir(currentTmpDir);
    currentTmpDir = null;
    process.exit(130);
  });
}

run().catch((err) => {
  console.error(`\n✗ backup failed: ${(err as Error).message}`);
  cleanupInFlight();
  cleanupTmpDir(currentTmpDir);
  process.exit(1);
});
