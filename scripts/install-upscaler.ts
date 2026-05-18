// scripts/install-upscaler.ts
//
// Installs the local-AI image upscaler (upscayl-ncnn engine) into
// local-assets/.upscaler/. Run via `npm run upscaler:install`.
//
// Mac (arm64 / x64) + Linux (x64) are supported. Windows and linux-arm64
// have no upstream prebuilds yet — the script exits with a clear message.
//
// On Linux the runtime also needs libvulkan1; this script does NOT install it
// (no sudo). Surfaced in QUICK_START.md and in the admin UI's error toast.
//
// Idempotent: if every file is present and (when pinned) hash-matches, the
// script is a no-op. Pass --force to redownload.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

interface Manifest {
  version: string;
  binary: Record<string, { assetUrl: string; sha256: string | null; archivePath: string }>;
  models: {
    _baseUrl: string;
    files: Array<{ name: string; sha256: string | null; rename?: string }>;
  };
}

const FORCE = process.argv.includes('--force');

async function main(): Promise<void> {
  const platformKey = `${process.platform}-${process.arch}`;
  const supported = ['darwin-arm64', 'darwin-x64', 'linux-x64'];
  if (!supported.includes(platformKey)) {
    fail(
      `Unsupported platform: ${platformKey}. Supported: ${supported.join(', ')}.\n` +
      `If you need Windows or linux-arm64, the upscayl-ncnn project must publish a release asset for it first.`,
    );
  }

  const manifestPath = path.join(REPO_ROOT, 'scripts', 'upscaler-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const binSpec = manifest.binary[platformKey];
  if (!binSpec) fail(`No binary entry in manifest for ${platformKey}.`);

  const installDir = path.join(REPO_ROOT, 'local-assets', '.upscaler');
  const platformDir = path.join(installDir, platformKey);
  const modelsDir = path.join(installDir, 'models');
  const binPath = path.join(platformDir, 'upscayl-bin');

  await mkdir(platformDir, { recursive: true });
  await mkdir(modelsDir, { recursive: true });

  // ── Binary ──
  if (!FORCE && (await fileMatchesHash(binPath, binSpec.sha256))) {
    log(`Binary already installed: ${binPath}`);
  } else {
    log(`Downloading upscayl-bin ${manifest.version} for ${platformKey}…`);
    log(`  ${binSpec.assetUrl}`);
    const archive = await download(binSpec.assetUrl);
    if (binSpec.sha256) verifyHash(archive, binSpec.sha256, 'binary archive');
    await extractBinary(archive, binSpec.archivePath, binPath);
    await chmod(binPath, 0o755);
    log(`Installed: ${binPath}`);
  }

  // ── Models ──
  for (const model of manifest.models.files) {
    const outName = model.rename ?? model.name;
    const outPath = path.join(modelsDir, outName);
    if (!FORCE && (await fileMatchesHash(outPath, model.sha256))) {
      log(`Model already installed: ${outName}`);
      continue;
    }
    const url = `${manifest.models._baseUrl}/${model.name}`;
    log(`Downloading model: ${outName}`);
    log(`  ${url}`);
    const bytes = await download(url);
    if (model.sha256) verifyHash(bytes, model.sha256, outName);
    await writeFile(outPath, bytes);
    log(`Installed: ${outPath}`);
  }

  // ── Smoke test ──
  log('Smoke test: ./upscayl-bin --help');
  await smokeTest(binPath, modelsDir);
  log('✓ Upscaler installed. Total disk: ~150 MB.');

  if (process.platform === 'linux') {
    log('Note (Linux): runtime also requires libvulkan1. On Debian/Ubuntu:');
    log('  sudo apt install -y libvulkan1 mesa-vulkan-drivers');
  }
}

async function fileMatchesHash(filePath: string, expected: string | null): Promise<boolean> {
  if (!existsSync(filePath)) return false;
  if (!expected) {
    // No pin: existence is enough. (First-time installs run with null hashes.)
    return true;
  }
  const buf = await readFile(filePath);
  return sha256(buf) === expected;
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

function verifyHash(buf: Buffer, expected: string, label: string): void {
  const got = sha256(buf);
  if (got !== expected) {
    fail(`SHA256 mismatch for ${label}.\n  expected: ${expected}\n  got:      ${got}`);
  }
}

async function download(url: string): Promise<Buffer> {
  // Follow redirects. github.com/.../releases/download/... 302s to
  // objects.githubusercontent.com, which fetch handles transparently.
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) fail(`HTTP ${res.status} downloading ${url}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

async function extractBinary(zipBytes: Buffer, archivePath: string, outPath: string): Promise<void> {
  // The upscayl-ncnn release ships a single executable inside a zip. We shell
  // out to `unzip` (present on macOS by default, and on every Linux distro
  // we target).
  if (!(await hasCommand('unzip'))) {
    fail('`unzip` is required to extract the upscayl release. Install it (Linux: `sudo apt install unzip`).');
  }
  const work = path.join(tmpdir(), `upscaler-install-${process.pid}-${Date.now()}`);
  await mkdir(work, { recursive: true });
  const zipPath = path.join(work, 'asset.zip');
  await writeFile(zipPath, zipBytes);
  await runCommand('unzip', ['-q', '-o', zipPath, '-d', work]);

  // Recursively locate the binary. Older releases shipped it as
  // `upscayl-realesrgan`; current releases use `upscayl-bin`. Skip macOS
  // metadata folders (`__MACOSX/`).
  const candidates = [path.basename(archivePath), 'upscayl-bin', 'upscayl-realesrgan'];
  let found: string | null = null;
  for (const name of candidates) {
    found = await findFile(work, name);
    if (found) break;
  }
  if (!found) {
    await rm(work, { recursive: true, force: true });
    fail(`Could not find the upscayl binary inside the downloaded zip. Tried: ${candidates.join(', ')}.`);
  }
  await rename(found, outPath).catch(async (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      const data = await readFile(found!);
      await writeFile(outPath, data);
    } else { throw err; }
  });
  await rm(work, { recursive: true, force: true });
}

async function findFile(dir: string, name: string): Promise<string | null> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === '__MACOSX' || e.name.startsWith('._')) continue; // Apple metadata
    const full = path.join(dir, e.name);
    if (e.isFile() && e.name === name) return full;
    if (e.isDirectory()) {
      const nested = await findFile(full, name);
      if (nested) return nested;
    }
  }
  return null;
}

async function hasCommand(cmd: string): Promise<boolean> {
  return await new Promise((resolve) => {
    const child = spawn('which', [cmd], { stdio: 'ignore' });
    child.on('exit', (code) => resolve(code === 0));
    child.on('error', () => resolve(false));
  });
}

async function runCommand(cmd: string, args: string[]): Promise<void> {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
    child.on('error', reject);
  });
}

async function smokeTest(binPath: string, modelsDir: string): Promise<void> {
  // upscayl-bin prints usage to stderr and exits non-zero when called without
  // args. That's fine — the goal is to confirm the binary loads at all (e.g.
  // dynamic linker doesn't immediately fail on missing libvulkan).
  const st = await stat(binPath);
  if (!st.isFile()) fail(`Binary not a file: ${binPath}`);
  const ok = await new Promise<boolean>((resolve) => {
    const child = spawn(binPath, ['-h'], {
      stdio: ['ignore', 'ignore', 'pipe'],
      env: { ...process.env, MODEL_PATH: modelsDir },
    });
    let stderr = '';
    child.stderr?.on('data', (d) => { stderr += d.toString(); });
    child.on('exit', () => {
      // Look for the upscayl/realesrgan-ncnn-vulkan usage banner.
      const looksRight = /usage|input.path|model.path/i.test(stderr);
      if (!looksRight) {
        console.warn(`[upscaler-install] Warning: smoke test produced unexpected stderr:\n${stderr.slice(0, 400)}`);
      }
      resolve(looksRight);
    });
    child.on('error', (err) => {
      console.warn(`[upscaler-install] Warning: could not spawn ${binPath}: ${(err as Error).message}`);
      resolve(false);
    });
  });
  if (!ok && process.platform === 'linux') {
    console.warn('[upscaler-install] Hint: missing libvulkan1 is the usual cause on Linux.');
  }
}

function log(msg: string): void {
  process.stdout.write(`[upscaler-install] ${msg}\n`);
}

function fail(msg: string): never {
  process.stderr.write(`[upscaler-install] ERROR: ${msg}\n`);
  process.exit(1);
}

void main();
