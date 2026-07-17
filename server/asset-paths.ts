/**
 * Asset path constants — shared between the server and read-only CLI tools
 * (sync-assets.ts, scripts/diagnose-sync-drift.ts, …) so every caller resolves
 * `local-assets/` and the NAS share to the exact same locations.
 *
 * `NAS_BASE` is resolved ONCE at module load from the operator-configurable
 * `nas-sync-prefs.json` (default: `/Volumes/Georg/Gameshow/Assets`). Changing the
 * path in the admin System tab therefore takes effect after a server restart —
 * see [specs/nas-sync-config.md](../specs/nas-sync-config.md).
 */

import path from 'path';
import { getNasBasePath } from './nas-sync-prefs.js';

export const ROOT_DIR = process.cwd();
export const NAS_BASE = getNasBasePath();
export const LOCAL_ASSETS_BASE = path.join(ROOT_DIR, 'local-assets');
