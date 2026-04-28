/**
 * Color profile extraction for the `colorguess` gamemode.
 *
 * Samples an image (PNG/JPG/WEBP/SVG), quantizes pixels into 64 buckets
 * (4 bins per RGB channel), and returns the top N colors by frequency as
 * `{ hex, percent }` slices. Results are persisted to a sidecar cache file
 * next to the images DAM and invalidated by the source image's mtime,
 * mirroring the pattern in [server/asset-alias-map.ts](server/asset-alias-map.ts).
 *
 * SVGs are rasterized by `sharp` (via librsvg); transparency is composited
 * onto white so the background does not dominate the profile.
 */

import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, rename, mkdir, stat } from 'fs/promises';
import sharp from 'sharp';

export interface ColorSlice {
  hex: string;
  percent: number;
}

interface ColorProfileEntry {
  mtime: number;
  colors: ColorSlice[];
}

type ProfileMap = Record<string, ColorProfileEntry>;

const SAMPLE_EDGE = 256;
const TOP_N = 6;
const REMAINDER_THRESHOLD = 0.02; // 2% — below this we renormalize the top N instead of adding a "rest" slice
const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);

export function isSupportedImageForColorProfile(p: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());
}

export function colorProfilesPath(imagesCategoryDir: string): string {
  return path.join(imagesCategoryDir, '.color-profiles.json');
}

async function readProfileMap(imagesCategoryDir: string): Promise<ProfileMap> {
  const file = colorProfilesPath(imagesCategoryDir);
  if (!existsSync(file)) return {};
  try {
    const raw = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProfileMap;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeProfileMap(imagesCategoryDir: string, map: ProfileMap): Promise<void> {
  const file = colorProfilesPath(imagesCategoryDir);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

function bucketHex(sumR: number, sumG: number, sumB: number, count: number): string {
  const r = Math.round(sumR / count);
  const g = Math.round(sumG / count);
  const b = Math.round(sumB / count);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

/**
 * Extract the top color slices from an image on disk.
 *
 * Rasters SVGs via sharp. Transparent pixels are skipped (not flattened onto
 * white) — otherwise logos with large transparent backgrounds would produce a
 * ~90% white slice that drowns out the actual logo colors. Images without an
 * alpha channel keep every pixel.
 */
export async function extractColors(absPath: string): Promise<ColorSlice[]> {
  const { data, info } = await sharp(absPath)
    .ensureAlpha()
    .resize(SAMPLE_EDGE, SAMPLE_EDGE, { fit: 'inside', withoutEnlargement: false })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  if (channels !== 4) {
    throw new Error(`Unexpected channel count after ensureAlpha: ${channels}`);
  }

  const ALPHA_THRESHOLD = 32;

  const counts = new Int32Array(64);
  const sumsR = new Float64Array(64);
  const sumsG = new Float64Array(64);
  const sumsB = new Float64Array(64);

  for (let i = 0; i < data.length; i += channels) {
    const a = data[i + 3];
    if (a < ALPHA_THRESHOLD) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const bucket = ((r >> 6) << 4) | ((g >> 6) << 2) | (b >> 6);
    counts[bucket]++;
    sumsR[bucket] += r;
    sumsG[bucket] += g;
    sumsB[bucket] += b;
  }

  let total = 0;
  for (let i = 0; i < 64; i++) total += counts[i];
  if (total === 0) return [];

  // Merge buckets that produce near-identical hex centroids. Without this,
  // SVG rasterization anti-aliasing scatters a logo's dominant color across
  // 2–3 adjacent buckets and the pie ends up with several near-duplicate
  // slices (e.g. Google's 47% blue + 0.5% slightly-different blue).
  //
  // `MERGE_DIST_SQ = 40²` is conservative: it collapses centroids that differ
  // by < 40 in each RGB channel on average (enough to catch AA artefacts) but
  // leaves distinct brand colors — even pastel variants — separate.
  interface Cluster { count: number; sumR: number; sumG: number; sumB: number }
  const MERGE_DIST_SQ = 40 * 40;
  const clusters: Cluster[] = [];

  const centroid = (c: Cluster): { r: number; g: number; b: number } => ({
    r: c.sumR / c.count,
    g: c.sumG / c.count,
    b: c.sumB / c.count,
  });

  const ranked: { bucket: number; count: number }[] = [];
  for (let i = 0; i < 64; i++) {
    if (counts[i] > 0) ranked.push({ bucket: i, count: counts[i] });
  }
  ranked.sort((a, b) => b.count - a.count);

  for (const { bucket, count } of ranked) {
    const r = sumsR[bucket] / count;
    const g = sumsG[bucket] / count;
    const b = sumsB[bucket] / count;
    let merged = false;
    for (const c of clusters) {
      const cc = centroid(c);
      const dr = r - cc.r, dg = g - cc.g, db = b - cc.b;
      if (dr * dr + dg * dg + db * db <= MERGE_DIST_SQ) {
        c.count += count;
        c.sumR += sumsR[bucket];
        c.sumG += sumsG[bucket];
        c.sumB += sumsB[bucket];
        merged = true;
        break;
      }
    }
    if (!merged) {
      clusters.push({ count, sumR: sumsR[bucket], sumG: sumsG[bucket], sumB: sumsB[bucket] });
    }
  }

  clusters.sort((a, b) => b.count - a.count);

  const top = clusters.slice(0, TOP_N);
  const topCount = top.reduce((s, c) => s + c.count, 0);
  const remainder = total - topCount;
  const remainderFraction = remainder / total;

  const slices: ColorSlice[] = top.map(c => ({
    hex: bucketHex(c.sumR, c.sumG, c.sumB, c.count),
    percent: (c.count / total) * 100,
  }));

  if (remainderFraction > REMAINDER_THRESHOLD) {
    let rR = 0, rG = 0, rB = 0;
    for (const c of clusters.slice(TOP_N)) {
      rR += c.sumR;
      rG += c.sumG;
      rB += c.sumB;
    }
    slices.push({
      hex: bucketHex(rR, rG, rB, remainder),
      percent: remainderFraction * 100,
    });
  } else if (slices.length > 0) {
    const sum = slices.reduce((s, sl) => s + sl.percent, 0);
    for (const sl of slices) sl.percent = (sl.percent / sum) * 100;
  }

  // Round to 1 decimal and fix rounding drift by absorbing residual into the largest slice.
  for (const sl of slices) sl.percent = Math.round(sl.percent * 10) / 10;
  if (slices.length > 0) {
    const sum = slices.reduce((s, sl) => s + sl.percent, 0);
    const drift = 100 - sum;
    if (Math.abs(drift) > 0.001) {
      let largestIdx = 0;
      for (let i = 1; i < slices.length; i++) {
        if (slices[i].percent > slices[largestIdx].percent) largestIdx = i;
      }
      slices[largestIdx].percent = Math.round((slices[largestIdx].percent + drift) * 10) / 10;
    }
  }

  return slices;
}

/**
 * Return the color profile for an image under the images DAM.
 * Uses the sidecar cache when valid; extracts + persists on miss or mtime mismatch.
 *
 * @param imagesCategoryDir Absolute path to the `images` category root
 * @param relPath Image path relative to the images category root (no leading slash)
 */
export async function getColorProfile(
  imagesCategoryDir: string,
  relPath: string,
): Promise<ColorSlice[]> {
  const normalized = relPath.replace(/^\/+/, '');
  const absPath = path.join(imagesCategoryDir, normalized);
  if (!existsSync(absPath)) {
    return [];
  }

  const st = await stat(absPath);
  const mtime = st.mtimeMs;

  const map = await readProfileMap(imagesCategoryDir);
  const cached = map[normalized];
  if (cached && cached.mtime === mtime) {
    return cached.colors;
  }

  let colors: ColorSlice[];
  try {
    colors = await extractColors(absPath);
  } catch (err) {
    console.error(`[color-profile] extraction failed for ${normalized}: ${(err as Error).message}`);
    return [];
  }

  const next = await readProfileMap(imagesCategoryDir);
  next[normalized] = { mtime, colors };
  try {
    await writeProfileMap(imagesCategoryDir, next);
  } catch (err) {
    console.error(`[color-profile] failed to persist cache: ${(err as Error).message}`);
  }
  return colors;
}

/**
 * Fire-and-forget variant for the upload hook. Errors are swallowed.
 */
export function warmColorProfile(imagesCategoryDir: string, relPath: string): void {
  if (!isSupportedImageForColorProfile(relPath)) return;
  getColorProfile(imagesCategoryDir, relPath).catch(() => {});
}
