/**
 * Natural-pixel-dimension extraction for raster images in the `images` DAM category.
 *
 * Backs the Image DAM's "Niedrige Auflösung" filter and "Auflösung" sort. The
 * caching strategy mirrors `durationCache` in [server/index.ts]:
 *   - in-memory `Map` keyed by absolute path → `{ mtimeMs, width, height }`
 *   - flushed to a persistent JSON sidecar (`<LOCAL_ASSETS_BASE>/.image-dimension-cache.json`)
 *   - lookups validate by `mtimeMs` so an edited file is re-probed automatically
 *
 * SVGs are intentionally skipped — vector files scale to any size and would always
 * read as "not low-res". Callers should never set `meta.dimensions` for them.
 */
import path from 'path';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { stat } from 'fs/promises';
import sharp from 'sharp';

interface DimensionEntry {
  mtimeMs: number;
  width: number;
  height: number;
}

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif']);

export function isProbeableImageForDimensions(p: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());
}

let cacheFile = '';
const dimensionCache = new Map<string, DimensionEntry>();
let dimensionCacheDirty = false;

export function initDimensionCache(absCacheFile: string): void {
  cacheFile = absCacheFile;
  if (!existsSync(cacheFile)) return;
  try {
    const raw = JSON.parse(readFileSync(cacheFile, 'utf-8')) as Record<string, DimensionEntry>;
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v.mtimeMs === 'number' && typeof v.width === 'number' && typeof v.height === 'number') {
        dimensionCache.set(k, v);
      }
    }
  } catch {
    /* corrupt cache — start empty */
  }
}

export function saveDimensionCache(): void {
  if (!dimensionCacheDirty || !cacheFile) return;
  dimensionCacheDirty = false;
  try {
    const obj: Record<string, DimensionEntry> = {};
    for (const [k, v] of dimensionCache) obj[k] = v;
    writeFileSync(cacheFile, JSON.stringify(obj) + '\n');
  } catch {
    /* non-critical */
  }
}

/** Cached lookup — instant, no I/O. Returns `undefined` if missing or mtime mismatch. */
export function getCachedDimensions(filePath: string, mtimeMs: number): { width: number; height: number } | undefined {
  const cached = dimensionCache.get(filePath);
  return (cached && cached.mtimeMs === mtimeMs) ? { width: cached.width, height: cached.height } : undefined;
}

/** Probe with sharp (slow). Stores the result in cache and returns it. */
export async function probeImageDimensions(filePath: string, mtimeMs: number): Promise<{ width: number; height: number } | undefined> {
  const cached = getCachedDimensions(filePath, mtimeMs);
  if (cached !== undefined) return cached;
  if (!isProbeableImageForDimensions(filePath)) return undefined;
  try {
    const meta = await sharp(filePath).metadata();
    const width = meta.width;
    const height = meta.height;
    if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) {
      dimensionCache.set(filePath, { mtimeMs, width, height });
      dimensionCacheDirty = true;
      return { width, height };
    }
  } catch {
    /* not a readable image — skip */
  }
  return undefined;
}

/** Fire-and-forget variant for upload / URL-download hooks. Stats the file internally. */
export function warmImageDimensions(filePath: string): void {
  if (!isProbeableImageForDimensions(filePath)) return;
  stat(filePath)
    .then(st => probeImageDimensions(filePath, st.mtimeMs))
    .catch(() => {});
}
