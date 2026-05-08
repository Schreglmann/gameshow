/**
 * Sync-safety I/O helpers — companion to `server/nas-sync.ts`.
 *
 * `nas-sync.ts` keeps its functions pure; this file is where the filesystem
 * side of Layer 1 (soft-delete to .trash/) lives, plus the periodic GC.
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'fs';
import path from 'path';
import { trashRel } from './nas-sync.js';

const TRASH_DIRNAME = '.trash';
const DEFAULT_MAX_AGE_DAYS = 30;

/**
 * Soft-delete: move `<baseDir>/<rel>` to `<baseDir>/.trash/<runId>/<rel>`.
 *
 * Mirrors the original directory layout under the run-ID folder so a restore is
 * a single `mv .trash/<runId>/* .`. If the destination already exists (e.g. a
 * sync was retried after a partial failure), append `.1`, `.2`, … to the
 * filename. The source not existing is treated as success — the goal is "the
 * file is no longer at the live path", which is already true.
 */
export function softDelete(baseDir: string, rel: string, runId: string): void {
  const src = path.join(baseDir, rel);
  if (!existsSync(src)) return;

  const dest = path.join(baseDir, trashRel(rel, runId));
  mkdirSync(path.dirname(dest), { recursive: true });

  let target = dest;
  let suffix = 0;
  while (existsSync(target)) {
    suffix++;
    target = `${dest}.${suffix}`;
  }
  renameSync(src, target);
}

/**
 * Garbage-collect trash directories whose runId folders are older than
 * `maxAgeDays` (by mtime of the runId folder itself). Best-effort — each
 * failure is logged but does not abort.
 */
export function pruneTrash(baseDir: string, maxAgeDays: number = DEFAULT_MAX_AGE_DAYS): void {
  const trashDir = path.join(baseDir, TRASH_DIRNAME);
  if (!existsSync(trashDir)) return;

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = readdirSync(trashDir);
  } catch (err) {
    console.warn(`[sync-safety] pruneTrash: cannot read ${trashDir}: ${(err as Error).message}`);
    return;
  }

  for (const entry of entries) {
    const full = path.join(trashDir, entry);
    try {
      const st = statSync(full);
      if (!st.isDirectory()) continue;
      if (st.mtime.getTime() <= cutoff) {
        rmSync(full, { recursive: true, force: true });
        console.log(`[sync-safety] pruned trash run ${entry} from ${trashDir}`);
      }
    } catch (err) {
      console.warn(`[sync-safety] pruneTrash: skip ${full}: ${(err as Error).message}`);
    }
  }
}
