import path from 'path';
import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'fs';

/**
 * Persistence + selection helpers for prerendered random-frame fallback frames.
 *
 * The `random-frame` game extracts a still frame live from the source video. When that
 * source is unreachable (e.g. a NAS-only file with the NAS not mounted at a live event),
 * the server instead serves frames the admin downloaded ahead of time. This module owns the
 * manifest sidecar + the on-disk layout; the actual ffmpeg extraction stays in server/index.ts
 * (it depends on index-local helpers). Kept separate so the pure logic is unit-testable.
 *
 * See specs/games/random-frame.md.
 */

export interface PrerenderEntry {
  /** Filenames (relative to the prerendered dir) of the downloaded variants, in stable order. */
  files: string[];
  /** Index into `files` of the variant shown FIRST offline (the GM rotate starts here). Default 0.
   *  Stored as a marker so selecting a different "first" never reorders/re-downloads the files. */
  first?: number;
}

/** Directory holding the prerendered JPEGs, under the random-frame cache dir. */
export function prerenderedDir(framesDir: string): string {
  return path.join(framesDir, 'prerendered');
}

/** Manifest sidecar path: `<framesDir>/.prerender.json`. */
export function prerenderManifestFile(framesDir: string): string {
  return path.join(framesDir, '.prerender.json');
}

/**
 * Manifest key for a (video, question-index) pair. Prerendered frames are stored **per
 * question**, not per video, so the same movie used in several questions gets its own
 * independently-downloaded frames. `qindex` is the question's original (pre-shuffle) index.
 */
export function prerenderKey(relPath: string, qindex: number): string {
  return `${relPath}#${qindex}`;
}

/** Variant filename for a given cache slug + question index + variant, e.g. `My__Film__q2__p0.jpg`. */
export function prerenderedFileName(slug: string, qindex: number, variant: number): string {
  return `${slug}__q${qindex}__p${variant}.jpg`;
}

/** Load the manifest into a Map. Returns an empty Map on first run / parse error. */
export function loadPrerenderManifest(framesDir: string): Map<string, PrerenderEntry> {
  const map = new Map<string, PrerenderEntry>();
  try {
    const data = JSON.parse(readFileSync(prerenderManifestFile(framesDir), 'utf-8')) as Record<string, PrerenderEntry>;
    for (const [k, v] of Object.entries(data)) {
      if (v && Array.isArray(v.files)) {
        const files = v.files.filter(f => typeof f === 'string');
        const first = typeof v.first === 'number' && v.first >= 0 && v.first < files.length ? v.first : 0;
        map.set(k, { files, first });
      }
    }
  } catch { /* first run or missing */ }
  return map;
}

/** Atomically persist the manifest Map (tmp file + rename). */
export function savePrerenderManifest(framesDir: string, map: Map<string, PrerenderEntry>): void {
  const file = prerenderManifestFile(framesDir);
  mkdirSync(path.dirname(file), { recursive: true });
  const obj: Record<string, PrerenderEntry> = {};
  for (const [k, v] of map) obj[k] = v;
  const tmp = file + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  renameSync(tmp, file);
}

/** Absolute path of the raw file at `slot` (no `first` offset). For the admin preview, which shows
 *  the variants in stable order. Returns null if there are no files or the file is missing. */
export function selectPrerenderedSlot(framesDir: string, entry: PrerenderEntry | undefined, slot: number): string | null {
  if (!entry || entry.files.length === 0) return null;
  const len = entry.files.length;
  const idx = ((slot % len) + len) % len;
  const full = path.join(prerenderedDir(framesDir), entry.files[idx]);
  return existsSync(full) ? full : null;
}

/**
 * Resolve the absolute path of the prerendered variant to serve for a (entry, variant) pair as
 * the SHOW sees it: the rotate counter `variant` is offset by the marked `first`, then cycled
 * through the files (`(first + variant) % count`) — so variant 0 is the marked-first frame and
 * the GM rotate walks the rest in stable order. Returns null when there are no files or the
 * selected file is missing on disk.
 */
export function selectPrerenderedFile(framesDir: string, entry: PrerenderEntry | undefined, variant: number): string | null {
  if (!entry || entry.files.length === 0) return null;
  return selectPrerenderedSlot(framesDir, entry, (entry.first ?? 0) + variant);
}
