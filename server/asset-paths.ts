/**
 * Asset path constants — shared between the server and read-only CLI tools
 * (sync-assets.ts, scripts/diagnose-sync-drift.ts, …) so every caller resolves
 * `local-assets/` and the NAS share to the exact same locations.
 */

import path from 'path';

export const ROOT_DIR = process.cwd();
export const NAS_BASE = '/Volumes/Georg/Gameshow/Assets';
export const LOCAL_ASSETS_BASE = path.join(ROOT_DIR, 'local-assets');
