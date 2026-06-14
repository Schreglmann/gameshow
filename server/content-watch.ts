/**
 * Content file watcher — pushes a `content-changed` WebSocket event whenever
 * config.json, theme-settings.json, or a games/*.json file changes on disk, so
 * the live frontend can re-fetch without a page reload. See
 * specs/live-config-reload.md and AGENTS.md §2a (API contracts).
 *
 * Catches every change source — admin CMS PUT endpoints, direct file edits,
 * `git`, `npm run fixtures` — because they all ultimately land bytes on disk.
 *
 * Watches DIRECTORIES, not individual files: the write endpoints save
 * atomically (write `*.tmp`, then rename onto the final path). A file-level
 * watch would lose the inode on the rename; a directory watch reports the
 * final filename reliably across macOS (FSEvents) and Linux (inotify).
 *
 * Best-effort: a failed `fs.watch` logs a warning and continues (the watcher
 * is a nicety, never a hard dependency — mirrors server/whisper-jobs.ts).
 */

import { watch as fsWatch, type FSWatcher } from 'fs';
import path from 'path';
import { broadcast } from './ws.js';
import type { ContentChangedPayload } from '../src/types/config.js';

const DEBOUNCE_MS = 200;

export function startContentWatch(rootDir: string, gamesDir: string): () => void {
  let pending: ContentChangedPayload = {};
  let timer: NodeJS.Timeout | null = null;

  const flush = (): void => {
    timer = null;
    if (!pending.config && !pending.theme && !pending.games) return;
    const payload = pending;
    pending = {};
    // broadcast() no-ops when no clients are connected, so this is cheap.
    broadcast('content-changed', payload);
  };

  const schedule = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, DEBOUNCE_MS);
  };

  const watchers: FSWatcher[] = [];

  // An FSWatcher can also error AFTER creation (e.g. EMFILE under fd pressure); without an
  // 'error' listener that crashes the process. Same best-effort contract: warn + drop.
  const armed = (w: FSWatcher, dir: string): FSWatcher => {
    if (typeof w.on === 'function') {
      w.on('error', (err) => {
        console.warn(`[content-watch] fs.watch error for ${dir}: ${(err as Error).message}`);
        try { w.close(); } catch { /* ignore */ }
      });
    }
    return w;
  };

  // Root dir: config.json + theme-settings.json. Exact-name match also excludes
  // the atomic-write tmp files (config.json.tmp / theme-settings.json.tmp).
  try {
    watchers.push(
      armed(fsWatch(rootDir, { persistent: false }, (_event, filename) => {
        if (filename === 'config.json') pending.config = true;
        else if (filename === 'theme-settings.json') pending.theme = true;
        else return;
        schedule();
      }), rootDir),
    );
  } catch (err) {
    console.warn(`[content-watch] fs.watch failed for ${rootDir}: ${(err as Error).message}`);
  }

  // Games dir: any *.json, excluding the per-save tmp form `<name>.json.<uuid>.tmp`.
  try {
    watchers.push(
      armed(fsWatch(gamesDir, { persistent: false }, (_event, filename) => {
        if (!filename) return;
        const name = typeof filename === 'string' ? filename : path.basename(String(filename));
        if (!name.endsWith('.json') || name.endsWith('.tmp')) return;
        pending.games = true;
        schedule();
      }), gamesDir),
    );
  } catch (err) {
    console.warn(`[content-watch] fs.watch failed for ${gamesDir}: ${(err as Error).message}`);
  }

  return () => {
    if (timer) { clearTimeout(timer); timer = null; }
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
  };
}
