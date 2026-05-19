/**
 * Shared filesystem walk for the local + NAS asset trees. Used by the server
 * (`startupSync` / `periodicRescan`) and by read-only CLI diagnostics
 * (`scripts/diagnose-sync-drift.ts`).
 *
 * Both callers must use this exact code path. The 2026-05-15 "harmonized walk
 * filters" fix landed because a divergent walk between the server and the CLI
 * sync seeded `.sync-state.json` with file sets one side later refused to
 * recognize — false `delete-*` ops followed.
 */

import path from 'path';
import { readdir, stat } from 'fs/promises';
import { shouldSkipDirent, type FileMeta } from './nas-sync.js';

const TRASH_DIRNAME = '.trash';

/**
 * Walk every file under `<baseDir>/<folder>` recursively, applying the shared
 * `shouldSkipDirent` filter. Returned relative paths are NFC-normalized.
 *
 * If the top-level folder is absent (e.g. a fresh `local-assets/` without an
 * `audio/` subfolder yet), the function returns `[]` rather than throwing.
 * Any deeper I/O error propagates to the caller — partial results are never
 * returned silently.
 */
export async function walkFiles(baseDir: string, folder: string): Promise<string[]> {
  const results: string[] = [];
  const dir = path.join(baseDir, folder);
  try { await stat(dir); } catch { return results; }
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (shouldSkipDirent(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) { await walk(full); }
      else if (entry.isFile()) { results.push(path.relative(baseDir, full).normalize('NFC')); }
    }
  }
  await walk(dir);
  return results;
}

/**
 * Walk every folder in `folders` under `baseDir` and collect `{mtime, size}`
 * for each file. Per-file `stat` failures are skipped (best-effort) — they
 * usually indicate the file was renamed between readdir and stat.
 */
export async function collectFileMetadata(
  baseDir: string,
  folders: readonly string[],
): Promise<Map<string, FileMeta>> {
  const files = new Map<string, FileMeta>();
  for (const folder of folders) {
    for (const rel of await walkFiles(baseDir, folder)) {
      try {
        const st = await stat(path.join(baseDir, rel));
        files.set(rel, { mtime: st.mtime, size: st.size });
      } catch { /* skip */ }
    }
  }
  return files;
}

/**
 * Collect every `<folder>/<rel>` path currently sitting under a DAM trash
 * batch (`<baseDir>/<folder>/.trash/<batchId>/<rel>`), normalized to NFC and
 * keyed so each entry matches the corresponding `computeSyncOps` key.
 *
 * Used by Layer 2 + Layer 3 to recognize the trash-intent override: a file
 * present here is direct on-disk evidence that the DAM deleted it. When the
 * symmetric NAS move-to-trash op fails (EBUSY / NAS unmounted at enqueue),
 * the next sync run sees the file as "missing from local, present on NAS,
 * in prev" → `delete-nas`. That's correct recovery, not a bug — so it must
 * not count toward the bulk-delete cap or trigger the local-loss veto.
 *
 * Trash GC is best-effort (`pruneTrash` in [server/sync-safety.ts]) and
 * purge-on-batch-change happens in the DAM delete handler. Either way the
 * trash set shrinks over time — if a previously-trashed file no longer
 * lives in trash, the intent has expired and the recovery falls back to
 * the Layer 3 cap, which is the desired behavior (purging trash is itself
 * a user signal of "yes, really delete").
 */
export async function collectTrashedRelPaths(
  baseDir: string,
  folders: readonly string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const folder of folders) {
    const trashRoot = path.join(baseDir, folder, TRASH_DIRNAME);
    try { await stat(trashRoot); } catch { continue; }
    let batches: import('fs').Dirent[];
    try {
      batches = await readdir(trashRoot, { withFileTypes: true });
    } catch { continue; }
    for (const batch of batches) {
      if (!batch.isDirectory()) continue;
      if (batch.name.startsWith('.')) continue;
      const batchDir = path.join(trashRoot, batch.name);
      await walkBatch(batchDir, folder, batchDir, out);
    }
  }
  return out;
}

async function walkBatch(
  current: string,
  folder: string,
  batchRoot: string,
  out: Set<string>,
): Promise<void> {
  let entries: import('fs').Dirent[];
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch { return; }
  for (const entry of entries) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walkBatch(full, folder, batchRoot, out);
    } else if (entry.isFile()) {
      const relFromBatch = path.relative(batchRoot, full).normalize('NFC');
      out.add(path.join(folder, relFromBatch).normalize('NFC'));
    }
  }
}
