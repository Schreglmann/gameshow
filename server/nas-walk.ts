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
