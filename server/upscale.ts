// server/upscale.ts
//
// Local-AI image upscaling via the upscayl-ncnn engine (Real-ESRGAN).
// Surfaced in the admin DAM as a 4th tab inside ReplaceImageModal —
// see specs/dam-image-upscale.md.
//
// Run via `npm run upscaler:install` first; this module ONLY spawns the
// pre-installed binary at local-assets/.upscaler/<platform>-<arch>/upscayl-bin.

import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { LOCAL_ASSETS_BASE } from './asset-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLATFORM_DIR = `${process.platform}-${process.arch}`;
const UPSCALER_ROOT = path.join(LOCAL_ASSETS_BASE, '.upscaler');
const BIN = path.join(UPSCALER_ROOT, PLATFORM_DIR, 'upscayl-bin');
const MODELS_DIR = path.join(UPSCALER_ROOT, 'models');

export type UpscaleModel = 'ultramix_balanced' | 'ultrasharp' | 'digital_art';
// The AI model is fixed at 4×. We always run it at native 4× and Sharp-resize
// down to the requested scale. Scales > 4 are deliberately not offered — they
// would be bicubic upscales of the AI output with no additional sharpness.
export type UpscaleScale = 1.5 | 2 | 3 | 4;
export const UPSCALE_MODELS: readonly UpscaleModel[] = [
  'ultramix_balanced',
  'ultrasharp',
  'digital_art',
];
export const UPSCALE_SCALES: readonly UpscaleScale[] = [1.5, 2, 3, 4];
export const UPSCALE_SUPPORTED_EXTS = ['.jpg', '.jpeg', '.png', '.webp'] as const;

// API uses snake_case (stable enum); on-disk model basenames are Upscayl's
// hyphenated convention (`upscayl/upscayl/resources/models`). This map is the
// only place that bridges the two.
const MODEL_BASENAME: Record<UpscaleModel, string> = {
  ultramix_balanced: 'ultramix-balanced-4x',
  ultrasharp: 'ultrasharp-4x',
  digital_art: 'digital-art-4x',
};

const JPEG_QUALITY = 88;
const WEBP_QUALITY = 88;
const SPAWN_TIMEOUT_MS = 60_000;
const CACHE_MAX_ENTRIES = 50;

export interface UpscaleResult {
  buffer: Buffer;
  width: number;
  height: number;
  contentType: string;
  durationMs: number;
  cacheKey: string;
  cached: boolean;
}

export function isUpscalerAvailable(): boolean {
  return existsSync(BIN);
}

export function getSupportedPlatforms(): readonly string[] {
  return ['darwin-arm64', 'darwin-x64', 'linux-x64'];
}

// ── In-memory preview cache ──────────────────────────────────────────────
// Cleared on Node restart. Keyed by sha1(inputBytes) + model + scale + ext.
interface CacheEntry {
  buffer: Buffer;
  contentType: string;
  width: number;
  height: number;
  lastUsed: number;
}
const cache = new Map<string, CacheEntry>();

export function getCachedUpscale(cacheKey: string): CacheEntry | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  entry.lastUsed = Date.now();
  return entry;
}

function setCached(cacheKey: string, entry: Omit<CacheEntry, 'lastUsed'>): void {
  cache.set(cacheKey, { ...entry, lastUsed: Date.now() });
  if (cache.size > CACHE_MAX_ENTRIES) {
    // LRU prune. Sort by lastUsed asc, drop the oldest.
    const sorted = Array.from(cache.entries()).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const toDrop = sorted.slice(0, cache.size - CACHE_MAX_ENTRIES);
    for (const [k] of toDrop) cache.delete(k);
  }
}

export function buildCacheKey(inputBytes: Buffer, model: UpscaleModel, scale: UpscaleScale, ext: string): string {
  const hash = createHash('sha1').update(inputBytes).digest('hex');
  return `${hash}-${model}-${scale}x${ext.toLowerCase()}`;
}

// ── Progress fan-out ──────────────────────────────────────────────────────
// The upscale endpoint accepts an optional `progressId`. The SSE endpoint
// `GET /api/backend/assets/images/upscale/progress/:progressId` registers a
// callback under that id; this module's `emitProgress()` looks the callback
// up and pushes a percent value into it. Single listener per id (one client
// poll per upscale).
type ProgressCallback = (percent: number) => void;
const progressListeners = new Map<string, ProgressCallback>();

export function setProgressListener(progressId: string, cb: ProgressCallback): () => void {
  progressListeners.set(progressId, cb);
  return () => {
    if (progressListeners.get(progressId) === cb) {
      progressListeners.delete(progressId);
    }
  };
}

function emitProgress(progressId: string | undefined, percent: number): void {
  if (!progressId) return;
  const cb = progressListeners.get(progressId);
  cb?.(percent);
}

// ── Concurrency: one upscale at a time (GPU bottleneck) ──────────────────
let queueTail: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queueTail.then(fn, fn);
  queueTail = next.catch(() => {});
  return next;
}

// ── Main entry point ─────────────────────────────────────────────────────
export interface UpscaleOpts {
  model: UpscaleModel;
  scale: UpscaleScale;
  targetExt: string; // '.jpg' | '.jpeg' | '.png' | '.webp' — output format follows input
  progressId?: string; // optional fan-out target for per-tile progress percents
}

export async function upscaleImage(input: Buffer, opts: UpscaleOpts): Promise<UpscaleResult> {
  if (!isUpscalerAvailable()) {
    throw new UpscaleError('not_installed', 'AI upscaler is not installed for this platform. Run `npm run upscaler:install`.');
  }
  const ext = normalizeExt(opts.targetExt);
  const cacheKey = buildCacheKey(input, opts.model, opts.scale, ext);
  const cached = getCachedUpscale(cacheKey);
  if (cached) {
    return {
      buffer: cached.buffer,
      width: cached.width,
      height: cached.height,
      contentType: cached.contentType,
      durationMs: 0,
      cacheKey,
      cached: true,
    };
  }
  return await enqueue(async () => {
    const t0 = Date.now();
    const work = mkdtempSync(path.join(tmpdir(), 'upscale-'));
    const inPath = path.join(work, 'in.png');
    const outPath = path.join(work, 'out.png');
    try {
      // Probe source dims so we can compute the final target size after the
      // AI pass. The model is fixed at 4× so we always run -s 4 and then
      // Sharp-resize to (source × requestedScale).
      const srcMeta = await sharp(input).metadata();
      const srcW = srcMeta.width;
      const srcH = srcMeta.height;
      if (!srcW || !srcH) {
        throw new UpscaleError('spawn_failed', 'Konnte Quellbildgröße nicht ermitteln.');
      }
      const targetW = Math.round(srcW * opts.scale);
      const targetH = Math.round(srcH * opts.scale);

      // Sharp pre-pass: decode whatever the input is and write PNG. The
      // upscaler only takes PNG/JPG; PNG sidesteps JPEG-of-JPEG quality loss.
      await sharp(input).png().toFile(inPath);

      // Spawn the upscaler at native 4×. upscayl-ncnn divides the image
      // into 256×256 tiles (`-t 256`) and reports per-tile percent on
      // stderr — each tile cycles 0→100 independently. We convert that to
      // an overall percent by tracking tile resets and folding the running
      // tile's percent into the count of completed tiles.
      const TILE = 256;
      const estimatedTiles = Math.max(
        1,
        Math.ceil(srcW / TILE) * Math.ceil(srcH / TILE),
      );
      let lastRaw = -1;
      let tileIdx = 0;
      let lastOverall = 0;
      await spawnUpscaler(inPath, outPath, opts.model, 4, (raw) => {
        // A significant drop (>10pt) marks the start of the next tile.
        if (lastRaw >= 0 && raw < lastRaw - 10) tileIdx++;
        lastRaw = raw;
        const overall = ((tileIdx + raw / 100) / estimatedTiles) * 100;
        // Monotonic: never let the bar go backwards. Cap at 99 until the
        // AI process exits cleanly — the final 100 is emitted below.
        const next = Math.min(99, overall);
        if (next > lastOverall) {
          lastOverall = next;
          emitProgress(opts.progressId, next);
        }
      });
      // AI process finished — emit a final 100% so the bar always lands.
      emitProgress(opts.progressId, 100);

      // Sharp post-pass: resize the AI's 4× output to (source × scale), then
      // re-encode to target ext, apply EXIF orientation, strip metadata via
      // the encoder. Fast path: skip the resize call entirely when scale
      // === 4 because the AI output is already exactly that size — saves
      // a Sharp resize pass on what's typically the largest image case.
      const rawUpscaled = await readFile(outPath);
      const post = opts.scale === 4
        ? sharp(rawUpscaled).rotate()
        : sharp(rawUpscaled).resize({ width: targetW, height: targetH, fit: 'fill' }).rotate();

      let pipeline: sharp.Sharp;
      let contentType: string;
      if (ext === '.png') {
        pipeline = post.png({ compressionLevel: 9 });
        contentType = 'image/png';
      } else if (ext === '.webp') {
        pipeline = post.webp({ quality: WEBP_QUALITY });
        contentType = 'image/webp';
      } else {
        pipeline = post.jpeg({ quality: JPEG_QUALITY, mozjpeg: false });
        contentType = 'image/jpeg';
      }
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

      const result: UpscaleResult = {
        buffer: data,
        width: info.width,
        height: info.height,
        contentType,
        durationMs: Date.now() - t0,
        cacheKey,
        cached: false,
      };
      setCached(cacheKey, {
        buffer: data,
        contentType,
        width: info.width,
        height: info.height,
      });
      return result;
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => {});
    }
  });
}

function normalizeExt(ext: string): '.jpg' | '.png' | '.webp' {
  const lower = ext.toLowerCase();
  if (lower === '.png') return '.png';
  if (lower === '.webp') return '.webp';
  // .jpeg → .jpg
  return '.jpg';
}

function spawnUpscaler(
  inPath: string,
  outPath: string,
  model: UpscaleModel,
  scale: UpscaleScale,
  onProgress?: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '-i', inPath,
      '-o', outPath,
      '-n', MODEL_BASENAME[model],
      '-s', String(scale),
      '-t', '256',
      '-f', 'png',
      '-m', MODELS_DIR,
    ];
    const child = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderr += text;
      // upscayl-ncnn emits per-tile lines like `25.00%`. Pull every percent
      // out of this chunk (a single chunk can carry multiple).
      if (onProgress) {
        for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*%/g)) {
          const percent = parseFloat(m[1]);
          if (percent >= 0 && percent <= 100) onProgress(percent);
        }
      }
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new UpscaleError('timeout', `Upscaling timed out after ${SPAWN_TIMEOUT_MS / 1000} s.`));
    }, SPAWN_TIMEOUT_MS);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      if (code === 0) return resolve();
      const vulkanErr = /vulkan|vk_|libvulkan/i.test(stderr);
      const errCode = vulkanErr ? 'vulkan_missing' : 'spawn_failed';
      const msg = vulkanErr
        ? 'Vulkan-Treiber fehlen — sudo apt install libvulkan1 mesa-vulkan-drivers'
        : `Upscaler exited with code ${code}. ${stderr.slice(0, 400).trim()}`;
      reject(new UpscaleError(errCode, msg));
    });
    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(new UpscaleError('spawn_failed', `Failed to spawn upscaler: ${err.message}`));
    });
  });
}

export class UpscaleError extends Error {
  constructor(public code: 'not_installed' | 'timeout' | 'spawn_failed' | 'vulkan_missing' | 'unsupported_format', message: string) {
    super(message);
    this.name = 'UpscaleError';
  }
}

export function predictOutputDims(input: { w: number; h: number }, scale: UpscaleScale): { w: number; h: number } {
  // The upscaler honours the requested scale exactly — `2×` doubles every
  // dimension, `4×` quadruples them. No envelope clamp.
  return {
    w: input.w * scale,
    h: input.h * scale,
  };
}

// Useful in tests to start from a known cache state.
export function _clearCacheForTests(): void {
  cache.clear();
}
