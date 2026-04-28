/**
 * Video reference map — tracks which entries in `local-assets/videos/` are
 * reference-only (a symlink to an external source file) rather than a locally
 * stored copy. The DAM lists both kinds transparently; the registry is the
 * source of truth for "is-a-reference" and records the original source path
 * so the UI can display it and self-heal stale entries.
 *
 * Stored as a dotfile inside the videos category so it's excluded from DAM
 * listings by the existing `e.name.startsWith('.')` filter.
 *
 * Shape: `{ [relPath]: { sourcePath: string, addedAt: number } }` — relPath is
 * the path inside `local-assets/videos/` (forward slashes, no leading slash).
 *
 * See specs/video-references.md.
 */

import path from 'path';
import { existsSync } from 'fs';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';

export interface VideoReferenceEntry {
  sourcePath: string;
  addedAt: number;
}

export type VideoReferenceMap = Record<string, VideoReferenceEntry>;

export function referenceMapPath(videosCategoryDir: string): string {
  return path.join(videosCategoryDir, '.video-references.json');
}

export async function readReferenceMap(videosCategoryDir: string): Promise<VideoReferenceMap> {
  const file = referenceMapPath(videosCategoryDir);
  if (!existsSync(file)) return {};
  try {
    const raw = await readFile(file, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: VideoReferenceMap = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const sourcePath = (v as Record<string, unknown>).sourcePath;
          const addedAt = (v as Record<string, unknown>).addedAt;
          if (typeof sourcePath === 'string' && typeof addedAt === 'number') {
            out[k] = { sourcePath, addedAt };
          }
        }
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

async function writeReferenceMap(videosCategoryDir: string, map: VideoReferenceMap): Promise<void> {
  const file = referenceMapPath(videosCategoryDir);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
  await rename(tmp, file);
}

export async function addReference(
  videosCategoryDir: string,
  relPath: string,
  sourcePath: string,
): Promise<void> {
  if (!relPath || !sourcePath) return;
  const map = await readReferenceMap(videosCategoryDir);
  map[relPath] = { sourcePath, addedAt: Date.now() };
  await writeReferenceMap(videosCategoryDir, map);
}

export async function removeReference(videosCategoryDir: string, relPath: string): Promise<boolean> {
  const map = await readReferenceMap(videosCategoryDir);
  if (!(relPath in map)) return false;
  delete map[relPath];
  await writeReferenceMap(videosCategoryDir, map);
  return true;
}

export async function renameReference(
  videosCategoryDir: string,
  fromRel: string,
  toRel: string,
): Promise<void> {
  if (fromRel === toRel) return;
  const map = await readReferenceMap(videosCategoryDir);
  if (!(fromRel in map)) return;
  map[toRel] = map[fromRel];
  delete map[fromRel];
  await writeReferenceMap(videosCategoryDir, map);
}

/** Drop entries whose expected symlink no longer exists on disk. Returns the
 *  list of removed relPaths so callers can log them. Idempotent. */
export async function pruneStaleReferences(
  videosCategoryDir: string,
): Promise<string[]> {
  const map = await readReferenceMap(videosCategoryDir);
  const removed: string[] = [];
  for (const relPath of Object.keys(map)) {
    const linkPath = path.join(videosCategoryDir, relPath);
    // `existsSync` follows the symlink: a dangling link returns false, but the
    // link file itself still exists. Use `lstat`-style check via existence of
    // the link entry in its parent directory instead.
    // Simpler: check if the relPath's parent dir lists this entry.
    try {
      // Use readlink via dynamic import to avoid top-level sync call
      const { readlinkSync, lstatSync } = await import('fs');
      lstatSync(linkPath); // throws if neither file nor symlink entry exists
      // Entry exists (either a copy, a symlink, or dangling symlink). Keep.
      void readlinkSync; // unused, kept for API symmetry
    } catch {
      removed.push(relPath);
      delete map[relPath];
    }
  }
  if (removed.length > 0) {
    await writeReferenceMap(videosCategoryDir, map);
  }
  return removed;
}

/** Check if a relPath is registered as a reference. */
export function isReference(map: VideoReferenceMap, relPath: string): boolean {
  return relPath in map;
}
