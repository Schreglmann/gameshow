/**
 * Sync-safety I/O helpers — companion to `server/nas-sync.ts`.
 *
 * `nas-sync.ts` keeps its functions pure; this file is where the filesystem
 * side of Layer 1 (soft-delete to .trash/) lives, plus the periodic GC.
 *
 * All I/O here is async (`fs/promises`). These run against `NAS_BASE` as well as
 * the local tree; a stale NAS mount must never block the main thread (see
 * specs/nas-freeze-resilience.md), so synchronous fs calls are forbidden here.
 */

import { mkdir, readdir, rename, rm, stat } from 'fs/promises';
import path from 'path';
import { trashRel } from './nas-sync.js';

const TRASH_DIRNAME = '.trash';
const DEFAULT_MAX_AGE_DAYS = 30;

/** Resolve to true iff `p` exists (async, never blocks the main thread). */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Soft-delete: move `<baseDir>/<rel>` to `<baseDir>/.trash/<runId>/<rel>`.
 *
 * Mirrors the original directory layout under the run-ID folder so a restore is
 * a single `mv .trash/<runId>/* .`. If the destination already exists (e.g. a
 * sync was retried after a partial failure), append `.1`, `.2`, … to the
 * filename. The source not existing is treated as success — the goal is "the
 * file is no longer at the live path", which is already true.
 */
export async function softDelete(baseDir: string, rel: string, runId: string): Promise<void> {
  const src = path.join(baseDir, rel);
  if (!(await pathExists(src))) return;

  const dest = path.join(baseDir, trashRel(rel, runId));
  await mkdir(path.dirname(dest), { recursive: true });

  let target = dest;
  let suffix = 0;
  while (await pathExists(target)) {
    suffix++;
    target = `${dest}.${suffix}`;
  }
  await rename(src, target);
}

/**
 * Garbage-collect trash directories whose runId folders are older than
 * `maxAgeDays` (by mtime of the runId folder itself). Best-effort — each
 * failure is logged but does not abort.
 */
export async function pruneTrash(baseDir: string, maxAgeDays: number = DEFAULT_MAX_AGE_DAYS): Promise<void> {
  const trashDir = path.join(baseDir, TRASH_DIRNAME);

  // If a stray file lives at `.trash` (e.g. a user touched it by mistake or a
  // failed copy left a `.trash.tmp` shape) readdir would throw ENOTDIR.
  // Catching the error in the readdir try/catch loses the cause — log the
  // distinct condition so the operator knows GC is silently disabled.
  let trashStat;
  try {
    trashStat = await stat(trashDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return; // no trash dir yet
    console.warn(`[sync-safety] pruneTrash: stat ${trashDir} failed: ${(err as Error).message}`);
    return;
  }
  if (!trashStat.isDirectory()) {
    console.warn(`[sync-safety] pruneTrash: ${trashDir} exists but is not a directory; GC disabled.`);
    return;
  }

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = await readdir(trashDir);
  } catch (err) {
    console.warn(`[sync-safety] pruneTrash: cannot read ${trashDir}: ${(err as Error).message}`);
    return;
  }

  for (const entry of entries) {
    const full = path.join(trashDir, entry);
    try {
      const st = await stat(full);
      if (!st.isDirectory()) continue;
      if (st.mtime.getTime() <= cutoff) {
        await rm(full, { recursive: true, force: true });
        console.log(`[sync-safety] pruned trash run ${entry} from ${trashDir}`);
      }
    } catch (err) {
      console.warn(`[sync-safety] pruneTrash: skip ${full}: ${(err as Error).message}`);
    }
  }
}
