/**
 * Operator-configurable NAS sync settings — see [specs/nas-sync-config.md](../specs/nas-sync-config.md).
 *
 * Two fields, persisted to `nas-sync-prefs.json` at repo root (atomic write, tmp + rename):
 *   - `basePath`: the NAS mount/base directory bidirectional sync targets. Consumed via
 *     `asset-paths.ts` (`NAS_BASE`), which resolves it ONCE at module load — so a path change
 *     only takes effect after a server restart. This is deliberate: the sync safety layers and
 *     `.sync-state.json` files are tied to one stable NAS identity (see specs/sync-bidirectional.md).
 *   - `enabled`: master on/off switch for sync WRITE/propagation. Read live at each sync trigger,
 *     so toggling takes effect without a restart. It does NOT gate NAS reads.
 *
 * Default: the previously-hardcoded path, sync enabled — so with no sidecar present, behaviour is
 * identical to before this setting existed.
 *
 * Uses only `fs` + `path` (no import of `asset-paths.ts`) to stay dependency-light and free of
 * import cycles: `asset-paths.ts` imports THIS module, and CLI tools import `asset-paths.ts`.
 */

import { existsSync, readFileSync, writeFileSync, renameSync } from 'fs';
import path from 'path';

export interface NasSyncPrefs {
  basePath: string;
  enabled: boolean;
}

const DEFAULT_PREFS: NasSyncPrefs = {
  basePath: '/Volumes/Georg/Gameshow/Assets',
  enabled: true,
};

// Fixed to the repo root in production; overridable so unit tests stay hermetic.
let prefsPathOverride: string | null = null;
function prefsPath(): string {
  return prefsPathOverride ?? path.join(process.cwd(), 'nas-sync-prefs.json');
}

let cached: NasSyncPrefs | null = null;

function load(): NasSyncPrefs {
  if (cached) return cached;
  try {
    if (existsSync(prefsPath())) {
      const text = readFileSync(prefsPath(), 'utf-8');
      const parsed = JSON.parse(text) as Partial<NasSyncPrefs>;
      const basePath =
        typeof parsed.basePath === 'string' && parsed.basePath.trim() && path.isAbsolute(parsed.basePath.trim())
          ? parsed.basePath.trim()
          : DEFAULT_PREFS.basePath;
      cached = { basePath, enabled: parsed.enabled !== false };
      return cached;
    }
  } catch (e) {
    console.warn('[nas-sync-prefs] failed to load, using defaults:', e instanceof Error ? e.message : e);
  }
  cached = { ...DEFAULT_PREFS };
  return cached;
}

export function getNasSyncConfig(): NasSyncPrefs {
  return { ...load() };
}

export function getNasBasePath(): string {
  return load().basePath;
}

export function getNasSyncEnabled(): boolean {
  return load().enabled;
}

/**
 * Persist a partial update. Throws on an invalid `basePath` (must be a non-empty absolute path)
 * or a non-boolean `enabled`, so the route can answer 400 without mutating anything. Returns the
 * new full config.
 */
export function setNasSyncConfig(partial: { basePath?: unknown; enabled?: unknown }): NasSyncPrefs {
  const next: NasSyncPrefs = { ...load() };

  if (partial.basePath !== undefined) {
    if (typeof partial.basePath !== 'string') {
      throw new Error('basePath must be a string');
    }
    const trimmed = partial.basePath.trim();
    if (!trimmed) throw new Error('basePath must not be empty');
    if (!path.isAbsolute(trimmed)) throw new Error('basePath must be an absolute path');
    next.basePath = trimmed;
  }

  if (partial.enabled !== undefined) {
    if (typeof partial.enabled !== 'boolean') throw new Error('enabled must be a boolean');
    next.enabled = partial.enabled;
  }

  cached = next;
  const tmp = prefsPath() + '.tmp';
  writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
  renameSync(tmp, prefsPath());
  return { ...next };
}

/** Test-only: point the sidecar at a temp file and reset the in-memory cache. */
export function _setNasSyncPrefsPathForTests(p: string | null): void {
  prefsPathOverride = p;
  cached = null;
}

/** Test-only: reset the in-memory cache between vitest cases. */
export function _resetNasSyncPrefsForTests(): void {
  cached = null;
}
