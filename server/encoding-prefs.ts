/**
 * Operator-local preference for the background-encoding priority mode.
 *
 * Two modes — see [specs/server-asset-priority.md](../specs/server-asset-priority.md):
 *   - `balanced` (default): utility QoS / nice 19, BG_ENCODE_CONCURRENCY = 1.
 *     File serving wins. Safe for live shows.
 *   - `max`: no priority demotion, BG_ENCODE_CONCURRENCY = 4. All-out
 *     throughput for prep windows. Operator-opt-in.
 *
 * Persistence: `encoding-prefs.json` at repo root. Atomic write (tmp + rename).
 * The in-memory cache is invalidated on every set, but reads return the cached
 * value to avoid hitting disk on the hot `bgProcessPrefix()` / `bgEncodeAcquire()`
 * paths (called per ffmpeg spawn).
 *
 * Mode change is delivered via the on-change subscription registry so that each
 * subprocess module (index.ts, whisper-jobs.ts, normalize.ts) can re-apply the
 * priority of its own already-running children without this module needing to
 * know about them.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';

export type CacheMode = 'balanced' | 'max';

interface EncodingPrefs {
  cacheMode: CacheMode;
}

const PREFS_PATH = path.join(process.cwd(), 'encoding-prefs.json');
const DEFAULT_PREFS: EncodingPrefs = { cacheMode: 'balanced' };

let cached: EncodingPrefs | null = null;

function load(): EncodingPrefs {
  if (cached) return cached;
  try {
    if (existsSync(PREFS_PATH)) {
      const text = readFileSync(PREFS_PATH, 'utf-8');
      const parsed = JSON.parse(text) as Partial<EncodingPrefs>;
      cached = { cacheMode: parsed.cacheMode === 'max' ? 'max' : 'balanced' };
      return cached;
    }
  } catch (e) {
    console.warn('[encoding-prefs] failed to load, using defaults:', e instanceof Error ? e.message : e);
  }
  cached = { ...DEFAULT_PREFS };
  return cached;
}

export function getCacheMode(): CacheMode {
  return load().cacheMode;
}

const listeners = new Set<(mode: CacheMode) => void>();

/** Register a callback that fires after every successful `setCacheMode()`. Used
 *  by subprocess modules to re-apply the new priority to their in-flight PIDs. */
export function onCacheModeChange(cb: (mode: CacheMode) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function setCacheMode(mode: CacheMode): void {
  const prefs: EncodingPrefs = { ...load(), cacheMode: mode };
  cached = prefs;
  const tmp = PREFS_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(prefs, null, 2) + '\n');
  renameSync(tmp, PREFS_PATH);
  for (const cb of listeners) {
    try { cb(mode); } catch (e) {
      console.warn('[encoding-prefs] listener threw:', e instanceof Error ? e.message : e);
    }
  }
}

/** Argv that re-applies the given mode's priority to an already-running PID.
 *  The PID is appended as the last positional arg by the caller. Returns null
 *  on platforms where in-place re-pricing isn't supported (Windows).
 *
 *  - macOS: `taskpolicy -c <utility|default> -p <pid>` flips the QoS clamp.
 *    `default` removes the clamp, restoring user-initiated priority.
 *  - Linux: `renice -n <19|0> -p <pid>`. Niceness 19 = max yield; 0 = default.
 */
export function getRepriceArgs(mode: CacheMode): string[] | null {
  if (process.platform === 'darwin') {
    return ['taskpolicy', '-c', mode === 'max' ? 'default' : 'utility', '-p'];
  }
  if (process.platform === 'linux') {
    return ['renice', '-n', mode === 'max' ? '0' : '19', '-p'];
  }
  return null;
}
