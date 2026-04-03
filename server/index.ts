import express from 'express';
import path from 'path';
import os from 'os';
import { existsSync, statSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, readdirSync, copyFileSync } from 'fs';
import { readdir, readFile, writeFile, unlink, rename, mkdir, rm, stat, copyFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import multer from 'multer';
import type { AppConfig, GameConfig, MultiInstanceGameFile, GameFileSummary, AssetCategory } from '../src/types/config.js';
import { isAudioFile, normalizeAudioFile } from './normalize.js';
import { fetchAndSavePoster, videoFilenameToSlug, MOVIE_POSTERS_SUBDIR } from './movie-posters.js';
import { probeVideoTracks, startTranscodeJob, getTranscodeJobs, getTranscodeJob, type VideoTrackInfo, type TranscodeJob, type TranscodeOptions } from './video-probe.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = process.cwd();
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const GAMES_DIR = path.join(ROOT_DIR, 'games');

// ── Asset path resolution (NAS vs local fallback) ──
const NAS_BASE = '/Volumes/Georg/Gameshow/Assets';
const LOCAL_ASSETS_BASE = path.join(ROOT_DIR, 'local-assets');
const NAS_MARKER = path.join(ROOT_DIR, '.nas-active');

// ── Persistent video cache (survives server restarts) ──
const VIDEO_CACHE_BASE = path.join(LOCAL_ASSETS_BASE, 'videos', '.cache');
const NAS_CACHE_BASE = path.join(NAS_BASE, 'videos', '.cache');

/** Convert a relative video path to a safe flat filename for caching. */
function cacheSlug(relPath: string): string {
  return relPath.replace(/[/\\]/g, '__').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/** Deterministic cache file path for a single-track remux. */
function trackCacheFile(relPath: string, trackIdx: number): string {
  const base = cacheSlug(relPath).replace(/\.[^.]+$/, '');
  return path.join(VIDEO_CACHE_BASE, 'tracks', `${base}__track${trackIdx}.mp4`);
}

/** Deterministic cache file path for an SDR tone-mapped segment. */
function sdrCacheFile(relPath: string, startSec: number, endSec: number): string {
  const base = cacheSlug(relPath).replace(/\.[^.]+$/, '');
  return path.join(VIDEO_CACHE_BASE, 'sdr', `${base}__${startSec}_${endSec}.mp4`);
}

/** Resolve a relative video path to an absolute path (prefers local when sizes match). */
function resolveVideoPath(relPath: string): string | null {
  const nasPath = path.join(NAS_BASE, 'videos', relPath);
  const localPath = path.join(LOCAL_ASSETS_BASE, 'videos', relPath);
  const localExists = existsSync(localPath);
  const nasExists = existsSync(nasPath);
  if (localExists && nasExists) {
    try {
      const ls = statSync(localPath);
      const ns = statSync(nasPath);
      return (ls.size === ns.size) ? localPath : nasPath;
    } catch { return nasPath; }
  }
  if (localExists) return localPath;
  if (nasExists) return nasPath;
  return null;
}

const HDR_CACHE_FILE = path.join(VIDEO_CACHE_BASE, 'hdr.json');

/** Derive the relative video path from an absolute path (strips NAS/local prefix). */
function videoRelPath(absPath: string): string {
  const nasPrefix = path.join(NAS_BASE, 'videos') + '/';
  const localPrefix = path.join(LOCAL_ASSETS_BASE, 'videos') + '/';
  if (absPath.startsWith(nasPrefix)) return absPath.slice(nasPrefix.length);
  if (absPath.startsWith(localPrefix)) return absPath.slice(localPrefix.length);
  return path.basename(absPath);
}

/** Load persisted HDR cache from disk. */
function loadHdrCache(): Map<string, boolean> {
  try {
    const data = JSON.parse(readFileSync(HDR_CACHE_FILE, 'utf-8'));
    return new Map(Object.entries(data) as [string, boolean][]);
  } catch {
    return new Map();
  }
}

/** Persist HDR cache to disk and mirror to NAS. */
function saveHdrCache(): void {
  mkdirSync(path.dirname(HDR_CACHE_FILE), { recursive: true });
  writeFileSync(HDR_CACHE_FILE, JSON.stringify(Object.fromEntries(hdrCache), null, 2) + '\n');
  mirrorHdrCacheToNas();
}

/** Delete all persistent cache files whose slug starts with the given prefix. */
function deleteCacheFilesForVideo(relPath: string): void {
  const slug = cacheSlug(relPath).replace(/\.[^.]+$/, '');
  for (const base of [VIDEO_CACHE_BASE, NAS_CACHE_BASE]) {
    for (const subdir of ['tracks', 'sdr']) {
      const dir = path.join(base, subdir);
      try {
        for (const file of readdirSync(dir)) {
          if (file.startsWith(slug + '__')) {
            try { unlinkSync(path.join(dir, file)); } catch { /* already gone */ }
          }
        }
      } catch { /* dir doesn't exist yet */ }
    }
  }
}

/** Mirror a local cache file to NAS in the background. */
function mirrorCacheToNas(localFile: string): void {
  if (!isNasMounted()) return;
  const rel = path.relative(VIDEO_CACHE_BASE, localFile);
  const nasFile = path.join(NAS_CACHE_BASE, rel);
  mkdir(path.dirname(nasFile), { recursive: true })
    .then(() => copyFile(localFile, nasFile))
    .catch(err => console.warn('[cache-mirror] NAS sync failed:', (err as Error).message));
}

/** Mirror hdr.json to NAS. */
function mirrorHdrCacheToNas(): void {
  if (!isNasMounted()) return;
  const nasHdrFile = path.join(NAS_CACHE_BASE, 'hdr.json');
  mkdir(path.dirname(nasHdrFile), { recursive: true })
    .then(() => copyFile(HDR_CACHE_FILE, nasHdrFile))
    .catch(err => console.warn('[cache-mirror] NAS hdr.json sync failed:', (err as Error).message));
}

/** On startup, pull any NAS cache files that are missing locally. */
function syncCacheFromNas(): void {
  if (!isNasMounted()) return;
  let synced = 0;
  for (const subdir of ['tracks', 'sdr']) {
    const nasDir = path.join(NAS_CACHE_BASE, subdir);
    const localDir = path.join(VIDEO_CACHE_BASE, subdir);
    try {
      const files = readdirSync(nasDir);
      mkdirSync(localDir, { recursive: true });
      for (const file of files) {
        const localFile = path.join(localDir, file);
        if (!existsSync(localFile)) {
          try {
            copyFileSync(path.join(nasDir, file), localFile);
            synced++;
          } catch { /* individual file failed, continue */ }
        }
      }
    } catch { /* NAS dir doesn't exist yet */ }
  }
  // Also restore hdr.json if missing locally
  const nasHdrFile = path.join(NAS_CACHE_BASE, 'hdr.json');
  if (!existsSync(HDR_CACHE_FILE) && existsSync(nasHdrFile)) {
    try {
      mkdirSync(path.dirname(HDR_CACHE_FILE), { recursive: true });
      copyFileSync(nasHdrFile, HDR_CACHE_FILE);
      synced++;
    } catch { /* failed to restore hdr.json */ }
  }
  if (synced > 0) console.log(`[cache-sync] Restored ${synced} cache file(s) from NAS`);
}

/** Populate in-memory Sets from existing cache files on disk. */
function populateCacheSets(): void {
  for (const [subdir, set] of [['tracks', trackCacheReady], ['sdr', sdrCacheReady]] as const) {
    const dir = path.join(VIDEO_CACHE_BASE, subdir);
    try {
      for (const file of readdirSync(dir)) {
        set.add(path.join(dir, file));
      }
    } catch { /* dir doesn't exist yet */ }
  }
  const total = trackCacheReady.size + sdrCacheReady.size + hdrCache.size;
  if (total > 0) console.log(`[cache] Loaded ${trackCacheReady.size} track, ${sdrCacheReady.size} SDR, ${hdrCache.size} HDR entries`);
}

// Returns true only when the user has activated NAS mode (.nas-active marker)
// AND the NAS volume is actually reachable right now.
// Checked per-request so unexpected disconnects fall back to local-assets automatically.
function isNasMounted(): boolean {
  if (!existsSync(NAS_MARKER)) return false;
  try {
    return statSync(NAS_BASE).isDirectory();
  } catch {
    return false;
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));

// Log all error responses to the terminal
app.use((_req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body: unknown) => {
    if (res.statusCode >= 400) {
      const msg = typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error: string }).error
        : JSON.stringify(body);
      console.error(`[${res.statusCode}] ${_req.method} ${_req.path} — ${msg}`);
    }
    return origJson(body);
  };
  next();
});

// Multer: upload to temp dir, then move to target
const upload = multer({ dest: os.tmpdir() });

// ── Security helpers ──

const ALLOWED_CATEGORIES: AssetCategory[] = ['audio', 'images', 'background-music', 'videos'];

function isSafeFileName(name: string): boolean {
  return !name.includes('..') && !name.includes('\0') && name.length > 0;
}

async function detectJsonIndent(filePath: string): Promise<number> {
  try {
    const content = await readFile(filePath, 'utf8');
    const match = content.match(/\n( +)"/);
    return match ? match[1].length : 2;
  } catch {
    return 2;
  }
}

// Like isSafeFileName but allows '/' for nested subfolder paths
function isSafePath(p: string): boolean {
  if (!p || p.includes('\0') || path.isAbsolute(p)) return false;
  return p.split('/').every(seg => seg.length > 0 && seg !== '..' && seg !== '.');
}

interface FolderListing { name: string; files: string[]; subfolders: FolderListing[]; }

async function listFolderRecursive(dir: string): Promise<FolderListing> {
  const name = path.basename(dir);
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const subfolders = await Promise.all(
      entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e =>
        listFolderRecursive(path.join(dir, e.name))
      )
    );
    const files = entries.filter(e => e.isFile() && !e.name.startsWith('.') && !e.name.includes('.transcoding.')).map(e => e.name);
    return { name, files, subfolders };
  } catch {
    return { name, files: [], subfolders: [] };
  }
}

function isSafeCategory(cat: string): cat is AssetCategory {
  return ALLOWED_CATEGORIES.includes(cat as AssetCategory);
}

// Resolve category to filesystem directory (NAS or local-assets, checked dynamically)
function categoryDir(category: AssetCategory): string {
  return path.join(isNasMounted() ? NAS_BASE : LOCAL_ASSETS_BASE, category);
}

// Always resolves to local-assets (used for mirroring when NAS is mounted)
function localCategoryDir(category: AssetCategory): string {
  return path.join(LOCAL_ASSETS_BASE, category);
}

// When NAS is mounted, mirror a write operation to local-assets.
// Failures are logged but never propagate — the NAS write already succeeded.
async function mirrorToLocal(op: () => Promise<void>): Promise<void> {
  if (!isNasMounted()) return;
  try {
    await op();
  } catch (err) {
    console.warn('[mirror] Failed to mirror to local-assets:', (err as Error).message);
  }
}

// In production, serve the built React app
const clientDist = path.join(ROOT_DIR, 'dist', 'client');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

// Serve static asset directories — prefer local copy when it matches NAS (saves bandwidth).
// When NAS is mounted, check if the local copy has the same file size (same-content proxy).
// If sizes match, serve from local-assets; otherwise fall through to NAS.
// When NAS is not mounted, only local-assets is tried.

// Fix MIME type for .m4v: browsers need video/mp4 (not video/x-m4v) for proper HDR tone mapping
const staticOptions: import('serve-static').ServeStaticOptions = {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.m4v')) {
      res.setHeader('Content-Type', 'video/mp4');
    }
  },
};

for (const folder of ['images', 'audio', 'background-music', 'videos']) {
  const nasDir = path.join(NAS_BASE, folder);
  const localDir = path.join(LOCAL_ASSETS_BASE, folder);

  // Middleware: if NAS is mounted and a local copy with matching size exists, serve it
  app.use(`/${folder}`, (req, _res, next) => {
    if (!isNasMounted()) return next();
    const filePath = decodeURIComponent(req.path).replace(/^\//, '');
    if (!filePath || !isSafePath(filePath)) return next();
    const localFile = path.join(localDir, filePath);
    const nasFile = path.join(nasDir, filePath);
    try {
      const localStat = statSync(localFile);
      const nasStat = statSync(nasFile);
      if (localStat.isFile() && nasStat.isFile() && localStat.size === nasStat.size) {
        // Same size — serve the local copy (bypass NAS static middleware)
        return express.static(localDir, staticOptions)(req, _res, next);
      }
    } catch {
      // Either file missing — fall through to normal static chain
    }
    return next();
  });

  // NAS first, local-assets fallback (for files that don't exist locally or differ in size)
  app.use(`/${folder}`, express.static(nasDir, staticOptions));
  app.use(`/${folder}`, express.static(localDir, staticOptions));
}

// Serve video with a specific audio track selected via ffmpeg remux (no re-encoding).
// URL: /videos-track/<audioIndex>/<path>
import { spawn } from 'child_process';
import ffmpegStaticPath from 'ffmpeg-static';
const FFMPEG_BIN = ffmpegStaticPath ?? 'ffmpeg';

// In-memory set of cache paths known to exist (avoids repeated existsSync calls)
const trackCacheReady = new Set<string>();

app.get('/videos-track/:track/*', async (req, res) => {
  const trackIdx = parseInt(req.params.track);
  if (isNaN(trackIdx) || trackIdx < 0) return res.status(400).send('Invalid track');
  const filePath = req.params[0];
  if (!filePath || !isSafePath(filePath)) return res.status(400).send('Invalid path');

  const nasPath = path.join(NAS_BASE, 'videos', filePath);
  const localPath = path.join(LOCAL_ASSETS_BASE, 'videos', filePath);
  // Prefer local copy when it has the same size as NAS (saves bandwidth)
  const localExists = existsSync(localPath);
  const nasExists = existsSync(nasPath);
  let fullPath: string | null = null;
  if (localExists && nasExists) {
    try {
      const ls = statSync(localPath);
      const ns = statSync(nasPath);
      fullPath = (ls.size === ns.size) ? localPath : nasPath;
    } catch {
      fullPath = nasPath;
    }
  } else if (localExists) {
    fullPath = localPath;
  } else if (nasExists) {
    fullPath = nasPath;
  }
  if (!fullPath) return res.status(404).send('Not found');

  const cacheFile = trackCacheFile(filePath, trackIdx);

  // Check in-memory set first, then disk, then generate
  if (!trackCacheReady.has(cacheFile) || !existsSync(cacheFile)) {
    trackCacheReady.delete(cacheFile);
    if (existsSync(cacheFile)) {
      trackCacheReady.add(cacheFile);
    } else {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      const tmpFile = cacheFile + '.tmp';
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(FFMPEG_BIN, [
            '-i', fullPath,
            '-map', '0:v',
            '-map', `0:a:${trackIdx}`,
            '-c', 'copy',
            '-f', 'mp4',
            '-movflags', '+faststart',
            '-y', tmpFile,
          ], { stdio: ['ignore', 'ignore', 'ignore'] });
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
          proc.on('error', reject);
        });
        renameSync(tmpFile, cacheFile);
        trackCacheReady.add(cacheFile);
        mirrorCacheToNas(cacheFile);
      } catch {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        return res.status(500).send('Remux failed');
      }
    }
  }

  // Serve the seekable file with range request support
  const fileStat = statSync(cacheFile);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileStat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'private, max-age=3600',
    });
    const { createReadStream } = await import('fs');
    createReadStream(cacheFile, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileStat.size,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    const { createReadStream } = await import('fs');
    createReadStream(cacheFile).pipe(res);
  }
});

// Warm the track cache in the background so audio track switching is instant.
// Probes the video, then remuxes each track to a persistent cache file.
function warmTrackCache(fullPath: string): void {
  const relPath = videoRelPath(fullPath);
  probeVideoTracks(fullPath).then(async ({ tracks }) => {
    if (tracks.length <= 1) return;
    for (let i = 0; i < tracks.length; i++) {
      const cacheFile = trackCacheFile(relPath, i);
      if (trackCacheReady.has(cacheFile) && existsSync(cacheFile)) continue;
      if (existsSync(cacheFile)) { trackCacheReady.add(cacheFile); continue; }
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      try {
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(FFMPEG_BIN, [
            '-i', fullPath,
            '-map', '0:v',
            '-map', `0:a:${i}`,
            '-c', 'copy',
            '-f', 'mp4',
            '-movflags', '+faststart',
            '-y', cacheFile,
          ], { stdio: ['ignore', 'ignore', 'ignore'] });
          proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
          proc.on('error', reject);
        });
        trackCacheReady.add(cacheFile);
        mirrorCacheToNas(cacheFile);
      } catch {
        // Individual track failed — continue with the rest
      }
    }
    console.log(`[track-cache] Warmed ${tracks.length} tracks for ${path.basename(fullPath)}`);
  }).catch((err) => {
    console.warn(`[track-cache] Warm failed for ${path.basename(fullPath)}: ${(err as Error).message}`);
  });
}

// Serve an HDR→SDR tone-mapped segment of a video.
// URL: /videos-sdr/<startSec>/<endSec>/<path>
// Extracts the segment, applies tone mapping, caches result on disk.
// For non-HDR videos, returns 400 (frontend should use normal route).
const sdrCacheReady = new Set<string>();

app.get('/videos-sdr/:start/:end/*', async (req, res) => {
  const startSec = parseFloat(req.params.start);
  const endSec = parseFloat(req.params.end);
  if (isNaN(startSec) || isNaN(endSec) || endSec <= startSec) {
    return res.status(400).send('Invalid time range');
  }
  const filePath = req.params[0];
  if (!filePath || !isSafePath(filePath)) return res.status(400).send('Invalid path');

  // Optional audio track selection via ?track=N
  const trackIdx = req.query.track !== undefined ? parseInt(req.query.track as string) : undefined;
  if (trackIdx !== undefined && (isNaN(trackIdx) || trackIdx < 0)) {
    return res.status(400).send('Invalid track');
  }

  const nasPath = path.join(NAS_BASE, 'videos', filePath);
  const localPath = path.join(LOCAL_ASSETS_BASE, 'videos', filePath);
  const localExists = existsSync(localPath);
  const nasExists = existsSync(nasPath);
  let fullPath: string | null = null;
  if (localExists && nasExists) {
    try {
      const ls = statSync(localPath);
      const ns = statSync(nasPath);
      fullPath = (ls.size === ns.size) ? localPath : nasPath;
    } catch { fullPath = nasPath; }
  } else if (localExists) {
    fullPath = localPath;
  } else if (nasExists) {
    fullPath = nasPath;
  }
  if (!fullPath) return res.status(404).send('Not found');

  const cacheFile = sdrCacheFile(filePath, startSec, endSec) + (trackIdx !== undefined ? `.t${trackIdx}` : '');

  if (!sdrCacheReady.has(cacheFile) || !existsSync(cacheFile)) {
    sdrCacheReady.delete(cacheFile);
    if (existsSync(cacheFile)) {
      sdrCacheReady.add(cacheFile);
      console.log(`[sdr] Cache hit: ${filePath} [${startSec}s–${endSec}s]`);
    } else {
      mkdirSync(path.dirname(cacheFile), { recursive: true });
      const duration = endSec - startSec;

      const vf = [
        'zscale=t=linear:npl=100',
        'format=gbrpf32le',
        'zscale=p=bt709',
        'tonemap=tonemap=hable:desat=0',
        'zscale=t=bt709:m=bt709:r=tv',
        'format=yuv420p',
      ].join(',');

      console.log(`[sdr] Transcoding ${filePath} [${startSec}s–${endSec}s] (${duration.toFixed(1)}s segment)${trackIdx !== undefined ? ` track=${trackIdx}` : ''}`);
      const transcodeStart = Date.now();
      const tmpFile = cacheFile + '.tmp';
      try {
        const mapArgs = trackIdx !== undefined
          ? ['-map', '0:v', '-map', `0:a:${trackIdx}`]
          : [];
        await new Promise<void>((resolve, reject) => {
          const proc = spawn(FFMPEG_BIN, [
            '-ss', String(startSec),
            '-t', String(duration),
            '-i', fullPath!,
            ...mapArgs,
            '-vf', vf,
            '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
            '-c:a', 'aac', '-b:a', '256k', '-ac', '2',
            '-f', 'mp4', '-movflags', '+faststart',
            '-y', tmpFile,
          ], { stdio: ['ignore', 'ignore', 'pipe'] });
          const stderrChunks: string[] = [];
          proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));
          proc.on('close', code => {
            if (code === 0) resolve();
            else {
              console.error(`[sdr] ffmpeg stderr:\n${stderrChunks.join('')}`);
              reject(new Error(`ffmpeg exit ${code}`));
            }
          });
          proc.on('error', reject);
        });
        renameSync(tmpFile, cacheFile);
        sdrCacheReady.add(cacheFile);
        mirrorCacheToNas(cacheFile);
        const elapsed = ((Date.now() - transcodeStart) / 1000).toFixed(1);
        console.log(`[sdr] Done ${filePath} [${startSec}s–${endSec}s] in ${elapsed}s`);
      } catch (err) {
        try { unlinkSync(tmpFile); } catch { /* ignore */ }
        const elapsed = ((Date.now() - transcodeStart) / 1000).toFixed(1);
        console.error(`[sdr] Failed ${filePath} [${startSec}s–${endSec}s] after ${elapsed}s: ${(err as Error).message}`);
        return res.status(500).send(`SDR transcode failed: ${(err as Error).message}`);
      }
    }
  }

  // Serve with range request support
  const fileStat = statSync(cacheFile);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileStat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileStat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'private, max-age=3600',
    });
    const { createReadStream } = await import('fs');
    createReadStream(cacheFile, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileStat.size,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    });
    const { createReadStream } = await import('fs');
    createReadStream(cacheFile).pipe(res);
  }
});

// ── Config helpers ──

async function loadConfig(): Promise<AppConfig> {
  const data = await readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(data) as AppConfig;
}

/**
 * Get the active gameOrder from config.
 * Resolves config.activeGameshow → config.gameshows[active].gameOrder
 */
function getActiveGameOrder(config: AppConfig): string[] {
  const active = config.gameshows[config.activeGameshow];
  if (!active) {
    throw new Error(`Active gameshow "${config.activeGameshow}" not found. Available: ${Object.keys(config.gameshows).join(', ')}`);
  }
  return active.gameOrder;
}

/**
 * Parse a gameOrder entry like "allgemeinwissen/v1" or "trump-oder-hitler"
 * into { gameName, instanceName }.
 */
function parseGameRef(ref: string): { gameName: string; instanceName: string | null } {
  const slashIdx = ref.indexOf('/');
  if (slashIdx === -1) return { gameName: ref, instanceName: null };
  return { gameName: ref.slice(0, slashIdx), instanceName: ref.slice(slashIdx + 1) };
}

/**
 * Load a game config from games/<gameName>.json, optionally selecting an instance.
 *
 * Single-instance file: the file IS the GameConfig.
 * Multi-instance file: base config + instances.{name} merged together.
 */
async function loadGameConfig(gameName: string, instanceName: string | null): Promise<GameConfig> {
  const filePath = path.join(GAMES_DIR, `${gameName}.json`);
  const data = await readFile(filePath, 'utf8');
  const fileContent = JSON.parse(data);

  if ('instances' in fileContent && fileContent.instances) {
    // Multi-instance game file
    const { instances, ...base } = fileContent as MultiInstanceGameFile & Record<string, unknown>;
    if (!instanceName) {
      throw new Error(`Game "${gameName}" has multiple instances but no instance was specified. Available: ${Object.keys(instances).join(', ')}`);
    }
    const instance = instances[instanceName];
    if (!instance) {
      throw new Error(`Instance "${instanceName}" not found in game "${gameName}". Available: ${Object.keys(instances).join(', ')}`);
    }
    return { ...base, ...instance } as GameConfig;
  }

  // Single-instance game file
  if (instanceName) {
    throw new Error(`Game "${gameName}" is single-instance but instance "${instanceName}" was specified`);
  }
  return fileContent as GameConfig;
}

// ── API Routes ──

app.get('/api/background-music', async (_req, res) => {
  try {
    const musicDir = path.join(ROOT_DIR, 'background-music');
    const files = await readdir(musicDir);
    const audioFiles = files.filter(
      file => /\.(mp3|m4a|wav|ogg|opus)$/i.test(file) && !file.startsWith('.')
    );
    res.json(audioFiles);
  } catch {
    console.warn('No background-music directory found');
    res.json([]);
  }
});

app.get('/api/settings', async (_req, res) => {
  try {
    const config = await loadConfig();
    res.json({
      pointSystemEnabled: config.pointSystemEnabled !== false,
      teamRandomizationEnabled: config.teamRandomizationEnabled !== false,
      globalRules: config.globalRules || [
        'Es gibt mehrere Spiele.',
        'Bei jedem Spiel wird am Ende entschieden welches Team das Spiel gewonnen hat.',
        'Das erste Spiel ist 1 Punkt wert, das zweite 2 Punkte, etc.',
        'Das Team mit den meisten Punkten gewinnt am Ende.',
      ],
    });
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// GET /api/video-hdr?path=... — check if a video is HDR (lightweight, for frontend use)
const hdrCache = loadHdrCache();
app.get('/api/video-hdr', async (req, res) => {
  const videoPath = (req.query.path as string || '').replace(/^\/videos\//, '');
  if (!videoPath || !isSafePath(videoPath)) return res.json({ isHdr: false });

  const cached = hdrCache.get(videoPath);
  if (cached !== undefined) return res.json({ isHdr: cached });

  const nasPath = path.join(NAS_BASE, 'videos', videoPath);
  const localPath = path.join(LOCAL_ASSETS_BASE, 'videos', videoPath);
  const fullPath = existsSync(localPath) ? localPath : existsSync(nasPath) ? nasPath : null;
  if (!fullPath) return res.json({ isHdr: false });

  try {
    const { videoInfo } = await probeVideoTracks(fullPath);
    const isHdr = videoInfo?.isHdr ?? false;
    hdrCache.set(videoPath, isHdr);
    saveHdrCache();
    res.json({ isHdr });
  } catch {
    res.json({ isHdr: false });
  }
});

app.get('/api/game/:index', async (req, res) => {
  try {
    const config = await loadConfig();
    const gameOrder = getActiveGameOrder(config);
    const index = parseInt(req.params.index);

    if (isNaN(index) || index < 0 || index >= gameOrder.length) {
      return res.status(404).json({ error: 'Game not found' });
    }

    const gameRef = gameOrder[index];
    const { gameName, instanceName } = parseGameRef(gameRef);

    let gameConfig: GameConfig;
    try {
      gameConfig = await loadGameConfig(gameName, instanceName);
    } catch (err) {
      return res.status(404).json({ error: `Game configuration not found: ${(err as Error).message}` });
    }

    const baseResponse = {
      gameId: gameRef,
      currentIndex: index,
      totalGames: gameOrder.length,
      pointSystemEnabled: config.pointSystemEnabled !== false,
    };

    res.json({ ...baseResponse, config: gameConfig });
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// ── Admin Backend API ──

// GET /api/backend/games — list all game files (excluding templates)
app.get('/api/backend/games', async (_req, res) => {
  try {
    const files = await readdir(GAMES_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('_'));

    const summaries: GameFileSummary[] = await Promise.all(
      jsonFiles.map(async (file): Promise<GameFileSummary> => {
        const data = await readFile(path.join(GAMES_DIR, file), 'utf8');
        const content = JSON.parse(data);
        const fileName = file.replace('.json', '');
        const isSingleInstance = !('instances' in content && content.instances);
        const instancePlayers: Record<string, string[]> = {};
        if (!isSingleInstance && content.instances) {
          for (const [key, inst] of Object.entries(content.instances as Record<string, { _players?: string[] }>)) {
            if (inst._players) instancePlayers[key] = inst._players;
          }
        }
        return {
          fileName,
          type: content.type,
          title: content.title,
          instances: isSingleInstance ? [] : Object.keys(content.instances),
          isSingleInstance,
          instancePlayers: Object.keys(instancePlayers).length > 0 ? instancePlayers : undefined,
        };
      })
    );

    summaries.sort((a, b) => a.fileName.localeCompare(b.fileName));
    res.json({ games: summaries });
  } catch (err) {
    res.status(500).json({ error: `Failed to list games: ${(err as Error).message}` });
  }
});

// GET /api/backend/games/:fileName — return raw game file JSON
app.get('/api/backend/games/:fileName', async (req, res) => {
  const { fileName } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  try {
    const data = await readFile(path.join(GAMES_DIR, `${fileName}.json`), 'utf8');
    res.json(JSON.parse(data));
  } catch {
    res.status(404).json({ error: 'Game not found' });
  }
});

// PUT /api/backend/games/:fileName — write game file (atomic)
app.put('/api/backend/games/:fileName', async (req, res) => {
  const { fileName } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  const filePath = path.join(GAMES_DIR, `${fileName}.json`);
  const tmpPath = `${filePath}.tmp`;
  try {
    const indent = await detectJsonIndent(filePath);
    await writeFile(tmpPath, JSON.stringify(req.body, null, indent) + '\n', 'utf8');
    await rename(tmpPath, filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to save game: ${(err as Error).message}` });
  }
});

// POST /api/backend/games — create new game file
app.post('/api/backend/games', async (req, res) => {
  const { fileName, gameFile } = req.body as { fileName: string; gameFile: unknown };
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  const filePath = path.join(GAMES_DIR, `${fileName}.json`);
  if (existsSync(filePath)) return res.status(409).json({ error: 'Game already exists' });
  try {
    await writeFile(filePath, JSON.stringify(gameFile, null, 2) + '\n', 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to create game: ${(err as Error).message}` });
  }
});

// DELETE /api/backend/games/:fileName — delete game file
app.delete('/api/backend/games/:fileName', async (req, res) => {
  const { fileName } = req.params;
  if (!isSafeFileName(fileName)) return res.status(400).json({ error: 'Invalid file name' });
  try {
    await unlink(path.join(GAMES_DIR, `${fileName}.json`));
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'Game not found' });
  }
});

// GET /api/backend/config — return full config.json
app.get('/api/backend/config', async (_req, res) => {
  try {
    const data = await readFile(CONFIG_PATH, 'utf8');
    res.json(JSON.parse(data));
  } catch {
    res.status(500).json({ error: 'Failed to load config' });
  }
});

// PUT /api/backend/config — write config.json (atomic)
app.put('/api/backend/config', async (req, res) => {
  const tmpPath = `${CONFIG_PATH}.tmp`;
  try {
    const indent = await detectJsonIndent(CONFIG_PATH);
    await writeFile(tmpPath, JSON.stringify(req.body, null, indent) + '\n', 'utf8');
    await rename(tmpPath, CONFIG_PATH);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to save config: ${(err as Error).message}` });
  }
});

// Helper: scan a questions array for audio trim markers for a given audio path
function scanQuestionsForMarkers(questions: unknown, audioPath: string): { start?: number; end?: number }[] {
  const results: { start?: number; end?: number }[] = [];
  if (!Array.isArray(questions)) return results;
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const qo = q as Record<string, unknown>;
    if (qo.questionAudio === audioPath) {
      results.push({
        start: typeof qo.questionAudioStart === 'number' ? qo.questionAudioStart : undefined,
        end: typeof qo.questionAudioEnd === 'number' ? qo.questionAudioEnd : undefined,
      });
    }
    if (qo.answerAudio === audioPath) {
      results.push({
        start: typeof qo.answerAudioStart === 'number' ? qo.answerAudioStart : undefined,
        end: typeof qo.answerAudioEnd === 'number' ? qo.answerAudioEnd : undefined,
      });
    }
  }
  return results;
}

// GET /api/backend/asset-usages — find games that reference a given asset path
app.get('/api/backend/asset-usages', async (req, res) => {
  const { category, file } = req.query as { category?: string; file?: string };
  if (!category || !file || !isSafeCategory(category)) return res.json({ games: [] });
  const searchPath = `/${category}/${file}`;
  try {
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    const usages: { fileName: string; title: string; instance?: string; markers?: { start?: number; end?: number }[] }[] = [];
    for (const gf of gameFiles) {
      const data = await readFile(path.join(GAMES_DIR, gf), 'utf8');
      if (!data.includes(searchPath)) continue;
      const content = JSON.parse(data);
      const fileName = gf.replace('.json', '');
      const title = content.title || gf;
      if (content.instances && typeof content.instances === 'object') {
        // One entry per matching instance with that instance's own markers
        for (const [instKey, instContent] of Object.entries(content.instances as Record<string, unknown>)) {
          if (!JSON.stringify(instContent).includes(searchPath)) continue;
          const markers = scanQuestionsForMarkers(
            instContent && typeof instContent === 'object' ? (instContent as Record<string, unknown>).questions : [],
            searchPath
          );
          usages.push({ fileName, title, instance: instKey, ...(markers.length ? { markers } : {}) });
        }
      } else {
        const markers = scanQuestionsForMarkers(content.questions, searchPath);
        usages.push({ fileName, title, ...(markers.length ? { markers } : {}) });
      }
    }
    res.json({ games: usages });
  } catch (err) {
    res.status(500).json({ error: `Failed to search usages: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/move — rename file/folder and rewrite game references
app.post('/api/backend/assets/:category/move', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const { from, to } = req.body as { from?: string; to?: string };
  if (!from || !to || !isSafePath(from) || !isSafePath(to)) {
    return res.status(400).json({ error: 'Invalid path' });
  }
  const dir = categoryDir(category);
  const fromFull = path.join(dir, from);
  const toFull = path.join(dir, to);
  try {
    // Check if destination already exists as a directory (naming collision).
    // This happens when moving the last file out of a folder that shares the file's name,
    // e.g. moving "Foo/Foo.jpg" to root — toFull "Foo.jpg" is still a directory at this point.
    let destIsDir = false;
    try { destIsDir = (await stat(toFull)).isDirectory(); } catch { /* toFull doesn't exist */ }

    if (destIsDir) {
      const tmpPath = `${toFull}.__moving__`;
      await rename(fromFull, tmpPath);
      try {
        const remaining = await readdir(path.dirname(fromFull));
        if (remaining.length === 0) await rm(path.dirname(fromFull), { recursive: true });
      } catch { /* ignore cleanup errors */ }
      await rename(tmpPath, toFull);
    } else {
      await mkdir(path.dirname(toFull), { recursive: true });
      await rename(fromFull, toFull);
    }

    await mirrorToLocal(async () => {
      const localDir = localCategoryDir(category);
      const localFrom = path.join(localDir, from);
      const localTo = path.join(localDir, to);
      let localDestIsDir = false;
      try { localDestIsDir = (await stat(localTo)).isDirectory(); } catch { /* doesn't exist */ }
      if (localDestIsDir) {
        const tmpPath = `${localTo}.__moving__`;
        await rename(localFrom, tmpPath);
        try {
          const remaining = await readdir(path.dirname(localFrom));
          if (remaining.length === 0) await rm(path.dirname(localFrom), { recursive: true });
        } catch { /* ignore */ }
        await rename(tmpPath, localTo);
      } else {
        await mkdir(path.dirname(localTo), { recursive: true });
        await rename(localFrom, localTo);
      }
    });

    // Rewrite game references: replace /<category>/<from> → /<category>/<to>
    const fromUrl = `/${category}/${from}`;
    const toUrl = `/${category}/${to}`;
    const gameFiles = (await readdir(GAMES_DIR)).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    for (const gf of gameFiles) {
      const fp = path.join(GAMES_DIR, gf);
      const data = await readFile(fp, 'utf8');
      if (data.includes(fromUrl)) {
        const tmpPath = `${fp}.tmp`;
        await writeFile(tmpPath, data.split(fromUrl).join(toUrl), 'utf8');
        await rename(tmpPath, fp);
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to move: ${(err as Error).message}` });
  }
});

// GET /api/backend/asset-storage — current storage mode (NAS or local-assets)
app.get('/api/backend/asset-storage', (_req, res) => {
  const nas = isNasMounted();
  res.json({ mode: nas ? 'nas' : 'local', path: nas ? NAS_BASE : LOCAL_ASSETS_BASE });
});

// GET /api/backend/assets/:category — list files/subfolders
app.get('/api/backend/assets/:category', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const dir = categoryDir(category);

  try {
    if (!existsSync(dir)) {
      return res.json({ files: [] });
    }

    const entries = await readdir(dir, { withFileTypes: true });

    const subfolders = await Promise.all(
      entries.filter(e => e.isDirectory() && !e.name.startsWith('.')).map(e =>
        listFolderRecursive(path.join(dir, e.name))
      )
    );
    const files = entries.filter(e => e.isFile() && !e.name.startsWith('.') && !e.name.includes('.transcoding.')).map(e => e.name);
    res.json({ files, subfolders });
  } catch (err) {
    res.status(500).json({ error: `Failed to list assets: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/upload — upload file
app.post('/api/backend/assets/:category/upload', upload.single('file'), async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const subfolder = (req.query.subfolder as string) || '';
  if (subfolder && !isSafePath(subfolder)) return res.status(400).json({ error: 'Invalid subfolder' });

  const baseDir = subfolder
    ? path.join(categoryDir(category), subfolder)
    : categoryDir(category);

  try {
    await mkdir(baseDir, { recursive: true });
    const destPath = path.join(baseDir, req.file.originalname);
    try {
      await rename(req.file.path, destPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(req.file.path, destPath);
        await unlink(req.file.path);
      } else throw e;
    }
    // Normalize audio files to -16 LUFS during upload
    let finalPath = destPath;
    const isAudio = category === 'audio' || category === 'background-music';
    if (isAudio && isAudioFile(destPath)) {
      finalPath = await normalizeAudioFile(destPath);
    }
    const finalName = path.basename(finalPath);
    // Mirror to local-assets in the background — don't block the response
    mirrorToLocal(async () => {
      const localBase = subfolder
        ? path.join(localCategoryDir(category), subfolder)
        : localCategoryDir(category);
      await mkdir(localBase, { recursive: true });
      await copyFile(finalPath, path.join(localBase, finalName));
    });
    // Pre-warm track cache for video uploads so audio switching is instant
    if (category === 'videos') warmTrackCache(finalPath);
    res.json({ fileName: finalName });
  } catch (err) {
    res.status(500).json({ error: `Failed to upload: ${(err as Error).message}` });
  }
});

// ── Chunked upload (for large files with dynamic throttling) ──

const CHUNKS_BASE = path.join(os.tmpdir(), 'gameshow-chunks');

// Cleanup stale chunk directories on startup (older than 1 hour)
(async () => {
  try {
    if (!existsSync(CHUNKS_BASE)) return;
    const dirs = await readdir(CHUNKS_BASE);
    const now = Date.now();
    for (const d of dirs) {
      const p = path.join(CHUNKS_BASE, d);
      try {
        const s = await stat(p);
        if (now - s.mtimeMs > 3600_000) await rm(p, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
})();

// POST /api/backend/assets/:category/upload-chunk — receive a single chunk
app.post('/api/backend/assets/:category/upload-chunk', upload.single('chunk'), async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'No chunk uploaded' });

  const uploadId = req.query.uploadId as string;
  const chunkIndex = req.query.chunkIndex as string;
  if (!uploadId || chunkIndex == null) return res.status(400).json({ error: 'Missing uploadId or chunkIndex' });

  const chunkDir = path.join(CHUNKS_BASE, uploadId);
  try {
    await mkdir(chunkDir, { recursive: true });
    const dest = path.join(chunkDir, chunkIndex);
    try {
      await rename(req.file.path, dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(req.file.path, dest);
        await unlink(req.file.path);
      } else throw e;
    }
    res.json({ received: true, chunkIndex: Number(chunkIndex) });
  } catch (err) {
    res.status(500).json({ error: `Chunk upload failed: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/upload-finalize — assemble chunks into final file
app.post('/api/backend/assets/:category/upload-finalize', express.json(), async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const { uploadId, fileName, totalChunks, subfolder } = req.body as {
    uploadId: string; fileName: string; totalChunks: number; subfolder?: string;
  };
  if (!uploadId || !fileName || !totalChunks) return res.status(400).json({ error: 'Missing fields' });
  if (subfolder && !isSafePath(subfolder)) return res.status(400).json({ error: 'Invalid subfolder' });

  const chunkDir = path.join(CHUNKS_BASE, uploadId);
  if (!existsSync(chunkDir)) return res.status(400).json({ error: 'No chunks found for this upload' });

  const baseDir = subfolder ? path.join(categoryDir(category), subfolder) : categoryDir(category);

  try {
    // Verify all chunks are present
    for (let i = 0; i < totalChunks; i++) {
      if (!existsSync(path.join(chunkDir, String(i)))) {
        return res.status(400).json({ error: `Missing chunk ${i}` });
      }
    }

    await mkdir(baseDir, { recursive: true });
    const destPath = path.join(baseDir, fileName);

    // Stream-concatenate chunks to avoid loading entire file into memory
    const { createReadStream: crs } = await import('fs');
    const ws = createWriteStream(destPath);
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(chunkDir, String(i));
      await new Promise<void>((resolve, reject) => {
        const rs = crs(chunkPath);
        rs.pipe(ws, { end: false });
        rs.on('end', resolve);
        rs.on('error', reject);
      });
    }
    ws.end();
    await new Promise<void>((resolve, reject) => {
      ws.on('finish', resolve);
      ws.on('error', reject);
    });

    // Cleanup chunks
    await rm(chunkDir, { recursive: true, force: true });

    // Same post-processing as regular upload
    let finalPath = destPath;
    const isAudio = category === 'audio' || category === 'background-music';
    if (isAudio && isAudioFile(destPath)) {
      finalPath = await normalizeAudioFile(destPath);
    }
    const finalName = path.basename(finalPath);

    mirrorToLocal(async () => {
      const localBase = subfolder
        ? path.join(localCategoryDir(category), subfolder)
        : localCategoryDir(category);
      await mkdir(localBase, { recursive: true });
      await copyFile(finalPath, path.join(localBase, finalName));
    });
    if (category === 'videos') warmTrackCache(finalPath);

    res.json({ fileName: finalName });
  } catch (err) {
    res.status(500).json({ error: `Finalize failed: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/:category/upload-abort — cleanup partial chunks
app.post('/api/backend/assets/:category/upload-abort', express.json(), async (req, res) => {
  const { uploadId } = req.body as { uploadId: string };
  if (!uploadId) return res.status(400).json({ error: 'Missing uploadId' });
  const chunkDir = path.join(CHUNKS_BASE, uploadId);
  try {
    if (existsSync(chunkDir)) await rm(chunkDir, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Abort cleanup failed: ${(err as Error).message}` });
  }
});

// ── yt-dlp binary management (auto-downloaded standalone binary) ──
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { chmod } from 'fs/promises';
const YT_DLP_BIN = path.join(ROOT_DIR, 'node_modules', '.cache', 'yt-dlp');
let ytDlpReady: Promise<void> | null = null;

function ytDlpAssetName(): string {
  const p = process.platform;
  const a = process.arch;
  if (p === 'darwin') return a === 'arm64' ? 'yt-dlp_macos' : 'yt-dlp_macos';
  if (p === 'linux') return a === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux';
  if (p === 'win32') return 'yt-dlp.exe';
  return 'yt-dlp';
}

function ensureYtDlp(): Promise<void> {
  if (!ytDlpReady) {
    ytDlpReady = (async () => {
      if (existsSync(YT_DLP_BIN)) return;
      await mkdir(path.dirname(YT_DLP_BIN), { recursive: true });
      const asset = ytDlpAssetName();
      const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`;
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok || !res.body) throw new Error(`Failed to download yt-dlp: ${res.status}`);
      await pipeline(res.body as unknown as NodeJS.ReadableStream, createWriteStream(YT_DLP_BIN));
      await chmod(YT_DLP_BIN, 0o755);
    })();
  }
  return ytDlpReady;
}

// POST /api/backend/assets/:category/youtube-download — download audio/video from YouTube via yt-dlp
app.post('/api/backend/assets/:category/youtube-download', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const ytAllowed = ['audio', 'background-music', 'videos'];
  if (!ytAllowed.includes(category)) {
    return res.status(400).json({ error: 'YouTube download only supported for audio and video categories' });
  }
  const isVideoDownload = category === 'videos';
  const { url, subfolder } = req.body as { url?: string; subfolder?: string };
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });
  if (subfolder && !isSafePath(subfolder)) return res.status(400).json({ error: 'Invalid subfolder' });

  // SSE setup — disable all buffering so progress reaches the client immediately
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
  };

  // Ensure yt-dlp binary is available (auto-downloads on first use)
  try {
    await ensureYtDlp();
  } catch (err) {
    send({ phase: 'error', message: `yt-dlp konnte nicht heruntergeladen werden: ${(err as Error).message}` });
    res.end();
    return;
  }

  // Fetch video title first so the client can show it immediately
  let title = '';
  try {
    const { execFileSync } = await import('child_process');
    title = execFileSync(YT_DLP_BIN, ['--no-playlist', '--print', 'title', url], { timeout: 15000, encoding: 'utf-8' }).trim();
  } catch { /* title stays empty, will be filled during download */ }
  send({ phase: 'downloading', percent: 0, title });

  const tmpDir = path.join(os.tmpdir(), `yt-dl-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  try {
    // Step 1: Download with yt-dlp (audio extraction or video depending on category)
    const ytdlpArgs = isVideoDownload
      ? [
          '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
          '--merge-output-format', 'mp4',
          '--no-playlist',
          '--newline',
          '--ffmpeg-location', FFMPEG_BIN,
          '-o', path.join(tmpDir, '%(title)s.%(ext)s'),
          url,
        ]
      : [
          '-x',                          // extract audio
          '--audio-format', 'mp3',       // convert to mp3
          '--audio-quality', '0',        // best quality
          '--no-playlist',               // single video only
          '--newline',                   // progress on new lines (one line per update)
          '--ffmpeg-location', FFMPEG_BIN,
          '-o', path.join(tmpDir, '%(title)s.%(ext)s'),
          url,
        ];
    const ytdlp = spawn(YT_DLP_BIN, ytdlpArgs);

    let downloadError = '';
    let lastPct = -1;

    // yt-dlp prints all progress on stderr with --newline
    ytdlp.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      downloadError += text;
      // Extract title from destination line
      const destMatch = text.match(/\[download\] Destination: (.+)/);
      if (destMatch) {
        title = path.basename(destMatch[1]).replace(/\.[^.]+$/, '');
        send({ phase: 'downloading', percent: 0, title });
      }
      // Extract percentage — yt-dlp outputs lines like "[download]  45.2% of 5.23MiB ..."
      const pctMatch = text.match(/(\d+(?:\.\d+)?)%/);
      if (pctMatch) {
        const pct = Math.round(parseFloat(pctMatch[1]));
        // Only send if changed by at least 1% to avoid flooding
        if (pct !== lastPct) {
          lastPct = pct;
          send({ phase: 'downloading', percent: pct, title });
        }
      }
    });

    // Capture stdout too (ffmpeg conversion output)
    ytdlp.stdout.on('data', (chunk: Buffer) => {
      downloadError += chunk.toString();
    });

    const exitCode = await new Promise<number>((resolve) => {
      ytdlp.on('close', resolve);
    });

    if (exitCode !== 0) {
      send({ phase: 'error', message: `yt-dlp fehlgeschlagen (Exit Code ${exitCode}): ${downloadError.slice(0, 300)}` });
      res.end();
      await rm(tmpDir, { recursive: true, force: true });
      return;
    }

    // Find the downloaded file
    const downloaded = await readdir(tmpDir);
    if (downloaded.length === 0) {
      send({ phase: 'error', message: 'Keine Datei heruntergeladen' });
      res.end();
      await rm(tmpDir, { recursive: true, force: true });
      return;
    }

    const dlFile = downloaded[0];
    const dlPath = path.join(tmpDir, dlFile);

    // Step 2: Move to asset directory and normalize
    send({ phase: 'processing' });
    const baseDir = subfolder
      ? path.join(categoryDir(category), subfolder)
      : categoryDir(category);
    await mkdir(baseDir, { recursive: true });

    const destPath = path.join(baseDir, dlFile);
    try {
      await rename(dlPath, destPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        await copyFile(dlPath, destPath);
        await unlink(dlPath);
      } else throw e;
    }

    // Normalize audio (skip for video downloads)
    let finalPath = destPath;
    if (!isVideoDownload && isAudioFile(destPath)) {
      finalPath = await normalizeAudioFile(destPath);
    }
    const finalName = path.basename(finalPath);

    // Mirror to local-assets
    mirrorToLocal(async () => {
      const localBase = subfolder
        ? path.join(localCategoryDir(category), subfolder)
        : localCategoryDir(category);
      await mkdir(localBase, { recursive: true });
      await copyFile(finalPath, path.join(localBase, finalName));
    });

    if (isVideoDownload) warmTrackCache(finalPath);
    send({ phase: 'done', fileName: finalName });
    res.end();
  } catch (err) {
    send({ phase: 'error', message: `Fehler: ${(err as Error).message}` });
    res.end();
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

// POST /api/backend/assets/videos/fetch-cover — fetch movie poster on demand
app.post('/api/backend/assets/videos/fetch-cover', async (req, res) => {
  const { fileName } = req.body as { fileName?: string };
  if (!fileName || !isSafePath(fileName)) return res.status(400).json({ error: 'Invalid fileName' });

  const imagesDir = categoryDir('images');
  const logs: string[] = [];
  const log = (msg: string) => { logs.push(msg); console.log(`[poster] ${msg}`); };

  try {
    const posterRelPath = await fetchAndSavePoster(fileName, imagesDir, log);
    if (posterRelPath) {
      const slug = videoFilenameToSlug(fileName);
      await mirrorToLocal(async () => {
        const nasFile = path.join(imagesDir, MOVIE_POSTERS_SUBDIR, `${slug}.jpg`);
        if (existsSync(nasFile)) {
          const localDir = path.join(localCategoryDir('images'), MOVIE_POSTERS_SUBDIR);
          await mkdir(localDir, { recursive: true });
          await copyFile(nasFile, path.join(localDir, `${slug}.jpg`));
        }
      });
    }
    res.json({ posterPath: posterRelPath, logs });
  } catch (err) {
    res.status(500).json({ error: `Failed to fetch cover: ${(err as Error).message}`, logs });
  }
});

// GET /api/backend/assets/videos/probe?path=... — check audio tracks
app.get('/api/backend/assets/videos/probe', async (req, res) => {
  const filePath = req.query.path as string;
  if (!filePath || !isSafePath(filePath)) return res.status(400).json({ error: 'Invalid path' });
  const fullPath = path.join(categoryDir('videos'), filePath);
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });
  try {
    const result = await probeVideoTracks(fullPath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: `Probe failed: ${(err as Error).message}` });
  }
});

// POST /api/backend/assets/videos/transcode — start transcode (non-blocking)
app.post('/api/backend/assets/videos/transcode', (req, res) => {
  const { filePath, hdrToSdr } = req.body as { filePath?: string; hdrToSdr?: boolean };
  if (!filePath || !isSafePath(filePath)) return res.status(400).json({ error: 'Invalid path' });
  const fullPath = path.join(categoryDir('videos'), filePath);
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'File not found' });

  const options: TranscodeOptions = { hdrToSdr: !!hdrToSdr };
  const job = startTranscodeJob(fullPath, filePath, (finished) => {
    if (finished.status === 'done') {
      // Invalidate stale persistent cache entries and re-warm with new file
      deleteCacheFilesForVideo(filePath);
      trackCacheReady.clear();
      sdrCacheReady.clear();
      hdrCache.delete(filePath);
      saveHdrCache();
      warmTrackCache(fullPath);
      // Mirror transcoded file to local in the background
      mirrorToLocal(async () => {
        const localPath = path.join(localCategoryDir('videos'), filePath);
        await mkdir(path.dirname(localPath), { recursive: true });
        await copyFile(fullPath, localPath);
      });
    }
  }, options);
  res.json({ status: job.status, percent: job.percent });
});

// GET /api/backend/assets/videos/transcode-status — get all active transcode jobs
app.get('/api/backend/assets/videos/transcode-status', (_req, res) => {
  res.json({ jobs: getTranscodeJobs() });
});

// GET /api/backend/assets/videos/sdr-cache-status — check if an SDR cache file exists
app.get('/api/backend/assets/videos/sdr-cache-status', (req, res) => {
  const video = req.query.video as string | undefined;
  const startSec = parseFloat(req.query.start as string);
  const endSec = parseFloat(req.query.end as string);
  const trackIdx = req.query.track !== undefined ? parseInt(req.query.track as string) : undefined;
  if (!video || isNaN(startSec) || isNaN(endSec) || endSec <= startSec) {
    return res.status(400).json({ cached: false });
  }
  const relPath = video.replace(/^\/videos\//, '');
  if (!isSafePath(relPath)) return res.status(400).json({ cached: false });
  const cacheFile = sdrCacheFile(relPath, startSec, endSec) + (trackIdx !== undefined ? `.t${trackIdx}` : '');
  const cached = sdrCacheReady.has(cacheFile) || existsSync(cacheFile);
  if (cached) sdrCacheReady.add(cacheFile);
  res.json({ cached });
});

// POST /api/backend/assets/videos/warmup-sdr — pre-transcode an HDR segment to SDR with progress
// Returns SSE stream: data: { percent: number } events, then data: { done: true } or { error: string }
app.post('/api/backend/assets/videos/warmup-sdr', async (req, res) => {
  const { video, start: startSec, end: endSec, track: trackIdx } = req.body as { video?: string; start?: number; end?: number; track?: number };
  if (!video || startSec === undefined || endSec === undefined || endSec <= startSec) {
    return res.status(400).json({ error: 'Invalid params' });
  }
  if (trackIdx !== undefined && (isNaN(trackIdx) || trackIdx < 0)) {
    return res.status(400).json({ error: 'Invalid track' });
  }
  const relPath = video.replace(/^\/videos\//, '');
  if (!isSafePath(relPath)) return res.status(400).json({ error: 'Invalid path' });

  const fullPath = resolveVideoPath(relPath);
  if (!fullPath) return res.status(404).json({ error: 'File not found' });

  const cacheFile = sdrCacheFile(relPath, startSec, endSec) + (trackIdx !== undefined ? `.t${trackIdx}` : '');

  // Already cached?
  if (sdrCacheReady.has(cacheFile) || existsSync(cacheFile)) {
    sdrCacheReady.add(cacheFile);
    console.log(`[sdr-warmup] Already cached: ${relPath} [${startSec}s–${endSec}s]`);
    return res.json({ done: true, cached: true });
  }

  // SSE setup
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  const send = (data: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const duration = endSec - startSec;
  console.log(`[sdr-warmup] Starting: ${relPath} [${startSec}s–${endSec}s] (${duration.toFixed(1)}s segment)${trackIdx !== undefined ? ` track=${trackIdx}` : ''}`);
  const transcodeStart = Date.now();

  mkdirSync(path.dirname(cacheFile), { recursive: true });

  const vf = [
    'zscale=t=linear:npl=100',
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ].join(',');

  const mapArgs = trackIdx !== undefined
    ? ['-map', '0:v', '-map', `0:a:${trackIdx}`]
    : [];
  const tmpFile = cacheFile + '.tmp';
  const proc = spawn(FFMPEG_BIN, [
    '-progress', 'pipe:1', '-nostats',
    '-ss', String(startSec),
    '-t', String(duration),
    '-i', fullPath,
    ...mapArgs,
    '-vf', vf,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '256k', '-ac', '2',
    '-f', 'mp4', '-movflags', '+faststart',
    '-y', tmpFile,
  ]);

  const stderrChunks: string[] = [];
  proc.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString()));

  proc.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      const match = line.match(/^out_time_ms=(\d+)/);
      if (match && duration > 0) {
        const seconds = parseInt(match[1]) / 1_000_000;
        const pct = Math.min(95, Math.round((seconds / duration) * 100));
        send({ percent: pct });
      }
    }
  });

  proc.on('close', (code) => {
    const elapsed = ((Date.now() - transcodeStart) / 1000).toFixed(1);
    if (code === 0) {
      try { renameSync(tmpFile, cacheFile); } catch { /* ignore */ }
      sdrCacheReady.add(cacheFile);
      mirrorCacheToNas(cacheFile);
      console.log(`[sdr-warmup] Done: ${relPath} [${startSec}s–${endSec}s] in ${elapsed}s`);
      send({ percent: 100, done: true });
    } else {
      try { unlinkSync(tmpFile); } catch { /* ignore */ }
      console.error(`[sdr-warmup] Failed: ${relPath} [${startSec}s–${endSec}s] after ${elapsed}s`);
      console.error(`[sdr-warmup] ffmpeg stderr:\n${stderrChunks.join('')}`);
      send({ error: `ffmpeg exit ${code}` });
    }
    res.end();
  });

  proc.on('error', (err) => {
    const elapsed = ((Date.now() - transcodeStart) / 1000).toFixed(1);
    console.error(`[sdr-warmup] Error: ${relPath} after ${elapsed}s: ${err.message}`);
    send({ error: err.message });
    res.end();
  });
});

// POST /api/backend/assets/:category/mkdir — create an empty folder
app.post('/api/backend/assets/:category/mkdir', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const { folderPath } = req.body as { folderPath?: string };
  if (!folderPath || !isSafePath(folderPath)) return res.status(400).json({ error: 'Invalid folderPath' });
  try {
    await mkdir(path.join(categoryDir(category), folderPath), { recursive: true });
    await mirrorToLocal(async () => {
      await mkdir(path.join(localCategoryDir(category), folderPath), { recursive: true });
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Failed to create folder: ${(err as Error).message}` });
  }
});

// DELETE /api/backend/assets/:category — delete a file (path in body or via wildcard)
// Using a wildcard route to support subfolder paths like audio/FolderName/file.wav
app.delete('/api/backend/assets/:category/*', async (req, res) => {
  const { category } = req.params;
  if (!isSafeCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const filePath = (req.params as Record<string, string>)['0'];
  if (!filePath || filePath.includes('..') || filePath.includes('\0')) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const fullPath = path.join(categoryDir(category), filePath);

  try {
    const stat = await import('fs/promises').then(m => m.stat(fullPath));
    if (stat.isDirectory()) {
      await rm(fullPath, { recursive: true });
    } else {
      await unlink(fullPath);
    }
    await mirrorToLocal(async () => {
      const localPath = path.join(localCategoryDir(category), filePath);
      const localStat = await import('fs/promises').then(m => m.stat(localPath));
      if (localStat.isDirectory()) {
        await rm(localPath, { recursive: true });
      } else {
        await unlink(localPath);
      }
    });
    // Clean up persistent video cache for deleted files
    if (category === 'videos') {
      deleteCacheFilesForVideo(filePath);
      trackCacheReady.clear();
      sdrCacheReady.clear();
      hdrCache.delete(filePath);
      saveHdrCache();
    }
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: 'File not found' });
  }
});

// ── SPA fallback ──

if (existsSync(clientDist)) {
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ── Start ──

app.listen(PORT, async () => {
  try {
    const config = await loadConfig();
    const gameOrder = getActiveGameOrder(config);
    console.log(`Server is running on http://localhost:${PORT}`);
    console.log(`Active gameshow: "${config.activeGameshow}" with ${gameOrder.length} games`);
  } catch (err) {
    console.log(`Server is running on http://localhost:${PORT}`);
    console.warn('Failed to load config on startup:', err);
  }
  // Restore any cache files from NAS that are missing locally, then populate in-memory Sets
  syncCacheFromNas();
  populateCacheSets();
});
